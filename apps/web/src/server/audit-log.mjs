import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// New generation only: legacy files are read-only and never enter retention.
export class AuditLog {
  constructor(dataRoot, {
    days = Number(process.env.DEVA_AUDIT_DAYS ?? 30),
    maxBytes = Number(process.env.DEVA_AUDIT_BYTES ?? 256 * 1024 * 1024)
  } = {}) {
    if (!(days > 0) || !(maxBytes > 0)) throw new Error('Invalid audit retention budget')
    this.dir = path.join(dataRoot, 'audit')
    this.days = days
    this.maxBytes = maxBytes
    this.active = new Map()
    this.health = new Map()
    this.index = new Map()
  }

  probe(userId) {
    const dir = path.join(this.dir, 'users', userId || 'auth', 'managed-v1')
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = path.join(dir, `.probe-${randomUUID()}`)
      const fd = fs.openSync(file, 'wx', 0o600)
      try { fs.writeSync(fd, 'probe'); fs.fsyncSync(fd) } finally { fs.closeSync(fd); fs.unlinkSync(file) }
      this.health.set(userId, true)
      return true
    } catch { this.health.set(userId, false); return false }
  }

  append(userId, event) {
    const dir = path.join(this.dir, 'users', userId || 'auth', 'managed-v1')
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    let index = this.index.get(dir)
    if (!index) {
      const files = fs.readdirSync(dir).filter(f => /^\d+-[\da-f-]+\.jsonl$/.test(f)).sort()
        .flatMap(name => {
          const stat = fs.lstatSync(path.join(dir, name))
          return stat.isFile() && !stat.isSymbolicLink() ? [{ name, size: stat.size, time: stat.mtimeMs }] : []
        })
      index = { files, bytes: files.reduce((n, f) => n + f.size, 0), timer: null }
      this.index.set(dir, index)
    }
    const day = new Date().toISOString().slice(0, 10)
    let current = this.active.get(dir)
    const rotated = !current || current.day !== day || current.record.size >= 1048576
    if (rotated) {
      const record = { name: `${Date.now()}-${randomUUID()}.jsonl`, size: 0, time: Date.now() }
      current = { day, record }; this.active.set(dir, current); index.files.push(record)
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n'
    try { fs.appendFileSync(path.join(dir, current.record.name), line, { mode: 0o600 }) }
    catch (error) { clearTimeout(index.timer); this.health.set(userId, false); this.index.delete(dir); this.active.delete(dir); throw error }
    const bytes = Buffer.byteLength(line)
    current.record.size += bytes; current.record.time = Date.now(); index.bytes += bytes
    if (rotated || index.bytes > this.maxBytes) this.maintain(dir, index)
    clearTimeout(index.timer)
    index.timer = setTimeout(() => {
      try { this.maintain(dir, index) }
      catch { this.health.set(userId, false); console.warn('[audit] retention maintenance failed') }
    }, 60000)
    index.timer.unref?.()
  }

  maintain(dir, index) {
    while (index.files.length) {
      const record = index.files[0]
      if (index.bytes <= this.maxBytes && record.time >= Date.now() - this.days * 86400000) break
      fs.unlinkSync(path.join(dir, record.name))
      index.files.shift(); index.bytes -= record.size
      if (record === this.active.get(dir)?.record) this.active.delete(dir)
    }
  }

  auth(event) { this.append('auth', event) }

  read(userId, limit = 200) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid audit limit')
    const dir = path.join(this.dir, 'users', String(userId))
    const files = []
    for (const folder of [dir, path.join(dir, 'managed-v1')]) {
      try {
        for (const name of fs.readdirSync(folder)) {
          if (name.endsWith('.jsonl')) {
            const file = path.join(folder, name)
            files.push({ file, time: fs.statSync(file).mtimeMs })
          }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    files.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file))
    const result = []
    for (const { file } of files) {
      const fd = fs.openSync(file, 'r')
      try {
        let position = fs.fstatSync(fd).size
        let tail = Buffer.alloc(0)
        while (position > 0 && result.length < limit) {
          const size = Math.min(16384, position)
          position -= size
          const chunk = Buffer.alloc(size)
          fs.readSync(fd, chunk, 0, size, position)
          tail = Buffer.concat([chunk, tail])
          let end = tail.length
          for (let i = tail.length - 1; i >= 0; i--) {
            if (tail[i] !== 10) continue
            const line = tail.subarray(i + 1, end).toString('utf8')
            if (line) result.push(line)
            end = i
            if (result.length === limit) break
          }
          tail = tail.subarray(0, end)
        }
        if (position === 0 && tail.length && result.length < limit) result.push(tail.toString('utf8'))
      } finally { fs.closeSync(fd) }
      if (result.length === limit) break
    }
    return result
  }
}
