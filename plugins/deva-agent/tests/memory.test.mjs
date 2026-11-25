import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeMemory, deleteMemory, readMemories, listMemories, formatMemoryIndex, projectMemoryKey,
  normalizeTitle, normalizeBody, formatMemoryLine, memoryUsage,
  MEMORY_TITLE_MAX, MEMORY_BODY_MAX,
} from '../lib/memory.mjs'
import { executeTool } from '../lib/tools.mjs'

/** 内存版 user 存储，按 namespace 分桶。 */
function memoryUser() {
  const buckets = new Map()
  const make = prefix => ({
    namespace: (...parts) => make(`${prefix}/${parts.join('/')}`),
    get: async key => buckets.get(`${prefix}#${key}`),
    set: async (key, value) => { buckets.set(`${prefix}#${key}`, value) },
    delete: async key => { buckets.delete(`${prefix}#${key}`) },
    keys: async () => [...buckets.keys()],
  })
  return { user: make('user'), buckets }
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-memory-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function ctxOf(state, workspaceDir, identityId = 'deva') {
  return { state, workspaceDir, identityId, identityName: identityId }
}

test('memory writes, updates, and deletes by id across the three layers', async () => {
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const global = await writeMemory(
      { type: 'user', title: '包管理器偏好', body: '用户偏好 pnpm 而不是 npm' },
      ctxOf(state, dir),
    )
    assert.equal(global.scope, 'global')
    assert.equal(global.created, true)
    assert.match(global.entry.id, /^m_[0-9a-f]{8}$/)

    const role = await writeMemory(
      { scope: 'role', type: 'feedback', title: '先跑测试再交付', body: '规则：改完先跑受影响测试。\n原因：回归成本远低于线上故障。' },
      ctxOf(state, dir),
    )
    assert.equal(role.scope, 'role')
    assert.match(role.entry.id, /^r_/)

    const project = await writeMemory(
      { scope: 'project', type: 'project', title: 'e2e 前置', body: 'e2e 测试须先启动 mock 服务' },
      ctxOf(state, dir),
    )
    assert.equal(project.scope, 'project')
    assert.match(project.entry.id, /^p_/)

    // 带 id 更新：省略的字段保持原值，id 前缀定位作用域。
    const updated = await writeMemory({ body: '用户偏好 pnpm 9（含 workspace 命令）' }, ctxOf(state, dir), global.entry.id)
    assert.equal(updated.created, false)
    assert.equal(updated.entry.title, '包管理器偏好')
    assert.match(updated.entry.body, /pnpm 9/)

    const all = await readMemories(ctxOf(state, dir))
    assert.equal(all.global.length, 1)
    assert.equal(all.role.length, 1)
    assert.equal(all.project.length, 1)

    await deleteMemory(project.entry.id, ctxOf(state, dir))
    assert.equal((await readMemories(ctxOf(state, dir))).project.length, 0)
    assert.equal((await readMemories(ctxOf(state, dir))).global.length, 1)
  } finally {
    await cleanup()
  }
})

test('each layer is partitioned: role by identity, project by workspace', async () => {
  const state = memoryUser()
  const a = await workspace()
  const b = await workspace()
  try {
    await writeMemory({ scope: 'role', type: 'user', title: 'A 身份记忆', body: 'x' }, ctxOf(state, a.dir, 'deva'))
    await writeMemory({ scope: 'project', type: 'project', title: 'A 项目的坑', body: 'y' }, ctxOf(state, a.dir, 'deva'))

    // 另一个身份看不到 deva 的角色记忆；另一个工作区看不到 A 的项目记忆。
    assert.equal((await listMemories('role', ctxOf(state, a.dir, 'xiaomajiang'))).length, 0)
    assert.equal((await listMemories('role', ctxOf(state, a.dir, 'deva'))).length, 1)
    assert.equal((await listMemories('project', ctxOf(state, b.dir, 'deva'))).length, 0)

    await assert.rejects(
      writeMemory({ scope: 'project', type: 'project', title: '无工作区', body: '' }, { state, identityId: 'deva' }),
      /未挂载工作区/,
    )
    assert.notEqual(await projectMemoryKey(a.dir), await projectMemoryKey(b.dir))
  } finally {
    await a.cleanup()
    await b.cleanup()
  }
})

