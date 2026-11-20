import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SELECTED_SERVERS,
  listStudioServers,
  readSelection,
  resolveStudioServers,
  writeSelection,
} from '../lib/studio-mcp.mjs'

function memoryStorage(records = new Map(), prefix = 'root') {
  return {
    namespace: (...parts) => memoryStorage(records, `${prefix}/${parts.join('/')}`),
    get: async key => records.get(`${prefix}#${key}`),
    set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
    async delete(key) { records.delete(`${prefix}#${key}`) },
    keys: async () => [...records.keys()],
  }
}

function memoryState() {
  return { profile: memoryStorage(new Map(), 'profile') }
}

const identity = { userId: 1, profile: 'default' }

function fakeHost(servers, { fail = null } = {}) {
  const calls = []
  return {
    calls,
    async request(path, options) {
      calls.push([path, options])
      if (fail) throw fail
      return { ok: true, servers }
    },
  }
}

const stdio = (name, extra = {}) => ({ name, managed: false, config: { type: 'stdio', command: `${name}-bin`, args: [], env: {}, enabled: true, ...extra } })

test('selection store is namespaced by user inside the profile scope', async () => {
  const state = memoryState()
  await writeSelection(state, identity, ['a'])
  assert.deepEqual(await readSelection(state, identity), ['a'])
  // profile 作用域由宿主按 Profile 分区，插件只再按用户分一层
  assert.deepEqual(await readSelection(state, { userId: 2, profile: 'default' }), [])
  const otherProfile = { profile: memoryStorage(new Map(), 'work') }
  assert.deepEqual(await readSelection(otherProfile, identity), [])
})

test('readSelection tolerates missing, corrupt and illegal records', async () => {
  const state = memoryState()
  const store = state.profile.namespace('1')
  assert.deepEqual(await readSelection(state, identity), [])
  await store.set('mcp', { servers: 'nope' })
  assert.deepEqual(await readSelection(state, identity), [])
  await store.set('mcp', { servers: ['ok', 42, 'bad name', '-lead', 'ok', 'with.dot'] })
  assert.deepEqual(await readSelection(state, identity), ['ok', 'with.dot'], 'Studio 允许点号，不允许以 _ / - 开头')
  await store.set('mcp', { servers: Array.from({ length: MAX_SELECTED_SERVERS + 5 }, (_, i) => `s${i}`) })
  assert.equal((await readSelection(state, identity)).length, MAX_SELECTED_SERVERS)
})

test('writeSelection dedupes, validates names, and rejects oversized lists', async () => {
  const state = memoryState()
  assert.deepEqual(await writeSelection(state, identity, ['a', 'a', 'b']), ['a', 'b'])
  await assert.rejects(writeSelection(state, identity, 'a'), /必须是服务名数组/)
  await assert.rejects(writeSelection(state, identity, ['a b']), /服务名/)
  await assert.rejects(writeSelection(state, identity, ['-lead']), /服务名/)
  assert.deepEqual(await writeSelection(state, identity, ['a.b', 'a-b', 'a_b']), ['a.b', 'a-b', 'a_b'])
  await assert.rejects(writeSelection(state, identity, [1]), /服务名/)
  await assert.rejects(writeSelection(state, identity, Array.from({ length: MAX_SELECTED_SERVERS + 1 }, (_, i) => `s${i}`)), /最多选择/)
  assert.deepEqual(await readSelection(state, identity), ['a.b', 'a-b', 'a_b'], '失败的写入不改动已存的选择')
})

test('listStudioServers maps Studio config into display fields', async () => {
  const host = fakeHost([
    { name: 'files', managed: false, config: { type: 'stdio', command: 'files-bin', enabled: true } },
    { name: 'ekko-studio-api', managed: true, config: { type: 'stdio', command: '/app/bin/ekko-studio-mcp.mjs', enabled: true } },
    { name: 'remote', managed: false, config: { type: 'streamable_http', url: 'https://example.com/mcp', enabled: false } },
    { name: 'broken name', managed: false, config: {} },
    null,
  ])
  const servers = await listStudioServers(host)
  assert.deepEqual(servers.map(server => [server.name, server.transport, server.managed, server.enabled]), [
    ['files', 'stdio', false, true],
    ['ekko-studio-api', 'stdio', true, true],
    // streamable_http 在页面上统一显示为 http
    ['remote', 'http', false, false],
  ])
  assert.deepEqual(host.calls, [['/api/ekko/mcp/servers', undefined]])
})

test('listStudioServers requires the Studio host channel', async () => {
  await assert.rejects(listStudioServers(undefined), /宿主通道/)
  await assert.rejects(listStudioServers({}), /宿主通道/)
})

test('resolveStudioServers does not touch the host when nothing is selected', async () => {
  const host = fakeHost([])
  const result = await resolveStudioServers({ host, state: memoryState(), identity })
  assert.deepEqual(result, { servers: [], problems: [] })
  assert.deepEqual(host.calls, [])
})

test('resolveStudioServers returns only selected, enabled servers and reports the rest', async () => {
  const state = memoryState()
  await writeSelection(state, identity, ['files', 'off', 'gone', 'noconfig'])
  const host = fakeHost([
    stdio('files'),
    { name: 'off', managed: false, config: { type: 'stdio', command: 'off-bin', enabled: false } },
    { name: 'noconfig', managed: false },
    stdio('unselected'),
  ])
  const result = await resolveStudioServers({ host, state, identity, log: { info() {} } })
  assert.deepEqual(result.servers.map(server => server.name), ['files'])
  assert.equal(result.servers[0].command, 'files-bin')
  assert.equal(result.problems.length, 3)
  assert.match(result.problems.join('\n'), /off: 在 Studio 里已停用/)
  assert.match(result.problems.join('\n'), /gone: Studio 里已不存在/)
  assert.match(result.problems.join('\n'), /noconfig: Studio 没有返回可用的连接配置/)
})

test('resolveStudioServers surfaces host failures and storage failures instead of silently skipping', async () => {
  const state = memoryState()
  await writeSelection(state, identity, ['files'])
  const failure = Object.assign(new Error('forbidden'), { body: { error: { message: 'Missing api.read permission' } } })
  const hostResult = await resolveStudioServers({ host: fakeHost([], { fail: failure }), state, identity })
  assert.deepEqual(hostResult.servers, [])
  assert.match(hostResult.problems.join('\n'), /Missing api\.read permission/)
  assert.match(hostResult.problems.join('\n'), /已选：files/)

  const noState = await resolveStudioServers({ host: fakeHost([]), state: {}, identity })
  assert.deepEqual(noState.servers, [])
  assert.match(noState.problems.join('\n'), /读取 Studio MCP 选择失败/)
})

test('resolveStudioServers merges http servers and keeps per-server parse problems', async () => {
  const state = memoryState()
  await writeSelection(state, identity, ['remote'])
  const host = fakeHost([
    { name: 'remote', managed: false, config: { type: 'streamable_http', url: 'https://example.com/mcp', headers: { authorization: 'Bearer ${MCP_TOKEN}' }, enabled: true } },
  ])
  const previous = process.env.MCP_TOKEN
  process.env.MCP_TOKEN = 'tk'
  try {
    const result = await resolveStudioServers({ host, state, identity, log: { info() {} } })
    assert.deepEqual(result.problems, [])
    assert.equal(result.servers.length, 1)
    assert.equal(result.servers[0].type, 'http')
    assert.equal(result.servers[0].url, 'https://example.com/mcp')
  } finally {
    if (previous === undefined) delete process.env.MCP_TOKEN
    else process.env.MCP_TOKEN = previous
  }
})
