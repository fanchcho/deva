import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDevamcpServer, deleteDevamcpServer, ensureDevamcpStore, getDevamcpServer,
  listDevamcpServers, resolveDevamcpServers, setDevamcpServerEnabled, updateDevamcpServer,
  isServerName, MAX_SELECTED_SERVERS, mcpFilePath,
} from '../lib/mcp-store.mjs'
import { maskMcpConfig, SECRET_MASK } from '../lib/mcp-secrets.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()
process.env.DEVA_BACKUP_ROOT = join(tmpdir(), `deva-mcp-backup-${process.pid}`)

const configFor = dir => ({ sharedDevaHome: join(dir, '.deva') })
const configPath = dir => join(dir, '.deva', 'config.json')
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

test('MCP 服务落桌面 mcp.json + config.json.mcp.enabled，不再建 deva-agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-desktop-'))
  const config = configFor(dir)
  try {
    assert.deepEqual(listDevamcpServers(config), [])
    const created = createDevamcpServer(config, { name: 'files', config: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 's3cret' } } })
    assert.deepEqual(created, { name: 'files', transport: 'stdio', managed: false, enabled: true })
    assert.deepEqual((await readdir(join(dir, '.deva'))).sort(), ['config.json', 'mcp.json'])
    assert.equal(mcpFilePath(config), join(dir, '.deva', 'mcp.json'))
    const mcp = await readJson(join(dir, '.deva', 'mcp.json'))
    assert.deepEqual(mcp.mcpServers.files, { name: 'files', description: '', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 's3cret' } })
    const cfg = await readJson(configPath(dir))
    assert.equal(cfg.mcp.enabled.files, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('密钥只以掩码下发；更新掩码保留、null 清除、新值替换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-secret-'))
  const config = configFor(dir)
  try {
    createDevamcpServer(config, { name: 's', config: { type: 'stdio', command: 'x', env: { A: 'one', B: 'two' } } })
    const detail = getDevamcpServer(config, 's')
    assert.deepEqual(maskMcpConfig(detail.config).env, { A: SECRET_MASK, B: SECRET_MASK })
    updateDevamcpServer(config, { name: 's', config: { type: 'stdio', command: 'x', env: { A: SECRET_MASK, B: null, C: 'three' } } })
    const mcp = await readJson(join(dir, '.deva', 'mcp.json'))
    assert.deepEqual(mcp.mcpServers.s.env, { A: 'one', C: 'three' })
    assert.throws(
      () => updateDevamcpServer(config, { name: 's', config: { type: 'stdio', command: 'x', env: { Z: SECRET_MASK } } }),
      /掩码没有对应的已存密钥/,
    )
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('启停、删除与名称校验；上限 32', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-crud-'))
  const config = configFor(dir)
  try {
    createDevamcpServer(config, { name: 'a', config: { type: 'http', url: 'https://example.com/mcp' } })
    assert.equal(setDevamcpServerEnabled(config, { name: 'a', enabled: false }).enabled, false)
    assert.deepEqual(listDevamcpServers(config).map(server => [server.name, server.enabled]), [['a', false]])
    assert.deepEqual(resolveDevamcpServers({ config }).servers, [])
    setDevamcpServerEnabled(config, { name: 'a', enabled: true })
    assert.equal(resolveDevamcpServers({ config }).servers.length, 1)
    deleteDevamcpServer(config, { name: 'a' })
    assert.deepEqual(listDevamcpServers(config), [])
    assert.throws(() => deleteDevamcpServer(config, { name: 'a' }), /not found/)
    assert.throws(() => createDevamcpServer(config, { name: '_bad', config: { type: 'stdio', command: 'x' } }), /服务名/)
    assert.throws(() => createDevamcpServer(config, { name: 'b', config: { type: 'stdio' } }), /缺少 command/)
    assert.equal(isServerName('ok.name-1'), true)
    assert.equal(isServerName('..'), false)
    for (let i = 0; i < MAX_SELECTED_SERVERS; i++) createDevamcpServer(config, { name: `s${i}`, config: { type: 'stdio', command: 'x' } })
    assert.throws(() => createDevamcpServer(config, { name: 'overflow', config: { type: 'stdio', command: 'x' } }), /最多/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('旧 deva-agent/mcp-servers.json 迁移到桌面 mcp.json + config.mcp.enabled，备份在 .deva 外', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-migrate-'))
  const config = configFor(dir)
  const backupRoot = join(dir, 'backups')
  process.env.DEVA_BACKUP_ROOT = backupRoot
  try {
    await mkdir(join(dir, '.deva', 'deva-agent'), { recursive: true })
    await writeFile(join(dir, '.deva', 'deva-agent', 'mcp-servers.json'), JSON.stringify({ version: 1, servers: { old: { type: 'stdio', command: 'x', env: { K: 'v' }, enabled: false } } }), 'utf8')
    const result = await ensureDevamcpStore(config)
    assert.equal(result.migrated, true)
    assert.deepEqual(listDevamcpServers(config).map(server => [server.name, server.enabled]), [['old', false]])
    const mcp = await readJson(join(dir, '.deva', 'mcp.json'))
    assert.equal(mcp.mcpServers.old.command, 'x')
    assert.equal((await readJson(configPath(dir))).mcp.enabled.old, false)
    assert.deepEqual((await readdir(join(dir, '.deva'))).sort(), ['config.json', 'mcp.json'])
    const backups = await readdir(backupRoot)
    assert.equal(backups.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('坏 mcp.json 明确报错；resolve 对坏条目报 problems', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-bad-'))
  const config = configFor(dir)
  try {
    await mkdir(join(dir, '.deva'), { recursive: true })
    await writeFile(join(dir, '.deva', 'mcp.json'), '{ not json', 'utf8')
    assert.throws(() => listDevamcpServers(config), /不是合法 JSON/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