test('limits reject oversized titles, bodies, duplicates and over-budget writes instead of dropping entries', async () => {
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const write = (title, body = '', type = 'user') => writeMemory({ type, title, body }, ctxOf(state, dir))
    await assert.rejects(write('x'.repeat(MEMORY_TITLE_MAX + 1)), /标题过长/)
    await assert.rejects(write('标题', 'y'.repeat(MEMORY_BODY_MAX + 1)), /正文过长/)
    await assert.rejects(write('  '), /标题为空/)
    await assert.rejects(writeMemory({ title: '没有类型' }, ctxOf(state, dir)), /缺少有效的类型/)

    // 同标题：内容一样视为已存在；内容不一样拒写并提示带 id 更新。
    const first = await write('同一主题', '内容 A')
    const same = await write('同一主题', '内容 A')
    assert.equal(same.created, false)
    assert.equal(same.entry.id, first.entry.id)
    await assert.rejects(write('同一主题', '内容 B'), /已有同标题/)

    // 索引预算：每行按 formatMemoryLine 计（正文不计），写到超预算即拒。
    let rejected = null
    for (let index = 0; index < 200 && !rejected; index++) {
      try { await write(`条目 ${index} ${'长'.repeat(35)}`, 'z'.repeat(200)) } catch (error) { rejected = error }
    }
    assert.match(rejected?.message || '', /索引总量已达上限/)
    const entries = await listMemories('global', ctxOf(state, dir))
    assert.ok(memoryUsage(entries) <= 4000, '被拒的写入不该把总量顶破预算')
  } finally {
    await cleanup()
  }
})

test('v1 one-liner memories are read as v2 entries with a derived title', async () => {
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    // 直接写旧格式：只有 id + content。
    const bucket = state.user.namespace('memory')
    await bucket.set('entries', [
      { id: 'm_deadbeef', content: '用户偏好简体中文。回复要简短。', createdAt: 1, updatedAt: 2 },
    ])
    const entries = await listMemories('global', ctxOf(state, dir))
    assert.equal(entries.length, 1)
    assert.equal(entries[0].type, 'user')
    assert.equal(entries[0].title, '用户偏好简体中文')
    assert.equal(entries[0].body, '用户偏好简体中文。回复要简短。')
  } finally {
    await cleanup()
  }
})

test('memory index only carries titles, except feedback entries which include the body', async () => {
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    await writeMemory({ type: 'user', title: '用户身份', body: '后端工程师' }, ctxOf(state, dir))
    await writeMemory({ type: 'feedback', title: '先跑测试', body: '规则：改完先跑测试。' }, ctxOf(state, dir))
    await writeMemory({ type: 'reference', title: '设计稿', body: '在 figma 某处' }, ctxOf(state, dir))
    const entries = await listMemories('global', ctxOf(state, dir))
    const text = formatMemoryIndex([{ scope: 'global', label: '全局记忆', entries }])
    assert.match(text, /全局记忆】3 条/)
    assert.match(text, /用户 · 用户身份/)
    assert.match(text, /做事方式 · 先跑测试\n {2}正文：规则：改完先跑测试。/)
    assert.doesNotMatch(text, /后端工程师/)
    assert.doesNotMatch(text, /figma/)
  } finally {
    await cleanup()
  }
})

