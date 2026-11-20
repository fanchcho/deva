/**
 * 身份选择：会话级覆盖 > 用户/Profile 默认 > 内置默认。
 *
 * 三个作用域对应 Studio 的三层存储：
 *  · session —— 会话窗口里用 `/deva:identity <id>` 或 `@deva:<id>` 临时切，只影响这个会话；
 *  · profile（按用户再分一层）——Agent 设置页保存的默认；
 *  · 都没有 —— DEFAULT_IDENTITY（deva）。
 */
import { DEFAULT_IDENTITY, isIdentity } from './identities.mjs'

/** 用户+profile 作用域的默认身份存储：profile 存储按 Profile 分区，再按用户分一层。 */
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
  return typeof id === 'string' && isIdentity(id) ? id : null
}

/** 读用户/Profile 默认身份；记录缺失或已失效时回退内置默认。 */
export async function readIdentityId(state, identity) {
  const stored = await identityStore(state, identity).get('identity')
  return validId(stored) || DEFAULT_IDENTITY
}

/** 保存用户/Profile 默认身份；不认识的 id 直接报错。 */
export async function writeIdentityId(state, identity, id) {
  if (typeof id !== 'string' || !isIdentity(id)) throw new Error(`未知身份：${String(id)}`)
  await identityStore(state, identity).set('identity', { identity: id })
  return id
}

/** 读会话级覆盖；没有覆盖返回 null。 */
export async function readSessionIdentityId(state) {
  const store = sessionStore(state)
  if (!store) return null
  try {
    return validId(await store.get('identity'))
  } catch {
    return null
  }
}

/** 写会话级覆盖；id 为 null 表示清除覆盖。 */
export async function writeSessionIdentityId(state, id) {
  const store = sessionStore(state)
  if (!store) throw new Error('当前上下文没有会话，无法设置会话级身份')
  if (id === null) {
    await store.delete('identity')
    return null
  }
  if (typeof id !== 'string' || !isIdentity(id)) throw new Error(`未知身份：${String(id)}`)
  await store.set('identity', { identity: id })
  return id
}

/** 本轮实际使用的身份：会话覆盖优先，其次用户/Profile 默认。 */
export async function resolveIdentityId(state, identity) {
  const session = await readSessionIdentityId(state)
  if (session) return { id: session, source: 'session' }
  return { id: await readIdentityId(state, identity), source: 'profile' }
}
