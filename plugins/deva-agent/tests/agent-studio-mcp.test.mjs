import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentDefinition } from '../lib/agent.mjs'

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
  const records = new Map()
  return { plugin: memoryStorage(records, 'plugin'), user: memoryStorage(records, 'user'), profile: memoryStorage(records, 'profile') }
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-studio-mcp-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 记录系统提示词，直接返回，不真的调模型。 */
function fakeRunTurn() {
  const calls = []
  const runTurn = async ({ system }) => {
    calls.push(system)
    return { finishReason: 'stop', content: [] }
  }
  return { calls, runTurn }
}

test('selected Studio servers that cannot be used show up in the MCP status section', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { calls, runTurn } = fakeRunTurn()
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    const state = memoryState()
    // 用户勾选了 Studio 里不存在的服务：运行时要如实点名，而不是当没选过
    await state.profile.namespace('1').set('mcp', { servers: ['gone'] })
    const run = {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state,
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host: { async request(path) { assert.equal(path, '/api/ekko/mcp/servers'); return { servers: [] } } },
    }
    await session.run({ input: [{ type: 'text', text: '你好' }], history: [], instructions: [], options: {} }, run)
    assert.equal(calls.length, 1)
    assert.match(calls[0], /## MCP 连接状态/)
    assert.match(calls[0], /gone: Studio 里已不存在这个 MCP 服务/)
    await session.dispose?.()
  } finally {
    await cleanup()
  }
})

test('no selection means no host call and no MCP status noise', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { calls, runTurn } = fakeRunTurn()
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    const requests = []
    const run = {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: memoryState(),
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      // 技能清单也会走 host.request；这里只关心有没有去读 Studio MCP 清单
      host: { async request(path) { requests.push(path); return path === '/api/ekko/skills' ? { skills: [] } : { servers: [] } } },
    }
    await session.run({ input: [{ type: 'text', text: '你好' }], history: [], instructions: [], options: {} }, run)
    assert.deepEqual(requests.filter(path => path.startsWith('/api/ekko/mcp')), [])
    assert.doesNotMatch(calls[0], /## MCP 连接状态/)
    await session.dispose?.()
  } finally {
    await cleanup()
  }
})
