import { fork } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(here, 'worker-host.mjs')

/**
 * 每用户一个后端进程：Electron 主进程里的单例（模块级 DEVA_HOME、配置缓存、
 * 会话注册表）在原样复用时不支持同进程多租户，进程隔离是最小改动且最可靠的方案。
 */
export class BackendPool {
  constructor({
    idleMs = 30 * 60 * 1000,
    onEvent = () => {},
    onLog = () => {},
    ctlUrl = '',
    ctlToken = '',
    trustRoots = () => []
  } = {}) {
    this.idleMs = idleMs
    this.onEvent = onEvent
    this.onLog = onLog
    this.ctlUrl = ctlUrl
    this.ctlToken = ctlToken
    this.trustRoots = trustRoots
    this.entries = new Map()
  }

  entry(user) {
    let entry = this.entries.get(user.id)
    if (entry) {
      if (entry.alive || entry.starting) {
        this.touch(entry)
        return entry
      }
      // 上一次 worker 已退出：旧的 ready 已 resolve，继续复用只会把消息发给 null。
      // 清掉旧 entry，下一次请求重新拉起一个干净的后端进程。
      clearTimeout(entry.idleTimer)
      this.entries.delete(user.id)
    }
    entry = {
      userId: user.id,
      proc: null,
      ready: null,
      alive: false,
      starting: true,
      nextId: 1,
      pending: new Map(),
      channels: [],
      lastUsed: Date.now(),
      idleTimer: null,
      restarting: false
    }
    entry.ready = this.spawn(user, entry)
    this.entries.set(user.id, entry)
    this.touch(entry)
    return entry
  }

  spawn(user, entry) {
    return new Promise((resolve, reject) => {
      const proc = fork(WORKER, [], {
        cwd: user.workspace,
        env: {
          ...process.env,
          HOME: user.home,
          DEVA_HOME: user.home,
          DEVA_WEB_WORKSPACE: user.workspace,
          DEVA_WEB_USER: user.id,
          DEVA_WEB_CTL_URL: this.ctlUrl,
          DEVA_WEB_CTL_TOKEN: this.ctlToken,
          DEVA_WEB_TRUST_ROOTS: JSON.stringify(this.trustRoots(user) ?? [])
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
      entry.proc = proc

      const prefix = `[backend:${user.username}]`
      proc.stdout?.on('data', (d) => this.onLog(prefix, String(d).trimEnd()))
      proc.stderr?.on('data', (d) => this.onLog(prefix, String(d).trimEnd()))

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        entry.starting = false
        reject(new Error('backend 启动超时'))
      }, 30_000)
      timer.unref?.()

      proc.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return
        if (msg.t === 'ready') {
          entry.alive = true
          entry.starting = false
          entry.channels = Array.isArray(msg.channels) ? msg.channels : []
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(entry)
          }
          this.onLog(prefix, `ready: ${msg.channels?.length ?? 0} channels`)
          return
        }
        if (msg.t === 'reply') {
          const pending = entry.pending.get(msg.id)
          if (!pending) return
          entry.pending.delete(msg.id)
          if (msg.ok) pending.resolve(msg.value)
          else pending.reject(new Error(msg.error ?? 'backend error'))
          return
        }
        if (msg.t === 'event') {
          this.onEvent(user.id, msg.channel, msg.payload)
        }
      })

      proc.on('exit', (code, signal) => {
        entry.alive = false
        entry.starting = false
        entry.proc = null
        const error = new Error(`backend 退出 code=${code} signal=${signal ?? ''}`)
        for (const pending of entry.pending.values()) pending.reject(error)
        entry.pending.clear()
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(error)
        }
        this.onLog(prefix, `exit code=${code} signal=${signal ?? ''}`)
      })
    })
  }

  touch(entry) {
    entry.lastUsed = Date.now()
    clearTimeout(entry.idleTimer)
    if (!this.idleMs) return
    entry.idleTimer = setTimeout(() => this.stop(entry.userId, 'idle'), this.idleMs)
    entry.idleTimer.unref?.()
  }

  async invoke(user, channel, args) {
    const entry = this.entry(user)
    await entry.ready
    this.touch(entry)
    const id = entry.nextId++
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject })
      const timer = setTimeout(() => {
        if (!entry.pending.has(id)) return
        entry.pending.delete(id)
        reject(new Error(`通道超时: ${channel}`))
      }, 10 * 60 * 1000)
      timer.unref?.()
      const wrap = entry.pending.get(id)
      entry.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          wrap.resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          wrap.reject(e)
        }
      })
      entry.proc?.send({ t: 'invoke', id, channel, args })
    })
  }

  async send(user, channel, args) {
    const entry = this.entry(user)
    await entry.ready
    this.touch(entry)
    entry.proc?.send({ t: 'send', channel, args })
  }

  async channels(user) {
    const entry = this.entry(user)
    await entry.ready
    return entry.channels
  }

  stop(userId, reason = 'manual') {
    const entry = this.entries.get(userId)
    if (!entry) return
    this.entries.delete(userId)
    clearTimeout(entry.idleTimer)
    try {
      entry.proc?.send({ t: 'shutdown' })
    } catch {
      /* ignore */
    }
    const proc = entry.proc
    if (proc) {
      setTimeout(() => {
        if (proc.exitCode === null) {
          try {
            proc.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }
      }, 3000).unref?.()
    }
    for (const pending of entry.pending.values()) pending.reject(new Error('backend 已停止'))
    entry.pending.clear()
    this.onLog(`[backend:${userId}]`, `stopped (${reason})`)
  }

  stopAll(reason = 'shutdown') {
    for (const id of [...this.entries.keys()]) this.stop(id, reason)
  }
}
