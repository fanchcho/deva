import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalIdentityId, ensureIdentityState, identityFilePath, identityProblems,
  inspectIdentityFile, listIdentityCatalog, loadIdentityRecord, resolveDevaRoot, selectIdentity,
} from '../lib/deva-home.mjs'
import { composePersonaFile, parseFrontmatter } from '../lib/persona-file.mjs'
import { readDevaConfig, updatePersonasSection } from '../lib/persona-store.mjs'
import { readFileSessionIdentity, writeFileSessionIdentity, clearFileSessionIdentity } from '../lib/session-identities.mjs'
import { migrateLegacyLayout } from '../lib/deva-layout.mjs'
import { readIdentityId, resolveIdentityId, readSessionIdentityId, writeSessionIdentityId } from '../lib/selection.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()
process.env.DEVA_BACKUP_ROOT = join(tmpdir(), `deva-backup-${process.pid}`)

const configFor = dir => ({ sharedDevaHome: join(dir, '.deva') })
const configPath = dir => join(dir, '.deva', 'config.json')

test('目录解析：默认 ~/.deva，支持覆盖，拒绝相对路径与主目录', () => {
  const before = process.env.DEVA_HOME
  try {
    delete process.env.DEVA_HOME
    assert.match(resolveDevaRoot({}), /\.deva$/)
    assert.equal(resolveDevaRoot({ sharedDevaHome: '/tmp/deva-x' }), '/tmp/deva-x')
    assert.throws(() => resolveDevaRoot({ sharedDevaHome: 'relative/deva' }), /绝对路径/)
    assert.throws(() => resolveDevaRoot({ sharedDevaHome: homedir() }), /不能是根目录或用户主目录/)
  } finally { if (before === undefined) delete process.env.DEVA_HOME; else process.env.DEVA_HOME = before }
})

