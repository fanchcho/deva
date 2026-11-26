import { desktopDiagnostics } from './desktop-diagnostics.mjs'
import { resolveAgentModel } from './agent-model-ref.mjs'
/** Desktop owns the route and the default; Studio owns its own credentials, and may read Desktop's read-only ones. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { customModelEndpoint, ModelInputError, normalizeBaseUrl } from './custom-model-network.mjs'
import { desktopConfigLocation, desktopModelState, writeDesktopDefaults, writeDesktopModel } from './desktop-models.mjs'
import { getPersona, listPersonas, writePersonaModel } from './persona-store.mjs'
import { resolveDevaRoot } from './deva-fs.mjs'
import { sharedDevaWritePath, desktopWriteDenial } from './shared-deva-model.mjs'
import { validateStored, validateStoredModel } from './storage-contracts.mjs'
import { DESKTOP_DECRYPT_CODES, isToolchainFailure, publicDesktopCredential, resolveDesktopCredential } from './desktop-secrets.mjs'

export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LEGACY_EFFORT = 'minimal'
const LEGACY_PROVIDER = 'deva-studio-shared'

function modelStore(run) {
  if (run.identity?.userId == null || !run.state?.profile) throw new Error('缺少 Studio 模型设置的用户或 Profile 作用域')
  return run.state.profile.namespace(String(run.identity.userId))
}

/**
 * 插件自己保存的 Key 有两个作用域：
 *  · `user`：按 Studio 账号（`state.user`），**与运行 Profile 无关**——这是修掉「保存过、重开就丢」的存放点；
 *  · `profile`：0.8.43 及更早按 `state.profile`（userId + profile）存放，作为只读兼容来源，读到后迁移。
 *
 * 为什么必须换作用域：宿主给插件 RPC 的 `run.identity.profile` 是**会话**的 Profile，Studio 从配置
 * 哈希派生（`studio-web-<sha>`，见宿主 dist），与插件安装时的激活 Profile（常为 `default`）不同。
 * 同一账号在两种 Profile 下保存的 Key 落在两个互不可见的命名空间里，于是「保存成功、下次读回为空」。
 */
function userCredentialStore(run) {
  return run.state.user?.namespace?.('desktopModelKeys') ?? null
}

function profileCredentialStore(run) {
  return run.state.profile.namespace(String(run.identity.userId), 'desktopModelKeys')
}

const credentialId = route => createHash('sha256').update(`${route.providerId}\0${route.baseUrl}`).digest('hex')
async function readStored(store, key) {
  const value = await store.get(key)
  return value === undefined ? null : validateStored(key, value)
}

/** 凭据作用域诊断：页面与报错都用它说明「查的是哪个名字空间」。只含 ID，不含密钥。 */
function credentialScope(run) {
  return { userId: run.identity?.userId ?? null, profile: run.identity?.profile ?? null }
}

/**
 * 读插件侧保存的 Key：先看账号级，再看旧的 Profile 级。
 * 不抛错：存储不可用/记录损坏都作为结论返回，交给解析层决定继续尝试桌面端还是报错。
 */
async function readPluginCredential(run, route) {
  const id = credentialId(route)
  const result = { present: false, key: '', scope: 'none', legacyScope: false, storeError: '', corrupt: false }
  const stores = []
  const userStore = userCredentialStore(run)
  if (userStore) stores.push(['user', userStore])
  try {
    stores.push(['profile', profileCredentialStore(run)])
  } catch (error) {
    // 宿主未提供 profile 作用域或该作用域不可用：记录原因，继续尝试账号级与桌面端。
    result.storeError = result.storeError || `profile:${error?.code || 'unavailable'}`
  }
  for (const [scope, store] of stores) {
    let record
    try {
      record = await store.get(id)
    } catch (error) {
      result.storeError = `${scope}:${error?.code || 'unavailable'}`
      continue
    }
    if (record === undefined) continue
    try {
      validateStored('desktopModelKey', record)
    } catch {
      result.corrupt = true
      continue
    }
    if (record.providerId !== route.providerId || record.baseUrl !== route.baseUrl) continue
    result.present = Boolean(record.apiKey)
    result.key = record.apiKey || ''
    result.scope = scope
    result.legacyScope = scope === 'profile'
    return result
  }
  return result
}

