import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_IDENTITY, IDENTITIES, isIdentity, listIdentities, loadIdentity } from '../lib/identities.mjs'
import { readIdentityId, readSessionIdentityId, resolveIdentityId, writeIdentityId, writeSessionIdentityId } from '../lib/selection.mjs'
import { applyInputIdentity, identityCommand } from '../lib/commands.mjs'

const pluginRoot = new URL('../', import.meta.url)
// 仓库根 = 插件目录的上两级（plugins/deva-agent/ → 仓库根）；按位置推导，换机器也不用改。
const repoPersona = fileURLToPath(new URL('../../../apps/desktop/src/main/services/xiaomajiang-personas.ts', import.meta.url))

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

test('selection defaults to deva, round-trips, and stays isolated per user and profile', async () => {
  const state = memoryState()
  const alice = { userId: 1, profile: 'default' }
  const bob = { userId: 2, profile: 'default' }
  assert.equal(await readIdentityId(state, alice), 'deva')
  assert.equal(await writeIdentityId(state, alice, 'xiaomajiang'), 'xiaomajiang')
  assert.equal(await readIdentityId(state, alice), 'xiaomajiang')
  // Profile 与用户各自独立：宿主给的 state.profile 已按 Profile 绑定，这里用独立 state 模拟
  assert.equal(await readIdentityId(memoryState(), { userId: 1, profile: 'work' }), 'deva')
  assert.equal(await readIdentityId(memoryState(), bob), 'deva')
  await assert.rejects(writeIdentityId(state, alice, 'ghost'), /未知身份/)
  // 记录被改成失效 id 时按默认身份处理，而不是报错崩掉整轮
  const store = state.profile.namespace('1')
  await store.set('identity', { identity: 'removed-identity' })
  assert.equal(await readIdentityId(state, alice), 'deva')
})

test('the agent prompt follows the saved identity and is switchable between turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-identity-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15' }))
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
    model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
    paths: { runtimeDir: dir, workspaceDir: dir },
    signal: new AbortController().signal,
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
    await writeIdentityId(state, runContext.identity, 'xiaomajiang')
    await session.run(input, runContext)
    assert.match(prompts[1], /Little Code Sauce/)
    assert.doesNotMatch(prompts[1].split('\n')[0], /Deva/)
    assert.equal(definition.management.settings().viewId, 'identity')
    await session.dispose()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('会话覆盖优先于默认值，可清除，且不同会话互不影响', async () => {
  const state = memoryState()
  const who = { userId: 1, profile: 'default' }
  assert.deepEqual(await resolveIdentityId(state, who), { id: 'deva', source: 'profile' })
  await writeSessionIdentityId(state, 'xiaomajiang')
  assert.deepEqual(await resolveIdentityId(state, who), { id: 'xiaomajiang', source: 'session' })
  assert.equal(await readSessionIdentityId(state), 'xiaomajiang')
  // 另一个会话（独立 session 存储）没有覆盖
  const other = { ...state, session: memoryStorage(new Map(), 'session-2') }
  assert.equal(await readSessionIdentityId(other), null)
  assert.deepEqual(await resolveIdentityId(other, who), { id: 'deva', source: 'profile' })
  // 清除覆盖后回到默认
  await writeSessionIdentityId(state, null)
  assert.deepEqual(await resolveIdentityId(state, who), { id: 'deva', source: 'profile' })
})

test('斜杠命令：查看、切换、拒绝未知 id、清除回默认', async () => {
  const state = memoryState()
  const notes = []
  const run = { state, identity: { userId: 1, profile: 'default', sessionId: 's1' }, messages: { notify: (text) => notes.push(text) } }
  const view = await identityCommand.execute('', run)
  assert.equal(view.current, 'deva')
  assert.equal(view.source, 'profile')
  assert.deepEqual(view.identities.map(item => item.id), ['deva', 'xiaomajiang'])
  const switched = await identityCommand.execute('xiaomajiang', run)
  assert.deepEqual([switched.current, switched.source], ['xiaomajiang', 'session'])
  assert.match(notes.at(-1), /小码酱/)
  await assert.rejects(identityCommand.execute('ghost', run), /未知身份/)
  const reset = await identityCommand.execute('default', run)
  assert.deepEqual([reset.current, reset.source], ['deva', 'profile'])
})

test('@deva:<id> 前缀：切身份、剥掉前缀，其他输入原样放行', async () => {
  const state = memoryState()
  const input = { input: [{ type: 'text', text: '@deva:xiaomajiang 看下这个报错' }], history: [], instructions: [], options: {} }
  const consumed = await applyInputIdentity(input, state)
  assert.equal(consumed.switched, 'xiaomajiang')
  assert.equal(consumed.input.input[0].text, '看下这个报错')
  assert.equal(await readSessionIdentityId(state), 'xiaomajiang')
  // 只有前缀、没有正文时补一句「继续」，不让空消息进模型
  const bare = await applyInputIdentity({ input: [{ type: 'text', text: '@deva:deva' }] }, state)
  assert.equal(bare.switched, 'deva')
  assert.equal(bare.input.input[0].text, '继续')
  // 普通消息 / 未知身份 / 没有文本块：原样返回
  const plain = { input: [{ type: 'text', text: '普通消息' }] }
  assert.equal((await applyInputIdentity(plain, state)).input, plain)
  const ghost = { input: [{ type: 'text', text: '@deva:ghost 你好' }] }
  assert.equal((await applyInputIdentity(ghost, state)).switched, null)
  assert.equal((await applyInputIdentity({ input: [] }, state)).switched, null)
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

test('Agent 运行时按会话覆盖选身份（会话 > 默认）', async () => {
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
  const runContext = {
    mode: 'scoped',
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
    await writeIdentityId(state, runContext.identity, 'deva')
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
    assert.equal(await readSessionIdentityId(state), 'deva')
    const view = await ask('/deva:identity')
    assert.match(view.content[0].text, /来源 session/)
    const reset = await ask('/deva:identity default')
    assert.match(reset.content[0].text, /来源 profile/)
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
