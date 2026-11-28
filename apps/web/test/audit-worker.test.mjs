import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { AuditLog } from '../src/server/audit-log.mjs'
import { handleInvoke } from '../src/server/invoke.mjs'
import { BackendPool } from '../src/server/backend-pool.mjs'

test('handleInvoke never persists positional secrets, content, paths or raw errors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
  try {
    const audit = new AuditLog(root)
    const secret = 'SYNTHETIC-secret-123'
    const privatePath = '/home/synthetic/private/file'
    for (const fail of [false, true]) {
      const req = Readable.from([Buffer.from(JSON.stringify({ channel: 'secrets:set', args: [privatePath, secret] }))])
      req.method = 'POST'; req.headers = { 'x-deva-csrf': 'csrf' }
      const res = { writeHead() { return this }, end() {} }
      await handleInvoke(req, res, { id: 'u' }, { csrf: 'csrf' }, {
        audit, jailCheck: async () => {}, pool: { invoke: async () => {
          if (fail) throw new Error(`${secret} ${privatePath}`)
          return { ok: true }
        } }
      })
    }
    const stored = audit.read('u').join('\n')
    assert.equal(audit.read('u').length, 2)
    assert.ok(!stored.includes(secret)); assert.ok(!stored.includes(privatePath))
  } finally { fs.rmSync(root, { recursive: true }) }
})

test('tail reads 200000 lines; retention leaves old logs untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tail-'))
  try {
    const dir = path.join(root, 'audit/users/u'); fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'legacy.jsonl')
    const text = Array.from({ length: 200000 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n'
    fs.writeFileSync(file, text)
    const audit = new AuditLog(root, { maxBytes: 1 })
    const t = performance.now(); const lines = audit.read('u', 120)
    console.log(JSON.stringify({ lines: lines.length, bytes: Buffer.byteLength(text), ms: performance.now() - t }))
    assert.equal(lines.length, 120); assert.equal(JSON.parse(lines[0]).i, 199999)
    assert.equal(JSON.parse(lines[119]).i, 199880)
    audit.append('u', { event: 'new' })
    assert.equal(fs.readFileSync(file, 'utf8'), text)
    assert.equal(fs.readdirSync(path.join(dir, 'managed-v1')).length, 0)
  } finally { fs.rmSync(root, { recursive: true }) }
})

test('startup timeout kills old worker; late ready cannot revive or kill replacement', async () => {
  const workers = []
  const pool = new BackendPool({ idleMs: 0, startupMs: 10, spawnWorker() {
    const worker = new EventEmitter(); worker.exitCode = null
    worker.kill = () => { worker.killed = true; worker.exitCode = -1 }
    workers.push(worker); return worker
  } })
  const user = { id: 'u', workspace: '.', home: '.', username: 'u' }
  const first = pool.entry(user)
  // Keep the event loop alive: production has HTTP sockets, this fake does not.
  const hold = setTimeout(() => {}, 1000)
  try {
    await assert.rejects(first.ready, /超时/)
    assert.equal(workers[0].killed, true)
    const second = pool.entry(user)
    workers[0].emit('message', { t: 'ready' })
    assert.equal(first.alive, false)
    workers[1].emit('message', { t: 'ready' })
    await second.ready
    workers[0].emit('exit', -1)
    assert.equal(pool.entries.get('u'), second)
    assert.ok(!workers[1].killed)
    pool.stopAll()
  } finally { clearTimeout(hold) }
})


test('audit read errors surface rather than returning an empty list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-error-'))
  try {
    fs.mkdirSync(path.join(root, 'audit/users/u/broken.jsonl'), { recursive: true })
    assert.throws(() => new AuditLog(root).read('u'))
  } finally { fs.rmSync(root, { recursive: true }) }
})