/** 把旧 Profile 作用域的 Key 迁到账号级；只在运行/保存路径调用，设置页读取仍然只读。 */
async function promoteLegacyCredential(run, route) {
  const userStore = userCredentialStore(run)
  if (!userStore) return false
  const record = await profileCredentialStore(run).get(credentialId(route)).catch(() => undefined)
  if (record === undefined) return false
  let parsed
  try {
    parsed = validateStored('desktopModelKey', record)
  } catch { return false }
  if (parsed.providerId !== route.providerId || parsed.baseUrl !== route.baseUrl || !parsed.apiKey) return false
  await userStore.set(credentialId(route), parsed)
  await profileCredentialStore(run).delete(credentialId(route)).catch(() => {})
  return true
}

function trustedBases(run) {
  return (run.config?.modelTrustedBases || []).map(normalizeBaseUrl)
}

export function resolveCustomEndpoint(run, baseUrl) {
  return customModelEndpoint(baseUrl, trustedBases(run))
}

/**
 * 解析一条路由可用的 Key。顺序固定：
 *  ① 插件侧显式保存的 Key（账号级 → 旧 Profile 级）
 *  ② 桌面端 `secrets.json` 里同一 provider 的 Key（只读、按需 DPAPI 解密，明文只留内存）
 *  ③ 都没有 → 返回原因，由调用方给出可操作报错
 *
 * `source` 就是页面要显示的来源（`plugin` / `desktop` / `none`）；`details` 只含元数据。
 */
export async function resolveCredential(run, route, options = {}) {
  const base = { key: '', source: 'none', scope: credentialScope(run), details: {}, plugin: null, desktop: null }
  if (!route?.providerId || !route?.baseUrl) return { ...base, reason: 'no-route' }
  let plugin
  try {
    plugin = await readPluginCredential(run, route)
  } catch (error) {
    plugin = { present: false, key: '', scope: 'unavailable', storeError: String(error?.code || 'store-unavailable') }
  }
  if (plugin.present && plugin.key) {
    return { ...base, key: plugin.key, source: 'plugin', plugin: { scope: plugin.scope, legacyScope: plugin.legacyScope } }
  }
  let desktop = null
  try {
    desktop = await resolveDesktopCredential({ config: run.config, providerId: route.providerId, decrypt: options.decrypt })
  } catch {
    desktop = { status: 'error', code: 'unavailable', present: false, plaintext: '' }
  }
  const desktopPublic = publicDesktopCredential(desktop)
  if (desktop?.status === 'decrypted' && desktop.plaintext) {
    return { ...base, key: desktop.plaintext, source: 'desktop', plugin: plugin ? { scope: plugin.scope } : null, desktop: desktopPublic }
  }
  return {
    ...base,
    reason: desktop?.status === 'missing-file' ? 'desktop-file-missing' : desktop?.status === 'missing' ? 'missing-desktop-entry' : desktop?.status === 'undecryptable' ? 'decrypt-failed' : desktop?.status === 'unreadable' ? 'desktop-unreadable' : 'none',
    plugin: { scope: plugin?.scope ?? 'none', storeError: plugin?.storeError || '', corrupt: Boolean(plugin?.corrupt) },
    desktop: desktopPublic,
  }
}

/** 运行期取 Key（只回明文，不解释来源）。 */
export async function readCredential(run, route, options = {}) {
  const resolved = await resolveCredential(run, route, options)
  if (resolved.key && resolved.source === 'plugin' && resolved.plugin?.legacyScope) {
    // 旧 Profile 作用域命中：顺手迁到账号级，下次换 Profile 也能读到。迁移失败不影响本轮。
    await promoteLegacyCredential(run, route).catch(() => {})
  }
  return resolved.key
}

