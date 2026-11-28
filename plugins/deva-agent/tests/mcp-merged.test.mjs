import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { mergedMcpHost, writeMcpDocument, runtimeMcpConfig } from '../lib/mcp-merged.mjs'
import { listStudioServers, readStudioMcpPage, saveStudioSelection, setStudioServerEnabled, updateStudioServer, deleteStudioServer } from '../lib/studio-mcp.mjs'
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
test('merged catalog: bidirectional additions, lossless secretRef, alias, idempotence, CRUD and one request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merged-'))
  const path = join(root, 'mcp.json'), cfg = join(root, 'config.json')
  const protectedEntry = { name: 'Display', command: 'node', env: { TOKEN: { secretRef: 'token' } }, extension: { untouched: 7 } }
  writeFileSync(path, JSON.stringify({ extra: { keep: true }, mcpServers: { desktop: protectedEntry } }), { mode: 0o640 })
  writeFileSync(cfg, JSON.stringify({ extra: 9, mcp: { enabled: { desktop: false }, keep: 3 } }))
  const before = hash(protectedEntry), meta = statSync(path), calls = []
  const remote = new Map([['host', { name: 'host', config: { command: 'fake', enabled: false } }], ['Display', { name: 'Display', config: { command: 'other', enabled: false } }]])
  let selected
  const run = { identity: { userId: 1 }, config: { sharedDevaHome: root, sharedDevaUserId: 1 }, state: { profile: { namespace: () => ({ get: async () => selected, set: async (_, v) => { selected = v } }) } }, host: { request: async (url, { method = 'GET', body } = {}) => {
    calls.push([method, url])
    if (method === 'GET') return { ok: true, servers: [...remote.values()] }
    const name = decodeURIComponent(url.split('/')[5])
    if (method === 'DELETE') remote.delete(name)
    if (method === 'PATCH') remote.set(name, { name, config: body.config || { ...remote.get(name).config, enabled: body.enabled } })
    return { ok: true, server: remote.get(name) }
  } } }
  const facade = { ...run, host: mergedMcpHost(run) }
  const page = await readStudioMcpPage(facade)
  assert.deepEqual(page.servers.map(x => x.name), ['desktop', 'host'])
  assert.equal(calls.length, 1)
  const first = readFileSync(path, 'utf8'), configFirst = readFileSync(cfg, 'utf8')
  assert.equal(hash(JSON.parse(first).mcpServers.desktop), before)
  assert.equal(JSON.parse(first).mcpServers.host.transport, 'stdio')
  await listStudioServers(facade.host)
  assert.equal(readFileSync(path, 'utf8'), first)
  assert.equal(readFileSync(cfg, 'utf8'), configFirst)
  assert.deepEqual(['mode','uid','gid'].map(k => statSync(path)[k]), ['mode','uid','gid'].map(k => meta[k]))
  await setStudioServerEnabled(facade.host, { name: 'desktop', enabled: true })
  await saveStudioSelection(facade, ['desktop'])
  assert.deepEqual(selected.servers, ['desktop'])
  await updateStudioServer(facade.host, { name: 'desktop', config: { command: 'new' } })
  const updated = JSON.parse(readFileSync(path)).mcpServers.desktop
  assert.deepEqual(updated.env, protectedEntry.env); assert.deepEqual(updated.extension, protectedEntry.extension)
  assert.throws(() => runtimeMcpConfig(updated), /secretRef/)
  await deleteStudioServer(facade.host, { name: 'desktop' })
  assert.equal(remote.has('Display'), false)
  assert.deepEqual((await listStudioServers(facade.host)).map(x => x.name), ['host'])
  console.log(JSON.stringify({ protectedEntryBefore: before, protectedEntryAfter: hash(JSON.parse(first).mcpServers.desktop), fileSha256: hash(first), idempotent: true, oneListRequest: true }))
})
test('atomic writer preserves original on injected failure and malformed input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merged-failure-')), path = join(root, 'mcp.json')
  const raw = '{"mcpServers":{},"unknown":5}'
  writeFileSync(path, raw, { mode: 0o644 })
  assert.throws(() => writeMcpDocument({ path, raw, value: JSON.parse(raw), stat: statSync(path) }, { mcpServers: { added: {} } }, () => { throw new Error('injected') }), /injected/)
  assert.equal(readFileSync(path, 'utf8'), raw)
  assert.ok(readdirSync(root).some(x => x.endsWith('.bak')))
  assert.ok(!readdirSync(root).some(x => x.endsWith('.tmp')))
  writeFileSync(path, '{bad')
  const host = mergedMcpHost({ identity: { userId: 1 }, config: { sharedDevaHome: root, sharedDevaUserId: 1 }, host: { request: async () => ({ ok: true, servers: [] }) } })
  await assert.rejects(listStudioServers(host))
  assert.equal(readFileSync(path, 'utf8'), '{bad')
  console.log(JSON.stringify({ failureOriginalSha256: hash(raw), preserved: true, temporaryFiles: 0 }))
})
