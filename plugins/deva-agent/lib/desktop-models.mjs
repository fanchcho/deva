/**
 * 桌面端模型配置（`~/.deva/config.json`）的只读视图与受控写入。
 *
 * 字段与桌面端 `renderer/src/store/models.tsx` / `services/model-resolve.ts` 一致：
 *  · `models.providers[]`：Provider（id/name/kind/purpose/accent/adapter/apiHost/enabled/models）
 *  · `models.activeModelId`：`"<providerId>:<modelId>"`（模型 id 本身可含冒号，按第一个冒号拆）
 *  · `models.models[]`：ModelDef（id/name/enabled/tags/contextWindow/maxOutput…）
 *
 * 只改「默认模型引用」与指定 provider 的 `apiHost` / 模型清单；其它 provider、其它顶层键、
 * 桌面 secrets.json 一概不碰。写入用「读原文 → 比对 → 原子 rename」，并核对 mtime，避免桌面
 * 运行期用旧快照回写时悄悄覆盖。
 */

import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeBaseUrl } from './custom-model-network.mjs'
import { resolveDevaRoot } from './deva-fs.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function desktopConfigPath(config = {}) {
  return join(resolveDevaRoot(config), 'config.json')
}

export function readDesktopConfig(config = {}) {
  const path = desktopConfigPath(config)
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`桌面 config.json 不是普通文件：${path}`)
    const raw = readFileSync(path, 'utf8')
    const value = JSON.parse(raw)
    if (!object(value)) throw new Error(`桌面 config.json 顶层不是对象：${path}`)
    return { path, raw, value, exists: true, mtimeMs: stat.mtimeMs }
  } catch (error) {
    if (error.code === 'ENOENT') return { path, raw: null, value: {}, exists: false, mtimeMs: 0 }
    if (error instanceof SyntaxError) throw new Error(`桌面 config.json 不是合法 JSON：${path}；没有覆盖`)
    throw new Error(`读取桌面 config.json 失败：${error.code || error.message}`)
  }
}

function readModels(value) {
  const models = object(value.models) ? value.models : {}
  const providers = Array.isArray(models.providers) ? models.providers.filter(object) : []
  return { models, providers }
}

function defaultRoute(models, providers) {
  const reference = models.activeModelId
  const separator = typeof reference === 'string' ? reference.indexOf(':') : -1
  if (separator <= 0) return null
  const providerId = reference.slice(0, separator)
  const modelId = reference.slice(separator + 1)
  const provider = providers.find(item => item.id === providerId)
  if (!modelId || !Array.isArray(provider?.models) || !provider.models.some(item => item?.id === modelId)) return null
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

function writeDesktopConfig(config, next, expectedRaw, expectedMtimeMs) {
  const path = desktopConfigPath(config)
  const dir = dirname(path)
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700) } catch { /* 已存在/非 POSIX */ }
  const tmp = join(dir, `.config-${randomUUID()}.tmp`)
  let pending = false
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    pending = true
    try {
      writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      fsyncSync(fd)
    } finally { closeSync(fd) }
    if (expectedRaw !== undefined) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (current !== expectedRaw) throw new Error('桌面配置在保存期间被修改，没有覆盖；请重新打开模型页再保存')
    }
    if (expectedMtimeMs !== undefined) {
      const now = existsSync(path) ? statSync(path).mtimeMs : 0
      if (Math.abs(now - expectedMtimeMs) > 0.5) throw new Error('桌面配置刚被其它进程改写，没有覆盖；请重新打开模型页再保存')
    }
    try { chmodSync(tmp, 0o600) } catch { /* ignore */ }
    renameSync(tmp, path)
    pending = false
  } finally {
    if (pending) { try { unlinkSync(tmp) } catch { /* keep original */ } }
  }
}

/**
 * 选中桌面已有的 provider/model 作为默认（可同时更新该 provider 的 Base URL）。
 * 不删除、不改其它 provider；模型不存在时补一条 enabled 的 ModelDef。
 */
function desktopSecretProviderIds(config) {
  const path = join(resolveDevaRoot(config), 'secrets.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? new Set(Object.keys(parsed)) : new Set()
  } catch {
    return new Set()
  }
}

export function selectDesktopModel(config = {}, { providerId, modelId, baseUrl } = {}) {
  const snapshot = readDesktopConfig(config)
  const { models, providers } = readModels(snapshot.value)
  const provider = providers.find(item => item.id === providerId)
  if (!provider) throw new Error(`桌面端没有这个模型提供方：${String(providerId)}`)
  const id = String(modelId || '').trim()
  if (!id) throw new Error('请选择模型名')
  if (baseUrl) {
    const nextBase = normalizeBaseUrl(baseUrl)
    if (provider.apiHost && normalizeBaseUrl(String(provider.apiHost)) !== nextBase && desktopSecretProviderIds(config).has(provider.id)) {
      // 桌面按 provider id 绑定 safeStorage 密文；有密钥时换地址前必须由用户在桌面端处理。
      throw new Error('该提供方在桌面端已有密钥；换 Base URL 请先在桌面端修改（或先清除该提供方密钥）')
    }
    provider.apiHost = nextBase
  }
  if (!Array.isArray(provider.models)) provider.models = []
  if (!provider.models.some(item => item?.id === id)) provider.models.push({ id, name: id, enabled: true })
  const next = {
    ...snapshot.value,
    models: { ...models, providers: providers.map(item => item === provider ? provider : item), activeModelId: `${providerId}:${id}` },
  }
  writeDesktopConfig(config, next, snapshot.raw, snapshot.exists ? snapshot.mtimeMs : 0)
  return listDesktopModels(config)
}
