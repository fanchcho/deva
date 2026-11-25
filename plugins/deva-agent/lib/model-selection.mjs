/** Studio API settings. Desktop fields stay behind the backend storage boundary. */
import { join } from 'node:path'
import { customModelEndpoint, ModelInputError, normalizeBaseUrl } from './custom-model-network.mjs'
import { readDesktopConfig, readDesktopRoute } from './desktop-models.mjs'
import { resolveDevaRoot } from './deva-fs.mjs'
import { readSharedModel, sharedDevaPath, writeSharedModel } from './shared-deva-model.mjs'
import { validateStored, validateStoredModel } from './storage-contracts.mjs'

const KEY = 'customModel'
const SHARED_KEY = 'sharedModelKey'
const DESKTOP_KEY = 'desktopModelKey'
const MODE_KEY = 'modelMode'
const CONSENT_KEY = 'modelNetworkConsent'
const OPTIONS_KEY = 'modelOptions'
/** Chat Completions `reasoning_effort` 的取值；空串表示不发送该参数。 */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']
const LEGACY_KEY = 'model'

function modelStore(run) {
  if (run.identity?.userId == null || !run.state?.profile) throw new Error('缺少 Studio 模型设置的用户或 Profile 作用域')
  return run.state.profile.namespace(String(run.identity.userId))
}

function trustedBases(run) {
  return (run.config?.modelTrustedBases || []).map(normalizeBaseUrl)
}

/** `confirmedBase` is the one normalized Base URL this user + Profile confirmed on the model page. */
export function resolveCustomEndpoint(run, baseUrl, confirmedBase = '') {
  return customModelEndpoint(baseUrl, confirmedBase ? [...trustedBases(run), confirmedBase] : trustedBases(run))
}

// With an explicit owner, other accounts must not consume or overwrite shared routes.
function desktopLinkAllowed(run) {
  return run.config?.sharedDevaUserId == null
}

async function readStored(store, key) {
  const value = await store.get(key)
  return value === undefined ? null : validateStored(key, value)
}

async function sharedCredential(store, model) {
  const record = model && await readStored(store, SHARED_KEY)
  return record?.baseUrl === model?.baseUrl ? record?.apiKey ?? '' : ''
}

async function desktopKey(store, route) {
  if (!route) return ''
  const record = await readStored(store, DESKTOP_KEY)
  if (!record) return ''
  return record.providerId === route.providerId && record.baseUrl === route.baseUrl ? record.apiKey ?? '' : ''
}

async function confirmedBase(store) {
  return (await readStored(store, CONSENT_KEY))?.baseUrl ?? ''
}

async function storedEffort(store) {
  return (await readStored(store, OPTIONS_KEY))?.reasoningEffort ?? ''
}

async function readUnsharedModel(run, store) {
  const source = await readStored(store, MODE_KEY)
  if (source?.mode === 'session') return null
  // Honor an explicit selection made in an older version, but never automatically
  // adopt a Desktop default for an unconfigured Studio account.
  if (source?.mode === 'desktop' && desktopLinkAllowed(run)) {
    const route = readDesktopRoute(run.config)
    if (route) return { ...route, apiKey: await desktopKey(store, route) }
  }
  return readStored(store, KEY)
}

async function setMode(store, mode) {
  await store.set(MODE_KEY, validateStored(MODE_KEY, { mode }))
}

async function saveOptional(store, key, value) {
  if (value) await store.set(key, value)
  else await remove(store, key)
}

const saveConsent = (store, consent) => saveOptional(store, CONSENT_KEY, consent)

async function remove(store, key) {
  if (await store.get(key) !== undefined) await store.delete(key)
}

async function readRoute(run, store) {
  const root = sharedDevaPath(run)
  if (!root) return readUnsharedModel(run, store)
  const model = readSharedModel(root)
  if (model) return validateStored(KEY, { ...model, apiKey: await sharedCredential(store, model) })
  if (await store.get(KEY) !== undefined) throw new Error('直连模型尚未迁入共享配置；请在模型设置中确认保存或清空地址')
  return null
}

/** Runtime route plus the page-confirmed base and effort; a confirmation for another address never applies. */
export async function readCustomModel(run) {
  const store = modelStore(run)
  const model = await readRoute(run, store)
  return model && { ...model, confirmedBase: await confirmedBase(store), reasoningEffort: await storedEffort(store) }
}

export async function readModelSelection(run) {
  const store = modelStore(run)
  const root = sharedDevaPath(run)
  const previous = root ? await readStored(store, KEY) : null
  const model = root ? readSharedModel(root) : await readUnsharedModel(run, store)
  const draft = model || previous
  const legacy = await store.get(LEGACY_KEY)
  const effort = await storedEffort(store)
  return {
    baseUrl: draft?.baseUrl ?? '', modelName: draft?.modelName ?? '',
    hasApiKey: Boolean(root ? await sharedCredential(store, model) : model?.apiKey),
    legacyNeedsSetup: Boolean(!draft && legacy?.modelId),
    ...(draft?.baseUrl && await confirmedBase(store) === draft.baseUrl ? { allowNonPublic: true } : {}),
    ...(draft?.baseUrl && effort ? { reasoningEffort: effort } : {}),
    ...(root ? { sharedConfigPath: join(root, 'config.json'), sharedNeedsSetup: Boolean(previous) } : {}),
  }
}

