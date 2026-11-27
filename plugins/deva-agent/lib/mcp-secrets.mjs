/** Never send stored env/header values to a client. Missing/masked values preserve; null explicitly clears. */
export const SECRET_MASK = '__EKKO_SECRET_UNCHANGED__'
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function maskMcpConfig(config = {}) {
  const copy = structuredClone(config)
  for (const field of ['env', 'headers']) if (object(copy[field])) {
    copy[field] = Object.fromEntries(Object.keys(copy[field]).map(key => [key, SECRET_MASK]))
  }
  return copy
}
export function mergeMcpSecrets(draft, previous = {}) {
  const copy = structuredClone(draft)
  for (const field of ['env', 'headers']) {
    if (copy[field] !== undefined && !object(copy[field])) throw new Error('MCP env/headers 必须为对象；清除单项请将值设为 null')
    const merged = { ...(previous[field] || {}) }
    for (const [key, value] of Object.entries(copy[field] || {})) {
      if (value === null) delete merged[key]
      else if (value === SECRET_MASK) {
        if (!Object.hasOwn(merged, key)) throw new Error('MCP 掩码没有对应的已存密钥，请填写新值或 null')
      } else if (typeof value === 'string') merged[key] = value
      else throw new Error('MCP env/headers 值必须是字符串或 null')
    }
    if (copy[field] !== undefined || previous[field] !== undefined) copy[field] = merged
  }
  return copy
}
/** Keep known actionable categories only; arbitrary host/process errors may contain credentials. */
export function safeMcpError(error) {
  if (error?.code === 'RPC_OVERLOADED') return Object.assign(new Error('RPC_OVERLOADED'), { code: 'RPC_OVERLOADED', retryAfterMs: 1000 })
  const raw = String(error?.body?.error?.message || error?.body?.error || error?.message || '')
  const missing = raw.match(/缺少(?:环境变量|请求头变量)：([A-Za-z_][A-Za-z0-9_]*(?:、[A-Za-z_][A-Za-z0-9_]*)*)/)
  if (missing) return new Error(`缺少环境变量：${missing[1]}`)
  const status = error?.status || error?.statusCode || raw.match(/(?:HTTP|status)\s*(\d{3})/i)?.[1]
  if (Number(status) === 404) return new Error('Studio MCP 接口或服务不存在（HTTP 404），请检查宿主接口版本和服务名')
  if (Number(status) === 405) return new Error('Studio MCP 接口不支持此方法（HTTP 405），请检查宿主接口版本')
  if (Number(status) === 401 || Number(status) === 403) return new Error(`Studio MCP 接口权限不足（HTTP ${Number(status)}）`)
  if (/already exists/i.test(raw)) return new Error('MCP server already exists')
  if (/not found/i.test(raw)) return new Error('MCP server not found')
  if (/Enable the MCP server before testing it/.test(raw)) return new Error('Enable the MCP server before testing it')
  const permission = raw.match(/Missing api\.(read|write) permission/)
  if (permission) return new Error(`Missing api.${permission[1]} permission`)
  if (/host.request/.test(raw)) return new Error('缺少 Studio 宿主通道 host.request')
  return new Error('MCP 操作失败：宿主或服务返回错误（详情已隐藏，避免凭据泄漏）')
}
