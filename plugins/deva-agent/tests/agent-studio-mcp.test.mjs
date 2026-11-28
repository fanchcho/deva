import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentDefinition } from '../lib/agent.mjs'

import { isolatedDevaHome } from './support/deva-home.mjs'

// 这些用例跑真实 Agent：身份文件要落在临时根，不能写进真实 ~/.deva。
isolatedDevaHome()

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

test('invalid Studio catalog MCP configuration is reported in the system prompt', async () => {
  const { dir, cleanup } = await workspace()
  const { calls, runTurn } = fakeRunTurn()
  const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { workspaceDir: dir } })
  try {
    await session.run({ input: [], history: [], instructions: [] }, {
      mode: 'scoped', model: { baseUrl: 'http://127.0.0.1:1', token: 'test', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir }, state: memoryState(),
      identity: { userId: 1, profile: 'default' }, signal: new AbortController().signal,
      host: { request: async path => path === '/api/ekko/skills' ? { skills: [] } : { ok: true, servers: [{ name: 'broken', config: { type: 'stdio' } }, { name: 'unknown', config: { type: 'carrier-pigeon' } }] } },
    })
    assert.equal(calls.length, 1)
    assert.match(calls[0], /broken: stdio 缺少 command/)
    assert.match(calls[0], /unknown: 未知传输类型 carrier-pigeon/)
  } finally {
    await session.dispose()
    await cleanup()
  }
})

test('Studio MCP 连不上时写进 MCP 状态段，不中断对话', async () => {
  const { dir, cleanup } = await workspace()
  const config = { sharedDevaHome: join(dir, '.deva') }
  try {
    const { calls, runTurn } = fakeRunTurn()
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    // Studio MCP：指向不可达端口，运行时要如实点名
    const catalog = [{ name: 'bad', config: { type: 'http', url: 'http://127.0.0.1:1' } }]
    const run = {
      mode: 'scoped',
      config,
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: memoryState(),
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host: { async request(path) { return path === '/api/ekko/mcp/servers' ? { ok: true, servers: catalog } : { skills: [] } } },
    }
    await session.run({ input: [{ type: 'text', text: '你好' }], history: [], instructions: [], options: {} }, run)
    assert.equal(calls.length, 1)
    assert.match(calls[0], /## MCP 连接状态/)
    assert.match(calls[0], /bad/)
    await session.dispose?.()
  } finally {
    await cleanup()
  }
})

test('Studio 和桌面 MCP 均为空时不产生 MCP 状态噪声', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { calls, runTurn } = fakeRunTurn()
    const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
    const session = await definition.runtime.createSession({ identity: { userId: 1, profile: 'default', sessionId: 's1' }, paths: { workspaceDir: dir } })
    const requests = []
    const run = {
      mode: 'scoped',
      config: { sharedDevaHome: join(dir, '.deva') },
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: memoryState(),
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host: { async request(path) { requests.push(path); return path === '/api/ekko/skills' ? { skills: [] } : { ok: true, servers: [] } } },
    }
    await session.run({ input: [{ type: 'text', text: '你好' }], history: [], instructions: [], options: {} }, run)
    assert.deepEqual(requests.filter(path => path.startsWith('/api/ekko/mcp')), ['/api/ekko/mcp/servers'])
    assert.doesNotMatch(calls[0], /## MCP 连接状态/)
    await session.dispose?.()
  } finally {
    await cleanup()
  }
})

test('Studio MCP 连接跨轮复用；配置变更后重建连接', async () => {
  const { dir, cleanup } = await workspace()
  const serverFile = join(dir, 'server.mjs')
  const startsFile = join(dir, 'starts.log')
  await writeFile(serverFile, STDIO_SERVER)
  const starts = async () => (await readFile(startsFile, 'utf8')).trim().split('\n').filter(Boolean).length
  try {
    const config = { sharedDevaHome: join(dir, '.deva') }
    const catalog = [{
      name: 'fake',
      config: { type: 'stdio', command: process.execPath, args: [serverFile], env: { START_LOG: startsFile, TOKEN: 'v1' } },
    }]
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
      config,
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: memoryState(),
      signal: new AbortController().signal,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      mcpServers: {},
      host: { async request(path) { return path === '/api/ekko/mcp/servers' ? { ok: true, servers: catalog } : { skills: [] } } },
    })
    const input = text => ({ input: [{ type: 'text', text }], history: [], instructions: [], options: {} })

    await session.run(input('一'), runFor('r1'))
    await session.run(input('二'), runFor('r2'))
    assert.deepEqual(turns, [['mcp__fake__echo'], ['mcp__fake__echo']])
    assert.equal(await starts(), 1, '同一配置的第二轮不应重连')

    // 宿主清单里的配置变了：指纹变化，必须重建连接
    catalog[0].config.env.TOKEN = 'v2'
    await session.run(input('三'), runFor('r3'))
    assert.equal(await starts(), 2)
    await session.dispose()
  } finally {
    await cleanup()
  }
})

