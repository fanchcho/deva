import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertContracts } from '../sdk/harness/contracts.mjs'
import { checkProject } from '../sdk/harness/project.mjs'
import { apply } from '../server.mjs'

const root = new URL('../', import.meta.url)
const readJson = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'))

function memoryStorage(records = new Map(), prefix = 'root') {
  return {
    namespace: (...parts) => memoryStorage(records, `${prefix}/${parts.join('/')}`),
    get: async key => records.get(`${prefix}#${key}`),
    set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
    async delete(key) { records.delete(`${prefix}#${key}`) },
    keys: async () => [...records.keys()],
  }
}

function setup() {
  const rpcs = new Map()
  const commands = new Map()
  const agents = []
  const disposers = []
  const records = new Map()
  const state = { plugin: memoryStorage(records, 'plugin'), user: memoryStorage(records, 'user'), profile: memoryStorage(records, 'profile') }
  /**
   * 伪造 Studio 的 MCP 服务表：实现 GET/POST/PATCH/DELETE/test 五条接口，
   * 其它路径报未实现，避免测试里静默通过。校验规则与 Studio 一致（服务名、仅 stdio/streamable_http）。
   */
  const requests = []
  const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
  const normalize = config => {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('MCP server config must be an object.')
    if (config.command && (!config.url || config.type === 'stdio')) return { type: 'stdio', command: config.command, args: config.args || [], env: config.env || {}, enabled: config.enabled !== false }
    if (!config.url) throw new Error('MCP server command or url is required.')
    if (!/^https?:\/\//.test(config.url)) throw new Error('MCP server url must use http or https.')
    return { type: 'streamable_http', url: config.url, headers: config.headers || {}, enabled: config.enabled !== false }
  }
  const studio = {
    servers: [
      { name: 'files', managed: false, config: { type: 'stdio', command: 'files-mcp', args: [], env: {}, enabled: true } },
      { name: 'ekko-studio-api', managed: true, config: { type: 'stdio', command: '/app/bin/ekko-studio-mcp.mjs', args: [], env: { HERMES_WEB_UI_MANAGED_MCP: '1' }, enabled: true } },
      { name: 'off', managed: false, config: { type: 'http', url: 'http://127.0.0.1:9/mcp', enabled: false } },
    ],
  }
  const host = {
    async request(path, options = {}) {
      requests.push([path, options])
      const method = options.method || 'GET'
      if (path === '/api/ekko/mcp/servers' && method === 'GET') return { ok: true, servers: studio.servers }
      if (path === '/api/ekko/mcp/servers' && method === 'POST') {
        if (!NAME.test(String(options.body?.name || ''))) throw new Error('MCP server names may contain letters, numbers, dots, underscores, and hyphens (maximum 64 characters).')
        if (studio.servers.some(server => server.name === options.body.name)) throw new Error(`MCP server already exists: ${options.body.name}.`)
        const config = normalize(options.body.config)
        const server = { name: options.body.name, managed: false, config }
        studio.servers.push(server)
        return { ok: true, server }
      }
      const match = /^\/api\/ekko\/mcp\/servers\/([^/]+)(\/test)?$/.exec(path)
      if (match) {
        const name = decodeURIComponent(match[1])
        const index = studio.servers.findIndex(server => server.name === name)
        if (index < 0) throw new Error(`MCP server not found: ${name}.`)
        if (match[2] === '/test' && method === 'POST') {
          if (studio.servers[index].config.enabled === false) throw new Error('Enable the MCP server before testing it.')
          return { ok: true, tools: [{ name: `${name}__ping`, description: '' }] }
        }
        if (method === 'DELETE') {
          studio.servers.splice(index, 1)
          return { ok: true }
        }
        if (method === 'PATCH') {
          const body = options.body || {}
          const config = typeof body.enabled === 'boolean'
            ? { ...studio.servers[index].config, enabled: body.enabled }
            : normalize(body.config)
          studio.servers[index] = { ...studio.servers[index], config }
          return { ok: true, server: studio.servers[index] }
        }
      }
      throw new Error(`unexpected host request ${method} ${path}`)
    },
  }
  const ctx = {
    log: { info() {}, warn() {}, error() {} },
    state,
    extensions: {
      rpc: { register(name, handler) { rpcs.set(name, handler); return () => rpcs.delete(name) } },
      commands: { register(command) { commands.set(command.name, command); return () => commands.delete(command.name) } },
      agents: { register(definition) { agents.push(definition); return { id: `plugin:deva/${definition.id}`, dispose: async () => { disposers.push('agent') } } } },
    },
    lifecycle: { add(dispose) { disposers.push(dispose); return dispose }, acquire: async () => () => {} },
  }
  const dispose = apply(ctx)
  const call = (name, input, identity = { userId: 1, profile: 'default' }) => rpcs.get(name)(input, { identity, state, host })
  return { rpcs, commands, agents, disposers, call, dispose, requests, studio }
}

test('project harness passes: versions, i18n, contracts, docs and SDK files', async () => {
  await checkProject(new URL('../', import.meta.url).pathname)
})

test('plugin manifest registers one Agent, two agent-settings views, and no plugin config schema', async () => {
  const manifest = await readJson('plugin.json')
  assert.equal(manifest.id, 'deva')
  assert.equal(manifest.apiVersion, 1)
  assert.equal(manifest.server, 'server.mjs')
  assert.equal(manifest.client, 'client.mjs')
  assert.deepEqual(manifest.permissions, ['agents', 'ui', 'commands', 'browser.cdp', 'api.read', 'api.write'])
  assert.deepEqual(manifest.views.map(view => [view.id, view.slot, view.icon]), [
    ['identity', 'agent-settings', 'bot'],
    ['mcp', 'agent-settings', 'mcp'],
  ])
  assert.equal(manifest.configSchema, undefined, '插件不再有 mcpServers 配置：MCP 服务只有 Studio 一份')
  assert.equal(manifest.icon, 'icon.png')
  assert.equal(manifest.navigation, undefined)
  const pkg = await readJson('package.json')
  assert.equal(manifest.version, pkg.version)
})

test('bundled icon is Deva 的图标：PNG、且不超过宿主 256KB 上限', async () => {
  const bytes = await readFile(new URL('icon.png', root))
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'icon.png 必须是 PNG')
  assert.ok(bytes.length < 256 * 1024, `icon.png 超过 256KB：${bytes.length}`)
  // 仓库根 = 插件目录的上两级；不在仓库里（单独 clone 插件）时跳过一致性核对。
  const source = await readFile(new URL('../../../apps/desktop/build/icon.png', import.meta.url)).catch(() => null)
  if (source) assert.equal(bytes.equals(source), true, '插件图标必须与 apps/desktop/build/icon.png 一致')
})

