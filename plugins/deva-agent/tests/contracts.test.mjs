import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertContracts } from '../sdk/harness/contracts.mjs'
import { checkProject } from '../sdk/harness/project.mjs'
import { apply } from '../server.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

// 身份文件测试必须落在临时根，不碰真实 ~/.deva。
isolatedDevaHome()
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
  const home = mkdtempSync(join(tmpdir(), 'deva-contract-'))
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
      if (path === '/api/studio/sessions' && method === 'POST') return { session: { id: 'qa-session', agent: options.body?.agent } }
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
    identity: { userId: 1, profile: 'default' },
    log: { info() {}, warn() {}, error() {} },
    state,
    config: { sharedDevaHome: home },
    extensions: {
      rpc: { register(name, handler) { rpcs.set(name, handler); return () => rpcs.delete(name) } },
      commands: { register(command) { commands.set(command.name, command); return () => commands.delete(command.name) } },
      agents: { register(definition) { agents.push(definition); return { id: `plugin:deva/${definition.id}`, dispose: async () => { disposers.push('agent') } } } },
    },
    lifecycle: { add(dispose) { disposers.push(dispose); return dispose }, acquire: async () => () => {} },
  }
  const dispose = apply(ctx)
  const call = (name, input, identity = { userId: 1, profile: 'default' }) => rpcs.get(name)(input, { identity, state, host, config: { sharedDevaHome: home, sharedDevaUserId: 1 } })
  return { rpcs, commands, agents, disposers, call, dispose, requests, studio, home }
}

test('project harness passes: versions, i18n, contracts, docs and SDK files', async () => {
  await checkProject(new URL('../', import.meta.url).pathname)
})

test('registered model settings RPC round-trips the Desktop schema without exposing a key', async t => {
  const { call, home, dispose } = setup()
  t.after(async () => { await dispose(); await rm(home, { recursive: true, force: true }) })
  const path = join(home, 'config.json')
  const input = { baseUrl: 'https://example.test/v1', modelName: 'manual' }
  assert.equal((await call('get-model-selection', null)).modelRef, '')
  for (const fixture of [{}, { models: {} }, ...[null, '', 17].map(activeModelId => ({ models: { activeModelId } }))]) {
    await writeFile(path, JSON.stringify(fixture))
    assert.equal((await call('get-model-selection', null)).modelRef, '')
    const saved = await call('save-model-selection', input)
    assert.equal(saved.modelName, input.modelName)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).models.activeModelId, saved.modelRef)
    assert.deepEqual(await call('get-model-selection', null), saved)
    assert.equal((await call('save-model-selection', { baseUrl: '', modelName: '' })).modelRef, '')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).models.activeModelId, null)
  }
  await assert.rejects(call('save-model-selection', { ...input, providerId: 'alpha', modelId: 'a1' }), /unknown property providerId/)
})

