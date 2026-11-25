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
    return { models }
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
