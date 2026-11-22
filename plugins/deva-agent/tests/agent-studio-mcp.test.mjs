import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentDefinition } from '../lib/agent.mjs'

/** 最小 MCP stdio 服务器：启动时往 START_LOG 记一行，用来数「连了几次」。 */
const STDIO_SERVER = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
appendFileSync(process.env.START_LOG, 'start\\n')
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } })
  else if (message.method === 'notifications/initialized') { /* 通知不需要回复 */ }
  else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }] } })
  else if (message.method === 'tools/call') send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok' }] } })
  else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } })
})
`

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

test('MCP connections are reused across turns and rebuilt when the Studio config changes', async () => {
  const { dir, cleanup } = await workspace()
  const serverFile = join(dir, 'server.mjs')
  const startsFile = join(dir, 'starts.log')
  await writeFile(serverFile, STDIO_SERVER)
  const starts = async () => (await readFile(startsFile, 'utf8')).trim().split('\n').filter(Boolean).length
  try {
    let token = 'v1'
    const state = memoryState()
    await state.profile.namespace('1').set('mcp', { servers: ['fake'] })
    const host = {
      async request(path) {
        if (path === '/api/ekko/mcp/servers') {
          return {
            servers: [{
              name: 'fake', transport: 'stdio', enabled: true,
              config: { command: process.execPath, args: [serverFile], env: { START_LOG: startsFile, TOKEN: token } },
            }],
          }
        }
        return { skills: [] }
      },
    }
    const turns = []
    const runTurn = async ({ extraTools, execute }) => {
      turns.push(extraTools.map(tool => tool.name))
      if (extraTools.length) assert.equal(await execute('mcp__fake__echo', {}), 'ok')
      return { finishReason: 'stop', content: [] }
    }
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    const runFor = runId => ({
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state,
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host,
    })
    const input = text => ({ input: [{ type: 'text', text }], history: [], instructions: [], options: {} })

    await session.run(input('一'), runFor('r1'))
    await session.run(input('二'), runFor('r2'))
    assert.deepEqual(turns, [['mcp__fake__echo'], ['mcp__fake__echo']])
    assert.equal(await starts(), 1, '同一配置的第二轮不应重连')

    // 宿主注入的凭证变了：指纹变化，必须重建连接，不能拿旧凭证继续用
    token = 'v2'
    await session.run(input('三'), runFor('r3'))
    assert.equal(await starts(), 2)
    await session.dispose()
  } finally {
    await cleanup()
  }
})

test('skill listings are cached per session and refreshed after skill_manage', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const requests = []
    const host = {
      async request(path, options = {}) {
        requests.push(`${options.method || 'GET'} ${path}`)
        if (path === '/api/ekko/skills' && !options.method) {
          return { skills: [{ name: 'demo', description: '演示技能', enabled: true }] }
        }
        return {}
      },
    }
    let manage = false
    const systems = []
    const runTurn = async ({ system, execute }) => {
      systems.push(system)
      // 只在本轮执行一次 skill_manage：走真实工具实现与成功回调，验证缓存失效
      if (manage) await execute('skill_manage', { action: 'toggle', name: 'demo', enabled: false }, { host })
      return { finishReason: 'stop', content: [] }
    }
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    const state = memoryState()
    const runFor = runId => ({
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state,
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host,
    })
    const input = text => ({ input: [{ type: 'text', text }], history: [], instructions: [], options: {} })
    const listCalls = () => requests.filter(item => item === 'GET /api/ekko/skills').length

    await session.run(input('一'), runFor('r1'))
    await session.run(input('二'), runFor('r2'))
    assert.equal(listCalls(), 1, '同一会话的第二轮应复用技能清单')
    assert.match(systems[0], /演示技能/)

    manage = true
    await session.run(input('三'), runFor('r3'))
    assert.equal(listCalls(), 1, '本轮开始时清单尚未失效')
    await session.run(input('四'), runFor('r4'))
    assert.equal(listCalls(), 2, 'skill_manage 成功后下一轮要重新读取')
    await session.dispose()
  } finally {
    await cleanup()
  }
})
