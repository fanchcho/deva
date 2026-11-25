/**
 * 桌面端模型配置（`~/.deva/config.json`）的只读视图与受控写入。
 *
 * 字段与桌面端 `renderer/src/store/models.tsx` / `services/model-resolve.ts` 一致：
 *  · `models.providers[]`：Provider（id/name/kind/purpose/accent/adapter/apiHost/enabled/models）
 *  · `models.activeModelId`：`"<providerId>:<modelId>"`（模型 id 本身可含冒号，按第一个冒号拆）
 *  · `models.providers[].models[]`：ModelDef（id/name/enabled/tags/contextWindow/maxOutput…）
 *
 * 只改「默认模型引用」与指定 provider 的 `apiHost` / 模型清单；其它 provider、其它顶层键、
 * 桌面 secrets.json 只检查 provider ID，不解密、不写入。写入前比对原文，通过原子 rename 落盘；
 * 已运行的桌面进程持有内存快照，保存前应先退出桌面。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBaseUrl } from './custom-model-network.mjs'
import { ensurePrivateDirectory, resolveDevaRoot, statOrNull, writeAtomic } from './deva-fs.mjs'
import { readDevaConfig } from './persona-store.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function desktopConfigPath(config = {}) {
  return join(resolveDevaRoot(config), 'config.json')
}

export function readDesktopConfig(config = {}) {
  checkDesktopRoot(config)
  return readDevaConfig(config)
}

function checkDesktopRoot(config) {
  if (typeof process.getuid !== 'function') throw new Error('共享桌面模型需要可校验 POSIX 文件归属的 Studio 主机')
  const root = resolveDevaRoot(config)
  const stat = statOrNull(root)
  if (stat && (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022))) {
    throw new Error('共享 Deva 配置目录必须是当前 OS 用户拥有的不可由其他用户写入的普通目录')
  }
  return root
}

function readModels(value) {
  if (value.models != null && !object(value.models)) throw new Error('桌面 config.json 的 models 不是对象')
  const models = value.models ?? {}
  if (models.providers != null && !Array.isArray(models.providers)) throw new Error('桌面 config.json 的 models.providers 不是数组')
  const providers = Array.isArray(models.providers) ? models.providers.filter(object) : []
  return { models, providers }
}

function defaultRoute(models, providers, reference = models.activeModelId) {
  const separator = typeof reference === 'string' ? reference.indexOf(':') : -1
  if (separator <= 0) return null
  const providerId = reference.slice(0, separator).trim()
  const modelId = reference.slice(separator + 1).trim()
  const provider = providers.find(item => item.id === providerId)
  if (!providerId || !modelId || !Array.isArray(provider?.models) || !provider.models.some(item => item?.id === modelId)) return null
  return { providerId, modelId, baseUrl: String(provider.apiHost || ''), modelName: modelId }
}

/** 桌面默认模型的内部视图；不作为 Studio RPC 响应。 */
export function listDesktopModels(config = {}) {
  const { value, path, exists } = readDesktopConfig(config)
  const { models, providers } = readModels(value)
  return {
    path,
    exists,
    activeModelId: typeof models.activeModelId === 'string' ? models.activeModelId : null,
    active: defaultRoute(models, providers),
    providers: providers.map(item => ({
      id: String(item.id || ''),
      name: String(item.name || item.id || ''),
      apiHost: String(item.apiHost || ''),
      adapter: String(item.adapter || ''),
      enabled: item.enabled !== false,
      models: (Array.isArray(item.models) ? item.models : []).map(model => ({ id: String(model.id || ''), name: String(model.name || model.id || ''), enabled: model.enabled !== false })),
    })),
  }
}

/** 桌面配置里某个 provider 的模型路由（运行期用；不返回密钥）。 */
export function readDesktopRoute(config = {}) {
  const { models, providers } = readModels(readDesktopConfig(config).value)
  const route = defaultRoute(models, providers)
  return route?.baseUrl.trim() ? { ...route, baseUrl: normalizeBaseUrl(route.baseUrl) } : null
}

/** Resolve the same references as Desktop; strip invalid/sensitive URL components from public settings. */
export function desktopModelState(config = {}) {
  const snapshot = readDesktopConfig(config)
  const { models, providers } = readModels(snapshot.value)
  const resolve = ref => {
    const route = defaultRoute(models, providers, ref)
    if (!route) return null
    const provider = providers.find(item => item.id === route.providerId)
    let baseUrl = ''
    try { baseUrl = normalizeBaseUrl(route.baseUrl) } catch { /* unsupported/implicit Desktop endpoint */ }
    const adapter = provider.adapter === 'openai' || provider.adapter === 'responses' ? provider.adapter : 'anthropic'
    return { ...route, ref: ref ?? models.activeModelId, adapter, baseUrl }
  }
  const choices = providers.flatMap(p => (Array.isArray(p.models) ? p.models : [])
    .filter(m => p.enabled === true && (p.purpose ?? 'llm') === 'llm' && m?.enabled === true && typeof m.id === 'string')
    .map(m => resolve(`${p.id}:${m.id}`)).filter(Boolean))
  return { snapshot, models, providers, active: resolve(models.activeModelId ?? null), resolve, choices }
}