test('全新安装：只在桌面 config.json 写 personas.selected，不创建 deva-agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-fresh-'))
  const config = configFor(dir)
  try {
    const state = await ensureIdentityState(config)
    assert.equal(state.value.selected, 'general')
    assert.deepEqual((await readdir(join(dir, '.deva'))).sort(), ['config.json', 'personas'])
    const cfg = JSON.parse(await readFile(configPath(dir), 'utf8'))
    assert.equal(cfg.personas.selected, 'general')
    assert.deepEqual(cfg.personas.enabled, { general: true, xiaomajiang: true })
    assert.equal((await stat(configPath(dir))).mode & 0o777, 0o600)
    assert.equal(identityFilePath(config), configPath(dir))
    const again = await ensureIdentityState(config)
    assert.equal(again.created, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('旧 deva-agent 一次性迁移：备份到 .deva 外，选择/会话/MCP 落桌面同名文件，旧目录删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-mig-'))
  const config = configFor(dir)
  const backupRoot = join(dir, 'backups')
  process.env.DEVA_BACKUP_ROOT = backupRoot
  try {
    await mkdir(join(dir, '.deva', 'deva-agent', 'backup'), { recursive: true })
    await writeFile(join(dir, '.deva', 'deva-agent', 'identity.json'), JSON.stringify({ schemaVersion: 2, selected: 'xiaomajiang' }), 'utf8')
    await writeFile(join(dir, '.deva', 'deva-agent', 'sessions.json'), JSON.stringify({ version: 1, sessions: { s1: { identity: 'general' } } }), 'utf8')
    await writeFile(join(dir, '.deva', 'deva-agent', 'mcp-servers.json'), JSON.stringify({ version: 1, servers: { x: { type: 'stdio', command: 'echo', enabled: false } } }), 'utf8')
    const state = await ensureIdentityState(config)
    const result = state.migration
    assert.equal(result.migrated, true)
    assert.ok(result.backup.startsWith(backupRoot))
    assert.equal(result.selected, 'xiaomajiang')
    assert.equal(result.sessions, 1)
    assert.equal(result.mcpCount, 1)
    assert.deepEqual((await readdir(join(dir, '.deva'))).sort(), ['config.json', 'mcp.json', 'personas'])
    const cfg = JSON.parse(await readFile(configPath(dir), 'utf8'))
    assert.equal(cfg.personas.selected, 'xiaomajiang')
    assert.equal(cfg.personas.sessionSelected.s1, 'general')
    assert.deepEqual(cfg.mcp.enabled, { x: false })
    const mcp = JSON.parse(await readFile(join(dir, '.deva', 'mcp.json'), 'utf8'))
    assert.deepEqual(mcp.mcpServers.x, { name: 'x', description: '', transport: 'stdio', command: 'echo' })
    // 备份在 .deva 外且含原文件
    const files = await readdir(join(result.backup))
    assert.ok(files.includes('identity.json'))
    // 二次调用不重复迁移
    assert.equal(migrateLegacyLayout(config).migrated, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份内容只读 personas；选择只改 config.json personas.selected；deva 别名可用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-wins-'))
  const config = configFor(dir)
  try {
    await ensureIdentityState(config)
    assert.equal(canonicalIdentityId('deva'), 'general')
    assert.equal((await loadIdentityRecord(config, 'deva')).id, 'general')
    const before = await readFile(join(dir, '.deva', 'personas', 'general.md'), 'utf8')
    await selectIdentity(config, 'xiaomajiang')
    assert.equal(JSON.parse(await readFile(configPath(dir), 'utf8')).personas.selected, 'xiaomajiang')
    assert.equal(await readFile(join(dir, '.deva', 'personas', 'general.md'), 'utf8'), before)
    await selectIdentity(config, 'deva')
    assert.equal(JSON.parse(await readFile(configPath(dir), 'utf8')).personas.selected, 'general')
    await assert.rejects(selectIdentity(config, 'ghost'), /未知身份/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('config.json 损坏：明确报错，不重建、不丢用户文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-badcfg-'))
  const config = configFor(dir)
  try {
    await mkdir(join(dir, '.deva'), { recursive: true })
    const broken = '{ not json'
    await writeFile(configPath(dir), broken, 'utf8')
    assert.throws(() => readDevaConfig(config), error => error.code === 'DEVA_CONFIG_INVALID_JSON')
    await assert.rejects(ensureIdentityState(config), /config\.json 不是合法 JSON/)
    assert.equal(await readFile(configPath(dir), 'utf8'), broken)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('config 合并保留 models/未知键；写 personas 段不动其它键', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-merge-'))
  const config = configFor(dir)
  try {
    await mkdir(join(dir, '.deva'), { recursive: true })
    await writeFile(configPath(dir), JSON.stringify({ theme: 'dark', models: { providers: [{ id: 'x' }] }, personas: { enabled: { general: false }, custom: 'keep' } }), 'utf8')
    await ensureIdentityState(config)
    updatePersonasSection(config, section => ({ ...section, order: ['xiaomajiang', 'general'] }))
    const cfg = JSON.parse(await readFile(configPath(dir), 'utf8'))
    assert.equal(cfg.theme, 'dark')
    assert.deepEqual(cfg.models.providers, [{ id: 'x' }])
    assert.equal(cfg.personas.custom, 'keep')
    assert.deepEqual(cfg.personas.order, ['xiaomajiang', 'general'])
    assert.equal(cfg.personas.enabled.general, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('persona 非法 id / 空正文跳过；selected 失效回退 general', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-skip-'))
  const config = configFor(dir)
  try {
    await ensureIdentityState(config)
    await writeFile(join(dir, '.deva', 'personas', 'empty.md'), composePersonaFile({ name: '空', prompt: '' }), 'utf8')
    const snap = await listIdentityCatalog(config)
    assert.deepEqual(snap.identities.map(item => item.id).sort(), ['general', 'xiaomajiang'])
    assert.ok(snap.skipped.some(item => item.id === 'empty' && item.reason === 'empty-prompt'))
    // 手改 selected 失效 → 回退 general 并写回 config
    const cfg = JSON.parse(await readFile(configPath(dir), 'utf8'))
    cfg.personas.selected = 'gone'
    await writeFile(configPath(dir), JSON.stringify(cfg), 'utf8')
    assert.equal(await readIdentityId({ profile: { namespace: () => ({ get: async () => undefined }) } }, { userId: 1, profile: 'default' }, config), 'general')
    assert.equal(JSON.parse(await readFile(configPath(dir), 'utf8')).personas.selected, 'general')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('权限过宽：读取时收紧到 0600/0700', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-mode-'))
  const config = configFor(dir)
  try {
    await ensureIdentityState(config)
    const fs = await import('node:fs/promises')
    await fs.chmod(join(dir, '.deva', 'personas', 'general.md'), 0o644)
    const inspected = inspectIdentityFile(config)
    assert.equal(inspected.file.mode, '0600')
    assert.equal(inspected.personasDirStat.mode, '0700')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('persona 文件格式与桌面端对称', async () => {
  const raw = composePersonaFile({ name: 'Deva', description: '含 : # []{}', avatar: '{"a":1}', prompt: '第一行\n第二行' })
  const { data, body } = parseFrontmatter(raw)
  assert.equal(data.avatar, '{"a":1}')
  assert.equal(body.trim(), '第一行\n第二行')
})

test('identityProblems 校验 personas 选择段', () => {
  assert.deepEqual(identityProblems({}), [])
  assert.match(identityProblems({ selected: '../x' }).join('；'), /selected/)
  assert.match(identityProblems({ sessionSelected: [] }).join('；'), /sessionSelected/)
})

test('会话选择落 config.json personas.sessionSelected，并优先于默认', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-session-'))
  const config = configFor(dir)
  try {
    await selectIdentity(config, 'general')
    const store = new Map()
    const state = { session: { get: async key => store.get(key), set: async (key, value) => store.set(key, value), delete: async key => store.delete(key) } }
    const identity = { userId: 1, profile: 'default', sessionId: 's-123' }
    await writeSessionIdentityId(state, 'xiaomajiang', ['general', 'xiaomajiang'], { config, sessionId: 's-123' })
    assert.equal(await readSessionIdentityId(state, identity, config), 'xiaomajiang')
    assert.equal(readFileSessionIdentity(config, 's-123'), 'xiaomajiang')
    assert.deepEqual(await resolveIdentityId(state, identity, config), { id: 'xiaomajiang', source: 'session' })
    await writeSessionIdentityId(state, null, null, { config, sessionId: 's-123' })
    assert.equal(readFileSessionIdentity(config, 's-123'), null)
    assert.deepEqual(await resolveIdentityId(state, identity, config), { id: 'general', source: 'file' })
    writeFileSessionIdentity(config, 's-9', 'general')
    assert.equal(readFileSessionIdentity(config, 's-9'), 'general')
    clearFileSessionIdentity(config, 's-9')
    assert.equal(readFileSessionIdentity(config, 's-9'), null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('先写 config.json 的选择，ensure 后仍是它（不覆盖用户选择）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-layout-keep-'))
  const config = configFor(dir)
  try {
    await mkdir(join(dir, '.deva', 'personas'), { recursive: true })
    await writeFile(join(dir, '.deva', 'personas', 'only.md'), composePersonaFile({ name: 'Only', prompt: 'x' }), 'utf8')
    await writeFile(configPath(dir), JSON.stringify({ personas: { selected: 'only' } }), 'utf8')
    const state = await ensureIdentityState(config)
    assert.equal(state.value.selected, 'only')
    assert.equal(JSON.parse(await readFile(configPath(dir), 'utf8')).personas.selected, 'only')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
