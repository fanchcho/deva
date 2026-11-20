/**
 * Agent 的一轮运行：模型 ↔ 工具循环。
 *
 * 设计要点：
 *  · 只做一件事——把 Studio 给的输入、历史、模型代理和本插件的工具接成一轮完整运行，
 *    文本增量实时回传（text.delta），工具起止逐个回传，最后返回完整结果；
 *  · 步数有上限（默认 24），到顶返回 finishReason='tool_limit'，不无限循环；
 *  · 工具参数解析失败不炸整轮：把错误当作工具结果交回模型，让它自己改；
 *  · 回复陷入逐字复读时掐断本步、丢弃重试一次；再复读就截到第一次重复处结束本轮（见 lib/repetition.mjs）；
 *  · 取消由 run.signal 传到 fetch 与子进程，取消后不再发事件。
 */
import { createHash } from 'node:crypto'
import { executeTool, TOOL_DEFINITIONS } from './tools.mjs'
import { formatTodos } from './interact.mjs'
import { memoryLayers, listMemories, formatMemoryIndex } from './memory.mjs'
import { memoryPromptSection } from './memory-prompt.mjs'
import { callModel, StreamAbort } from './model.mjs'
import { watchRepetition, cutTrailingRepetition } from './repetition.mjs'

const MAX_HISTORY_MESSAGES = 200
const MAX_TEXT_PER_MESSAGE = 200000

/**
 * 原地打转（同一工具同一参数连续得到完全相同的结论）：到的次数与桌面端 shared/limits.ts 一致。
 * 到 WARN 次起在工具结果后附一句提醒；到 STOP 次就不再执行工具，改发收尾请求让模型说明卡在哪里。
 * 与复读检测不同：复读看的是「文字逐字相同」，这里看的是「反复做同一件事、结果毫无变化」。
 */
const REPEAT_WARN = 3
const REPEAT_STOP = 5

/** 一次工具调用的指纹：工具名 + 参数 + 结果（含错误标记）。取哈希，免得大结果在内存里多留一份。 */
function callFingerprint(name, args, result, isError) {
  return createHash('sha1')
    .update(name).update('\0')
    .update(JSON.stringify(args ?? null) ?? '').update('\0')
    .update(isError ? '1' : '0').update(String(result))
    .digest('hex')
}

function repeatReminder(tool, count) {
  return (
    `\n\n（系统提示）你已用相同参数连续 ${count} 次调用 ${tool}，结果都没有变化。` +
    `请换个做法，或直接基于已有结果给出结论；连续 ${REPEAT_STOP} 次将停止调用工具。`
  )
}

/** 原地打转到 REPEAT_STOP 次后的收尾请求：不再执行工具，让模型说明卡在哪里。 */
function repeatStopNudge(tool, count) {
  return (
    `（系统提示）你已用相同参数连续 ${count} 次调用 ${tool}，结果都没有变化，工具调用已停止，即使调用也不会执行。` +
    '请基于目前已有的结果直接给出回复：说明已完成的部分、卡在哪里，以及建议的下一步。'
  )
}

/** 复读截断后追加在回复末尾的说明（插件没有单独的结束原因通道，只落进正文）。 */
const DEGENERATE_NOTE = '（模型输出陷入逐字重复，重试后仍如此，已截断到第一次重复处。上下文过长常会导致这种情况，可压缩上下文或换个模型再试。）'

/**
 * 同一步里可以并发跑的工具：只读、无副作用、彼此无先后依赖。
 * 子智能体也在此列——每个都在自己的隔离上下文里，互不共享可变状态；
 * 但它们的结论要按调用顺序回灌，且不能与写类工具混在同一步并发。
 */
const PARALLEL_SAFE = new Set(['read_file', 'list_dir', 'glob', 'grep', 'web_fetch', 'memory_read', 'run_subagent'])

