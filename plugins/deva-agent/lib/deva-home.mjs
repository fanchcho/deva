/**
 * 身份选择（桌面同构版）：**persona 内容与默认选择都落桌面 `config.json`**。
 *
 * 桌面端没有「当前选中 persona」字段（personas 是多条叠加），所以插件把选择写在
 * `config.json → personas.selected`（personas 段内的扩展键）。桌面 `getConfig()` 读得到整段；
 * 桌面 `writeEnabledMap()` 用 `{...base, enabled}` 合并，会保留 `selected` 与 `sessionSelected`。
 *
 * 旧布局 `<root>/deva-agent/` 一次性迁移（见 lib/deva-layout.mjs）：备份到 `.deva` 之外后删除，
 * 不再作为运行期存储。persona 正文只读写 `personas/*.md`。
 */

import { join } from 'node:path'
import { DevaIdentityError, resolveDevaRoot, statOrNull } from './deva-fs.mjs'
import { createPersona, getPersona, listPersonas, personasDir, updatePersonasSection } from './persona-store.mjs'
import { isPersonaId, promptHash } from './persona-file.mjs'
import { readPersonaAvatar } from './persona-avatar.mjs'
import { IDENTITIES, DEFAULT_IDENTITY, loadIdentity } from './identities.mjs'
import { migrateLegacyLayout, readConfigSelection, writeConfigSelection } from './deva-layout.mjs'

export { DevaIdentityError, resolveDevaRoot }

export const IDENTITY_SCHEMA_VERSION = 3
export const DEFAULT_PERSONA_ID = 'general'
/** 0.8.4 及更早 id `deva` 对应桌面 persona `general`（身份文件迁移/旧输入用，不是旧会话兼容）。 */
export const LEGACY_ID_ALIASES = Object.freeze({ deva: 'general' })

export function canonicalIdentityId(id) {
  return Object.hasOwn(LEGACY_ID_ALIASES, id) ? LEGACY_ID_ALIASES[id] : id
}

/** 选择态现在写在桌面 config.json 里；保留该函数供 UI 显示文件位置。 */
export function identityFilePath(config = {}) {
  return join(resolveDevaRoot(config), 'config.json')
}

/** 选择态结构校验（config.personas 段）。 */
export function identityProblems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['personas 段应为对象']
  const problems = []
  if (value.selected !== undefined && (typeof value.selected !== 'string' || !isPersonaId(canonicalIdentityId(value.selected)))) problems.push('selected 不是合法身份 id')
  if (value.sessionSelected !== undefined && (value.sessionSelected === null || typeof value.sessionSelected !== 'object' || Array.isArray(value.sessionSelected))) problems.push('sessionSelected 应为对象')
  return problems
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function pickSelection(list, candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const wanted = canonicalIdentityId(candidate)
    if (list.some(item => item.id === wanted)) return wanted
  }
  return list.find(item => item.id === DEFAULT_PERSONA_ID)?.id ?? list[0]?.id ?? ''
}

async function seedBundledPersonas(config) {
  const mapping = [{ personaId: DEFAULT_PERSONA_ID, sourceId: DEFAULT_IDENTITY }, { personaId: 'xiaomajiang', sourceId: 'xiaomajiang' }]
  const created = []
  for (const { personaId, sourceId } of mapping) {
    if (getPersona(config, personaId)) continue
    if (!IDENTITIES.some(item => item.id === sourceId)) continue
    const record = await loadIdentity(sourceId)
    createPersona(config, { id: personaId, name: record.name, description: record.description, prompt: record.persona })
    created.push(personaId)
  }
  if (created.length) {
    const enabled = {}
    const seeded = {}
    for (const id of created) { enabled[id] = true; seeded[id] = true }
    updatePersonasSection(config, section => ({
      ...section,
      enabled: { ...enabled, ...(object(section.enabled) ? section.enabled : {}) },
      seeded: { ...(object(section.seeded) ? section.seeded : {}), ...seeded },
    }))
  }
  return created
}

/**
 * 确保选择态存在：迁移旧 deva-agent → 读取 personas → 若 `personas.selected` 缺失/失效则写入候选。
 * @returns {Promise<{value:{selected:string}, path:string, personas, created:boolean, migrated:boolean, repaired:boolean}>}
 */
