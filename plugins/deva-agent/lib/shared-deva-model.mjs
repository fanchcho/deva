import { randomUUID } from 'node:crypto'
import { closeSync, chmodSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBaseUrl } from './custom-model-network.mjs'
import { resolveDevaRoot } from './deva-home.mjs'
import { validateStoredModel } from './storage-contracts.mjs'

const ID = 'deva-studio-shared'
const PREFIX = `${ID}:`
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function sharedDevaPath(run) {
  const owner = run.config?.sharedDevaUserId
  if (!Number.isSafeInteger(owner) || owner < 1 || run.identity?.userId !== owner) return null
  // 与身份文件共用同一个根解析（config.sharedDevaHome → DEVA_HOME → ~/.deva），避免出现两套 .deva。
  return resolveDevaRoot(run.config)
}

function statIfPresent(path) {
  try { return lstatSync(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}

function checkDirectory(root) {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('共享 Deva 配置需要支持 POSIX 用户权限的 Studio 主机')
  const stat = statIfPresent(root)
  if (stat && (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022))) {
    throw new Error('共享 Deva 配置目录必须归 Studio 的 OS 用户所有，且不能是符号链接或允许其他用户写入')
  }
  return stat
}

function snapshot(root, name) {
  const file = join(root, name)
  try {
    if (!checkDirectory(root)) return { raw: null, value: {} }
    const stat = statIfPresent(file)
    if (!stat) return { raw: null, value: {} }
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o022)) throw new Error()
    const raw = readFileSync(file, 'utf8')
    const value = JSON.parse(raw)
    if (!object(value)) throw new Error()
    return { raw, value }
  } catch {
    // Never expose a JSON parse error: it can contain bytes of the configuration or ciphertext.
    throw new Error(`无法安全读取共享 Deva ${name}；请检查文件格式、归属和权限`)
  }
}

function readModels(config) {
  const { models = {} } = config
  if (!object(models) || (models.providers !== undefined && !Array.isArray(models.providers))) {
    throw new Error('共享 Deva config.json 的 models 格式无效')
  }
  const providers = models.providers ?? []
  const matching = providers.filter(p => p?.id === ID)
  if (matching.length > 1) throw new Error('共享 Deva provider ID 重复')
  const [provider] = matching
  if (provider) validateStoredModel('sharedDesktopProvider', provider)
  return { models, providers, provider }
}

export function readSharedModel(root) {
  const { models, provider } = readModels(snapshot(root, 'config.json').value)
  if (!provider || !provider.enabled || !provider.apiHost.trim()) return null
  const ref = typeof models.activeModelId === 'string' && models.activeModelId.startsWith(PREFIX)
    ? models.activeModelId.slice(PREFIX.length) : null
  const enabled = provider.models.filter(model => model.enabled)
  const selected = (ref && enabled.find(model => model.id === ref)) || enabled[0]
  if (!selected) throw new Error('共享 Deva provider 没有启用的模型；请选择模型或停用该 provider')
  if (!selected.id.trim() || /\p{Cc}/u.test(selected.id)) throw new Error('共享 Deva provider 的模型名无效')
  return validateStoredModel('sharedModelRoute', {
    baseUrl: normalizeBaseUrl(provider.apiHost.trim()), modelName: selected.id,
  })
}

function replaceConfig(root, raw, config) {
  if (!checkDirectory(root)) mkdirSync(root, { mode: 0o700 })
  const stat = checkDirectory(root)
  if ((stat.mode & 0o777) !== 0o700) chmodSync(root, 0o700)
  const target = join(root, 'config.json')
  const tmp = join(root, `.config-${randomUUID()}.tmp`)
  let created = false
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    created = true
    try { writeFileSync(fd, JSON.stringify(config, null, 2), 'utf8') } finally { closeSync(fd) }
    if (snapshot(root, 'config.json').raw !== raw) throw new Error('桌面端配置已变化；请重新载入并保存')
    renameSync(tmp, target)
    created = false
  } finally {
    if (created) {
      try { unlinkSync(tmp) } catch { /* leave the original write error intact */ }
    }
  }
}

export function writeSharedModel(root, route) {
  const { raw, value } = snapshot(root, 'config.json')
  const { models, providers, provider } = readModels(value)
  if (!route && (!provider || !provider.enabled)) return
  const active = typeof models.activeModelId === 'string' && models.activeModelId.startsWith(PREFIX)
  let next
  if (route) {
    validateStoredModel('sharedModelRoute', route)
    // Desktop's safeStorage keys are bound to provider ID, not host. Never retarget a Desktop key.
    if (provider?.apiHost !== route.baseUrl && (!provider?.apiHost || normalizeBaseUrl(provider.apiHost) !== route.baseUrl)) {
      if (Object.hasOwn(snapshot(root, 'secrets.json').value, ID)) {
        throw new Error('桌面端为共享 provider 保存了密钥；更换地址前请在桌面端清除该密钥并退出桌面端')
      }
    }
    const previous = provider?.models.find(model => model.id === route.modelName)
    const remaining = provider?.models.filter(model => model.id !== route.modelName) ?? []
    next = {
      id: ID, name: 'Deva Studio Shared', kind: 'custom', purpose: 'llm', accent: '#8a8a94',
      ...provider, adapter: 'openai', enabled: true, apiHost: route.baseUrl,
      models: [{ name: route.modelName, ...previous, id: route.modelName, enabled: true }, ...remaining],
    }
  } else {
    next = { ...provider, enabled: false }
  }
  validateStoredModel('sharedDesktopProvider', next)
  replaceConfig(root, raw, {
    ...value,
    models: {
      ...models,
      providers: provider ? providers.map(p => p === provider ? next : p) : [...providers, next],
      ...(active ? { activeModelId: route ? PREFIX + route.modelName : null } : {}),
    },
  })
}
