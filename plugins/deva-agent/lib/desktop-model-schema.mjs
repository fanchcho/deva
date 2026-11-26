const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (v, k) => Object.hasOwn(v, k)
function fail(path, reason) { throw new Error(`桌面配置 ${path}：${reason}；未覆盖文件`) }
function layout(value) {
  const nested = object(value.models) && (own(value.models, 'providers') || own(value.models, 'provider') || (!own(value, 'providers') && !own(value, 'provider')))
  const container = nested ? value.models : value
  const key = own(container, 'providers') ? 'providers' : own(container, 'provider') ? 'provider' : null
  let rows = key ? container[key] : []
  if (typeof rows === 'string') rows = { ...container, id: rows }
  if (object(rows)) rows = [rows]
  if (!Array.isArray(rows)) fail(key || 'providers', '应为提供商对象或数组')
  if (!key && (own(container, 'model') || Array.isArray(container.models))) rows = [container]
  if (!key && value.models != null && !object(value.models) && !Array.isArray(value.models)) fail('models', '应为对象或数组')
  return { nested, container, key, rows }
}
function provider(raw, index) {
  if (!object(raw)) fail(`providers[${index}]`, '提供商不是对象')
  const id = raw.id ?? raw.providerId ?? (typeof raw.provider === 'string' ? raw.provider : `legacy-provider-${index + 1}`)
  if (typeof id !== 'string' || !id.trim()) fail(`providers[${index}].id`, '缺少有效标识')
  let rows = raw.models ?? raw.model ?? []
  if (typeof rows === 'string' || object(rows)) rows = [rows]
  if (!Array.isArray(rows)) fail(`providers[${index}].models`, '应为模型字符串、对象或数组')
  const models = rows.map((row, i) => {
    const m = typeof row === 'string' ? { id: row, name: row } : row
    if (!object(m)) fail(`providers[${index}].models[${i}]`, '模型不是字符串或对象')
    const modelId = m.id ?? m.model ?? m.name
    if (typeof modelId !== 'string' || !modelId.trim()) fail(`providers[${index}].models[${i}]`, '缺少模型标识')
    return { ...m, id: modelId, name: m.name ?? modelId }
  })
  const apiHost = raw.apiHost ?? raw.baseUrl ?? raw.baseURL ?? ''
  if (typeof apiHost !== 'string') fail(`providers[${index}].baseUrl`, '地址必须是字符串')
  return { ...raw, id, name: raw.name ?? id, apiHost, models }
}
export function readModels(value) {
  const { container, rows, nested } = layout(value)
  const providers = rows.map(provider)
  const raw = container.activeModelId ?? container.defaultModel ?? value.activeModelId ?? value.defaultModel ?? (typeof container.model === 'string' ? container.model : undefined)
  let ref = raw
  if (object(raw)) ref = raw.providerId ? `${raw.providerId}:${raw.modelId ?? raw.model ?? raw.id}` : raw.modelId ?? raw.model ?? raw.id
  if (ref != null && typeof ref !== 'string') fail('defaultModel/activeModelId', '默认模型必须是字符串或引用对象')
  if (ref && !providers.some(p => p.models.some(m => `${p.id}:${m.id}` === ref))) {
    const hits = providers.flatMap(p => p.models.filter(m => m.id === ref).map(m => `${p.id}:${m.id}`))
    if (hits.length > 1) fail('defaultModel', '裸模型名在多个提供商中重复，需 providerId:modelId')
    if (hits.length === 1) ref = hits[0]
  }
  return { models: { ...(nested ? container : {}), providers, ...(ref == null ? {} : { activeModelId: ref }) }, providers }
}

/** Explicit saves normalize into Desktop's current section, inside the same file.
 * Legacy fields and all opaque fields remain intact; known aliases are synchronized.
 */
export function writeModels(value, models) {
  const { container, nested, key } = layout(value)
  const originals = layout(value).rows
  models = { ...models, providers: models.providers.map(p => {
    const index = originals.findIndex((raw, i) => provider(raw, i).id === p.id)
    const raw = originals[index]
    const canonical = object(raw) && !own(raw, 'model') && !own(raw, 'baseUrl') && !own(raw, 'baseURL') && (!raw.models || Array.isArray(raw.models) && raw.models.every(m => object(m) && typeof m.id === 'string'))
    return canonical && JSON.stringify(provider(raw, index)) === JSON.stringify(p) ? raw : p
  }) }
  const next = { ...value, models }
  if (!nested || own(value, 'providers') || own(value, 'provider')) {
    // Retain the original legacy section and keep it consistent with the canonical section.
    const rootKey = own(value, 'providers') ? 'providers' : own(value, 'provider') ? 'provider' : key
    if (rootKey) next[rootKey] = rootKey === 'provider' && !Array.isArray(container[key]) ? models.providers[0] : models.providers
    if (own(value, 'activeModelId')) next.activeModelId = models.activeModelId
    if (own(value, 'defaultModel')) next.defaultModel = models.activeModelId
  }
  if (own(container, 'defaultModel')) models.defaultModel = models.activeModelId
  if (own(container, 'provider')) models.provider = models.providers[0]
  for (const p of models.providers) {
    if (own(p, 'baseUrl')) p.baseUrl = p.apiHost
    if (own(p, 'baseURL')) p.baseURL = p.apiHost
    if (own(p, 'model') && p.models.length === 1) p.model = typeof p.model === 'string' ? p.models[0].id : p.models[0]
  }
  return next
}