test('skill listings survive fresh per-turn host wrappers and refresh after skill_manage', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const requests = []
    let enabled = true
    const host = {
      async request(path, options = {}) {
        requests.push(`${options.method || 'GET'} ${path}`)
        if (path === '/api/ekko/skills' && !options.method) {
          return { skills: [{ name: 'demo', description: '演示技能', enabled }] }
        }
        return { ok: true }
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
      host: { request: (...args) => host.request(...args) },
    })
    const input = text => ({ input: [{ type: 'text', text }], history: [], instructions: [], options: {} })
    const listCalls = () => requests.filter(item => item === 'GET /api/ekko/skills').length

    await session.run(input('一'), runFor('r1'))
    enabled = false // 模拟 Studio 原生页面在两轮之间停用
    await session.run(input('二'), runFor('r2'))
    assert.equal(listCalls(), 2, '每轮应重新获取 Studio 技能清单')
    assert.match(systems[0], /演示技能/)
    assert.doesNotMatch(systems[1], /演示技能/, '外部停用下一轮立刻从提示词消失')

    manage = true
    await session.run(input('三'), runFor('r3'))
    assert.equal(listCalls(), 3, '本轮开始时也要获取最新清单')
    await session.run(input('四'), runFor('r4'))
    assert.equal(listCalls(), 4, 'skill_manage 成功后下一轮要重新读取')
    await session.dispose()
  } finally {
    await cleanup()
  }
})

test('failed skill listing retries next turn and refreshes the recovered listing', async () => {
  const { dir, cleanup } = await workspace()
  const { calls, runTurn } = fakeRunTurn()
  const definition = createAgentDefinition({ runTurn, log: { info() {}, warn() {} } })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { workspaceDir: dir } })
  let requests = 0
  const state = memoryState()
  try {
    const run = () => ({
      mode: 'scoped', model: { baseUrl: 'http://127.0.0.1:1', token: 'test', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir }, state,
      identity: { userId: 1, profile: 'default' }, signal: new AbortController().signal,
      host: { async request(path) {
        if (path === '/api/ekko/mcp/servers') return { ok: true, servers: [] }
        assert.equal(path, '/api/ekko/skills')
        requests++
        if (requests === 1) throw new Error('temporary unavailable')
        return { skills: [{ name: 'recovered', description: '恢复后的技能', enabled: true }] }
      } },
    })
    for (let i = 0; i < 3; i++) await session.run({ input: [], history: [], instructions: [] }, run())
    assert.match(calls[0], /技能清单本轮读取失败/)
    assert.match(calls[1], /恢复后的技能/)
    assert.doesNotMatch(calls[1], /技能清单本轮读取失败/)
    assert.match(calls[2], /恢复后的技能/)
    assert.equal(requests, 3, '失败下一轮重试，恢复后仍每轮读取最新清单')
  } finally {
    await session.dispose()
    await cleanup()
  }
})

test('session lifecycle releases the agent and repeated disposal is safe', async () => {
  const { dir, cleanup } = await workspace()
  const releases = []
  const definition = createAgentDefinition({ log: { info() {}, warn() {} } })
  try {
    const session = await definition.runtime.createSession({
      identity: { sessionId: 'lifecycle' }, paths: { workspaceDir: dir },
      lifecycle: { add(dispose) { releases.push(dispose) } },
    })
    assert.equal(releases.length, 1)
    await releases[0]()
    await session.dispose()
    await assert.rejects(session.run({}, {}), /已释放/)
  } finally { await cleanup() }
})

test('runtime ignores desktop and injected duplicates, honors empty selection and host disable', async () => {
  const { dir, cleanup } = await workspace()
  const { mkdir } = await import('node:fs/promises')
  const home = join(dir, '.deva')
  await mkdir(home)
  const raw = JSON.stringify({ mcpServers: { same: { command: 'never-launch-desktop', env: { K: { secretRef: 'keep' } } } } })
  await writeFile(join(home, 'mcp.json'), raw)
  await writeFile(join(home, 'config.json'), JSON.stringify({ mcp: { enabled: { same: true } } }))
  const state = memoryState(), systems = []
  const definition = createAgentDefinition({ runTurn: async ({ system, extraTools = [] }) => { systems.push(system); assert.deepEqual(extraTools, []); return { finishReason: 'stop', content: [] } }, log: { info() {}, warn() {} } })
  const session = await definition.runtime.createSession({ identity: { sessionId: 'single' }, paths: { workspaceDir: dir } })
  let enabled = false
  const run = { config: { sharedDevaHome: home }, mode: 'scoped', model: { baseUrl: 'http://127.0.0.1:1', token: 'test', model: 'test' }, state,
    paths: { workspaceDir: dir, runtimeDir: dir }, identity: { userId: 1, profile: 'default' }, signal: new AbortController().signal,
    mcpServers: { same: { command: 'never-launch-injected' } },
    host: { request: async path => path.endsWith('/skills') ? { skills: [] } : { ok: true, servers: [{ name: 'same', config: { command: 'never-launch-host', enabled } }] } },
  }
  try {
    await session.run({ input: [], history: [], instructions: [] }, run)
    enabled = true
    await state.profile.namespace('1').set('mcp', { servers: [] })
    await session.run({ input: [], history: [], instructions: [] }, run)
    assert.ok(systems.every(system => !system.includes('## MCP 连接状态')))
    assert.equal(await readFile(join(home, 'mcp.json'), 'utf8'), raw)
  } finally { await session.dispose(); await cleanup() }
})