async function writeCredential(run, route, apiKey) {
  const record = validateStored('desktopModelKey', { providerId: route.providerId, baseUrl: route.baseUrl, apiKey })
  const id = credentialId(route)
  const userStore = userCredentialStore(run)
  const target = userStore || profileCredentialStore(run)
  if (apiKey) await target.set(id, record)
  else {
    await target.delete(id)
    // 清除也要清旧作用域，否则「清除」后又被旧记录复活。
    if (userStore) await profileCredentialStore(run).delete(id).catch(() => {})
  }
}

/** Import only the authorized user's recoverable legacy route. Existing Desktop defaults take priority.
 * Copy the key before deleting the source; never copy it to a different provider/base on a retry. */
async function migrateLegacy(run, store) {
  const [legacy, sharedKey, desktopKey, options, mode] = await Promise.all([
    readStored(store, 'customModel'), readStored(store, 'sharedModelKey'), readStored(store, 'desktopModelKey'),
    readStored(store, 'modelOptions'), readStored(store, 'modelMode'),
  ])
  let desktop = desktopModelState(run.config)
  const effort = desktop.models.activeEffort === undefined && REASONING_EFFORTS.includes(options?.reasoningEffort) ? options.reasoningEffort : undefined
  const mirror = desktop.active?.providerId === LEGACY_PROVIDER ? desktop.active : desktop.choices.find(route => route.providerId === LEGACY_PROVIDER)
  const candidate = legacy || (sharedKey && mode?.mode !== 'session' && mirror?.baseUrl === sharedKey.baseUrl ? mirror : null)
  if (candidate) {
    const baseUrl = normalizeBaseUrl(candidate.baseUrl)
    if (legacy?.apiKey && (baseUrl.includes(legacy.apiKey) || candidate.modelName.includes(legacy.apiKey))) {
      throw new Error('旧模型配置的非密钥字段包含密钥；未迁移')
    }
    // Importing a new private address must not create an unapproved Desktop provider.
    const existing = desktop.choices.find(r => r.adapter === 'openai' && r.baseUrl === baseUrl && r.modelName === candidate.modelName)
    if (!existing) resolveCustomEndpoint(run, baseUrl)
    const route = writeDesktopModel(run.config, desktop, {
      route: { baseUrl, modelName: candidate.modelName },
      select: !desktop.active,
      effort,
    })
    const key = legacy?.apiKey || (sharedKey?.baseUrl === baseUrl ? sharedKey.apiKey : '')
    if (key && !await readCredential(run, route)) await writeCredential(run, route, key)
    if (legacy) await store.delete('customModel')
    if (sharedKey?.baseUrl === baseUrl) await store.delete('sharedModelKey')
    desktop = desktopModelState(run.config)
  }
  if (!candidate && desktop.active && effort) {
    writeDesktopDefaults(run.config, desktop.snapshot, { ...desktop.models, activeEffort: effort })
    desktop = desktopModelState(run.config)
  }
  if (desktopKey) {
    const route = desktop.providers.some(p => p.id === desktopKey.providerId)
      ? { ...desktopKey, baseUrl: normalizeBaseUrl(desktopKey.baseUrl) } : null
    if (route && !await readCredential(run, route)) await writeCredential(run, route, desktopKey.apiKey)
    if (route) await store.delete('desktopModelKey')
  }
  for (const key of ['modelMode', 'modelNetworkConsent', ...((candidate || desktop.active) && options?.reasoningEffort !== LEGACY_EFFORT ? ['modelOptions'] : [])]) {
    if (await store.get(key) !== undefined) await store.delete(key)
  }
  return desktop
}

function defaultEffort(desktop) {
  return REASONING_EFFORTS.includes(desktop.models.activeEffort) ? desktop.models.activeEffort : ''
}

/** 镜像展示用：不改变任何信任判定，只保证 URL 规范化失败时页面仍看得到桌面存的原文。 */
function displayBaseUrl(value) {
  if (!value) return ''
  try { return normalizeBaseUrl(value) } catch {
    try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch { return '[地址格式无效]' }
  }
}

