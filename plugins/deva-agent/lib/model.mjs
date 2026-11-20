/**
 * Studio scoped 模型的三种协议适配：chat_completions / anthropic_messages / codex_responses。
 *
 * 为什么自己实现而不用 SDK：Agent 插件拿到的是 Studio 注入的短期代理（baseUrl + token），
 * 走的是标准协议；这里只做"发一轮请求、解析流、拼出文本与工具调用"这一件事，
 * 不引入任何依赖，出错时统一把 token 打码。
 *
 * 归一化的会话结构（loop.mjs 维护）：
 *   { role: 'user' | 'assistant' | 'tool', text, images?, toolCalls?, toolCallId?, name? }
 *
 * 正文里漏出的 DeepSeek DSML 工具调用在 callModel 这一层统一兜底（见 lib/dsml.mjs），三个适配器不各自处理。
 */

import { DsmlGuard, settleDsml } from './dsml.mjs'

const ANTHROPIC_VERSION = '2023-06-01'

/**
 * 调用方主动掐断流时抛的哨兵（复读检测用）。callModel 原样透出，不包成「模型请求失败」，
 * 也不当成「本轮已被取消」——那两种文案会误导模型与用户。
 */
export class StreamAbort extends Error {
  constructor() {
    super('输出流已被调用方掐断')
    this.name = 'StreamAbort'
  }
}

/** baseUrl 可能已经带 /v1，也可能只是 host 根；两种都拼成 <base>/v1/<path> 或 <base>/<path>。 */
export function endpoint(baseUrl, suffix) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('scoped 模型缺少 baseUrl')
  return base.endsWith('/v1') ? `${base}${suffix}` : `${base}/v1${suffix}`
}

export function redact(message, token) {
  const text = String(message ?? '')
  return token ? text.split(String(token)).join('[redacted]') : text
}

async function readError(response) {
  let body = ''
  try { body = (await response.text()).slice(0, 800) } catch { body = '' }
  return `模型请求失败：HTTP ${response.status}${body ? ` ${body}` : ''}`
}

/** 逐帧读 SSE，容忍 CRLF 与跨块截断。 */
export async function* sseFrames(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const drain = () => {
    const frames = []
    let index
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      frames.push(buffer.slice(0, index))
      buffer = buffer.slice(index + 2)
    }
    return frames
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
      for (const frame of drain()) {
        const data = frame.split('\n').filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n').trim()
        if (!data || data === '[DONE]') continue
        yield data
      }
    }
    buffer += decoder.decode()
    for (const frame of drain()) {
      const data = frame.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n').trim()
      if (data && data !== '[DONE]') yield data
    }
  } finally {
    // 调用方提前 break（复读掐断）时真正关掉连接，别把剩下的流读完再丢。
    try { await reader.cancel() } catch { /* 已经结束或已释放 */ }
    try { reader.releaseLock() } catch { /* 已经释放 */ }
  }
}

const number = value => (Number.isFinite(value) ? Number(value) : 0)

/**
 * Gemini 对没有签名的工具调用认的占位签名（官方给的兜底值）：跳过校验，代价是这一步没有思考上下文可接。
 * 只用于拿不到真签名的调用——别的模型留下的历史、参数残缺的调用、本修复之前的旧对话。
 */
const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator'

/** 请求是否发往 Gemini（官方的 OpenAI 兼容端点，或经中转但模型名带 gemini）。 */
function isGemini(baseUrl, model) {
  return /gemini/i.test(String(model || '')) || /generativelanguage\.googleapis\.com/i.test(String(baseUrl || ''))
}

/**
 * 回放第 index 个工具调用时要带的 Gemini 思考签名。Gemini 3 起每一步的第一个工具调用必须带签名，
 * 缺了整个请求 400（issue #74）；同一步并行的其余调用本来就没有签名。故有真签名的原样带回，
 * 第一个调用没有的补占位签名。只对 Gemini 发：别家不认 extra_content 字段。
 */
function geminiSignature(gemini, call, index) {
  if (!gemini) return {}
  const signature = call.signature ?? (index === 0 ? GEMINI_SKIP_SIGNATURE : undefined)
  return signature ? { extra_content: { google: { thought_signature: signature } } } : {}
}

function chatMessages(messages, gemini = false) {
  return messages.map(message => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.text || '' }
    if (message.role === 'assistant') {
      const result = { role: 'assistant', content: message.text || '' }
      if (message.toolCalls?.length) {
        result.tool_calls = message.toolCalls.map((call, index) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' },
          ...geminiSignature(gemini, call, index),
        }))
        if (!message.text) result.content = null
      }
      return result
    }
    const content = []
    if (message.text) content.push({ type: 'text', text: message.text })
    for (const image of message.images || []) {
      content.push({ type: 'image_url', image_url: { url: `data:${image.mediaType || 'image/png'};base64,${image.dataBase64}` } })
    }
    return { role: 'user', content: content.length === 1 && content[0].type === 'text' ? content[0].text : content }
  })
}

