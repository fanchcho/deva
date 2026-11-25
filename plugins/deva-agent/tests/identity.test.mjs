import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_IDENTITY, IDENTITIES, isIdentity, listIdentities, loadIdentity } from '../lib/identities.mjs'
import {
  readIdentityId, readIdentitySnapshot, readSessionIdentityId, resolveIdentityId, writeIdentityId, writeSessionIdentityId,
} from '../lib/selection.mjs'
import { ensureIdentityState, loadIdentityRecord, selectIdentity } from '../lib/deva-home.mjs'
import { applyInputIdentity, identityCommand } from '../lib/commands.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

const pluginRoot = new URL('../', import.meta.url)
// 仓库根 = 插件目录的上两级（plugins/deva-agent/ → 仓库根）；按位置推导，换机器也不用改。
const repoPersona = fileURLToPath(new URL('../../../apps/desktop/src/main/services/xiaomajiang-personas.ts', import.meta.url))

// 本文件的默认根：任何漏传 config 的调用都不许写进真实 ~/.deva。
isolatedDevaHome()
process.env.DEVA_BACKUP_ROOT = join(tmpdir(), `deva-identity-backup-${process.pid}`)

/** 内存版 PluginStorage：prefix 区分 plugin/user/profile 作用域。 */
function memoryStorage(records = new Map(), prefix = 'root') {
  return {
    records,
    namespace: (...parts) => memoryStorage(records, `${prefix}/${parts.join('/')}`),
    get: async key => records.get(`${prefix}#${key}`),
    set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
    async delete(key) { records.delete(`${prefix}#${key}`) },
    keys: async () => [...records.keys()],
  }
}

function memoryState() {
  const records = new Map()
  return { records, plugin: memoryStorage(records, 'plugin'), user: memoryStorage(records, 'user'), profile: memoryStorage(records, 'profile'), session: memoryStorage(records, 'session') }
}

/** 每个测试一个隔离的 Deva 根（模拟 ~/.deva）。 */
const configFor = dir => ({ sharedDevaHome: join(dir, '.deva') })

test('identity catalog lists the personas shipped in this repository', () => {
  const list = listIdentities()
  assert.deepEqual(list.map(item => item.id), ['deva', 'xiaomajiang'])
  assert.equal(DEFAULT_IDENTITY, 'deva')
  assert.ok(list.every(item => item.name && item.description))
  assert.equal(isIdentity('xiaomajiang'), true)
  assert.equal(isIdentity('nope'), false)
  assert.equal(IDENTITIES.length, 2)
})

test('loading an identity reads its prompt, unknown ids fall back to the default identity', async () => {
  const deva = await loadIdentity('deva')
  assert.equal(deva.id, 'deva')
  assert.match(deva.persona, /Deva/)
  const sauce = await loadIdentity('xiaomajiang')
  assert.equal(sauce.name, '小码酱')
  assert.match(sauce.persona, /Little Code Sauce/)
  const fallback = await loadIdentity('does-not-exist')
  assert.equal(fallback.id, 'deva')
})

test('bundled 小码酱 prompt stays byte-identical to the repository persona source', async t => {
  let source
  try { source = await readFile(repoPersona, 'utf8') } catch { t.skip('仓库 persona 源文件不在，跳过漂移核对'); return }
  const start = source.indexOf('const PROMPT = `') + 'const PROMPT = `'.length
  const end = source.indexOf('`\n\nconst XIAOMAJIANG')
  const expected = source.slice(start, end).replaceAll('\\`', '`').replaceAll('\\${', '${').replaceAll('\\\\', '\\').trim()
  const bundled = (await readFile(new URL('identities/xiaomajiang.md', pluginRoot), 'utf8')).trim()
  assert.equal(bundled, expected, 'identities/xiaomajiang.md 与仓库 persona 已漂移：重新抽取一次')
})