test('contracts declare the identity and Studio MCP RPCs, the identity command and the namespaced storage', async () => {
  const contract = assertContracts(await readJson('contracts/plugin.json'))
  assert.deepEqual(Object.keys(contract.rpc).sort(), [
    'create-mcp-server', 'delete-mcp-server', 'get-identities', 'get-mcp-server', 'get-mcp-servers',
    'save-mcp-selection', 'save-selection', 'set-mcp-server-enabled', 'test-mcp-server', 'update-mcp-server',
  ])
  assert.deepEqual(Object.keys(contract.commands), ['identity'])
  assert.deepEqual(Object.keys(contract.storage).sort(), ['identity', 'mcp'])
  assert.equal(contract.storage.identity.version, 1)
  assert.equal(contract.storage.mcp.version, 1)
  assert.match(contract.storage.mcp.scope, /namespace/)
  assert.deepEqual(Object.keys(contract.tools), [])
})

test('apply registers the Agent, all ten RPCs and the identity command, and disposes on unload', async () => {
  const { rpcs, commands, agents, disposers, dispose } = setup()
  assert.deepEqual([...rpcs.keys()].sort(), [
    'create-mcp-server', 'delete-mcp-server', 'get-identities', 'get-mcp-server', 'get-mcp-servers',
    'save-mcp-selection', 'save-selection', 'set-mcp-server-enabled', 'test-mcp-server', 'update-mcp-server',
  ])
  assert.deepEqual([...commands.keys()], ['identity'])
  assert.match(commands.get('identity').description, /会话/)
  assert.deepEqual(agents.map(agent => agent.id), ['deva'])
  assert.deepEqual(agents.map(agent => agent.name), ['Deva'])
  assert.equal(typeof dispose, 'function')
  assert.ok(disposers.length >= 1)
  await dispose()
  assert.deepEqual(disposers.filter(item => item === 'agent').length, 1)
})