export async function readCustomModel(run, personaId, options = {}) {
  if (!sharedDevaWritePath(run)) {
    if (run.mode === 'global') throw new Error(desktopWriteDenial(run))
    return null
  }
  const desktop = await migrateLegacy(run, modelStore(run))
  const explicit = run.mode === 'global' ? resolveAgentModel(desktop, run.model?.model) : null
  const selected = personaId ?? desktop.snapshot.value.personas?.selected
  const ref = selected && getPersona(run.config, selected)?.model
  if (!explicit && ref && !desktop.resolve(ref)) throw new Error(`身份模型引用失效：${ref}；请在 Deva → 模型 → 身份模型绑定重新选择`)
  if (!explicit && !ref && unresolvedActiveRef(desktop)) throw new Error(`桌面默认模型引用失效：${desktop.models.activeModelId}；请在 Deva → 模型重新选择`)
  const route = explicit || (ref && desktop.resolve(ref)) || desktop.active
  if (!route) return null
  if (route.adapter !== 'openai' || !route.baseUrl) {
    throw new Error('当前桌面模型没有可用于 Chat Completions 的地址或适配器；未回退')
  }
  const credential = await resolveCredential(run, route, options)
  return { ...route, apiKey: credential.key, credentialSource: credential.source, credentialDiagnostics: credentialDetails(credential), reasoningEffort: defaultEffort(desktop) }
}

/** 运行期诊断行：只说明「查过哪里、结论是什么」，不含任何密钥片段。 */
function credentialDetails(credential) {
  const desktop = credential.desktop || null
  return {
    source: credential.source,
    scope: credential.scope,
    reason: credential.reason || '',
    ...(desktop?.decryptCode ? { decryptCode: desktop.decryptCode } : {}),
    ...(desktop?.toolchainBroken ? { toolchainBroken: true } : {}),
    ...(desktop?.selfCheck ? { selfCheck: desktop.selfCheck } : {}),
    ...(desktop?.stderr ? { stderr: desktop.stderr } : {}),
    plugin: credential.plugin ? { scope: credential.plugin.scope, storeError: credential.plugin.storeError || '', corrupt: Boolean(credential.plugin.corrupt) } : null,
    desktop: desktop ? {
      path: desktop.path, source: desktop.source, exists: desktop.exists, size: desktop.size ?? null,
      structure: desktop.structure, code: desktop.code, entryCount: desktop.entryCount ?? null,
      present: Boolean(desktop.present), status: desktop.status || '',
      ...(desktop.fileOwner ? { fileOwner: desktop.fileOwner } : {}),
      ...(desktop.aclReadable !== undefined ? { aclReadable: Boolean(desktop.aclReadable) } : {}),
      ...(desktop.decryptCode ? { decryptCode: desktop.decryptCode } : {}),
      ...(desktop.toolchainBroken !== undefined ? { toolchainBroken: Boolean(desktop.toolchainBroken) } : {}),
    } : null,
  }
}

/**
 * 把桌面已生效的选择投影成页面可显示的一条路由。
 *
 * **只读镜像不设网络/管理员门槛。** 管理员批准（`modelTrustedBases`）约束的是「Deva 自己发起直连」，
 * 不是「页面显示桌面本来就选着的地址」。这里不调用 `resolveCustomEndpoint`，
 * 于是本机 / 内网 / HTTP 地址照实显示；真正要发请求时由 `createCustomModel` 再判，
 * 那时才给可操作的批准提示。
 */
function desktopRouteView(desktop) {
  const route = desktop.active
  const provider = route && desktop.providers.find(item => item.id === route.providerId)
  return {
    baseUrl: displayBaseUrl(route?.baseUrl),
    modelName: route?.modelName ?? '',
    modelRef: route?.ref ?? '',
    providerId: route?.providerId ?? '',
    providerName: String(provider?.name || route?.providerId || ''),
    ...(route?.contextWindow ? { contextWindow: route.contextWindow } : {}),
    ...(route?.maxOutput ? { maxOutput: route.maxOutput } : {}),
    ...(route?.maxInput ? { maxInput: route.maxInput } : {}),
    adapter: route?.adapter ?? '',
  }
}

