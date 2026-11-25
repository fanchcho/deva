/**
 * 身份选择：会话级覆盖 > `~/.deva` 身份文件里的默认选择。
 *
 * 三个作用域：
 *  · 文件（唯一真源）——`<root>/config.json → personas.selected`，即设置页保存的默认身份；
 *    身份目录（id/name/description/persona）全部来自 `<root>/personas/*.md`，见 lib/deva-home.mjs；
 *  · session —— 会话窗口里用 `/deva:identity <id>` 或 `@deva:<id>` 临时切，只影响这个会话，
 *    仍然放在宿主会话存储里（它不是持久身份记录，也不应该改掉所有人的默认值）；
 *  · 宿主 `state.profile.namespace(userId).identity` —— 0.8.3 及更早的旧记录，只在文件第一次创建时
 *    作为 seed 参考，之后不再读取、不删除、也不能覆盖文件。
 */
import {
  DEFAULT_IDENTITY, listIdentities,
} from './identities.mjs'
import { canonicalIdentityId } from './deva-home.mjs'
import { isPersonaId } from './persona-file.mjs'
import { listIdentityCatalog, loadIdentityRecord, selectIdentity } from './deva-home.mjs'
import { clearFileSessionIdentity, readFileSessionIdentity, writeFileSessionIdentity } from './session-identities.mjs'

/** 用户+profile 作用域的旧身份存储：只用于 seed 与迁移追溯。 */
export function identityStore(state, identity) {
  if (!state?.profile) throw new Error('缺少 profile 存储作用域，无法读写身份选择')
  return state.profile.namespace(String(identity?.userId ?? 'anonymous'))
}

/** 会话作用域的覆盖存储；没有会话上下文时返回 null（不是错误）。 */
export function sessionStore(state) {
  const session = state?.session
  return session && typeof session.get === 'function' ? session : null
}

function validId(value) {
  const id = value && typeof value === 'object' ? value.identity : undefined
  // 身份 id 现在是桌面 persona id（general/xiaomajiang…），`deva` 作为旧别名一起接受。
  return typeof id === 'string' && isPersonaId(canonicalIdentityId(id)) ? id : null
}

/** 宿主旧记录里的身份 id（没有就返回 null）；读不到不当作错误。 */
export async function readHostIdentityId(state, identity) {
  try {
    const stored = await identityStore(state, identity).get('identity')
    return validId(stored)
  } catch {
    return null
  }
}

/**
 * 身份快照：文件里的身份目录 + 当前默认选择 + 落盘路径/创建/权限修复状态。
 * 文件不存在时按宿主旧值 seed 创建；文件损坏时抛错（不静默回退宿主旧值）。
 */
export async function readIdentitySnapshot(state, identity, config = {}, options = {}) {
  const legacySelection = await readHostIdentityId(state, identity)
  return await listIdentityCatalog(config, { ...options, legacySelection })
}

/** 读默认身份（文件里的 selected）。 */
export async function readIdentityId(state, identity, config = {}) {
  return (await readIdentitySnapshot(state, identity, config)).selected
}

/** 保存默认身份到文件；旧宿主记录保留不动（不静默删除，seed 时已写入 legacyHostSelection）。 */
export async function writeIdentityId(_state, _identity, id, config = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error(`未知身份：${String(id)}`)
  const file = await selectIdentity(config, id)
  return file.value.selected
}

/**
 * 读会话级覆盖：宿主会话存储优先，其次 `~/.deva/config.json → personas.sessionSelected`。
 * 没有会话上下文或没有覆盖返回 null（不是错误）。
 */
export async function readSessionIdentityId(state, identity = null, config = {}) {
  const store = sessionStore(state)
  if (store) {
    try {
      const id = validId(await store.get('identity'))
      if (id) return id
    } catch { /* 宿主存储读不到时看文件 */ }
  }
  const sessionId = identity?.sessionId
  if (sessionId && config) {
    try {
      const id = readFileSessionIdentity(config, sessionId)
      if (id) return validId({ identity: id })
    } catch { /* 文件损坏由 resolve 时的其它路径报错；这里不吞掉持久层的显式错误？保留 null 回退 */ }
  }
  return null
}

/**
 * 写会话级覆盖；id 为 null 表示清除覆盖。
 * 同时写宿主会话存储（若当前是真实会话）与 `~/.deva/config.json → personas.sessionSelected`（可读可手改）。
 * @param {{config?: object, sessionId?: string}} options
 */
export async function writeSessionIdentityId(state, id, allowedIds = null, options = {}) {
  const store = sessionStore(state)
  const { config = null, sessionId = null } = options
  const canonical = typeof id === 'string' ? canonicalIdentityId(id) : id
  if (id !== null) {
    const known = Array.isArray(allowedIds) ? allowedIds.includes(canonical) : isPersonaId(canonical)
    if (typeof id !== 'string' || !known) throw new Error(`未知身份：${String(id)}`)
  }
  if (!store && !(config && sessionId)) throw new Error('当前上下文没有会话，无法设置会话级身份')
  if (store) {
    if (id === null) await store.delete('identity')
    else await store.set('identity', { identity: canonical })
  }
  if (config && sessionId) {
    if (id === null) clearFileSessionIdentity(config, sessionId)
    else writeFileSessionIdentity(config, sessionId, canonical)
  }
  return id === null ? null : canonical
}

/** 本轮实际使用的身份：会话覆盖优先（且必须仍在身份文件里），其次文件里的默认选择。 */
export async function resolveIdentityId(state, identity, config = {}) {
  const snapshot = await readIdentitySnapshot(state, identity, config)
  const ids = snapshot.identities.map(item => item.id)
  const session = await readSessionIdentityId(state, identity, config)
  const canonical = session ? canonicalIdentityId(session) : null
  if (canonical && ids.includes(canonical)) return { id: canonical, source: 'session' }
  return { id: snapshot.selected, source: 'file' }
}

/** 身份文件里的可选 id；`identities.mjs` 的内置目录只作为 seed 来源。 */
export async function listKnownIdentities(config = {}) {
  return (await listIdentityCatalog(config)).identities
}

export { DEFAULT_IDENTITY, listIdentities }
export { loadIdentityRecord }
