import { normalizeBaseUrl, requestCustomModel } from './custom-model-network.mjs'
import { readCredential, resolveCustomEndpoint } from './model-selection.mjs'
import { desktopModelState } from './desktop-models.mjs'
import { validateStoredModel } from './storage-contracts.mjs'

const positive = (...values) => values.find(v => Number.isSafeInteger(v) && v > 0)
export function parseModels(value) {
  const rows = Array.isArray(value) ? value : value?.data
  if (!Array.isArray(rows)) throw new Error('模型列表格式不支持：需要 data 数组或裸数组')
  const seen = new Set()
  return rows.flatMap(row => {
    if (typeof row?.id !== 'string' || !row.id.trim() || row.id.length > 256 || /\p{Cc}/u.test(row.id) || seen.has(row.id)) return []
    seen.add(row.id)
    // Input limit is not necessarily the total context window; keep the two separate.
    const lengths = {
      contextWindow: positive(row.context_length, row.max_model_len, row.context_window, row.top_provider?.context_length),
      maxOutput: positive(row.max_output_tokens, row.max_completion_tokens, row.top_provider?.max_completion_tokens),
      maxInput: positive(row.max_input_tokens),
    }
    return [{ id: row.id, ...Object.fromEntries(Object.entries(lengths).filter(([, v]) => v !== undefined)) }]
  })
}

/**
 * 「拉模型能用、对话 401」的真实差异就在这里：
 *  · `GET {base}/models` 即使在**完全不带 Authorization** 时也可能返回 200（网关/代理允许匿名列目录）；
 *  · `POST {base}/chat/completions` 才是真正消费凭据的端点。
 * 所以列表 200 **不能**证明 Key 可用。这里在同一凭据、同一 Base URL 上做一次只到鉴权层的探测，
 * 把结论作为 `authProbe` 一起回给页面——探测本身不产生生成，也不发空消息。
 */
/**
 * 鉴权判别：故意发一个**结构不合法**的 chat 请求（`messages: []`），只到鉴权层。
 *  · 401/403 → 凭据被拒（unauthorized）；
 *  · 400/422/404/429/5xx 等 → 鉴权已通过，只是请求体/模型名被拒（authorized）；
 *  · 网络/批准失败 → unknown。
 * 这样既不产生生成、也不花 token，也不会因为假模型名被误判成「Key 无效」。
 */
const chatProbeBody = model => JSON.stringify({ model, messages: [] })

async function probeChatAuthorization({ endpoint, apiKey, model, signal }) {
  if (!apiKey) {
    return {
      sentAuthorization: false,
      chatAuthorized: 'absent',
      reason: '本次列表请求没有可用 Key（未发送 Authorization）。列表 200 只说明该地址允许匿名读取模型清单，不能证明对话可用。',
    }
  }
  const url = new URL(`${endpoint.url.href.split('/models')[0]}/chat/completions`)
  try {
    await requestCustomModel({ ...endpoint, url }, { method: 'POST', body: chatProbeBody(model), signal, json: true, headers: { authorization: `Bearer ${apiKey}` } })
    return { sentAuthorization: true, chatAuthorized: 'authorized', chatHttp: 200, reason: 'chat/completions 接受了该凭据。' }
  } catch (error) {
    const status = Number(String(error?.message || '').match(/HTTP (\d{3})/)?.[1] || 0)
    if (status === 401 || status === 403) {
      return {
        sentAuthorization: true, chatAuthorized: 'unauthorized', chatHttp: status,
        reason: `上游在 chat/completions 拒绝了该凭据（HTTP ${status}）；列表请求返回 200 只说明该地址允许匿名读取模型清单，两者鉴权口径不同。`,
      }
    }
    if (status >= 100 && status < 600) {
      // 鉴权已通过：上游是因为请求体/模型名不合规而拒绝，不是 Key 的问题。
      return { sentAuthorization: true, chatAuthorized: 'authorized', chatHttp: status, reason: `鉴权已通过（chat/completions 以 HTTP ${status} 拒绝的是一个故意不合规的探测请求，不代表 Key 无效）。` }
    }
    return { sentAuthorization: true, chatAuthorized: 'unknown', reason: `鉴权探测未能完成（${String(error?.message || error).slice(0, 200)}）；这不代表凭据无效。` }
  }
}

export async function discoverModels(run, input, { timeoutMs = 15000 } = {}) {
  const options = validateStoredModel('modelDiscoveryInput', input)
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  let apiKey = options.apiKey
  if (apiKey === undefined) {
    const desktop = desktopModelState(run.config)
    const route = options.modelRef === undefined ? desktop.active : options.modelRef ? desktop.resolve(options.modelRef) : null
    apiKey = route?.baseUrl === baseUrl ? await readCredential(run, route) : ''
  }
  if (apiKey && (!/^[A-Za-z0-9._~+/-]+=*$/.test(apiKey) || baseUrl.includes(apiKey))) throw new Error('API Key 格式无效或误填入地址')
  const endpoint = resolveCustomEndpoint(run, baseUrl)
  endpoint.url = new URL(`${baseUrl}/models`)
  const timeout = AbortSignal.timeout(timeoutMs)
  const controller = new AbortController()
  const onTimeout = () => controller.abort(timeout.reason)
  const onCancel = () => controller.abort(run.signal.reason)
  timeout.addEventListener('abort', onTimeout, { once: true })
  run.signal?.addEventListener('abort', onCancel, { once: true })
  if (run.signal?.aborted) onCancel()
  const signal = controller.signal
  let abort
  const aborted = new Promise((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    // Bound DNS lookup as well as the socket; the shared transport rechecks signal before connecting.
    const value = await Promise.race([aborted, requestCustomModel(endpoint, { method: 'GET', json: true, signal, headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} })])
    const models = parseModels(value)
    if (apiKey && JSON.stringify(models).includes(apiKey)) throw new Error('模型列表包含敏感凭据，已拒绝回传')
    // 列表成功 ≠ 对话可用：把同一凭据在 chat 端点的鉴权结论一并返回。
    const authProbe = await probeChatAuthorization({ endpoint, apiKey, model: models[0]?.id || '', signal }).catch(error => ({ sentAuthorization: Boolean(apiKey), chatAuthorized: 'unknown', reason: String(error?.message || error).slice(0, 200) }))
    const safeProbe = { sentAuthorization: Boolean(authProbe.sentAuthorization), chatAuthorized: authProbe.chatAuthorized, ...(authProbe.chatHttp ? { chatHttp: authProbe.chatHttp } : {}), ...(authProbe.reason ? { reason: apiKey ? String(authProbe.reason).split(apiKey).join('[redacted]') : String(authProbe.reason) } : {}) }
    return { models, authProbe: safeProbe }
  } catch (error) {
    if (timeout.aborted) throw new Error('获取模型列表超时，请检查地址或稍后重试')
    if (run.signal?.aborted) throw new Error('获取模型列表已取消')
    if (/HTTP (401|403)/.test(error.message)) throw new Error('模型列表鉴权失败（HTTP ' + error.message.match(/HTTP (\d+)/)[1] + '），请检查该地址的 API Key 与访问权限')
    if (/HTTP 404/.test(error.message)) throw new Error('模型列表接口不存在（HTTP 404），请检查 Base URL 或手动输入模型名')
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    timeout.removeEventListener('abort', onTimeout)
    run.signal?.removeEventListener('abort', onCancel)
  }
}