test('the command switches the session identity and reports its source', async () => {
  const { commands } = setup()
  const state = { plugin: memoryStorage(new Map(), 'plugin'), user: memoryStorage(new Map(), 'user'), profile: memoryStorage(new Map(), 'profile'), session: memoryStorage(new Map(), 'session') }
  const run = { identity: { userId: 1, profile: 'default', sessionId: 's1' }, state, messages: { notify() {} } }
  const first = await commands.get('identity').execute('', run)
  assert.deepEqual([first.current, first.source], ['deva', 'profile'])
  const next = await commands.get('identity').execute('xiaomajiang', run)
  assert.deepEqual([next.current, next.source], ['xiaomajiang', 'session'])
  await assert.rejects(commands.get('identity').execute('ghost', run), /未知身份/)
})

test('RPCs read and persist the identity selection with contract validation', async () => {
  const { call } = setup()
  const before = await call('get-identities', null)
  assert.deepEqual(before.identities.map(item => item.id), ['deva', 'xiaomajiang'])
  assert.equal(before.selected, 'deva')
  const saved = await call('save-selection', { identity: 'xiaomajiang' })
  assert.deepEqual(saved, { ok: true, selected: 'xiaomajiang' })
  assert.equal((await call('get-identities', null)).selected, 'xiaomajiang')
  assert.equal((await call('get-identities', null, { userId: 2, profile: 'default' })).selected, 'deva')
  await assert.rejects(call('save-selection', { identity: 'ghost' }), /未知身份/)
  await assert.rejects(call('save-selection', {}), /missing identity/)
  await assert.rejects(call('get-identities', { nope: true }), /expected null/)
})

test('get-mcp-servers lists Studio servers through the host channel without leaking config', async () => {
  const { call, requests, studio } = setup()
  const snapshot = await call('get-mcp-servers', null)
  assert.deepEqual(requests.map(([path]) => path), ['/api/ekko/mcp/servers'])
  assert.deepEqual(snapshot.servers.map(server => [server.name, server.transport, server.managed, server.enabled]), [
    ['files', 'stdio', false, true],
    ['ekko-studio-api', 'stdio', true, true],
    ['off', 'http', false, false],
  ])
  assert.deepEqual(snapshot.selected, [])
  for (const server of snapshot.servers) {
    assert.deepEqual(Object.keys(server).sort(), ['enabled', 'managed', 'name', 'transport'], '页面拿不到连接配置或密钥')
  }
  // Studio 里新配置的服务下一轮就能读到，不需要改插件配置
  studio.servers.push({ name: 'later', managed: false, config: { type: 'http', url: 'http://127.0.0.1:9/mcp', enabled: true } })
  assert.ok((await call('get-mcp-servers', null)).servers.some(server => server.name === 'later'))
})

test('get-mcp-servers surfaces a missing host channel instead of returning an empty list', async () => {
  const { rpcs } = setup()
  const handler = rpcs.get('get-mcp-servers')
  await assert.rejects(handler(null, { identity: { userId: 1, profile: 'default' }, state: undefined }), /宿主通道/)
})

test('save-mcp-selection persists names per user and profile and validates input', async () => {
  const { call } = setup()
  const saved = await call('save-mcp-selection', { servers: ['files', 'files', 'ekko-studio-api'] })
  assert.deepEqual(saved, { ok: true, selected: ['files', 'ekko-studio-api'] })
  assert.deepEqual((await call('get-mcp-servers', null)).selected, ['files', 'ekko-studio-api'])
  assert.deepEqual((await call('get-mcp-servers', null, { userId: 2, profile: 'default' })).selected, [])
  assert.deepEqual((await call('save-mcp-selection', { servers: [] })).selected, [])
  await assert.rejects(call('save-mcp-selection', { servers: ['bad name'] }), /服务名/)
  await assert.rejects(call('save-mcp-selection', { servers: 'files' }), /expected array|servers 必须是/)
  await assert.rejects(call('save-mcp-selection', { servers: Array.from({ length: 33 }, (_, i) => `s${i}`) }), /最多选择|too many items/)
})