async function chatCompletions({ model, messages, tools, system, token, baseUrl, signal, onDelta, onReasoning }) {
  const url = endpoint(baseUrl, '/chat/completions')
  const body = {
    model: model.model,
    // 身份/工具纪律/项目事实都在 system 里，必须作为首条 system 消息发出去。
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...chatMessages(messages, isGemini(baseUrl, model.model))],
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), tool_choice: 'auto' } : {}),
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(await readError(response))
  const guard = new DsmlGuard(tools.length > 0)
  let finish = 'stop'
  let usage = null
  const calls = new Map()
  // 最近一次拼接的 tool_call 下标：增量不带 index 时据此归位。
  let lastIndex = -1
  for await (const data of sseFrames(response)) {
    let frame
    try { frame = JSON.parse(data) } catch { continue }
    if (frame.usage) {
      usage = {
        inputTokens: number(frame.usage.prompt_tokens ?? frame.usage.inputTokens),
        outputTokens: number(frame.usage.completion_tokens ?? frame.usage.outputTokens),
        cacheReadTokens: number(frame.usage.prompt_tokens_details?.cached_tokens ?? frame.usage.cache_read_tokens),
      }
    }
    const choice = frame.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    if (typeof delta.content === 'string' && delta.content) {
      const text = guard.feed(delta.content)
      if (text) await onDelta(text)
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) await onReasoning(reasoning)
    for (const call of delta.tool_calls || []) {
      // Gemini 的兼容端点有时不给 index：id 与正在拼的那个不同就是新的一个调用，否则接着拼上一个
      //（都落到同一个键上的话，并行调用的参数会被拼成一串坏 JSON）。
      const prevId = calls.get(lastIndex)?.id
      const key = call.index ?? (call.id && prevId && call.id !== prevId ? lastIndex + 1 : Math.max(lastIndex, 0))
      lastIndex = key
      const entry = calls.get(key) || { id: '', name: '', arguments: '' }
      if (call.id) entry.id = call.id
      if (call.function?.name) entry.name += call.function.name
      if (call.function?.arguments) entry.arguments += call.function.arguments
      // Gemini 3 起每步第一个调用必须带思考签名，回放时要原样带回（见 chatMessages）。
      const signature = call.extra_content?.google?.thought_signature
      if (signature) entry.signature = signature
      calls.set(key, entry)
    }
    if (choice.finish_reason === 'length') finish = 'length'
    else if (choice.finish_reason) finish = choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop'
  }
  return settleDsml(guard, {
    onDelta,
    toolCalls: collectCalls(calls),
    finish,
    aborted: !!signal?.aborted,
  }).then(result => ({ ...result, usage }))
}

function anthropicMessages(messages) {
  const result = []
  for (const message of messages) {
    if (message.role === 'tool') {
      result.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.text || '' }] })
      continue
    }
    if (message.role === 'assistant') {
      const content = []
      if (message.text) content.push({ type: 'text', text: message.text })
      for (const call of message.toolCalls || []) {
        let parsed = {}
        try { parsed = JSON.parse(call.arguments || '{}') } catch { parsed = {} }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: parsed })
      }
      if (content.length) result.push({ role: 'assistant', content })
      continue
    }
    const content = []
    for (const image of message.images || []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/png', data: image.dataBase64 } })
    }
    if (message.text) content.push({ type: 'text', text: message.text })
    result.push({ role: 'user', content: content.length === 1 && content[0].type === 'text' ? content[0].text : content })
  }
  return result
}

async function anthropic({ model, messages, tools, system, token, baseUrl, signal, onDelta, onReasoning }) {
  const url = endpoint(baseUrl, '/messages')
  const body = {
    model: model.model,
    max_tokens: model.outputLimit || 4096,
    system,
    messages: anthropicMessages(messages),
    stream: true,
    ...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}),
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': token, authorization: `Bearer ${token}`, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(await readError(response))
  const guard = new DsmlGuard(tools.length > 0)
  let finish = 'stop'
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  const calls = new Map()
  const partial = new Map()
  for await (const data of sseFrames(response)) {
    let frame
    try { frame = JSON.parse(data) } catch { continue }
    if (frame.type === 'message_start' && frame.message?.usage) {
      usage.inputTokens = number(frame.message.usage.input_tokens)
      usage.cacheReadTokens = number(frame.message.usage.cache_read_input_tokens)
    } else if (frame.type === 'content_block_start' && frame.content_block?.type === 'tool_use') {
      calls.set(frame.index, { id: frame.content_block.id, name: frame.content_block.name, arguments: '' })
    } else if (frame.type === 'content_block_delta') {
      const delta = frame.delta || {}
      if (delta.type === 'text_delta' && delta.text) {
        const text = guard.feed(delta.text)
        if (text) await onDelta(text)
      } else if (delta.type === 'thinking_delta' && delta.thinking) await onReasoning(delta.thinking)
      else if (delta.type === 'input_json_delta' && delta.partial_json) {
        partial.set(frame.index, (partial.get(frame.index) || '') + delta.partial_json)
      }
    } else if (frame.type === 'content_block_stop') {
      const call = calls.get(frame.index)
      if (call && partial.has(frame.index)) call.arguments = partial.get(frame.index)
    } else if (frame.type === 'message_delta') {
      if (frame.usage) usage.outputTokens = number(frame.usage.output_tokens)
      const reason = frame.delta?.stop_reason
      if (reason === 'max_tokens') finish = 'length'
      else if (reason) finish = reason === 'tool_use' ? 'tool_calls' : 'stop'
    } else if (frame.type === 'error') {
      throw new Error(String(frame.error?.message || 'anthropic 流返回错误'))
    }
  }
  return settleDsml(guard, {
    onDelta,
    toolCalls: collectCalls(calls),
    finish,
    aborted: !!signal?.aborted,
  }).then(result => ({ ...result, usage }))
}