function safeText(blocks) {
  return (blocks || []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

/** 把 Studio 的 agent 内容块变成归一化消息：图片读成 base64，文件给出本地路径。 */
async function contentToMessage(role, content, run) {
  const images = []
  const notes = []
  for (const block of content || []) {
    if (block.type === 'text') continue
    if (block.type === 'image') {
      try {
        const asset = await run.attachments.resolve(block.assetId)
        const bytes = await run.attachments.read(block.assetId)
        images.push({ mediaType: asset.mediaType, dataBase64: Buffer.from(bytes).toString('base64') })
      } catch (error) {
        notes.push(`（图片 ${block.name || block.assetId} 读取失败：${error.message}）`)
      }
    } else if (block.type === 'file') {
      try {
        const asset = await run.attachments.resolve(block.assetId)
        notes.push(`用户附带文件 ${JSON.stringify(block.name || asset.name)} 位于 ${asset.localPath}；回答其内容前先用 read_file 读取。`)
      } catch (error) {
        notes.push(`（文件 ${block.name || block.assetId} 读取失败：${error.message}）`)
      }
    }
  }
  const text = [safeText(content), ...notes].filter(Boolean).join('\n\n').slice(0, MAX_TEXT_PER_MESSAGE)
  return { role, text, images }
}

/** Studio 历史里 assistant/tool 也带 toolCallId，这里按上游协议归一化。 */
function historyToMessages(history, run) {
  const messages = []
  for (const message of (history || []).slice(-MAX_HISTORY_MESSAGES)) {
    const text = safeText(message.content).slice(0, MAX_TEXT_PER_MESSAGE)
    if (message.role === 'tool') {
      messages.push({ role: 'tool', toolCallId: message.toolCallId || '', name: 'tool', text })
      continue
    }
    if (message.role === 'assistant') {
      if (!text) continue
      messages.push({ role: 'assistant', text })
      continue
    }
    if (message.role === 'user' && text) messages.push({ role: 'user', text })
  }
  return messages
}

function parseArguments(raw) {
  const value = String(raw ?? '').trim() || '{}'
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ok: true, value: parsed }
    return { ok: false, error: '工具参数必须是 JSON 对象' }
  } catch (error) {
    return { ok: false, error: `工具参数不是合法 JSON：${error.message}` }
  }
}

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return text.length > 100000 ? { truncated: true, text: text.slice(0, 100000) } : text
}

/**
 * 跑一轮。run 为 Studio 的 AgentRunContext；system 为系统提示词；workspaceDir 为工作区根。
 * extraTools 是运行期才发现的工具（MCP）；execute 可替换工具执行器（默认走本插件的工具集）。
 * 子智能体复用同一函数：tools 覆盖工具表、initialMessages 用自己的隔离历史、depth>0 表示子轮，
 * silent 表示不回传事件（Studio 没有子任务卡片，子轮的调用 id 与事件没有归属通道）。
 * 返回值即 AgentRunResult：content / finishReason / usage。
 */