function checkedRoute(run, baseUrl, modelName, apiKey, allowNonPublic, reasoningEffort) {
  if (reasoningEffort && !REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new ModelInputError('reasoningEffort', 'reasoning-effort-invalid', `模型强度只能是默认（不发送）或 ${REASONING_EFFORTS.join(' / ')}；收到的值不受支持`)
  }
  if (!baseUrl.trim()) {
    if (modelName.trim() || apiKey || reasoningEffort) throw new ModelInputError('baseUrl', 'base-url-required', '请填写自定义模型 API 地址，或清空地址和模型名以跟随会话')
    return null
  }
  let base
  try { base = normalizeBaseUrl(baseUrl.trim()) } catch (error) { throw new ModelInputError('baseUrl', 'base-url-invalid', error.message) }
  // The confirmation covers exactly the base being saved, never another path or origin.
  resolveCustomEndpoint(run, base, allowNonPublic ? base : '')
  const name = modelName.trim()
  if (!name || /\p{Cc}/u.test(name)) throw new ModelInputError('modelName', 'model-name-invalid', '请填写有效的模型名')
  if (apiKey && !/^[A-Za-z0-9._~+/-]+=*$/.test(apiKey)) throw new ModelInputError('apiKey', 'api-key-invalid', 'API Key 必须是有效的 Bearer Token 格式')
  return { baseUrl: base, modelName: name }
}

async function checkedInput(run, store, root, { baseUrl, modelName, apiKey, allowNonPublic = false, reasoningEffort }) {
  const route = checkedRoute(run, baseUrl, modelName, apiKey, allowNonPublic, reasoningEffort)
  const previous = route && (root
    ? await readStored(store, SHARED_KEY) ?? await readStored(store, KEY)
    : await readUnsharedModel(run, store))
  const key = route ? apiKey ?? (previous?.baseUrl === route.baseUrl ? previous.apiKey : '') : ''
  if (key && (route.baseUrl.includes(key) || route.modelName.includes(key))) throw new ModelInputError('apiKey', 'api-key-misplaced', '请仅在 API Key 字段填写密钥')
  // 省略强度字段时保留已保存的档位；空串清除；清空地址一并清除。
  const effort = route ? reasoningEffort ?? await storedEffort(store) : ''
  return {
    route, key,
    consent: route && allowNonPublic ? validateStored(CONSENT_KEY, { baseUrl: route.baseUrl }) : null,
    options: effort ? validateStored(OPTIONS_KEY, { reasoningEffort: effort }) : null,
  }
}

export async function saveModelSelection(run, input) {
  const store = modelStore(run)
  const root = sharedDevaPath(run)
  let checked
  try {
    checked = await checkedInput(run, store, root, validateStoredModel('modelSettingsInput', input))
  } catch (error) {
    if (!(error instanceof ModelInputError)) throw error
    // Nothing was written: return the persisted settings with the field the user has to correct.
    return { ...await readModelSelection(run), error: { field: error.field, code: error.code, message: error.message } }
  }
  const { route, key, consent, options } = checked

  if (root) {
    writeSharedModel(root, route)
    try {
      if (key) await store.set(SHARED_KEY, validateStored(SHARED_KEY, { baseUrl: route.baseUrl, apiKey: key }))
      else await remove(store, SHARED_KEY)
      await remove(store, KEY)
      await remove(store, LEGACY_KEY)
      await saveConsent(store, consent)
      await saveOptional(store, OPTIONS_KEY, options)
    } catch {
      throw new Error('共享文件已更新，但 Studio 私有模型状态保存失败；请重新打开设置并确认密钥')
    }
  } else {
    await saveConsent(store, consent)
    await saveOptional(store, OPTIONS_KEY, options)
    if (route) {
      // Preserve the existing Desktop mirror, never replace Desktop's selected default.
      if (desktopLinkAllowed(run) && readDesktopConfig(run.config).exists) writeSharedModel(resolveDevaRoot(run.config), route)
      await store.set(KEY, validateStored(KEY, { ...route, apiKey: key }))
    } else await remove(store, KEY)
    await remove(store, DESKTOP_KEY)
    await remove(store, LEGACY_KEY)
    await setMode(store, route ? 'custom' : 'session')
  }
  return readModelSelection(run)
}

/**
 * global 模式的模型目录：只有模型页配置的那一个直连模型，带可选强度档位。
 * 不含地址与密钥；未配置时返回 empty 并说明下一步。
 * 目录 id 固定：宿主要求会话记住的 id 仍在目录里，用模型名当 id 会让用户改名后旧会话全部失效。
 */
export const CONFIGURED_MODEL_ID = 'deva-direct'

export async function listConfiguredModels(run) {
  const source = 'deva-model-settings'
  const model = await readCustomModel(run)
  if (!model) {
    return { status: 'empty', source, scope: 'configured', models: [], message: '尚未配置直连模型：请在 Deva → 设置 → 模型 填写 Base URL 和模型名并保存' }
  }
  return {
    status: 'ready', source, scope: 'configured',
    models: [{ id: CONFIGURED_MODEL_ID, name: model.modelName, resolvedModel: model.modelName, isDefault: true, reasoningEfforts: REASONING_EFFORTS }],
  }
}

/** global 模式本轮生效的强度：会话里显式选了就用会话的，否则用模型页保存的默认档位。 */
export function resolveRunEffort(run, storedEffort) {
  const requested = run.mode === 'global' ? run.model?.reasoningEffort || '' : ''
  if (requested && !REASONING_EFFORTS.includes(requested)) {
    throw new Error(`会话选择的模型强度 ${requested} 不受支持；可选：默认 / ${REASONING_EFFORTS.join(' / ')}`)
  }
  return requested || storedEffort
}