test('MCP server CRUD RPCs write to Studio and never return connection config', async () => {
  const { call, requests } = setup()
  const created = await call('create-mcp-server', {
    name: 'private.tools',
    config: { type: 'stdio', command: 'private-mcp', args: ['--port', '0'], env: { TOKEN: '${MCP_TOKEN}' }, enabled: true },
  })
  assert.deepEqual(created, { ok: true, server: { name: 'private.tools', transport: 'stdio', managed: false, enabled: true } })
  assert.deepEqual(requests.at(-1), ['/api/ekko/mcp/servers', { method: 'POST', body: {
    name: 'private.tools',
    config: { type: 'stdio', command: 'private-mcp', args: ['--port', '0'], env: { TOKEN: '${MCP_TOKEN}' }, enabled: true },
  } }])
  assert.ok((await call('get-mcp-servers', null)).servers.some(server => server.name === 'private.tools'), '新服务立刻出现在勾选清单里')

  const detail = await call('get-mcp-server', { name: 'private.tools' })
  assert.deepEqual(detail.server, created.server)
  assert.equal(detail.config.command, 'private-mcp')
  assert.deepEqual(detail.config.env, { TOKEN: '${MCP_TOKEN}' }, '只有单条详情接口下发配置')

  const updated = await call('update-mcp-server', { name: 'private.tools', config: { type: 'streamable_http', url: 'https://example.com/mcp', enabled: true } })
  assert.deepEqual(updated.server, { name: 'private.tools', transport: 'http', managed: false, enabled: true })
  const tested = await call('test-mcp-server', { name: 'private.tools' })
  assert.deepEqual(tested, { ok: true, tools: [{ name: 'private.tools__ping', description: '' }] })

  const off = await call('set-mcp-server-enabled', { name: 'private.tools', enabled: false })
  assert.equal(off.server.enabled, false)
  // 停用的服务 Studio 拒绝测试：这个错误要原样回到页面
  await assert.rejects(call('test-mcp-server', { name: 'private.tools' }), /Enable the MCP server before testing it/)
  const removed = await call('delete-mcp-server', { name: 'private.tools' })
  assert.deepEqual(removed, { ok: true, name: 'private.tools' })
  assert.ok(!(await call('get-mcp-servers', null)).servers.some(server => server.name === 'private.tools'))
})

test('get-mcp-server accepts Studio-normalized configs that omit type', async () => {
  const { call, studio } = setup()
  // Studio 的规范化对 stdio 只回 command/args/env（不带 type），契约不能要求 type 必填
  studio.servers[0].config = { command: 'files-mcp', args: [], env: {}, enabled: true }
  const detail = await call('get-mcp-server', { name: 'files' })
  assert.equal(detail.server.transport, 'stdio')
  assert.equal(detail.config.command, 'files-mcp')
  assert.equal(detail.config.type, undefined)
})

test('MCP CRUD RPCs surface Studio errors instead of pretending success', async () => {
  const { call } = setup()
  await assert.rejects(call('create-mcp-server', { name: 'files', config: { type: 'stdio', command: 'x' } }), /already exists/)
  await assert.rejects(call('create-mcp-server', { name: '_bad', config: { type: 'stdio', command: 'x' } }), /服务名/)
  await assert.rejects(call('update-mcp-server', { name: 'ghost', config: { type: 'stdio', command: 'x' } }), /not found/)
  await assert.rejects(call('get-mcp-server', { name: 'ghost' }), /已不存在/)
  await assert.rejects(call('delete-mcp-server', { name: 'ghost' }), /not found/)
  await assert.rejects(call('test-mcp-server', { name: 'off' }), /Enable the MCP server before testing it/)
  await assert.rejects(call('set-mcp-server-enabled', { name: 'files', enabled: 'yes' }), /expected boolean/)
  await assert.rejects(call('create-mcp-server', { name: 'files2', config: [] }), /expected object/)
})

test('deleting a selected server keeps the selection and reports it at run time', async () => {
  const { call } = setup()
  await call('save-mcp-selection', { servers: ['files'] })
  await call('delete-mcp-server', { name: 'files' })
  // 勾选不动：运行时会让它出现在「MCP 连接状态」里，由用户决定是否重新勾选
  assert.deepEqual((await call('get-mcp-servers', null)).selected, ['files'])
})