export async function runAgentTurn({
  run, input, system, workspaceDir, facts, model = callModel, maxSteps = 24,
  extraTools = [], execute = null, identityId = null, identityName = null,
  tools: toolsOverride = null, initialMessages = null, depth = 0, silent = false, runTurn = runAgentTurn,
}) {
  // 子智能体传入自己的记录消息数组：原地追加，跑完后记录里就有完整上下文（续聊要用）。
  const messages = initialMessages || historyToMessages(input.history, run)
  if (!initialMessages) messages.push(await contentToMessage('user', input.input, run))
  const tools = toolsOverride || [...TOOL_DEFINITIONS, ...extraTools]
  const emit = silent || !run.output?.emit ? async () => {} : event => run.output.emit(event)
  const isChild = depth > 0
  // 记忆的规则段只组装一次：条目索引随消息下发（下面 pushMemoryIndex），记忆增删改不动 system 前缀。
  // 子智能体只看自己的系统提示词：主对话的待办与记忆属于另一条上下文，不注入。
  const memoryCtx = !isChild && run.state?.user?.namespace
    ? { state: run.state, workspaceDir, identityId, identityName }
    : null
  if (memoryCtx) {
    const layers = await memoryLayers(memoryCtx)
    const notes = layers.length ? memoryPromptSection({ layers, identityName }) : []
    if (notes.length) system = `${system}\n\n${notes.join('\n')}`
  }
  /** 记忆索引：紧跟在用户消息之后下发一次；本轮中模型自己写入的条目在下一步补发。 */
  const pushMemoryIndex = async ({ diffOnly = false } = {}) => {
    if (!memoryCtx) return
    const layers = []
    for (const layer of await memoryLayers(memoryCtx)) layers.push({ ...layer, entries: await listMemories(layer.scope, memoryCtx) })
    const text = formatMemoryIndex(layers)
    if (!text) return
    if (diffOnly && text === lastMemoryIndex) return
    lastMemoryIndex = text
    messages.push({ role: 'user', text: `【记忆】${diffOnly ? '更新后的' : ''}记忆索引（方括号里是 id，用于 memory_read 读正文、memory_write 更新、memory_delete 删除）：\n\n${text}` })
  }
  let lastMemoryIndex = null
  const composeSystem = async () => {
    if (isChild) return system
    const parts = [system]
    const todos = formatTodos(await readTodos(run))
    if (todos) parts.push(`## 当前待办清单\n\n${todos}`)
    return parts.join('\n\n')
  }
  let systemText = await composeSystem()
  // 索引紧跟用户消息：user → 记忆索引 → ……这样缓存前缀从 system 到首条用户消息都不受记忆变化影响。
  if (!initialMessages) await pushMemoryIndex()
  const toolCtx = {
    run,
    workspaceDir,
    runtimeDir: run.paths?.runtimeDir,
    state: run.state,
    interactions: run.interactions,
    agentSession: run.state?.agentSession,
    host: run.host,
    signal: run.signal,
    facts,
    log: run.log,
    // 子智能体运行入口：run_subagent / send_to_subagent 通过它复用同一套循环。
    runTurn,
    model,
    maxSteps,
    tools,
    extraTools,
    baseTools: TOOL_DEFINITIONS,
    execute,
    messages,
    system,
    depth,
    // 记忆的角色层按本轮身份分区：身份 id/名称来自 agent.mjs 解析出的 identity。
    identity: identityId || identityName ? { identityId, identityName } : undefined,
  }
  const callTool = execute || ((name, args, ctx) => executeTool(name, args, ctx))
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let sawUsage = false
  let reply = ''
  let finishReason = 'stop'
  /** 本轮已因复读丢弃重试过一步（每轮至多一次；重试仍复读说明模型已退化，再试无益）。 */
  let repetitionRetried = false

  /** 本轮复读截断的说明；非空时附在回复末尾，并让 finishReason 落成 length。 */
  let degenerateNote = ''

  /** 连续同工具同参数同结果的调用：key 是指纹，tool 是工具名。 */
  let repeat = { key: '', count: 0, tool: '' }
  /** 打转到 REPEAT_STOP 次：非 null 即下一步改发收尾请求、不再执行工具。 */
  let stuckOn = null

  for (let step = 0; step < maxSteps; step++) {
    if (run.signal?.aborted) throw new Error('本轮已被取消')
    if (stuckOn) messages.push({ role: 'user', text: repeatStopNudge(stuckOn.tool, stuckOn.count) })
    // 第一步的索引已随用户消息发出；此后每步只在条目有变化时补一条，避免重复灌同样的索引。
    if (step > 0) await pushMemoryIndex({ diffOnly: true })
    systemText = await composeSystem()
    await emit({ type: 'status', phase: 'thinking' })
    let streamed = ''
    // 本步开始前的完整回复：复读重试/截断都从它接着算，别把上一步的文字算进来。
    const replyBeforeStep = reply
    // 正文与思考各一路看守：只看结尾，命中即掐断本步的流（见 lib/repetition.mjs）。
    const watchText = watchRepetition()
    const watchReasoning = watchRepetition()
    let looped = null
    let result
    try {
      result = await model({
        model: run.model,
        apiMode: run.model?.apiMode,
        baseUrl: run.model?.baseUrl,
        token: run.model?.token,
        system: systemText,
        messages,
        tools,
        signal: run.signal,
        onDelta: async delta => {
          streamed += delta
          reply += delta
          await emit({ type: 'text.delta', text: delta })
          // 命中后先 throw，增量本身已经发出去（预览里能看到复读段；插件没有 stream_reset 事件可撤回）。
          if (watchText(delta)) {
            looped = { channel: 'text' }
            throw new StreamAbort()
          }
        },
        onReasoning: async delta => {
          await emit({ type: 'reasoning.summary.delta', text: delta })
          if (watchReasoning(delta)) {
            looped = { channel: 'reasoning' }
            throw new StreamAbort()
          }
        },
      })
    } catch (error) {
      // 只有看守主动掐断的流才吞掉；真实的网络/网关错误照常抛出。
      if (!(error instanceof StreamAbort)) throw error
      result = null
    }
    if (looped) {
      run.log?.warn?.(`deva: 回复复读（${looped.channel}），掐断本步`)
      // 复读段已经画到界面上了（插件没有 stream_reset），只能丢弃本步重试一次；仍复读就截到第一份收尾。
      reply = replyBeforeStep
      if (!repetitionRetried) {
        repetitionRetried = true
        // 重试不占用工具步数（与桌面端一致）：这一步整段作废，重新发一次。
        step--
        continue
      }
      const kept = cutTrailingRepetition(streamed)
      reply = replyBeforeStep + kept
      degenerateNote = DEGENERATE_NOTE
      finishReason = 'length'
      if (kept) messages.push({ role: 'assistant', text: kept })
      break
    }
    if (result.usage) {
      sawUsage = true
      usage.inputTokens += Number(result.usage.inputTokens || 0)
      usage.outputTokens += Number(result.usage.outputTokens || 0)
      usage.cacheReadTokens += Number(result.usage.cacheReadTokens || 0)
    }
    const text = result.text || ''
    // 供应商偶尔不按增量回文本（或只回最终文本）：补上差量，保证最终 content 与界面上看到的一致。
    if (text && text !== streamed) reply += text.startsWith(streamed) ? text.slice(streamed.length) : text
    const toolCalls = result.toolCalls || []
    if (!toolCalls.length) {
      // 最终回复也进消息数组：子智能体的记录要带上自己的结论，续聊才接得上。
      const finalText = text || streamed
      if (finalText) messages.push({ role: 'assistant', text: finalText })
      if (result.finish === 'length') finishReason = 'length'
      if (!text && !reply) finishReason = 'length'
      break
    }
    messages.push({
      role: 'assistant',
      text,
      // signature 是 Gemini 的思考签名：回放历史时必须原样带回，缺了该模型 400（见 lib/model.mjs）。
      toolCalls: toolCalls.map(call => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments || '{}',
        ...(call.signature ? { signature: call.signature } : {}),
        ...(call.broken ? { broken: true } : {}),
      })),
    })
    const parsedCalls = toolCalls.map(call => ({ call, parsed: parseArguments(call.arguments) }))
    const canRunParallel = parsedCalls.length > 1 && parsedCalls.every(({ call, parsed }) => parsed.ok && !call.broken && PARALLEL_SAFE.has(call.name))
    for (const { call } of parsedCalls) {
      await emit({ type: 'tool.started', callId: call.id, name: call.name, input: safeArgs(call.arguments) })
    }

    /** 跑一次工具；返回要回灌给模型的内容，并就地发出 completed/failed。 */
    const runOne = async ({ call, parsed }) => {
      // 参数残缺（从漏出的 DSML 里恢复、但参数没写完或撞上输出上限）：不执行，如实说清并让模型重发。
      if (call.broken) {
        const message = `参数残缺：本次 ${call.name} 调用的参数没有写完（输出中断或格式损坏），未执行，没有产生任何改动。请重新调用并确保参数完整；内容较长时分段完成。`
        await emit({ type: 'tool.failed', callId: call.id, error: '参数残缺，未执行' })
        return { text: message, isError: true, args: null }
      }
      if (!parsed.ok) {
        await emit({ type: 'tool.failed', callId: call.id, error: parsed.error })
        return { text: parsed.error, isError: true, args: null }
      }
      try {
        // callId 供子智能体派生记录用（确定性派生 ID）；depth 供子轮拒绝再派生。
        const content = await callTool(call.name, parsed.value, { ...toolCtx, callId: call.id })
        await emit({ type: 'tool.completed', callId: call.id, result: summarize(content) })
        return { text: content, isError: false, args: parsed.value }
      } catch (error) {
        const message = `工具执行失败：${error?.message || error}`
        await emit({ type: 'tool.failed', callId: call.id, error: String(error?.message || error) })
        return { text: message, isError: true, args: parsed.value }
      }
    }

    // 只读工具之间没有先后依赖，多个子智能体也是彼此独立的上下文：同一步里并发跑。
    // 回灌顺序仍按模型给出的调用顺序，保证 assistant.tool_calls 与后续 tool 消息一一对应。
    // 收尾请求（stuckOn 非空）这一步仍可能带工具调用：一律不执行，补「已停止」结果，历史里不留悬空调用。
    let done
    if (stuckOn) {
      done = parsedCalls.map(({ call }) => ({
        text: `未执行：已达到原地打转上限，工具调用已停止（${call.name}）。`,
        isError: true,
        args: null,
      }))
      for (const { call } of parsedCalls) await emit({ type: 'tool.failed', callId: call.id, error: '原地打转，未执行' })
    } else {
      done = canRunParallel
        ? await Promise.all(parsedCalls.map(runOne))
        : await parsedCalls.reduce(async (accP, item) => {
            const acc = await accP
            acc.push(await runOne(item))
            return acc
          }, Promise.resolve([]))
    }
    for (let index = 0; index < parsedCalls.length; index++) {
      messages.push({ role: 'tool', toolCallId: parsedCalls[index].call.id, name: parsedCalls[index].call.name, text: String(done[index].text) })
    }
    if (stuckOn) break
    // 原地打转判定：按调用原序比对指纹（工具名 + 参数 + 结果），算在附提醒之前——提醒本身不进指纹。
    // 同一工具同一参数反复得到完全相同的结论即为打转；到 WARN 次附提醒，到 STOP 次下一步改发收尾请求。
    for (let index = 0; index < parsedCalls.length; index++) {
      const { call } = parsedCalls[index]
      const key = callFingerprint(call.name, done[index].args, done[index].text, done[index].isError)
      repeat = key === repeat.key ? { key, count: repeat.count + 1, tool: call.name } : { key, count: 1, tool: call.name }
      // 记下而非现读 repeat：同一步里排在后面的不同调用会把计数清零。
      if (repeat.count >= REPEAT_STOP) {
        run.log?.warn?.(`deva: ${call.name} 原地打转 ${repeat.count} 次，改发收尾请求`)
        stuckOn ??= { tool: call.name, count: repeat.count }
        break
      }
      if (repeat.count >= REPEAT_WARN) {
        const message = messages[messages.length - parsedCalls.length + index]
        message.text += repeatReminder(call.name, repeat.count)
      }
    }
    if (step === maxSteps - 1) finishReason = 'tool_limit'
  }

  if (run.signal?.aborted) throw new Error('本轮已被取消')
  if (degenerateNote) reply = reply ? `${reply.trimEnd()}\n\n${degenerateNote}` : degenerateNote
  return {
    content: [{ type: 'text', text: reply }],
    finishReason,
    ...(sawUsage ? { usage: { ...usage, costUsd: null, isEstimated: false } } : {}),
  }
}

function safeArgs(raw) {
  const parsed = parseArguments(raw)
  return parsed.ok ? parsed.value : {}
}

/** 读回本会话的待办清单；存储不可用或数据损坏时当作没有清单，不影响对话。 */
async function readTodos(run) {
  try {
    const todos = await run.state?.agentSession?.get('todos')
    return Array.isArray(todos) ? todos : []
  } catch {
    return []
  }
}