test('memory tools go through executeTool and surface the result', async () => {
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const wrote = await executeTool(
      'memory_write',
      { type: 'user', title: '语言偏好', body: '偏好简体中文' },
      { state, workspaceDir: dir, identity: { identityId: 'deva' } },
    )
    assert.match(wrote, /已记住（全局记忆）：- \[m_[0-9a-f]{8}\] 用户 · 语言偏好/)
    const listed = await executeTool('memory_read', {}, { state, workspaceDir: dir, identity: { identityId: 'deva' } })
    assert.match(listed, /【全局记忆】/)
    assert.match(listed, /语言偏好/)
    // 不带 ids 只给索引，正文要带 ids 读。
    assert.doesNotMatch(listed, /偏好简体中文/)
    const id = listed.match(/m_[0-9a-f]{8}/)[0]
    assert.match(await executeTool('memory_read', { ids: [id] }, { state, workspaceDir: dir }), /偏好简体中文/)
    assert.match(await executeTool('memory_delete', { id }, { state, workspaceDir: dir }), /已删除记忆/)
    assert.match(await executeTool('memory_read', {}, { state, workspaceDir: dir }), /（暂无）/)
    await assert.rejects(executeTool('memory_delete', { id }, { state, workspaceDir: dir }), /不存在 id 为/)
    await assert.rejects(
      executeTool('memory_write', { title: '缺类型' }, { state, workspaceDir: dir, identity: { identityId: 'deva' } }),
      /缺少有效的类型/,
    )
  } finally {
    await cleanup()
  }
})

test('a memory written mid-turn shows up in the next step index', async () => {
  const { runAgentTurn } = await import('../lib/loop.mjs')
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const run = {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state,
      signal: new AbortController().signal,
      log: { info() {}, warn() {}, error() {} },
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async () => {} },
      attachments: { resolve: async () => ({ localPath: dir, mediaType: 'text/plain', name: 'x' }), read: async () => new Uint8Array() },
    }
    const systems = []
    const messageSnapshots = []
    const scripted = [
      { text: '', toolCalls: [{ id: 'c1', name: 'memory_write', arguments: '{"type":"user","title":"包管理器","body":"用户偏好 pnpm"}' }], finish: 'tool_calls' },
      { text: '记住了', toolCalls: [], finish: 'stop' },
    ]
    const result = await runAgentTurn({
      run, workspaceDir: dir, facts: {}, identityId: 'deva', identityName: 'Deva',
      input: { input: [{ type: 'text', text: '以后都用 pnpm' }], history: [], instructions: [], options: {} },
      model: async request => {
        systems.push(request.system)
        messageSnapshots.push(JSON.parse(JSON.stringify(request.messages)))
        const next = scripted.shift()
        if (next.text) await request.onDelta(next.text)
        return next
      },
    })
    assert.equal(result.finishReason, 'stop')
    // 系统提示词只放规则，条目绝不出现在 system 里（否则每写一条都会作废提示缓存）。
    assert.match(systems[0], /【长期记忆】/)
    assert.doesNotMatch(systems[0], /包管理器/)
    assert.doesNotMatch(systems[1], /包管理器/)
    // 索引随消息下发，且第二步能看到第一步刚写入的条目。
    const first = JSON.stringify(messageSnapshots[0])
    const second = JSON.stringify(messageSnapshots[1])
    assert.match(second, /【记忆】/)
    assert.match(second, /包管理器/)
    assert.doesNotMatch(first, /包管理器/)
  } finally {
    await cleanup()
  }
})

test('title and body normalisation keeps a single-line title and compressed body', () => {
  assert.equal(normalizeTitle('  a \n b  '), 'a b')
  assert.equal(normalizeBody('a\r\n\r\n\n\nb  \n'), 'a\n\nb')
  assert.equal(formatMemoryLine({ id: 'm_1', type: 'feedback', title: 't' }), '- [m_1] 做事方式 · t')
})

