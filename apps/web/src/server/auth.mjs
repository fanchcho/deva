import crypto from 'node:crypto'
import path from 'node:path'
import { migrateFile, randomId, readJsonSync, safeEqual, writeJsonAtomic } from './util.mjs'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024
  })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, saltB64, hashB64] = parts
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), Buffer.from(hashB64, 'base64').length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    })
    return crypto.timingSafeEqual(hash, Buffer.from(hashB64, 'base64'))
  } catch {
    return false
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/

export class UserStore {
  constructor(dataRoot) {
    this.file = path.join(dataRoot, 'state', 'users.json')
    migrateFile(path.join(dataRoot, 'users.json'), this.file)
    this.data = readJsonSync(this.file, { version: 1, users: [] })
    if (!Array.isArray(this.data.users)) this.data.users = []
  }

  list() {
    return this.data.users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      disabled: u.disabled === true
    }))
  }

  find(username) {
    const name = String(username ?? '').toLowerCase()
    return this.data.users.find((u) => u.username.toLowerCase() === name) ?? null
  }

  byId(id) {
    return this.data.users.find((u) => u.id === id) ?? null
  }

  adminCount() {
    return this.data.users.filter((u) => u.role === 'admin' && !u.disabled).length
  }

  async create({ username, password, role = 'user' }) {
    const name = String(username ?? '').trim()
    if (!USERNAME_RE.test(name)) throw new Error('用户名需为 2-32 位字母、数字、下划线、点或短横线')
    if (String(password ?? '').length < 6) throw new Error('密码至少 6 位')
    if (this.find(name)) throw new Error('用户名已存在')
    const user = {
      id: randomId(9),
      username: name,
      role: role === 'admin' ? 'admin' : 'user',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }
    this.data.users.push(user)
    await this.save()
    return user
  }

  async setPassword(id, password) {
    const user = this.byId(id)
    if (!user) throw new Error('用户不存在')
    if (String(password ?? '').length < 6) throw new Error('密码至少 6 位')
    user.passwordHash = hashPassword(password)
    await this.save()
  }

  async remove(id) {
    const user = this.byId(id)
    if (!user) throw new Error('用户不存在')
    if (user.role === 'admin' && this.adminCount() <= 1) throw new Error('不能删除最后一个管理员')
    this.data.users = this.data.users.filter((u) => u.id !== id)
    await this.save()
  }

  async save() {
    await writeJsonAtomic(this.file, this.data)
  }
}

/**
 * 会话：随机 id 放 HttpOnly Cookie，服务端保存会话记录。
 * 落盘是为了容器重启后不用重新登录；过期与删除即时生效。
 */
export class SessionStore {
  constructor(dataRoot, ttlMs) {
    this.file = path.join(dataRoot, 'state', 'sessions.json')
    migrateFile(path.join(dataRoot, 'sessions.json'), this.file)
    this.ttlMs = ttlMs
    this.sessions = new Map()
    const saved = readJsonSync(this.file, { sessions: [] })
    for (const s of saved.sessions ?? []) {
      if (s && s.id && s.userId && s.expiresAt > Date.now()) this.sessions.set(s.id, s)
    }
    this.timer = setInterval(() => this.sweep(), 60_000)
    this.timer.unref?.()
  }

  create(user) {
    const session = {
      id: randomId(32),
      userId: user.id,
      username: user.username,
      role: user.role,
      csrf: randomId(24),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs
    }
    this.sessions.set(session.id, session)
    void this.save()
    return session
  }

  get(id) {
    const session = this.sessions.get(String(id ?? ''))
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(session.id)
      void this.save()
      return null
    }
    return session
  }

  destroy(id) {
    if (this.sessions.delete(String(id ?? ''))) void this.save()
  }

  destroyUser(userId) {
    let changed = false
    for (const [id, s] of this.sessions) {
      if (s.userId === userId) {
        this.sessions.delete(id)
        changed = true
      }
    }
    if (changed) void this.save()
  }

  sweep() {
    const now = Date.now()
    let changed = false
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(id)
        changed = true
      }
    }
    if (changed) void this.save()
  }

  async save() {
    try {
      await writeJsonAtomic(this.file, { sessions: [...this.sessions.values()] })
    } catch {
      /* 磁盘写失败不阻断请求 */
    }
  }
}


/**
 * 审计：登录事件写 audit/auth/YYYY-MM-DD.jsonl，每用户写 audit/users/<id>/YYYY-MM-DD.jsonl。
 * 旧布局（audit/ 下平铺 <id>-<day>.jsonl）在启动时自动迁移。
 */
export { AuditLog } from './audit-log.mjs'

export function csrfOk(session, provided) {
  return Boolean(session && provided && safeEqual(session.csrf, provided))
}
