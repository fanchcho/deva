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
    startupMs = 30_000,
    requestMs = 600_000,
    maxInflight = Number(process.env.DEVA_RPC_MAX_INFLIGHT ?? 32),
    maxQueue = Number(process.env.DEVA_RPC_MAX_QUEUE ?? 128),
    spawnWorker = fork,
    onEvent = () => {},
    onLog = () => {},
    ctlUrl = '',
    ctlToken = '',
    trustRoots = () => []
  } = {}) {
    if (!Number.isSafeInteger(maxInflight) || maxInflight < 1 || !Number.isSafeInteger(maxQueue) || maxQueue < 0) throw new Error("Invalid RPC budget")
    this.maxInflight = maxInflight; this.maxQueue = maxQueue; this.requestMs = requestMs
    this.startupMs = startupMs
    this.spawnWorker = spawnWorker
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
      queue: [],
      sending: false,
      leases: new Set(),
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
      const proc = this.spawnWorker(WORKER, [], {
        cwd: user.workspace,
        env: {
          ...process.env,
          HOME: user.home,
          TMPDIR: path.join(user.home, 'tmp'),
          TMP: path.join(user.home, 'tmp'),
          TEMP: path.join(user.home, 'tmp'),
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
      let terminated = false
      const terminate = (error, kill = true) => {
        if (terminated) return
        terminated = true
        clearTimeout(timer)
        clearTimeout(entry.idleTimer)
        entry.alive = false
        entry.starting = false
        entry.proc = null
        if (this.entries.get(user.id) === entry) this.entries.delete(user.id)
        for (const pending of entry.pending.values()) pending.reject(error)
        entry.pending.clear()
        for (const task of [...entry.queue]) task.reject(error)
        entry.queue = []
        entry.leases.clear()
        if (!settled) { settled = true; reject(error) }
        if (kill && proc.exitCode === null) proc.kill('SIGKILL')
      }
      entry.terminate = terminate
      const timer = setTimeout(() => terminate(new Error('backend 启动超时')), this.startupMs)
      timer.unref?.()

      proc.on('message', (msg) => {
        if (terminated || !msg || typeof msg !== 'object') return
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
        if (msg.t === 'lease' || typeof msg.active === 'boolean') {
          if (msg.active) entry.leases.add('worker')
          else entry.leases.clear()
          this.touch(entry)
          if (msg.t === 'lease') return
        }
        if (msg.t === 'reply') {
          const pending = entry.pending.get(msg.id)
          if (!pending) return
          entry.pending.delete(msg.id)
          if (msg.ok) pending.resolve(msg.value)
          else pending.reject(Object.assign(new Error(msg.error ?? 'backend error'), { code: msg.code }))
          return
        }
        if (msg.t === 'event') {
          const event = msg.payload?.event
          const key = msg.payload?.turnId
          if (key && event?.type === 'turn_start') entry.leases.add(key)
          if (key && event?.type === 'done') entry.leases.delete(key)
          this.touch(entry)
          this.onEvent(user.id, msg.channel, msg.payload)
        }
      })

      proc.on('error', terminate)
      proc.on('exit', (code, signal) => {
        terminate(new Error(`backend 退出 code=${code} signal=${signal ?? ''}`))
        this.onLog(prefix, `exit code=${code} signal=${signal ?? ''}`)
      })
    })
  }

  touch(entry) {
    entry.lastUsed = Date.now()
    clearTimeout(entry.idleTimer)
    if (!this.idleMs || (!entry.alive && !entry.starting)) return
    if (entry.pending.size || entry.queue.length || entry.leases.size || entry.sending) return
    entry.idleTimer = setTimeout(() => {
      if (!entry.pending.size && !entry.queue.length && !entry.leases.size && !entry.sending) this.stop(entry.userId, 'idle')
    }, this.idleMs)
    entry.idleTimer.unref?.()
  }

  pump(entry) {
    if (!entry.alive || entry.sending || entry.pending.size >= this.maxInflight) return
    const task = entry.queue.shift()
    if (!task) { this.touch(entry); return }
    entry.pending.set(task.id, task)
    entry.sending = true
    entry.sendingId = task.id
    let callbackCalled = false
    const sent = error => {
      if (callbackCalled) return
      callbackCalled = true
      entry.sending = false
      entry.sendingId = null
      if (error) task.reject(error)
      else if (task.message.t === 'send') task.resolve()
      this.pump(entry)
    }
    try {
      // A false return keeps the gate closed until Node's IPC send callback.
      entry.proc.send(task.message, sent)
    } catch (error) { sent(error) }
  }

  request(user, channel, args, type, { signal } = {}) {
    const entry = this.entry(user)
    entry.ready.catch(() => {}) // overload can reject before the startup promise settles
    if (entry.pending.size + entry.queue.length >= this.maxInflight + this.maxQueue || (entry.queue.length >= this.maxQueue && (!entry.alive || entry.sending || entry.pending.size >= this.maxInflight))) {
      return Promise.reject(Object.assign(new Error('RPC_OVERLOADED'), { code: 'RPC_OVERLOADED', retryAfterMs: 1000 }))
    }
    return new Promise((resolve, reject) => {
      const id = entry.nextId++
      let finished = false
      const finish = (error, value) => {
        if (finished) return
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
        entry.pending.delete(id)
        const index = entry.queue.indexOf(task)
        if (index >= 0) entry.queue.splice(index, 1)
        if (error) reject(error); else resolve(value)
        if (error && entry.sending && entry.sendingId === id) entry.terminate(error)
        this.pump(entry); this.touch(entry)
      }
      const task = { id, message: { t: type, id, channel, args }, resolve: value => finish(null, value), reject: error => finish(error) }
      const abort = () => task.reject(Object.assign(new Error('RPC_CANCELLED'), { code: 'RPC_CANCELLED' }))
      const timer = setTimeout(() => task.reject(new Error(`通道超时: ${channel}`)), this.requestMs)
      timer.unref?.()
      entry.queue.push(task)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      if (entry.alive) this.pump(entry)
      else entry.ready.then(() => this.pump(entry), task.reject)
      this.touch(entry)
    })
  }

  invoke(user, channel, args, options) { return this.request(user, channel, args, 'invoke', options) }
  send(user, channel, args, options) { return this.request(user, channel, args, 'send', options) }

  async channels(user) {
    const entry = this.entry(user)
    await entry.ready
    return entry.channels
  }

  stop(userId, reason = 'manual') {
    const entry = this.entries.get(userId)
    if (!entry) return
    const proc = entry.proc
    entry.terminate(new Error(`backend 已停止 (${reason})`), false)
    if (proc) {
      try { proc.send?.({ t: 'shutdown' }) } catch { proc.kill('SIGKILL') }
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL') }, 3000).unref?.()
    }
    this.onLog(`[backend:${userId}]`, `stopped (${reason})`)
  }

  stopAll(reason = 'shutdown') {
    for (const id of [...this.entries.keys()]) this.stop(id, reason)
  }
}