test('Deva uses the native settings views without registering a main navigation shortcut', async () => {
  const manifest = await readJson('plugin.json')
  assert.equal(manifest.id, 'deva')
  assert.equal(manifest.apiVersion, 1)
  assert.equal(manifest.server, 'server.mjs')
  assert.equal(manifest.client, 'client.mjs')
  assert.deepEqual(manifest.permissions, ['agents', 'ui', 'commands', 'browser.cdp', 'api.read', 'api.write', 'compression'])
  assert.deepEqual(manifest.views.map(view => [view.id, view.slot, view.icon]), [
    ['identity', 'agent-settings', 'book'],
    ['mcp', 'agent-settings', 'mcp'],
    ['model', 'agent-settings', 'settings'],
  ])
  assert.equal(manifest.configSchema.properties.mcpServers, undefined, 'MCP 配置仍只有 Studio 一份')
  assert.equal(manifest.configSchema.properties.approvalEnabled.default, false)
  assert.equal(manifest.configSchema.properties.compressionEnabled.default, false)
  assert.equal(manifest.icon, 'icon.png')
  assert.equal(manifest.navigation, undefined)
  const translations = Object.values(manifest.i18n)
  assert.equal(translations.length, 12)
  for (const locale of translations) {
    assert.equal(locale.navigation, undefined)
    assert.deepEqual(Object.keys(locale.views).sort(), ['identity', 'mcp', 'model'])
  }
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

test('contracts declare the identity, model and Studio MCP RPCs, the identity command and the namespaced storage', async () => {
  const contract = assertContracts(await readJson('contracts/plugin.json'))
  assert.deepEqual(Object.keys(contract.rpc).sort(), [
    'clear-session-identity', 'create-mcp-server', 'create-persona', 'delete-mcp-server', 'get-identities', 'get-mcp-server', 'get-mcp-servers',
    'get-model-selection', 'get-persona-editor', 'get-session-identity', 'save-mcp-selection', 'save-model-selection', 'save-persona-model', 'save-selection', 'save-session-identity',
    'set-mcp-server-enabled', 'test-mcp-server', 'update-mcp-server', 'update-persona',
  ])
  assert.deepEqual(Object.keys(contract.commands), ['identity'])
  assert.deepEqual(Object.keys(contract.storage).sort(), ['attachments', 'checkpoint', 'customModel', 'desktopModelKey', 'identity', 'mcp', 'memory', 'modelMode', 'modelNetworkConsent', 'modelOptions', 'sharedDesktopProvider', 'sharedModelKey', 'subagents', 'todos'])
  assert.equal(contract.storage.identity.version, 1)
  assert.equal(contract.storage.mcp.version, 1)
  assert.match(contract.storage.mcp.scope, /namespace/)
  assert.deepEqual(Object.keys(contract.tools), [])
})

test('apply registers the Agent, all RPCs and the identity command, and disposes on unload', async () => {
  const { rpcs, commands, agents, disposers, dispose } = setup()
  assert.deepEqual([...rpcs.keys()].sort(), [
    'clear-session-identity', 'create-mcp-server', 'create-persona', 'delete-mcp-server', 'get-identities', 'get-mcp-server', 'get-mcp-servers',
    'get-model-selection', 'get-persona-editor', 'get-session-identity', 'save-mcp-selection', 'save-model-selection', 'save-persona-model', 'save-selection', 'save-session-identity',
    'set-mcp-server-enabled', 'test-mcp-server', 'update-mcp-server', 'update-persona',
  ])
  assert.deepEqual([...commands.keys()], ['identity'])
  assert.match(commands.get('identity').description, /会话/)
  assert.deepEqual(agents.map(agent => agent.id), ['deva'])
  assert.deepEqual(agents.map(agent => agent.name), ['Deva'])
  const settings = await agents[0].management.settings()
  assert.deepEqual(settings, { viewId: 'identity' })
  const manifest = await readJson('plugin.json')
  assert.equal(manifest.views.find(view => view.id === settings.viewId)?.slot, 'agent-settings')
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
  assert.deepEqual([first.current, first.source], ['general', 'file'])
  const next = await commands.get('identity').execute('xiaomajiang', run)
  assert.deepEqual([next.current, next.source], ['xiaomajiang', 'session'])
  await assert.rejects(commands.get('identity').execute('ghost', run), /未知身份/)
})

test('shared persona editor is limited to the configured owner or activation account', async () => {
  const { call, rpcs, home } = setup()
  const outsider = { userId: 2, profile: 'default' }
  assert.equal((await call('get-identities', null, outsider)).canEdit, false)
  await assert.rejects(call('get-persona-editor', { id: 'general' }, outsider), /Only the configured Deva owner/)
  await assert.rejects(call('create-persona', { name: 'Other', description: '', prompt: 'Other' }, outsider), /Only the configured Deva owner/)
  assert.equal((await call('get-identities', null)).canEdit, true)
  const ownerRecord = await rpcs.get('get-persona-editor')({ id: 'general' }, { identity: outsider, config: { sharedDevaHome: home, sharedDevaUserId: 2 } })
  assert.equal(ownerRecord.id, 'general')
  assert.ok(ownerRecord.prompt)
  assert.match(ownerRecord.revision, /^[0-9a-f]{64}$/)
})

test('RPCs read and persist the identity selection with contract validation', async () => {
  const { call } = setup()
  const before = await call('get-identities', null)
  assert.deepEqual(before.identities.map(item => item.id), ['general', 'xiaomajiang'])
  assert.equal(before.selected, 'general')
  assert.match(before.filePath, /config\.json$/)
  assert.match(before.personasDir, /personas$/)
  assert.equal(typeof before.created, 'boolean', 'created 只在真正新建时为 true')
  assert.equal(typeof before.migrated, 'boolean')
  assert.equal(typeof before.permissionRepaired, 'boolean')
  assert.equal(before.identities.length, 2)
  assert.match(before.identities[0].promptSha256, /^[0-9a-f]{64}$/)
  const saved = await call('save-selection', { identity: 'xiaomajiang' })
  assert.deepEqual({ ok: saved.ok, selected: saved.selected }, { ok: true, selected: 'xiaomajiang' })
  assert.equal(saved.filePath, before.filePath)
  assert.equal((await call('get-identities', null)).selected, 'xiaomajiang')
  // 身份文件是 OS 用户级的：同一进程的其它 Studio 账号读同一份文件（多账号在报告里列为限制）
  assert.equal((await call('get-identities', null, { userId: 2, profile: 'default' })).selected, 'xiaomajiang')
  assert.equal((await call('get-identities', null)).filePath, before.filePath)
  await assert.rejects(call('save-selection', { identity: 'ghost' }), /未知身份/)
  await assert.rejects(call('save-selection', {}), /missing identity/)
  await assert.rejects(call('get-identities', { nope: true }), /expected null/)
})

test('读身份不会为 persona 注册 Studio Agent：插件只暴露一个 Deva Agent', async () => {
  const { call, agents } = setup()
  await call('get-identities', null)
  assert.deepEqual(agents.map(item => item.id), ['deva'])
})

test('会话身份 RPC：读默认/写覆盖/清除，sessions.json 落盘', async () => {
  const { call } = setup()
  const sessionIdentity = { userId: 1, profile: 'default', sessionId: 's-qa' }
  const empty = await call('get-session-identity', null, { userId: 1, profile: 'default' })
  assert.deepEqual(empty, { sessionId: '', identity: '', source: 'none' })
  const before = await call('get-session-identity', null, sessionIdentity)
  assert.equal(before.sessionId, 's-qa')
  assert.equal(before.source, 'default')
  const saved = await call('save-session-identity', { identity: 'xiaomajiang' }, sessionIdentity)
  assert.deepEqual(saved, { ok: true, sessionId: 's-qa', identity: 'xiaomajiang' })
  const after = await call('get-session-identity', null, sessionIdentity)
  assert.deepEqual([after.identity, after.source], ['xiaomajiang', 'session'])
  const cleared = await call('clear-session-identity', null, sessionIdentity)
  assert.equal(cleared.identity, before.identity)
  assert.equal((await call('get-session-identity', null, sessionIdentity)).source, 'default')
  await assert.rejects(call('save-session-identity', { identity: 'ghost' }, sessionIdentity), /未知身份/)
})

test('Studio MCP catalog includes managed defaults and measured tool counts, never connection configs', async () => {
  const { call, requests, studio } = setup()
  studio.servers[1].config.env.TOKEN = 'fixture-secret'
  const view = await call('get-mcp-servers', null)
  assert.deepEqual(view.servers.map(server => [server.name, server.transport, server.managed, server.enabled, server.toolCount]), [
    ['files', 'stdio', false, true, 1], ['ekko-studio-api', 'stdio', true, true, 1], ['off', 'http', false, false, 0],
  ])
  assert.deepEqual(view.selected, ['files', 'ekko-studio-api'])
  assert.equal(JSON.stringify(view).includes('fixture-secret'), false)
  assert.deepEqual(requests.map(([path]) => path), [
    '/api/ekko/mcp/servers', '/api/ekko/mcp/servers/files/test', '/api/ekko/mcp/servers/ekko-studio-api/test',
  ])
})

test('MCP checkbox storage is separate from the Studio enabled states and persists an empty selection', async () => {
  const { call, requests } = setup()
  assert.deepEqual((await call('save-mcp-selection', { servers: ['files'] })).selected, ['files'])
  const readback = await call('get-mcp-servers', null)
  assert.deepEqual(readback.selected, ['files'])
  assert.deepEqual(readback.servers.map(server => [server.name, server.enabled]), [['files', true], ['ekko-studio-api', true], ['off', false]])
  assert.deepEqual((await call('save-mcp-selection', { servers: [] })).selected, [])
  assert.deepEqual((await call('get-mcp-servers', null)).selected, [])
  assert.equal(requests.some(([, options]) => options.method === 'PATCH'), false)
  await assert.rejects(call('save-mcp-selection', { servers: ['ghost'] }), /清单已变更/)
  await assert.rejects(call('save-mcp-selection', { servers: ['off'] }), /清单已变更/)
  await assert.rejects(call('save-mcp-selection', { servers: 'a' }), /expected array/)
})

test('MCP CRUD RPC 委托 Studio，详情密钥只回掩码', async () => {
  const { call } = setup()
  const created = await call('create-mcp-server', {
    name: 'private.tools',
    config: { type: 'stdio', command: 'private-mcp', args: ['--port', '0'], env: { TOKEN: '${MCP_TOKEN}' }, enabled: true },
  })
  assert.deepEqual(created, { ok: true, server: { name: 'private.tools', transport: 'stdio', managed: false, enabled: true } })
  const detail = await call('get-mcp-server', { name: 'private.tools' })
  assert.equal(detail.config.command, 'private-mcp')
  assert.deepEqual(detail.config.env, { TOKEN: '__EKKO_SECRET_UNCHANGED__' }, '详情接口只回掩码')
  const updated = await call('update-mcp-server', { name: 'private.tools', config: { type: 'streamable_http', url: 'https://example.com/mcp', enabled: true } })
  assert.deepEqual(updated.server, { name: 'private.tools', transport: 'http', managed: false, enabled: true })
  const off = await call('set-mcp-server-enabled', { name: 'private.tools', enabled: false })
  assert.equal(off.server.enabled, false)
  const removed = await call('delete-mcp-server', { name: 'private.tools' })
  assert.deepEqual(removed, { ok: true, name: 'private.tools' })
  assert.equal((await call('get-mcp-servers', null)).servers.some(server => server.name === 'private.tools'), false)
})

test('get-mcp-server 接受省略 type 的 stdio 配置', async () => {
  const { call } = setup()
  await call('create-mcp-server', { name: 'fixture-files', config: { command: 'files-mcp', args: [], env: {} } })
  const detail = await call('get-mcp-server', { name: 'fixture-files' })
  assert.equal(detail.server.transport, 'stdio')
  assert.equal(detail.config.command, 'files-mcp')
})

test('MCP RPC 错误如实抛出，不假装成功', async () => {
  const { call } = setup()
  await call('create-mcp-server', { name: 'fixture-files', config: { type: 'stdio', command: 'x' } })
  await assert.rejects(call('create-mcp-server', { name: 'files', config: { type: 'stdio', command: 'x' } }), /already exists/)
  await assert.rejects(call('create-mcp-server', { name: '_bad', config: { type: 'stdio', command: 'x' } }), /服务名/)
  await assert.rejects(call('update-mcp-server', { name: 'ghost', config: { type: 'stdio', command: 'x' } }), /不存在/)
  await assert.rejects(call('get-mcp-server', { name: 'ghost' }), /不存在/)
  await assert.rejects(call('delete-mcp-server', { name: 'ghost' }), /not found/)
  await assert.rejects(call('set-mcp-server-enabled', { name: 'files', enabled: 'yes' }), /expected boolean/)
  await assert.rejects(call('create-mcp-server', { name: 'files2', config: [] }), /expected object/)
})

test('MCP 密钥：读掩码、掩码保留、新值替换、null 清除', async () => {
  const { call } = setup()
  await call('create-mcp-server', { name: 'fixture-files', config: { command: 'files-mcp', env: { TOKEN: 'never-echo-this', KEEP: 'also-secret' } } })
  const detail = await call('get-mcp-server', { name: 'fixture-files' })
  assert.ok(!JSON.stringify(detail).includes('never-echo-this'))
  await call('update-mcp-server', { name: 'fixture-files', config: detail.config })
  await call('update-mcp-server', { name: 'fixture-files', config: { command: 'files-mcp', env: { TOKEN: 'replacement' } } })
  const after = await call('get-mcp-server', { name: 'fixture-files' })
  assert.deepEqual(after.config.env, { TOKEN: '__EKKO_SECRET_UNCHANGED__', KEEP: '__EKKO_SECRET_UNCHANGED__' })
  await call('update-mcp-server', { name: 'fixture-files', config: { command: 'files-mcp', env: { TOKEN: null } } })
  const cleared = await call('get-mcp-server', { name: 'fixture-files' })
  assert.deepEqual(cleared.config.env, { KEEP: '__EKKO_SECRET_UNCHANGED__' })
  assert.ok(!JSON.stringify(cleared).includes('also-secret'))
})