test('a full layer consolidates old entries with the turn model before writing', async () => {
  const { writeMemoryWithConsolidation } = await import('../lib/memory-consolidate.mjs')
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const ctx = { ...ctxOf(state, dir), runtimeDir: dir }
    // 先把索引写满。
    for (let index = 0; index < 200; index++) {
      try {
        await writeMemory({ type: 'project', title: `进展 ${index} ${'x'.repeat(50)}`, body: '一次性细节' }, ctx)
      } catch (error) {
        assert.match(error.message, /索引总量已达上限/)
        break
      }
    }
    const before = await listMemories('global', ctx)
    let asked = null
    const model = async (system, user) => {
      asked = { system, user }
      // 只留一条合并后的条目：模拟归并把旧条目压下去。
      return JSON.stringify({ entries: [{ id: null, type: 'project', title: '合并后的进展', body: '保留的关键事实' }] })
    }
    const written = await writeMemoryWithConsolidation(
      { scope: 'global', type: 'feedback', title: `新的做事方式 ${'n'.repeat(50)}`, body: '规则：先跑测试。' },
      undefined,
      'global',
      ctx,
      model,
    )
    assert.ok(asked, '撞上限时应调用模型归纳')
    assert.match(asked.system, /归纳精简/)
    assert.match(asked.user, /即将写入的新记忆/)
    assert.ok(written.consolidated, '应报告发生过归纳')
    assert.equal(written.consolidated.before.count, before.length)
    assert.equal(written.result.created, true)
    const after = await listMemories('global', ctx)
    assert.ok(after.length < before.length + 1)
    assert.ok(after.some(entry => entry.title.startsWith('新的做事方式')))
    assert.ok(after.some(entry => entry.title === '合并后的进展'))
  } finally {
    await cleanup()
  }
})

test('consolidation gives up and keeps the layer untouched when the model output is unusable', async () => {
  const { writeMemoryWithConsolidation } = await import('../lib/memory-consolidate.mjs')
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const ctx = { ...ctxOf(state, dir), runtimeDir: dir }
    let full = null
    for (let index = 0; index < 200 && !full; index++) {
      try { await writeMemory({ type: 'reference', title: `资料 ${index} ${'y'.repeat(50)}`, body: '' }, ctx) } catch (error) { full = error }
    }
    assert.match(full?.message || '', /索引总量已达上限/)
    const before = await listMemories('global', ctx)
    await assert.rejects(
      writeMemoryWithConsolidation(
        { scope: 'global', type: 'user', title: `再写一条 ${'q'.repeat(50)}`, body: '' },
        undefined,
        'global',
        ctx,
        async () => '抱歉，我无法完成',
      ),
      /自动归纳没有成功/,
    )
    const after = await listMemories('global', ctx)
    assert.deepEqual(after.map(entry => entry.id), before.map(entry => entry.id), '归纳失败时条目不该被改动')
  } finally {
    await cleanup()
  }
})

test('deleting the last memory publishes an empty index before the next model step', async () => {
  const { runAgentTurn } = await import('../lib/loop.mjs')
  const state = memoryUser()
  const { dir, cleanup } = await workspace()
  try {
    const { entry } = await writeMemory({ type: 'user', title: '过期偏好', body: '旧偏好' }, ctxOf(state, dir))
    const snapshots = []
    const scripted = [
      { text: '', toolCalls: [{ id: 'd1', name: 'memory_delete', arguments: JSON.stringify({ id: entry.id }) }], finish: 'tool_calls' },
      { text: '', toolCalls: [{ id: 'l1', name: 'list_dir', arguments: '{}' }], finish: 'tool_calls' },
      { text: '已删除', toolCalls: [], finish: 'stop' },
    ]
    const result = await runAgentTurn({
      run: { state, paths: { workspaceDir: dir, runtimeDir: dir }, signal: new AbortController().signal },
      workspaceDir: dir, facts: {}, identityId: 'deva', identityName: 'Deva',
      input: { input: [{ type: 'text', text: '删除这条记忆' }], history: [] },
      model: async request => {
        snapshots.push(request.messages.filter(message => message.text?.startsWith('【记忆】')).map(message => message.text))
        return scripted.shift()
      },
    })
    assert.equal(result.finishReason, 'stop')
    assert.match(snapshots[0][0], /过期偏好/)
    assert.equal(snapshots[1].length, 2, '最后一条删除后也应补发更新索引')
    assert.match(snapshots[1][1], /当前没有记忆条目/)
    assert.doesNotMatch(snapshots[1][1], /过期偏好/)
    assert.deepEqual(snapshots[2], snapshots[1], '无后续记忆变更不重复发送空索引')
    assert.deepEqual(await readMemories(ctxOf(state, dir)), { global: [], role: [], project: [] })
  } finally {
    await cleanup()
  }
})