export async function ensureIdentityState(config = {}, { legacySelection = null } = {}) {
  const migration = migrateLegacyLayout(config)
  let personas = listPersonas(config)
  let seeded = false
  if (personas.list.length === 0) { await seedBundledPersonas(config); personas = listPersonas(config); seeded = true }
  const current = readConfigSelection(config)
  const selected = pickSelection(personas.list, [current.selected, legacySelection, DEFAULT_PERSONA_ID])
  if (selected && selected !== current.selected) writeConfigSelection(config, selected)
  return {
    value: { selected },
    path: identityFilePath(config),
    personas,
    created: seeded,
    migrated: Boolean(migration.migrated),
    migration,
    repaired: false,
  }
}

export function inspectIdentityFile(config = {}) {
  const root = resolveDevaRoot(config)
  const describe = stat => stat && { mode: `0${(stat.mode & 0o777).toString(8)}`, uid: stat.uid, size: stat.size, mtime: stat.mtime.toISOString(), directory: stat.isDirectory(), file: stat.isFile(), symlink: stat.isSymbolicLink() }
  const dir = personasDir(config)
  let personas = null
  try { personas = listPersonas(config).list.map(item => item.id) } catch { personas = null }
  return {
    root,
    path: identityFilePath(config),
    personasDir: dir,
    rootDir: describe(statOrNull(root)),
    configStat: describe(statOrNull(identityFilePath(config))),
    file: describe(statOrNull(identityFilePath(config))),
    personasDirStat: describe(statOrNull(dir)),
    personas,
  }
}

/** 身份目录 + 当前选择（设置页/命令共用）。 */
export async function listIdentityCatalog(config = {}, options = {}) {
  const state = await ensureIdentityState(config, options)
  const list = options.includeEmpty ? listPersonas(config, { includeEmpty: true }).list : state.personas.list
  const identities = list.map(item => {
    const view = {
      id: item.id, name: item.name, description: item.description,
      promptSha256: promptHash(item.prompt), avatar: item.avatar || '', model: item.model || '',
      workspace: item.workspace || '', enabled: item.enabled === true,
      ...(options.includeEmpty ? { hasPrompt: Boolean(item.prompt) } : {}),
    }
    try {
      // 头像读取在 persona-avatar；这里延迟 import 会让测试桩复杂，改为同步顶层 import。
      view.avatarImage = readAvatar(item, config)
    } catch (error) { view.avatarImage = ''; view.avatarError = error?.message || String(error) }
    return view
  })
  return {
    identities,
    selected: state.value.selected,
    selectedSource: 'file',
    path: state.path,
    personasDir: state.personas.dir,
    created: state.created,
    migrated: state.migrated,
    repaired: false,
    conflicts: [],
    skipped: state.personas.problems ?? [],
  }
}

function readAvatar(item, config) {
  return readPersonaAvatar(config, item.id)?.dataUri || ''
}

export async function loadIdentityRecord(config = {}, id) {
  const state = await ensureIdentityState(config)
  const wanted = canonicalIdentityId(id)
  const record = state.personas.list.find(item => item.id === wanted)
    || state.personas.list.find(item => item.id === state.value.selected)
  if (!record) throw new DevaIdentityError('DEVA_IDENTITY_EMPTY', `personas 目录里没有可用身份：${state.personas.dir}`, { path: state.personas.dir })
  return {
    id: record.id, name: record.name, description: record.description, persona: record.prompt,
    avatar: record.avatar, model: record.model, workspace: record.workspace, enabled: record.enabled,
    path: join(state.personas.dir, `${record.id}.md`), source: 'file',
  }
}

/** 保存默认身份：只写 config.json → personas.selected；不动 persona 正文。 */
export async function selectIdentity(config = {}, id) {
  const state = await ensureIdentityState(config)
  const wanted = canonicalIdentityId(id)
  const ids = state.personas.list.map(item => item.id)
  if (!ids.includes(wanted)) throw new DevaIdentityError('DEVA_IDENTITY_UNKNOWN', `未知身份：${String(id)}；personas 目录里的可选值：${ids.join(' / ')}`, { path: state.personas.dir })
  if (state.value.selected === wanted) return state
  writeConfigSelection(config, wanted)
  return { ...state, value: { ...state.value, selected: wanted } }
}
