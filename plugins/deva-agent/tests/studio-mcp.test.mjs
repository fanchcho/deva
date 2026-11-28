import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isolatedDevaHome } from './support/deva-home.mjs'
isolatedDevaHome()
test('Studio MCP permission and malformed response failures are explicit; probe failures are unknown', async () => {
  const { readStudioMcpPage } = await import('../lib/studio-mcp.mjs')
  const run = {
    identity: { userId: 1, profile: 'default' },
    state: { profile: { namespace: () => ({ async get() {} }) } },
  }
  run.host = { request: async () => { throw Object.assign(new Error('secret upstream detail'), { status: 403 }) } }
  await assert.rejects(readStudioMcpPage(run), err => /403/.test(err.message) && !/secret/.test(err.message))
  run.host = { request: async () => ({ ok: true, servers: {} }) }
  await assert.rejects(readStudioMcpPage(run), /清单格式异常/)
  run.host = { request: async path => {
    if (path.endsWith('/test')) throw new Error('probe failed')
    return { ok: true, servers: [{ name: 'managed', managed: true, config: { command: 'fixture' } }] }
  } }
  const result = await readStudioMcpPage(run)
  assert.deepEqual(result, {
    servers: [{ name: 'managed', enabled: true, transport: 'stdio', managed: true, toolCountUnavailable: true }],
    selected: ['managed'],
  })
})

test('host fixture CRUD, test and scoped Agent selection use one Studio catalog', async () => {
  const { createStudioServer, updateStudioServer, setStudioServerEnabled, deleteStudioServer, testStudioServer, saveStudioSelection } = await import('../lib/studio-mcp.mjs')
  const entries = new Map(), calls = []
  let stored
  const run = {
    identity: { userId: 1 }, config: { sharedDevaHome: process.env.DEVA_HOME },
    state: { profile: { namespace: id => { assert.equal(id, '1'); return { get: async () => stored, set: async (_, value) => { stored = value } } } } },
    host: { request: async (path, { method = 'GET', body } = {}) => {
      calls.push([method, path])
      if (method === 'GET') return { ok: true, servers: [...entries.values()] }
      const name = body?.name || decodeURIComponent(path.split('/')[5])
      if (method === 'DELETE') { entries.delete(name); return { ok: true } }
      if (path.endsWith('/test')) { assert.ok(entries.get(name).config.enabled); return { ok: true, tools: [{ name: 'echo', description: 'fixture' }] } }
      const config = body.config ? structuredClone(body.config) : { ...entries.get(name).config, enabled: body.enabled }
      const server = { name, managed: false, config }
      entries.set(name, server)
      return { ok: true, server }
    } },
  }
  await createStudioServer(run.host, { name: 'fixture', config: { command: 'node', enabled: true } })
  await updateStudioServer(run.host, { name: 'fixture', config: { command: 'node', args: ['fixture.mjs'], enabled: true } })
  await saveStudioSelection(run, ['fixture'])
  const { readStudioMcpPage } = await import('../lib/studio-mcp.mjs')
  assert.deepEqual((await readStudioMcpPage(run, 1)).selected, ['fixture'])
  assert.equal((await testStudioServer(run.host, { name: 'fixture' }))[0].name, 'echo')
  await setStudioServerEnabled(run.host, { name: 'fixture', enabled: false })
  await assert.rejects(saveStudioSelection(run, ['fixture']), /已启用/)
  assert.deepEqual((await readStudioMcpPage(run, 1)).selected, [])
  await deleteStudioServer(run.host, { name: 'fixture' })
  assert.equal(entries.size, 0)
  assert.ok(calls.every(([, path]) => path.startsWith('/api/ekko/mcp/servers')))
  assert.deepEqual(new Set(calls.map(([method]) => method)), new Set(['POST', 'PATCH', 'GET', 'DELETE']))
})

test('desktop compatibility is not disclosed to a different account', async () => {
  const { readStudioMcpPage } = await import('../lib/studio-mcp.mjs')
  const result = await readStudioMcpPage({ identity: { userId: 2 }, host: { request: async () => ({ ok: true, servers: [] }) } }, 1)
  assert.deepEqual(result, { servers: [], selected: [] })
})
