import { desktopDiagnostics } from './desktop-diagnostics.mjs'
/** Desktop owns the route and the default; Studio owns only its server-side credentials. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { customModelEndpoint, ModelInputError, normalizeBaseUrl } from './custom-model-network.mjs'
import { desktopConfigLocation, desktopModelState, writeDesktopDefaults, writeDesktopModel } from './desktop-models.mjs'
import { getPersona, listPersonas, writePersonaModel } from './persona-store.mjs'
import { resolveDevaRoot } from './deva-fs.mjs'
import { sharedDevaWritePath, desktopWriteDenial } from './shared-deva-model.mjs'
import { validateStored, validateStoredModel } from './storage-contracts.mjs'

export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LEGACY_EFFORT = 'minimal'
const LEGACY_PROVIDER = 'deva-studio-shared'

function modelStore(run) {
  if (run.identity?.userId == null || !run.state?.profile) throw new Error('缺少 Studio 模型设置的用户或 Profile 作用域')
  return run.state.profile.namespace(String(run.identity.userId))
}

function credentialStore(run) {
  return run.state.profile.namespace(String(run.identity.userId), 'desktopModelKeys')
}

const credentialId = route => createHash('sha256').update(`${route.providerId}\0${route.baseUrl}`).digest('hex')
async function readStored(store, key) {
  const value = await store.get(key)
  return value === undefined ? null : validateStored(key, value)
}

function trustedBases(run) {
  return (run.config?.modelTrustedBases || []).map(normalizeBaseUrl)
}

export function resolveCustomEndpoint(run, baseUrl) {
  return customModelEndpoint(baseUrl, trustedBases(run))
}

export async function readCredential(run, route) {
  if (!route?.baseUrl) return ''
  const record = await credentialStore(run).get(credentialId(route))
  if (!record) return ''
  validateStored('desktopModelKey', record)
  return record.providerId === route.providerId && record.baseUrl === route.baseUrl ? record.apiKey : ''
}

async function writeCredential(run, route, apiKey) {
  const store = credentialStore(run)
  const id = credentialId(route)
  if (apiKey) await store.set(id, validateStored('desktopModelKey', { providerId: route.providerId, baseUrl: route.baseUrl, apiKey }))
  else await store.delete(id)
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
  try { return normalizeBaseUrl(value) } catch { return String(value) }
}

export async function readCustomModel(run, personaId) {
  if (!sharedDevaWritePath(run)) {
    if (run.mode === 'global') throw new Error(desktopWriteDenial(run))
    return null
  }
  const desktop = await migrateLegacy(run, modelStore(run))
  const selected = personaId ?? desktop.snapshot.value.personas?.selected
  const ref = selected && getPersona(run.config, selected)?.model
  if (ref && !desktop.resolve(ref)) throw new Error(`身份模型引用失效：${ref}；请在 Deva → 模型 → 身份模型绑定重新选择`)
  if (!ref && unresolvedActiveRef(desktop)) throw new Error(`桌面默认模型引用失效：${desktop.models.activeModelId}；请在 Deva → 模型重新选择`)
  const route = (ref && desktop.resolve(ref)) || desktop.active
  if (!route) return null
  if (route.adapter !== 'openai' || !route.baseUrl) {
    throw new Error('当前桌面模型没有可用于 Chat Completions 的地址或适配器；未回退')
  }
  return { ...route, apiKey: await readCredential(run, route), reasoningEffort: defaultEffort(desktop) }
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
  let hasApiKey = false, credentialError = ''
  try { hasApiKey = Boolean(await readCredential(run, desktop.active)) }
  catch (error) { credentialError = safeReadError(error) + '；凭据读取失败；桌面模型仍可选择，远端刷新需要可用 Key。桌面 secrets.json 不由插件解密。' }
  const base = {
    ...empty,
    ...desktopRouteView(desktop),
    desktopWriteRequired: !sharedDevaWritePath(run),
    ...(!sharedDevaWritePath(run) ? { desktopWriteMessage: desktopWriteDenial(run) } : {}),
    hasApiKey,
    ...(credentialError ? { credentialError } : {}),
    sharedConfigPath: join(root, 'config.json'),
    desktopConfigPath: location.path,
    desktopConfigExists: location.exists,
    desktopOwnership: location.ownership,
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
