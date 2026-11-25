/** Desktop owns the route and the default; Studio owns only its server-side credentials. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { customModelEndpoint, ModelInputError, normalizeBaseUrl } from './custom-model-network.mjs'
import { desktopModelState, writeDesktopDefaults, writeDesktopModel } from './desktop-models.mjs'
import { getPersona, listPersonas, writePersonaModel } from './persona-store.mjs'
import { sharedDevaPath } from './shared-deva-model.mjs'
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

async function readCredential(run, route) {
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

export async function readCustomModel(run, personaId) {
  if (!sharedDevaPath(run)) return null
  const desktop = await migrateLegacy(run, modelStore(run))
  const selected = personaId ?? desktop.snapshot.value.personas?.selected
  const ref = selected && getPersona(run.config, selected)?.model
  const route = (ref && desktop.resolve(ref)) || desktop.active
  if (!route) return null
  if (route.adapter !== 'openai' || !route.baseUrl) {
    throw new Error('当前桌面模型没有可用于 Chat Completions 的地址或适配器；未回退')
  }
  return { ...route, apiKey: await readCredential(run, route), reasoningEffort: defaultEffort(desktop) }
}

function needsNetworkApproval(run, route) {
  if (!route?.baseUrl || route.adapter !== 'openai') return false
  try { resolveCustomEndpoint(run, route.baseUrl); return false } catch (error) {
    if (error instanceof ModelInputError && error.code === 'confirmation-required') return true
    throw error
  }
}

export async function readModelSelection(run) {
  const root = sharedDevaPath(run)
  const store = modelStore(run)
  const empty = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: Boolean((await store.get('model'))?.modelId) }
  if (!root) return { ...empty, desktopAccessRequired: true }
  const desktop = await migrateLegacy(run, store)
  const route = desktop.active
  return {
    ...empty,
    baseUrl: route?.baseUrl ?? '', modelName: route?.modelName ?? '',
    hasApiKey: Boolean(await readCredential(run, route)),
    sharedConfigPath: join(root, 'config.json'),
    modelRef: route?.ref ?? '',
    desktopModels: desktop.choices.map(({ ref, adapter, baseUrl, modelName }) => ({ ref, adapter, baseUrl, modelName })),
    personaModels: listPersonas(run.config).list.map(({ id, name, model }) => ({ id, name, model })),
    ...(needsNetworkApproval(run, route) ? { needsNetworkApproval: true } : {}),
    ...(route?.baseUrl && trustedBases(run).includes(route.baseUrl) ? { allowNonPublic: true } : {}),
    ...(defaultEffort(desktop) ? { reasoningEffort: defaultEffort(desktop) } : {}),
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
  resolveCustomEndpoint(run, base)
  return { baseUrl: base, modelName: name }
}

async function removeLegacyId(store) {
  if (await store.get('model') !== undefined) await store.delete('model')
}

export async function saveModelSelection(run, input) {
  if (!sharedDevaPath(run)) throw new Error('请让管理员配置 sharedDevaUserId 并指定同一个桌面 Deva 配置目录')
  const options = validateStoredModel('modelSettingsInput', input)
  const store = modelStore(run)
  const desktop = await migrateLegacy(run, store)
  const ref = options.modelRef ?? desktop.active?.ref ?? ''
  const existing = ref ? desktop.resolve(ref) : null
  if (ref && !existing) throw new Error('桌面模型引用已不存在，请刷新后重选')
  let route
  try {
    // Selecting an existing Desktop model does not approve its Base URL for network use.
    if (existing && existing.baseUrl === options.baseUrl && existing.modelName === options.modelName && !options.apiKey) {
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
  const saved = writeDesktopModel(run.config, desktop, { route, ref: route ? ref : '', effort: options.reasoningEffort })
  if (saved && options.apiKey !== undefined) await writeCredential(run, saved, options.apiKey)
  await removeLegacyId(store)
  return readModelSelection(run)
}

export async function savePersonaModel(run, { personaId, modelRef }) {
  if (!sharedDevaPath(run)) throw new Error('仅管理员指定的 Deva 桌面账号可以修改身份绑定')
  if (modelRef && !desktopModelState(run.config).choices.some(route => route.ref === modelRef)) {
    throw new Error('请选择桌面已启用的对话模型')
  }
  writePersonaModel(run.config, personaId, modelRef)
  return readModelSelection(run)
}

export const CONFIGURED_MODEL_ID = 'deva-direct'

export async function listConfiguredModels(run) {
  const source = 'deva-model-settings'
  const model = await readCustomModel(run)
  if (!model) {
    return { status: 'empty', source, scope: 'configured', models: [], message: '尚未选择桌面默认模型，或 Studio 未获管理员授权访问桌面配置' }
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