/** 桌面有默认引用但当前解析不出来：区分「没选」和「选了但引用失效」，两者文案不能混。 */
function unresolvedActiveRef(desktop) {
  const reference = desktop.models.activeModelId
  return typeof reference === 'string' && reference.trim() && !desktop.active ? reference : ''
}

function publishableRoute(route) {
  const lengths = Object.fromEntries(['contextWindow', 'maxOutput', 'maxInput'].filter(k => route[k] !== undefined).map(k => [k, route[k]]))
  return { ref: route.ref, adapter: route.adapter, baseUrl: displayBaseUrl(route.baseUrl), modelName: route.modelName, providerId: route.providerId, providerName: String(route.providerName || route.providerId || ''), ...lengths }
}

/**
 * 桌面这套配置能不能被 Deva 拿去直连？
 *
 * 这里是**只读判定**，只回答「要不要提示批准」，不因它禁掉页面、也不因它拒绝显示。
 * 非公网 / HTTP 地址（含 127.0.0.1、内网段）返回 true，页面据此给出「哪个地址、为什么、到哪里批」。
 */
function needsNetworkApproval(run, route) {
  if (!route?.baseUrl || route.adapter !== 'openai') return false
  try { resolveCustomEndpoint(run, route.baseUrl); return false } catch (error) {
    if (error instanceof ModelInputError && error.code === 'confirmation-required') return true
    return false
  }
}

function isTrustedBase(run, baseUrl) {
  if (!baseUrl) return false
  try { return trustedBases(run).includes(normalizeBaseUrl(baseUrl)) } catch { return false }
}

export async function readModelSelection(run) {
  const diagnostic = desktopDiagnostics(run.config)
  try {
    const result = await readDesktopSelection(run)
    return { ...result, desktopDiagnostics: diagnostic }
  } catch (error) {
    return { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false,
      desktopModels: [], personaModels: [], desktopWriteRequired: true,
      desktopDiagnostics: JSON.stringify({ ...JSON.parse(diagnostic), error: safeReadError(error) }, null, 2) }
  }
}