function responsesInput(messages) {
  const input = []
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.text || '' })
      continue
    }
    if (message.role === 'assistant') {
      if (message.text) input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.text }] })
      for (const call of message.toolCalls || []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' })
      }
      continue
    }
    const content = []
    if (message.text) content.push({ type: 'input_text', text: message.text })
    for (const image of message.images || []) {
      content.push({ type: 'input_image', image_url: `data:${image.mediaType || 'image/png'};base64,${image.dataBase64}` })
    }
    input.push({ role: 'user', content: content.length === 1 && content[0].type === 'input_text' ? content[0].text : content })
  }
  return input
}

async function codexResponses({ model, messages, tools, system, token, baseUrl, signal, onDelta, onReasoning }) {
  const url = endpoint(baseUrl, '/responses')
  const body = {
    model: model.model,
    instructions: system,
    input: responsesInput(messages),
    stream: true,
    store: false,
    ...(model.reasoningEffort ? { reasoning: { effort: model.reasoningEffort } } : {}),
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema })), tool_choice: 'auto' } : {}),
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(await readError(response))
  const guard = new DsmlGuard(tools.length > 0)
  let finish = 'stop'
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  const calls = new Map()
  for await (const data of sseFrames(response)) {
    let frame
    try { frame = JSON.parse(data) } catch { continue }
    if (frame.type === 'response.output_text.delta' && typeof frame.delta === 'string') {
      const text = guard.feed(frame.delta)
      if (text) await onDelta(text)
    } else if (frame.type === 'response.reasoning_summary_text.delta' && typeof frame.delta === 'string') await onReasoning(frame.delta)
    else if (frame.type === 'response.output_item.added' && frame.item?.type === 'function_call') {
      calls.set(frame.item.id || frame.item.call_id, { id: frame.item.call_id || frame.item.id, name: frame.item.name, arguments: frame.item.arguments || '' })
    } else if (frame.type === 'response.function_call_arguments.delta' && typeof frame.delta === 'string') {
      const key = frame.item_id
      const call = calls.get(key)
      if (call) call.arguments += frame.delta
    } else if (frame.type === 'response.output_item.done' && frame.item?.type === 'function_call') {
      const key = frame.item.id || frame.item.call_id
      calls.set(key, { id: frame.item.call_id || frame.item.id, name: frame.item.name, arguments: frame.item.arguments || calls.get(key)?.arguments || '{}' })
    } else if (frame.type === 'response.completed' && frame.response) {
      const responseUsage = frame.response.usage
      if (responseUsage) {
        usage.inputTokens = number(responseUsage.input_tokens)
        usage.outputTokens = number(responseUsage.output_tokens)
        usage.cacheReadTokens = number(responseUsage.input_tokens_details?.cached_tokens)
      }
      if (frame.response.status === 'incomplete') finish = 'length'
    } else if (frame.type === 'error') throw new Error(String(frame.error?.message || 'responses 流返回错误'))
  }
  return settleDsml(guard, {
    onDelta,
    toolCalls: collectCalls(calls),
    finish,
    aborted: !!signal?.aborted,
  }).then(result => ({ ...result, usage }))
}

function collectCalls(calls) {
  const list = []
  for (const [key, call] of calls) {
    if (!call.name) continue
    list.push({
      id: call.id || `call_${key}`,
      name: call.name,
      arguments: call.arguments || '{}',
      ...(call.signature ? { signature: call.signature } : {}),
    })
  }
  return list
}

/** 一轮模型调用：按 apiMode 选协议，流式回调文本/推理。 */
export async function callModel(options) {
  const mode = options.apiMode || options.model?.apiMode || 'chat_completions'
  const token = options.token
  try {
    if (mode === 'anthropic_messages') return await anthropic(options)
    if (mode === 'codex_responses') return await codexResponses(options)
    return await chatCompletions(options)
  } catch (error) {
    // 调用方主动掐断（复读检测）不算模型错误：原样透出，调用方据此区分。
    if (error instanceof StreamAbort) throw error
    if (options.signal?.aborted) throw new Error('本轮已被取消')
    throw new Error(redact(error?.message || error, token))
  }
}
