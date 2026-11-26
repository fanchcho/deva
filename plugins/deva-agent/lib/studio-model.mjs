import { writeUiTrace } from './ui-trace.mjs'
import { callModel } from './model.mjs'
import { ModelInputError, requestCustomModel } from './custom-model-network.mjs'
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

/**
 * 直连前的审批提示：把「哪个地址、为什么被拦、到哪里批」写在报错里。
 *
 * 这里的门槛只管**发请求**；读页面、镜像桌面已有选择不受它约束（见 model-selection 的说明）。
 * 抛原始 `ModelInputError`，只补一句可操作下一步；不吞掉 code，方便上层与页面复用。
 */
function approvalHint(error, baseUrl) {
  if (!(error instanceof ModelInputError) || error.code !== 'confirmation-required') return error
  const hint = `${baseUrl} 是本机、内网或 HTTP 地址，Deva 直连前需要 Studio 管理员批准：请把完整地址 ${baseUrl} 加入插件配置 modelTrustedBases 后重试。这是安全策略，页面不能自行批准。管理员入口：管理插件 → Deva 详情 → 配置 → modelTrustedBases（JSON 数组追加，保留原地址）→ 保存。`
  const wrapped = new ModelInputError(error.field, error.code, hint)
  wrapped.cause = error
  return wrapped
}

/** Uses only the selected endpoint and its own key, never the scoped lease or Studio Model API. */
export function createCustomModel(run, { baseUrl, modelName, apiKey, reasoningEffort = '' }) {
  let endpoint
  try { endpoint = resolveCustomEndpoint(run, baseUrl) } catch (error) { throw approvalHint(error, baseUrl) }
  return async ({ onDelta = noop, onReasoning = noop, ...options }) => {
    const text = apiKey ? protectDelta(onDelta, apiKey) : null
    const reasoning = apiKey ? protectDelta(onReasoning, apiKey) : null
    const result = await callModel({
      ...options, apiMode: 'chat_completions', model: { model: modelName, ...(reasoningEffort ? { reasoningEffort } : {}) }, baseUrl, token: apiKey,
      chatRequest: request => {
        // Observe only routing metadata from the actual serialized request, never headers or messages.
        try {
          const body = JSON.parse(request.body)
          writeUiTrace({ side: 'server', phase: 'model-request', method: 'chat-completions',
            modelName: body.model, reasoningEffort: body.reasoning_effort || 'omitted',
            userId: run.identity?.userId, profile: run.identity?.profile })
        } catch { /* Diagnostics must not prevent inference. */ }
        return requestCustomModel(endpoint, request).catch(error => { throw /HTTP (401|403)；/.test(error.message)
        ? new Error(`${error.message}；Studio 侧 API Key ${apiKey ? '已设置但上游拒绝' : '未设置'}，请在 Deva → 模型保存该提供方的有效 Key；桌面密钥不会自动复制`)
        : effortRejected(error, reasoningEffort) })
      },
      onDelta: text?.emit ?? onDelta,
      onReasoning: reasoning?.emit ?? onReasoning,
    })
    if (apiKey && (result.text.includes(apiKey) || JSON.stringify(result.toolCalls).includes(apiKey))) throw reflectedKeyError()
    await text?.flush()
    await reasoning?.flush()
    return result
  }
}