function safeReadError(error) {
  // Never forward storage payloads or credential values across the RPC boundary.
  return String(error?.message || error).replace(/(Bearer\s+|(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
}

async function readDesktopSelection(run) {
  const root = resolveDevaRoot(run.config)
  const empty = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false }
  try { empty.legacyNeedsSetup = Boolean((await modelStore(run).get('model'))?.modelId) } catch { /* metadata is optional */ }
  // Settings reads must never migrate legacy routes or require write authorization.
  const desktop = desktopModelState(run.config, { includeDisabled: true })
  const location = desktopConfigLocation(run.config)
  let hasApiKey = false, credentialError = '', credential = null
  try {
    credential = await resolveCredential(run, desktop.active)
    hasApiKey = Boolean(credential.key)
  } catch (error) {
    credentialError = safeReadError(error) + '；凭据读取失败；桌面模型仍可选择，远端刷新需要可用 Key。'
  }
  // 三种情况分开说：没保存 / 保存了读不回 / 桌面有但没解密。页面据此给不同下一步。
  const keyProblem = !desktop.active || hasApiKey ? '' : credentialProblemMessage(credential, run, desktop.active)
  // 旧字段保持兼容：凭据存储不可用时继续填 credentialError（它只说明「Key 不可用」，不影响桌面模型显示）。
  if (!credentialError && credential?.plugin?.storeError) {
    credentialError = `插件侧凭据存储不可用（${credential.plugin.storeError}）；桌面模型仍可选择，远端刷新需要可用 Key。`
  }
  const base = {
    ...empty,
    ...desktopRouteView(desktop),
    desktopWriteRequired: !sharedDevaWritePath(run),
    ...(!sharedDevaWritePath(run) ? { desktopWriteMessage: desktopWriteDenial(run) } : {}),
    hasApiKey,
    ...(hasApiKey ? { keySource: credential?.source || 'plugin' } : {}),
    ...(hasApiKey && credential?.source === 'desktop' ? { keySourceReadOnly: true } : {}),
    ...(credential ? { keyDiagnostics: JSON.stringify(credentialDetails(credential), null, 2) } : {}),
    ...(keyProblem ? { keyProblem } : {}),
    ...(credentialError ? { credentialError } : {}),
    sharedConfigPath: join(root, 'config.json'),
    desktopConfigPath: location.path,
    desktopConfigExists: location.exists,
    desktopOwnership: location.ownership,
    desktopProviders: desktop.providers.map(p => ({ id: p.id, name: p.name, baseUrl: displayBaseUrl(p.apiHost), models: p.models.map(m => ({ id: m.id, name: m.name })) })),
    desktopModels: desktop.choices.map(route => publishableRoute({ ...route, providerName: desktop.providers.find(item => item.id === route.providerId)?.name })),
    personaModels: [],
    ...(unresolvedActiveRef(desktop) ? { unresolvedModelRef: unresolvedActiveRef(desktop) } : {}),
    ...(needsNetworkApproval(run, desktop.active) ? { needsNetworkApproval: true } : {}),
    ...(isTrustedBase(run, desktop.active?.baseUrl) ? { allowNonPublic: true } : {}),
    ...(defaultEffort(desktop) ? { reasoningEffort: defaultEffort(desktop) } : {}),
  }
  try { base.personaModels = listPersonas(run.config).list.map(({ id, name, model }) => ({ id, name, model })) } catch { /* model settings remain available */ }
  return base
}

/**
 * 「为什么没有可用 Key」的可操作说明。每种情况对应不同下一步，不能统一回「未设置」：
 *  · 插件侧记录损坏 / 存储不可用 → 说明作用域，请重填一次
 *  · 桌面文件不存在或没有该 provider → 给出确切路径与条目数，请到桌面端保存
 *  · 桌面有条目但解不开 → 说明 DPAPI 密文只能在保存它的同一 Windows 用户/机器解密
 */
function credentialProblemMessage(credential, run, route) {
  const scope = credential?.scope || credentialScope(run)
  const desktop = credential?.desktop || null
  const desktopDetail = desktop
    ? `桌面 secrets.json：${desktop.path}（存在=${desktop.exists}，结构=${desktop.structure}，条目=${desktop.entryCount ?? '未知'}${desktop.decryptCode ? `，解密=${desktop.decryptCode}` : ''}）`
    : '桌面 secrets.json：路径未能解析'
  const provider = route?.providerId || '当前模型'
  if (credential?.plugin?.corrupt) {
    return `插件侧保存的凭据记录已损坏（Profile ${scope.profile}）；请在下方重新填写一次 API Key 覆盖。${desktopDetail}`
  }
  if (credential?.plugin?.storeError) {
    return `插件侧凭据存储不可用（${credential.plugin.storeError}）；请在下方重新填写一次 API Key。${desktopDetail}`
  }
  switch (credential?.reason) {
    case 'decrypt-failed': {
      const code = desktop?.decryptCode || 'unknown'
      const health = desktop?.selfCheck
      const variantText = health?.variants?.length
        ? `（PowerShell 变体：${health.variants.map(v => `${v.binary}=${v.ok ? 'ok' : (v.code || 'fail')}`).join('，')}${health.container ? `；运行环境：${health.container}` : ''}）`
        : ''
      if (code === DESKTOP_DECRYPT_CODES.FOREIGN_BLOB) {
        const owner = desktop?.fileOwner ? `文件所有者=${desktop.fileOwner}` : ''
        const procUser = health?.user ? `当前进程用户=${health.user}` : ''
        const who = [owner, procUser].filter(Boolean).join('，')
        return `桌面端已保存 providerId=${provider} 的密钥，但**这份密文不是当前 Studio 进程这个 Windows 用户/这台机器存的**（自检往返成功，说明本机 DPAPI 可用；该 blob 解不开${who ? `；${who}` : ''}）。DPAPI 是用户级加密，跨用户/跨机器在密码学上不可解，Studio 内部绕不过去：请在本页填一次 API Key（会存到 Studio 账号级，换 Profile/重启都保留），或由桌面端做一次显式交接（需改桌面端，本版本未实现）。${desktopDetail}`
      }
      if (isToolchainFailure(code)) {
        return `桌面端已保存 providerId=${provider} 的密钥，但本机没有可用的 DPAPI 工具链（${code}）${variantText}。这不是密钥的问题：请让管理员在 Studio 所在 Windows 机器上确认 Windows PowerShell 5.1 或 PowerShell 7 可用、且未被 Constrained Language/组策略限制；也可先在本页手动填写。${desktopDetail}`
      }
      if (code === DESKTOP_DECRYPT_CODES.NOT_WINDOWS) {
        return `桌面端已保存 providerId=${provider} 的密钥，但 Studio 服务端不在那台 Windows 上（${health?.container ? `检测到 ${health.container}；` : ''}当前平台 ${health?.platform || process.platform}）。DPAPI 密文只在保存它的 Windows 用户/机器上可解，跨机器/容器在密码学上不可解：请在 Studio 本页填一次，或把 Studio 部署到同一台 Windows。${desktopDetail}`
      }
      return `桌面端已保存 providerId=${provider} 的密钥，但本次无法解密（${code}）。DPAPI 密文只能由保存它的同一 Windows 用户、在同一台机器上解密；请在本页手动填写一次（之后会永久保留）。${desktopDetail}`
    }
    case 'desktop-unreadable':
      return `桌面 secrets.json 存在但不可用（${desktop?.code || '未知'}：${desktop?.path || '路径未知'}）；请检查该文件的类型/大小/JSON 结构，或在下方手动填写 Key。`
    case 'missing-desktop-entry':
      return `插件侧和桌面端都没有 providerId=${provider} 的密钥；桌面 secrets.json 已读取但没有这一条（${desktop?.path || '路径未知'}，条目=${desktop?.entryCount ?? 0}）。请在 Deva 桌面端保存一次，或在下方手动填写。`
    case 'desktop-file-missing':
      return `插件侧没有保存该提供方的 Key，桌面端也还没写过密钥文件（${desktop?.path || '路径未知'} 不存在）。请在 Deva 桌面端保存一次，或直接在下方手动填写。`
    default:
      return `未找到可用的 API Key：插件侧没有保存，桌面端也没有该提供方的条目。${desktopDetail}`
  }
}

function checkedRoute(run, { baseUrl, modelName, apiKey, reasoningEffort }) {
  if (reasoningEffort && !REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new ModelInputError('reasoningEffort', 'reasoning-effort-invalid', '模型强度无效；请选择支持的档位')
  }
  if (!baseUrl.trim()) {
    if (modelName.trim() || apiKey) throw new ModelInputError('baseUrl', 'base-url-required', '请填写有效的模型 API 地址')
    return null
  }
  let base
  try { base = normalizeBaseUrl(baseUrl.trim()) } catch (error) { throw new ModelInputError('baseUrl', 'base-url-invalid', error.message) }
  const name = modelName.trim()
  if (!name || /\p{Cc}/u.test(name)) throw new ModelInputError('modelName', 'model-name-invalid', '请填写有效的模型名')
  if (apiKey && !/^[A-Za-z0-9._~+/-]+=*$/.test(apiKey)) throw new ModelInputError('apiKey', 'api-key-invalid', 'API Key 必须是有效的 Bearer Token 格式')
  if (apiKey && (base.includes(apiKey) || name.includes(apiKey))) throw new ModelInputError('apiKey', 'api-key-misplaced', '请仅在 API Key 字段填写密钥')
  return { baseUrl: base, modelName: name }
}

async function removeLegacyId(store) {
  if (await store.get('model') !== undefined) await store.delete('model')
}

export async function saveModelSelection(run, input) {
  if (!sharedDevaWritePath(run)) throw new Error(desktopWriteDenial(run))
  const options = validateStoredModel('modelSettingsInput', input)
  const store = modelStore(run)
  const desktop = await migrateLegacy(run, store)
  const ref = options.modelRef ?? desktop.active?.ref ?? ''
  const existing = ref ? desktop.resolve(ref) : null
  if (ref && !existing) throw new Error('桌面模型引用已不存在，请刷新后重选')
  let route
  try {
    // Selecting an existing Desktop model does not approve its Base URL for network use.
    if (existing && existing.baseUrl === options.baseUrl && existing.modelName === options.modelName && !options.apiKey && !['contextWindow', 'maxOutput', 'maxInput'].some(k => options[k] !== undefined)) {
      if (options.reasoningEffort && !REASONING_EFFORTS.includes(options.reasoningEffort)) {
        throw new ModelInputError('reasoningEffort', 'reasoning-effort-invalid', '模型强度无效')
      }
      const next = { ...desktop.models, activeModelId: existing.ref }
      if (options.reasoningEffort !== undefined) next.activeEffort = options.reasoningEffort || 'default'
      writeDesktopDefaults(run.config, desktop.snapshot, next)
      if (existing.baseUrl && options.apiKey === '') await writeCredential(run, existing, '')
      await removeLegacyId(store)
      return readModelSelection(run)
    }
    route = checkedRoute(run, options)
    if (route && existing?.adapter && existing.adapter !== 'openai') {
      throw new ModelInputError('baseUrl', 'base-url-invalid', '此适配器由桌面管理；选择它或新增独立的 Chat Completions 提供方')
    }
    const oldKey = existing && await readCredential(run, existing)
    if (oldKey && route && (route.baseUrl.includes(oldKey) || route.modelName.includes(oldKey))) {
      throw new ModelInputError('apiKey', 'api-key-misplaced', '请仅在 API Key 字段填写密钥')
    }
  } catch (error) {
    if (!(error instanceof ModelInputError)) throw error
    return { ...await readModelSelection(run), error: { field: error.field, code: error.code, message: error.message } }
  }
  const saved = writeDesktopModel(run.config, desktop, { route, ref: route ? ref : '', effort: options.reasoningEffort, lengths: options })
  if (saved && options.apiKey !== undefined) await writeCredential(run, saved, options.apiKey)
  await removeLegacyId(store)
  return readModelSelection(run)
}

export async function savePersonaModel(run, { personaId, modelRef }) {
  if (!sharedDevaWritePath(run)) throw new Error(desktopWriteDenial(run))
  if (modelRef && !desktopModelState(run.config).choices.some(route => route.ref === modelRef)) {
    throw new Error('请选择桌面已启用的对话模型')
  }
  writePersonaModel(run.config, personaId, modelRef)
  return readModelSelection(run)
}

export const CONFIGURED_MODEL_ID = 'deva-direct'

export async function listConfiguredModels(run) {
  const source = 'deva-model-settings'
  // The catalog is a read-only projection, not a network or credential operation.
  const desktop = desktopModelState(run.config)
  const selected = desktop.snapshot.value.personas?.selected
  const ref = selected && getPersona(run.config, selected)?.model
  const model = ref ? desktop.resolve(ref) : desktop.active
  if (!model) {
    return { status: 'empty', source, scope: 'configured', models: [], message: ref || desktop.models.activeModelId ? `模型引用失效：${ref || desktop.models.activeModelId}；请在 Deva → 模型重新选择` : '桌面未选择模型；请在 Deva → 模型选择并保存' }
  }
  return {
    status: 'ready', source, scope: 'configured',
    models: [{ id: CONFIGURED_MODEL_ID, name: model.modelName, resolvedModel: model.modelName, isDefault: true, reasoningEfforts: REASONING_EFFORTS }],
  }
}

export function resolveRunEffort(run, storedEffort) {
  const requested = run.mode === 'global' ? run.model?.reasoningEffort || '' : ''
  if (requested && requested !== LEGACY_EFFORT && !REASONING_EFFORTS.includes(requested)) {
    throw new Error(`会话选择的模型强度 ${requested} 不受支持；可选：默认 / ${REASONING_EFFORTS.join(' / ')}`)
  }
  return requested || storedEffort
}