test('旧 deva-agent 选择迁移到 config.json；persona 正文仍只读 personas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-file-'))
  const config = configFor(dir)
  try {
    const state = memoryState()
    const alice = { userId: 1, profile: 'default' }
    await state.profile.namespace('1').set('identity', { identity: 'xiaomajiang' })
    await mkdir(join(dir, '.deva', 'deva-agent'), { recursive: true })
    await writeFile(join(dir, '.deva', 'deva-agent', 'identity.json'), JSON.stringify({ schemaVersion: 2, selected: 'xiaomajiang' }), 'utf8')
    const first = await readIdentitySnapshot(state, alice, config)
    assert.equal(first.migrated, true)
    assert.deepEqual(first.identities.map(item => item.id), ['general', 'xiaomajiang'])
    assert.equal(first.selected, 'xiaomajiang')
    assert.equal(first.path, join(dir, '.deva', 'config.json'))
    assert.equal(first.personasDir, join(dir, '.deva', 'personas'))
    assert.match((await loadIdentityRecord(config, 'general')).persona, /Deva/)
    assert.deepEqual((await readdir(join(dir, '.deva'))).sort(), ['config.json', 'personas'])
    assert.equal((await stat(join(dir, '.deva', 'personas'))).mode & 0o777, 0o700)
    assert.equal((await stat(join(dir, '.deva', 'personas', 'general.md'))).mode & 0o777, 0o600)
    assert.equal(await writeIdentityId(state, alice, 'general', config), 'general')
    assert.equal(JSON.parse(await readFile(join(dir, '.deva', 'config.json'), 'utf8')).personas.selected, 'general')
    assert.equal(await readIdentityId(state, alice, config), 'general')
    const other = memoryState()
    await other.profile.namespace('1').set('identity', { identity: 'xiaomajiang' })
    assert.equal(await readIdentityId(other, alice, config), 'general')
    await writeFile(join(dir, '.deva', 'personas', 'general.md'), '---\nname: Deva\n---\n\n用户手改的正文\n', 'utf8')
    assert.equal((await loadIdentityRecord(config, 'general')).persona, '用户手改的正文')
    await assert.rejects(writeIdentityId(state, alice, 'ghost', config), /未知身份/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('会话覆盖优先于文件默认值，可清除，且不同会话互不影响', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-session-'))
  const config = configFor(dir)
  try {
    const state = memoryState()
    const who = { userId: 1, profile: 'default' }
    assert.deepEqual(await resolveIdentityId(state, who, config), { id: 'general', source: 'file' })
    await writeSessionIdentityId(state, 'xiaomajiang')
    assert.deepEqual(await resolveIdentityId(state, who, config), { id: 'xiaomajiang', source: 'session' })
    assert.equal(await readSessionIdentityId(state), 'xiaomajiang')
    // 另一个会话（独立 session 存储）没有覆盖
    const other = { ...state, session: memoryStorage(new Map(), 'session-2') }
    assert.equal(await readSessionIdentityId(other), null)
    assert.deepEqual(await resolveIdentityId(other, who, config), { id: 'general', source: 'file' })
    // 清除覆盖后回到文件默认
    await writeSessionIdentityId(state, null)
    assert.deepEqual(await resolveIdentityId(state, who, config), { id: 'general', source: 'file' })
    // 文件里的默认值改了，下一轮跟着变
    await selectIdentity(config, 'xiaomajiang')
    assert.deepEqual(await resolveIdentityId(state, who, config), { id: 'xiaomajiang', source: 'file' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份正文就是本轮提示词：改桌面 persona 文件即改人格', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-persona-'))
  const config = configFor(dir)
  try {
    const before = await loadIdentityRecord(config, 'deva')
    assert.equal(before.id, 'general')
    assert.match(before.persona, /Deva/)
    assert.equal(before.source, 'file')
    await writeFile(before.path, '---\nname: Deva\n---\n\n# 我是自定义 Deva\n\n这是用户在 ~/.deva/personas 里手改的正文。\n', 'utf8')
    const after = await loadIdentityRecord(config, 'general')
    assert.match(after.persona, /用户在 ~\/\.deva\/personas 里手改的正文/)
    // 未知 id 回退到当前选择，不回退到空提示词
    const fallback = await loadIdentityRecord(config, 'does-not-exist')
    assert.equal(fallback.id, 'general')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('the agent prompt follows the saved identity and is switchable between turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  const config = configFor(dir)
  const { createAgentDefinition } = await import('../lib/agent.mjs')
  const state = memoryState()
  const prompts = []
  const definition = createAgentDefinition({
    log: { info() {} },
    runTurn: async ({ system }) => { prompts.push(system); return { content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' } },
  })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
  const runContext = {
    mode: 'scoped',
    config,
    model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
    paths: { runtimeDir: dir, workspaceDir: dir },
    state,
    identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's', runId: 'r' },
    output: { emit: async () => {} },
    attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
    log: { info() {} },
  }
  const input = { input: [{ type: 'text', text: 'hi' }], history: [], instructions: [], options: {} }
  try {
    await session.run(input, runContext)
    assert.match(prompts[0], /你是 \*\*Deva\*\*/)
    await writeIdentityId(state, runContext.identity, 'xiaomajiang', config)
    await session.run(input, runContext)
    assert.match(prompts[1], /Little Code Sauce/)
    assert.doesNotMatch(prompts[1].split('\n')[0], /Deva/)
    assert.deepEqual(await definition.management.settings(), { viewId: 'identity' })
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('斜杠命令：查看、切换、拒绝未知 id、清除回默认', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-cmd-'))
  const config = configFor(dir)
  try {
    const state = memoryState()
    const notes = []
    const run = { state, config, identity: { userId: 1, profile: 'default', sessionId: 's1' }, messages: { notify: (text) => notes.push(text) } }
    const view = await identityCommand.execute('', run)
    assert.equal(view.current, 'general')
    assert.equal(view.source, 'file')
    assert.deepEqual(view.identities.map(item => item.id), ['general', 'xiaomajiang'])
    const switched = await identityCommand.execute('xiaomajiang', run)
    assert.deepEqual([switched.current, switched.source], ['xiaomajiang', 'session'])
    assert.match(notes.at(-1), /小码酱/)
    await assert.rejects(identityCommand.execute('ghost', run), /未知身份/)
    const reset = await identityCommand.execute('default', run)
    assert.deepEqual([reset.current, reset.source], ['general', 'file'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('@deva:<id> 前缀：切身份、剥掉前缀，其他输入原样放行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-prefix-unit-'))
  const config = configFor(dir)
  try {
    const state = memoryState()
    const input = { input: [{ type: 'text', text: '@deva:xiaomajiang 看下这个报错' }], history: [], instructions: [], options: {} }
    const consumed = await applyInputIdentity(input, state, undefined, { config })
    assert.equal(consumed.switched, 'xiaomajiang')
    assert.equal(consumed.input.input[0].text, '看下这个报错')
    assert.equal(await readSessionIdentityId(state), 'xiaomajiang')
    // 只有前缀、没有正文时补一句「继续」，不让空消息进模型
    const bare = await applyInputIdentity({ input: [{ type: 'text', text: '@deva:deva' }] }, state, undefined, { config })
    assert.equal(bare.switched, 'general')
    assert.equal(bare.input.input[0].text, '继续')
    // 普通消息 / 未知身份 / 没有文本块：原样返回
    const plain = { input: [{ type: 'text', text: '普通消息' }] }
    assert.equal((await applyInputIdentity(plain, state, undefined, { config })).input, plain)
    const ghost = { input: [{ type: 'text', text: '@deva:ghost 你好' }] }
    assert.equal((await applyInputIdentity(ghost, state, undefined, { config })).switched, null)
    assert.equal((await applyInputIdentity({ input: [] }, state, undefined, { config })).switched, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Agent 运行时消费 @deva: 前缀：先切身份、再按新身份组装提示词', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-prefix-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  const { createAgentDefinition } = await import('../lib/agent.mjs')
  const state = memoryState()
  const seen = []
  const definition = createAgentDefinition({
    log: { info() {} },
    runTurn: async ({ system, input }) => {
      seen.push({ system, text: input.input.map(block => block.text).join('\n') })
      return { content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' }
    },
  })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
  const runContext = {
    mode: 'scoped',
    config: configFor(dir),
    model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
    paths: { runtimeDir: dir, workspaceDir: dir },
    state,
    identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's', runId: 'r' },
    output: { emit: async () => {} },
    attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
    log: { info() {} },
  }
  try {
    await session.run({ input: [{ type: 'text', text: '@deva:xiaomajiang 写个 poc' }], history: [], instructions: [], options: {} }, runContext)
    assert.match(seen[0].system, /本轮身份：\*\*小码酱\*\*/)
    assert.equal(seen[0].text, '写个 poc')
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Agent 运行时按会话覆盖选身份（会话 > 文件默认）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-session-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  const { createAgentDefinition } = await import('../lib/agent.mjs')
  const state = memoryState()
  const prompts = []
  const definition = createAgentDefinition({
    log: { info() {} },
    runTurn: async ({ system }) => { prompts.push(system); return { content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' } },
  })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
  const config = configFor(dir)
  const runContext = {
    mode: 'scoped',
    config,
    model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
    paths: { runtimeDir: dir, workspaceDir: dir },
    state,
    identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's', runId: 'r' },
    output: { emit: async () => {} },
    attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
    log: { info() {} },
  }
  const input = { input: [{ type: 'text', text: 'hi' }], history: [], instructions: [], options: {} }
  try {
    await writeIdentityId(state, runContext.identity, 'deva', config)
    await writeSessionIdentityId(state, 'xiaomajiang')
    await session.run(input, runContext)
    assert.match(prompts[0], /本轮身份：\*\*小码酱\*\*/)
    await writeSessionIdentityId(state, null)
    await session.run(input, runContext)
    assert.match(prompts[1], /本轮身份：\*\*Deva\*\*/)
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('输入框里打整条 /deva:identity 命令：切换并本地回话，不调模型', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-cmd-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  const { createAgentDefinition } = await import('../lib/agent.mjs')
  const state = memoryState()
  let modelCalls = 0
  const definition = createAgentDefinition({
    log: { info() {} },
    runTurn: async () => { modelCalls++; return { content: [{ type: 'text', text: 'model' }], finishReason: 'stop' } },
  })
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
  const runContext = {
    mode: 'scoped',
    config: configFor(dir),
    model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
    paths: { runtimeDir: dir, workspaceDir: dir },
    state,
    identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's', runId: 'r' },
    output: { emit: async () => {} },
    attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
    log: { info() {} },
  }
  const ask = text => session.run({ input: [{ type: 'text', text }], history: [], instructions: [], options: {} }, runContext)
  try {
    const switched = await ask('/deva:identity xiaomajiang')
    assert.match(switched.content[0].text, /小码酱/)
    assert.match(switched.content[0].text, /xiaomajiang/)
    assert.equal(await readSessionIdentityId(state), 'xiaomajiang')
    const bare = await ask('deva:identity deva')
    assert.match(bare.content[0].text, /Deva/)
    assert.equal(await readSessionIdentityId(state), 'general')
    const view = await ask('/deva:identity')
    assert.match(view.content[0].text, /来源 本会话/)
    const reset = await ask('/deva:identity default')
    assert.match(reset.content[0].text, /来源 默认（~\/\.deva）/)
    assert.equal(await readSessionIdentityId(state), null)
    await assert.rejects(ask('/deva:identity ghost'), /未知身份/)
    assert.equal(modelCalls, 0, '命令不应触发模型调用')
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('每个身份一个 Agent：固定的 Agent 不读存储、直接用自身身份', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-fixed-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
  const { createAgentDefinition } = await import('../lib/agent.mjs')
  const prompts = []
  const definition = createAgentDefinition({
    log: { info() {} },
    identityId: 'xiaomajiang',
    runTurn: async ({ system }) => { prompts.push(system); return { content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' } },
  })
  assert.equal(definition.id, 'xiaomajiang')
  assert.equal(definition.name, '小码酱')
  // 存储访问即报错：证明固定身份的 Agent 完全不依赖设置/会话覆盖
  const brokenState = { get profile() { throw new Error('不应读取存储') }, session: { get() { throw new Error('不应读取存储') } } }
  const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
  try {
    await session.run({ input: [{ type: 'text', text: '@deva:deva 你好' }], history: [], instructions: [], options: {} }, {
      mode: 'scoped',
      config: configFor(dir),
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { runtimeDir: dir, workspaceDir: dir },
      state: brokenState,
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/xiaomajiang', sessionId: 's', runId: 'r' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({}), read: async () => new Uint8Array() },
      log: { info() {} },
    })
    assert.match(prompts[0], /本轮身份：\*\*小码酱\*\*/)
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('会话身份覆盖：写宿主会话存储并落 sessions.json，清除后回落默认', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-session-file-'))
  const config = configFor(dir)
  try {
    await selectIdentity(config, 'general')
    const store = new Map()
    const state = { session: { get: async key => store.get(key), set: async (key, value) => store.set(key, value), delete: async key => store.delete(key) } }
    const identity = { userId: 1, profile: 'default', sessionId: 's-123' }
    await writeSessionIdentityId(state, 'xiaomajiang', ['general', 'xiaomajiang'], { config, sessionId: 's-123' })
    assert.equal(await readSessionIdentityId(state, identity, config), 'xiaomajiang')
    const cfg = JSON.parse(await readFile(join(dir, '.deva', 'config.json'), 'utf8'))
    assert.equal(cfg.personas.sessionSelected['s-123'], 'xiaomajiang')
    assert.deepEqual(await resolveIdentityId(state, identity, config), { id: 'xiaomajiang', source: 'session' })
    await writeSessionIdentityId(state, null, null, { config, sessionId: 's-123' })
    assert.equal(await readSessionIdentityId(state, identity, config), null)
    assert.deepEqual(await resolveIdentityId(state, identity, config), { id: 'general', source: 'file' })
    assert.equal((await stat(join(dir, '.deva', 'config.json'))).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('没有宿主会话存储时，sessions.json 里的选择仍然生效（可手改）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-session-file-only-'))
  const config = configFor(dir)
  try {
    await selectIdentity(config, 'general')
    await ensureIdentityState(config)
    await writeFile(join(dir, '.deva', 'config.json'), JSON.stringify({ personas: { enabled: { general: true, xiaomajiang: true }, selected: 'general', sessionSelected: { 's-9': 'xiaomajiang' } } }), 'utf8')
    const state = { session: { get: async () => undefined, set: async () => {}, delete: async () => {} } }
    assert.deepEqual(await resolveIdentityId(state, { userId: 1, profile: 'default', sessionId: 's-9' }, config), { id: 'xiaomajiang', source: 'session' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