export function writeDesktopDefaults(config, snapshot, models) {
  if (JSON.stringify(models) === JSON.stringify(snapshot.value.models)) return
  if (!snapshot.exists) ensurePrivateDirectory(checkDesktopRoot(config))
  writeAtomic(snapshot.path, `${JSON.stringify({ ...snapshot.value, models }, null, 2)}
`, { expectedRaw: snapshot.raw })
}

/** Edit the selected existing provider, or reuse/add a custom provider for a new Base URL.
 * Selection, migration and credential-save retries are idempotent and preserve other settings. */
export function writeDesktopModel(config, state, { route, ref = '', select = true, effort } = {}) {
  const { providers, models, snapshot } = state
  if (!route) {
    if (!select || (!snapshot.exists && !effort) || (models.activeModelId == null && effort === undefined)) return null
    writeDesktopDefaults(config, snapshot, { ...models, activeModelId: null, ...(effort === undefined ? {} : { activeEffort: effort || 'default' }) })
    return null
  }
  const existing = ref ? state.resolve(ref) : null
  if (ref && !existing) throw new Error('桌面模型引用已不存在，请刷新后重选')
  const matching = !ref && state.choices.find(p => p.adapter === 'openai' && p.baseUrl === route.baseUrl && p.modelName === route.modelName)
  const candidate = existing || matching
  const providerId = candidate?.providerId ?? `deva-studio-${createHash('sha256').update(route.baseUrl).digest('hex').slice(0, 20)}`
  const provider = providers.find(p => p.id === providerId)
  if (!candidate && provider && (provider.apiHost !== route.baseUrl || provider.adapter !== 'openai')) {
    throw new Error('新模型提供方 ID 与现有桌面配置冲突；未写入')
  }
  if (candidate && candidate.baseUrl !== route.baseUrl && desktopSecretProviderIds(config).has(providerId)) {
    throw new Error('该提供方在桌面端已有密钥；换 Base URL 请先在桌面端修改（或先清除该提供方密钥）')
  }
  const previous = (provider?.models ?? []).find(m => m.id === route.modelName)
  const model = { name: route.modelName, ...previous, id: route.modelName, enabled: true }
  const nextProvider = {
    id: providerId, name: 'Deva Studio', kind: 'custom', purpose: 'llm', accent: '#8a8a94',
    adapter: 'openai', ...provider, enabled: candidate && previous ? provider.enabled : true,
    apiHost: route.baseUrl, models: previous
      ? provider.models.map(m => m === previous ? (candidate ? previous : model) : m)
      : [...(provider?.models ?? []), model],
  }
  const next = {
    ...models,
    providers: provider ? providers.map(p => p === provider ? nextProvider : p) : [...providers, nextProvider],
    ...(select ? { activeModelId: `${providerId}:${route.modelName}` } : {}),
    ...(effort === undefined ? {} : { activeEffort: effort || 'default' }),
  }
  writeDesktopDefaults(config, snapshot, next)
  return desktopModelState(config).resolve(`${providerId}:${route.modelName}`)
}
function desktopSecretProviderIds(config) {
  const path = join(resolveDevaRoot(config), 'secrets.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!object(parsed)) throw new Error()
    return new Set(Object.keys(parsed))
  } catch (error) {
    if (error.code === 'ENOENT') return new Set()
    throw new Error('无法核对桌面密钥记录；没有更改 Base URL')
  }
}

export function selectDesktopModel(config = {}, { providerId, modelId, baseUrl } = {}) {
  const snapshot = readDesktopConfig(config)
  const { models, providers } = readModels(snapshot.value)
  const previousProvider = providers.find(item => item.id === providerId)
  if (!previousProvider) throw new Error(`桌面端没有这个模型提供方：${String(providerId)}`)
  const provider = { ...previousProvider, models: Array.isArray(previousProvider.models) ? [...previousProvider.models] : [] }
  const id = String(modelId || '').trim()
  if (!id) throw new Error('请选择模型名')
  if (baseUrl) {
    const nextBase = normalizeBaseUrl(baseUrl)
    if ((!provider.apiHost || normalizeBaseUrl(String(provider.apiHost)) !== nextBase) && desktopSecretProviderIds(config).has(provider.id)) {
      // 桌面按 provider id 绑定 safeStorage 密文；有密钥时换地址前必须由用户在桌面端处理。
      throw new Error('该提供方在桌面端已有密钥；换 Base URL 请先在桌面端修改（或先清除该提供方密钥）')
    }
    provider.apiHost = nextBase
  }
  if (!provider.models.some(item => item?.id === id)) provider.models.push({ id, name: id, enabled: true })
  const next = {
    ...snapshot.value,
    models: { ...models, providers: providers.map(item => item === previousProvider ? provider : item), activeModelId: `${providerId}:${id}` },
  }
  writeDesktopDefaults(config, snapshot, next.models)
  return listDesktopModels(config)
}
