import fs from 'node:fs'
import os from 'node:os'
import { basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

const processBirth = Date.now() - Math.floor(process.uptime() * 1000)
/** Fingerprint the OS start time and executable identity without persisting command-line secrets. */
export function processIdentity(pid, { platform = process.platform, run = execFileSync } = {}) {
  if (!Number.isInteger(pid) || pid < 1) return null
  try {
    const text = platform === 'win32'
      ? run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object CreationDate,ExecutablePath | ConvertTo-Json -Compress`],
      { encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim()
      : run('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='],
        { encoding: 'utf8', timeout: 2000, env: { ...process.env, LC_ALL: 'C' } }).trim()
    if (!text || text === 'null') return null
    return createHash('sha256').update(text).digest('hex')
  } catch { return null }
}
let ownIdentity
export function inspectOwner(pid, owner, { signal = process.kill, identity = processIdentity } = {}) {
  try { signal(pid, 0) } catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown' }
  const current = identity(pid)
  if (!current || !owner.identity) return 'unknown'
  return current === owner.identity ? 'alive' : 'reused'
}
/** Fail closed: live/reused PID, foreign host, backwards time and unknown permissions never recover. */
export function recoverable(owner, { now = Date.now(), host = os.hostname(), inspect = inspectOwner, age = 300000 } = {}) {
  return owner?.version === 1 && owner.host === host && Number.isInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.token === 'string' && Number.isFinite(owner.startedAt) && typeof owner.command === 'string' &&
    Number.isFinite(owner.createdAt) && Number.isFinite(owner.heartbeatAt) &&
    now >= owner.createdAt && now - owner.heartbeatAt > age && inspect(owner.pid, owner) === 'dead'
}
function conflict() { return Object.assign(new Error('配置正在被其它进程修改，请重试'), { code: 'DEVA_CONCURRENT_WRITE' }) }
function audit(file, event, owner) {
  const fd = fs.openSync(`${file}.lock-audit.jsonl`, 'a', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify({ event, at: Date.now(), owner }) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
/** Immutable per-generation election records. Never remove: removal would permit ABA. */
function acquireGuard(file, guard, candidate, temporary) {
  try { fs.linkSync(temporary, guard); return } catch (e) { if (e.code !== 'EEXIST') throw e }
  const original = JSON.parse(fs.readFileSync(guard, 'utf8'))
  const confirm = owner => {
    if (!recoverable(owner)) { audit(file, 'guard-recovery-denied', owner); throw conflict() }
  }
  confirm(original)
  const directory = `${file}.lock-audit`
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  let previous = original
  const abandoned = []
  // Every link is immutable. A live/unknown successor terminates traversal without mutation.
  for (;;) {
    confirm(previous)
    abandoned.push(previous)
    const claim = `${directory}/${createHash('sha256').update(previous.token).digest('hex')}.json`
    try { fs.linkSync(temporary, claim); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      previous = JSON.parse(fs.readFileSync(claim, 'utf8'))
    }
  }
  const current = JSON.parse(fs.readFileSync(guard, 'utf8'))
  if (current.token !== original.token) { audit(file, 'guard-generation-changed', original); throw conflict() }
  confirm(current)
  audit(file, 'recover-dead-guard', { previous: current, successor: candidate })
  // Only this confirmed dead generation's prepared link can be an interrupted temporary.
  for (const owner of abandoned)
    if (/^[0-9a-f-]{36}$/.test(owner.token)) fs.rmSync(`${guard}.${owner.token}.tmp`, { force: true })
  // Only the unique, living terminal claimant may unlink this exact generation.
  // Original owner is confirmed dead; other reclaimers cannot pass its immutable claim.
  fs.unlinkSync(guard)
  // A fresh normal writer may win this gap. Never overwrite or remove its guard.
  fs.linkSync(temporary, guard)
}
export function acquireFileLock(file) {
  const lock = `${file}.lock`, guard = `${lock}.recovery`
  const now = Date.now()
  const candidate = { version: 1, token: randomUUID(), pid: process.pid, host: os.hostname(),
    createdAt: now, heartbeatAt: now, startedAt: processBirth, command: basename(process.execPath),
    identity: ownIdentity ??= processIdentity(process.pid) }
  const temporary = `${guard}.${candidate.token}.tmp`
  let ownsGuard = false
  try {
    const prepared = fs.openSync(temporary, 'wx', 0o600)
    try { fs.writeFileSync(prepared, JSON.stringify(candidate)); fs.fsyncSync(prepared) } finally { fs.closeSync(prepared) }
    try { acquireGuard(file, guard, candidate, temporary); ownsGuard = true } catch (e) {
      if (e.code === 'EEXIST' || e.code === 'ENOENT') throw conflict()
      throw e
    }
    if (fs.existsSync(lock)) {
      let owner
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')) } catch { throw conflict() }
      if (!recoverable(owner)) throw conflict()
      // Every cooperating writer holds guard across inspect/unlink/acquire, preventing two recoverers.
      const audit = fs.openSync(`${file}.lock-audit.jsonl`, 'a', 0o600)
      try { fs.writeFileSync(audit, JSON.stringify({ event: 'recover-dead-owner', at: Date.now(), owner }) + '\n'); fs.fsyncSync(audit) } finally { fs.closeSync(audit) }
      fs.unlinkSync(lock)
    }
    const token = randomUUID(), now = Date.now()
    const owner = { version: 1, token, pid: process.pid, host: os.hostname(), createdAt: now,
      heartbeatAt: now, startedAt: processBirth, command: basename(process.execPath),
      identity: ownIdentity ??= processIdentity(process.pid) }
    const fd = fs.openSync(lock, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    // Transactions are synchronous today; this also supports callers holding the lock across awaits.
    const heartbeat = setInterval(() => {
      try {
        const current = JSON.parse(fs.readFileSync(lock, 'utf8'))
        if (current.token !== token) { clearInterval(heartbeat); return }
        owner.heartbeatAt = Math.max(owner.heartbeatAt, Date.now())
        fs.writeFileSync(lock, JSON.stringify(owner), { mode: 0o600 })
      } catch { /* Permission loss or partial metadata fails closed at recovery. */ }
    }, 1000)
    heartbeat.unref()
    return () => {
      clearInterval(heartbeat)
      const current = JSON.parse(fs.readFileSync(lock, 'utf8'))
      if (current.token !== token) throw conflict()
      fs.unlinkSync(lock)
    }
  } finally {
    try { fs.rmSync(temporary, { force: true }) } finally {
      if (ownsGuard) fs.unlinkSync(guard)
    }
  }
}
