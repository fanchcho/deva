import { callModel } from './model.mjs'
import { requestCustomModel } from './custom-model-network.mjs'
import { resolveCustomEndpoint } from './model-selection.mjs'

const noop = async () => {}
const reflectedKeyError = () => new Error('自定义模型 API 响应回显了密钥；已拦截，未回退')

// Do not expose an echoed key in displayed deltas, even when split across SSE frames.
function protectDelta(callback, key) {
  let tail = ''
  return {
    async emit(text) {
      const value = tail + text
      if (value.includes(key)) throw reflectedKeyError()
      let keep = Math.min(value.length, key.length - 1)
      while (keep && !key.startsWith(value.slice(-keep))) keep--
      tail = keep ? value.slice(-keep) : ''
      if (value.length > keep) await callback(value.slice(0, value.length - keep))
    },
    async flush() { if (tail) await callback(tail) },
  }
}

// 上游以 400/422 拒绝且本轮带了强度：指明是哪个参数、去哪里改；不去掉参数重试。
function effortRejected(error, reasoningEffort) {
  if (!reasoningEffort || !/HTTP (400|422)；/.test(error.message)) return error
  return new Error(`${error.message}；本轮请求带了模型强度 reasoning_effort=${reasoningEffort}，上游可能不支持该档位，请在 Deva 模型设置页把「模型强度」改为默认或其它档位后重试`)
}

/** Uses only the selected endpoint and its own key, never the scoped lease or Studio Model API. */
export function createCustomModel(run, { baseUrl, modelName, apiKey, confirmedBase, reasoningEffort = '' }) {
  const endpoint = resolveCustomEndpoint(run, baseUrl, confirmedBase)
  return async ({ onDelta = noop, onReasoning = noop, ...options }) => {
    const text = apiKey ? protectDelta(onDelta, apiKey) : null
    const reasoning = apiKey ? protectDelta(onReasoning, apiKey) : null
    const result = await callModel({
      ...options, apiMode: 'chat_completions', model: { model: modelName, ...(reasoningEffort ? { reasoningEffort } : {}) }, baseUrl, token: apiKey,
      chatRequest: request => requestCustomModel(endpoint, request).catch(error => { throw effortRejected(error, reasoningEffort) }),
      onDelta: text?.emit ?? onDelta,
      onReasoning: reasoning?.emit ?? onReasoning,
    })
    if (apiKey && (result.text.includes(apiKey) || JSON.stringify(result.toolCalls).includes(apiKey))) throw reflectedKeyError()
    await text?.flush()
    await reasoning?.flush()
    return result
  }
}
