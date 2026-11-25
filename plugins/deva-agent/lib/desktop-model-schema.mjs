const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const owns = (value, key) => Object.hasOwn(value, key)
function unsupported(path) {
  throw new Error(`不兼容的桌面模型配置字段：${path}；当前桌面读取 models.providers[].models[]、apiHost 和 models.activeModelId；未迁移或覆盖原文件`)
}

/** Match Desktop's canonical fields; never interpret an unknown alias as an empty configuration. */
export function readModels(value) {
  if (value.models == null) {
    for (const key of ['providers', 'provider', 'model', 'defaultModel', 'activeModelId']) if (owns(value, key)) unsupported(key)
  }
  if (value.models != null && !object(value.models)) unsupported('models（应为对象）')
  const models = value.models ?? {}
  if (!owns(models, 'providers')) {
    for (const key of ['provider', 'model']) if (owns(models, key)) unsupported(`models.${key}`)
  }
  if (!owns(models, 'activeModelId') && owns(models, 'defaultModel')) unsupported('models.defaultModel')
  if (models.providers != null && !Array.isArray(models.providers)) unsupported('models.providers（应为数组）')
  const providers = Array.isArray(models.providers) ? models.providers.filter(object) : []
  for (const [index, provider] of providers.entries()) {
    if (!owns(provider, 'models') && owns(provider, 'model')) unsupported(`models.providers[${index}].model`)
    if (!owns(provider, 'apiHost') && (owns(provider, 'baseUrl') || owns(provider, 'baseURL'))) unsupported(`models.providers[${index}].baseUrl/baseURL`)
    if (provider.models != null && !Array.isArray(provider.models)) unsupported(`models.providers[${index}].models（应为数组）`)
  }
  return { models, providers }
}
