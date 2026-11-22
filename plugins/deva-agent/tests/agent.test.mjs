import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { runAgentTurn } from '../lib/loop.mjs'
import { createAgentDefinition } from '../lib/agent.mjs'

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-agent-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15', scripts: { typecheck: 'pnpm typecheck' } }))
  await writeFile(join(dir, 'README.md'), '# deva\n')
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 内存版 PluginStorage，够 createAgentDefinition 读身份选择即可。 */
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

function fakeRun(dir, { aborted = false } = {}) {
  const events = []
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    events,
    run: {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: memoryState(),
      signal: controller.signal,
      log: { info() {}, warn() {}, error() {} },
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async event => { events.push(event) } },
      attachments: { resolve: async () => ({ localPath: join(dir, 'x'), mediaType: 'text/plain', name: 'x' }), read: async () => new Uint8Array() },
    },
  }
}

test('loop runs a tool call then answers, streaming events in order', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run, events } = fakeRun(dir)
    const scripted = [
      { text: '先读一下 package.json', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"package.json"}' }], finish: 'tool_calls' },
      { text: '版本是 0.1.15', toolCalls: [], finish: 'stop', usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0 } },
    ]
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {},
      input: { input: [{ type: 'text', text: '版本多少' }], history: [], instructions: [], options: {} },
      model: async request => {
        // 系统提示词 = 传入的正文 + 记忆规则段（只放规则，不放条目）。
        assert.ok(request.system.startsWith('sys'))
        assert.match(request.system, /【长期记忆】/)
        assert.equal(request.messages[0].role, 'user')
        const next = scripted.shift()
        await request.onDelta(next.text)
        return next
      },
    })
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.content[0].text, '先读一下 package.json版本是 0.1.15')
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, costUsd: null, isEstimated: false })
    const kinds = events.map(event => event.type)
    assert.deepEqual(kinds, ['status', 'text.delta', 'tool.started', 'tool.completed', 'status', 'text.delta'])
    const started = events.find(event => event.type === 'tool.started')
    assert.equal(started.name, 'read_file')
    assert.deepEqual(started.input, { path: 'package.json' })
    const completed = events.find(event => event.type === 'tool.completed')
    assert.match(String(completed.result), /deva-workspace/)
  } finally { await cleanup() }
})

test('bad tool arguments become a tool result instead of failing the turn', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run, events } = fakeRun(dir)
    const seen = []
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {},
      input: { input: [{ type: 'text', text: 'x' }], history: [], instructions: [], options: {} },
      model: async request => {
        seen.push(request.messages.at(-1))
        if (seen.length === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{oops' }], finish: 'tool_calls' }
        return { text: '已修正', toolCalls: [], finish: 'stop' }
      },
    })
    assert.equal(result.content[0].text, '已修正')
    assert.ok(events.some(event => event.type === 'tool.failed'))
    assert.match(String(seen[1].text), /不是合法 JSON/)
  } finally { await cleanup() }
})

test('tool loop stops at the step limit', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run } = fakeRun(dir)
    let calls = 0
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {}, maxSteps: 3,
      input: { input: [{ type: 'text', text: 'loop' }], history: [], instructions: [], options: {} },
      model: async () => { calls++; return { text: '', toolCalls: [{ id: `c${calls}`, name: 'list_dir', arguments: '{}' }], finish: 'tool_calls' } },
    })
    assert.equal(calls, 3)
    assert.equal(result.finishReason, 'tool_limit')
  } finally { await cleanup() }
})

test('cancellation aborts before any model call', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run } = fakeRun(dir, { aborted: true })
    await assert.rejects(runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {}, model: async () => { throw new Error('should not run') },
      input: { input: [{ type: 'text', text: 'x' }], history: [], instructions: [], options: {} },
    }), /取消/)
  } finally { await cleanup() }
})

test('agent definition exposes scoped-only modes and rejects unsupported runs', async () => {
  const definition = createAgentDefinition({ log: { info() {}, warn() {} } })
  assert.equal(definition.id, 'deva')
  assert.equal(definition.agentApiVersion, 1)
  assert.deepEqual(definition.modes.scoped.protocols, ['chat_completions', 'anthropic_messages', 'codex_responses'])
  assert.equal(definition.modes.global, undefined)
  assert.deepEqual(definition.features.surfaces, ['chat', 'group-chat', 'workflow', 'api'])
  assert.equal(definition.features.streaming, true)
  assert.equal(definition.features.resume, false)
  const status = await definition.getStatus({})
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(status, { installed: true, version: pkg.version, source: 'plugin' })
  const dir = await mkdtemp(join(tmpdir(), 'deva-def-'))
  try {
    const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
    await assert.rejects(session.run({ input: [], history: [], instructions: [], options: {} }, {
      mode: 'global', model: {}, paths: { runtimeDir: dir, workspaceDir: dir }, signal: new AbortController().signal,
      output: { emit: async () => {} }, attachments: {}, log: { info() {} },
    }), /scoped/)
    await session.dispose()
    await assert.rejects(session.run({ input: [], history: [], instructions: [], options: {} }, {
      mode: 'scoped', model: { baseUrl: 'http://x', token: 't' }, paths: { runtimeDir: dir, workspaceDir: dir },
      signal: new AbortController().signal, output: { emit: async () => {} }, attachments: {}, log: { info() {} },
    }), /已释放/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('definition end-to-end over a scoped model proxy', async () => {
  const { dir, cleanup } = await workspace()
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (parsed.messages.some(message => message.role === 'tool')) {
        response.write('data: {"choices":[{"delta":{"content":"README 已读"}}]}\n\n')
        response.end('data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":3}}\n\ndata: [DONE]\n\n')
        return
      }
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const definition = createAgentDefinition({ log: { info() {} } })
    const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
    const { run, events } = fakeRun(dir)
    run.model = { apiMode: 'chat_completions', baseUrl: `http://127.0.0.1:${port}`, token: 'tk', model: 'test' }
    const result = await session.run({ input: [{ type: 'text', text: '读 README' }], history: [], instructions: [{ kind: 'system', text: '额外指令' }], options: {} }, run)
    assert.equal(result.finishReason, 'stop')
    assert.match(result.content[0].text, /README 已读/)
    assert.equal(result.usage.inputTokens, 9)
    assert.ok(events.some(event => event.type === 'tool.completed' && String(event.result).includes('# deva')))
    await session.dispose()
  } finally {
    await new Promise(resolve => server.close(resolve))
    await cleanup()
  }
})

test('the same call repeated with the same result stops the loop and asks for a wrap-up', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run, events } = fakeRun(dir)
    const prompts = []
    let calls = 0
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {},
      input: { input: [{ type: 'text', text: '反复读同一个文件会怎样' }], history: [], instructions: [], options: {} },
      model: async request => {
        prompts.push(request.messages)
        calls++
        // 一直用同一参数调用同一工具：结果永远一样，属于原地打转。
        return { text: '', toolCalls: [{ id: `c${calls}`, name: 'read_file', arguments: '{"path":"README.md"}' }], finish: 'tool_calls' }
      },
    })
    // 第 5 次达到 REPEAT_STOP：这一次之后不再执行工具，下一步改发收尾请求。
    // 收尾那一步模型仍然调工具（脚本如此），调用不执行，整轮到此为止。
    assert.ok(calls <= 7, `应在打转判定后停下，实际调用 ${calls} 次`)
    assert.equal(result.finishReason, 'stop')
    // 第 3 次起工具结果后附提醒。
    const warned = prompts.find(messages => messages.some(message => message.role === 'tool' && /连续 \d+ 次调用 read_file/.test(String(message.text))))
    assert.ok(warned, 'REPEAT_WARN 次后应附提醒')
    // 收尾请求本身以 user 消息回灌，说明工具已停止。
    assert.ok(prompts.some(messages => messages.some(message => message.role === 'user' && /工具调用已停止/.test(String(message.text)))))
    const stopped = events.filter(event => event.type === 'tool.failed' && /原地打转/.test(String(event.error)))
    assert.ok(stopped.length >= 1, '收尾请求里带来的调用要如实标成未执行')
  } finally { await cleanup() }
})

test('a broken DSML call is reported as failed and never executed', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const { run, events } = fakeRun(dir)
    let seenResult
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {},
      input: { input: [{ type: 'text', text: 'x' }], history: [], instructions: [], options: {} },
      model: async () => {
        if (!seenResult) {
          seenResult = true
          // broken=true 表示参数残缺（适配器从漏出的 DSML 里恢复、但没写完）：不执行，只回灌说明。
          return { text: '', toolCalls: [{ id: 'cb', name: 'write_file', arguments: '{"path":"a.txt"}', broken: true }], finish: 'tool_calls' }
        }
        return { text: '已改用完整参数重发', toolCalls: [], finish: 'stop' }
      },
    })
    assert.equal(result.finishReason, 'stop')
    assert.ok(events.some(event => event.type === 'tool.failed' && /参数残缺/.test(String(event.error))))
    assert.doesNotMatch(events.map(event => event.type).join(','), /tool\.completed/, '残缺调用不该被执行')
  } finally { await cleanup() }
})

test('definition end-to-end: a memory written mid-turn reaches the next step and never rewrites the system prefix', async () => {  const { dir, cleanup } = await workspace()
  const seen = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body)
      seen.push({ system: parsed.messages[0].content, messages: parsed.messages })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (parsed.messages.some(message => message.role === 'tool')) {
        response.write('data: {"choices":[{"delta":{"content":"记住了"}}]}\n\n')
        response.end('data: [DONE]\n\n')
        return
      }
      const args = JSON.stringify({ type: 'feedback', title: '先跑测试再交付', body: '规则：改完先跑相关测试。' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'memory_write', arguments: args } }] }, finish_reason: 'tool_calls' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const definition = createAgentDefinition({ log: { info() {} } })
    const session = await definition.runtime.createSession({ identity: { sessionId: 's' }, paths: { runtimeDir: dir, workspaceDir: dir } })
    const { run } = fakeRun(dir)
    run.model = { apiMode: 'chat_completions', baseUrl: `http://127.0.0.1:${port}`, token: 'tk', model: 'test' }
    const result = await session.run({ input: [{ type: 'text', text: '以后改完先跑测试' }], history: [], instructions: [], options: {} }, run)
    assert.equal(result.finishReason, 'stop')
    assert.equal(seen.length, 2)

    // 系统提示词只放规则：两次请求一字不差（写记忆不会作废提示缓存前缀），且不含条目内容。
    assert.equal(seen[0].system, seen[1].system)
    assert.match(seen[0].system, /【长期记忆】/)
    assert.doesNotMatch(seen[0].system, /先跑测试再交付/)

    // 第一步还没有记忆索引；第二步带上了刚写入的那条（做事方式类附正文）。
    assert.ok(!seen[0].messages.some(message => String(message.content).startsWith('【记忆】')))
    const index = seen[1].messages.find(message => String(message.content).startsWith('【记忆】'))
    assert.ok(index, '第二步应带上记忆索引')
    assert.match(index.content, /先跑测试再交付/)
    assert.match(index.content, /规则：改完先跑相关测试。/)
    await session.dispose()
  } finally {
    await new Promise(resolve => server.close(resolve))
    await cleanup()
  }
})

test('the memory index is re-read only after a successful memory write or delete', async () => {
  const { dir, cleanup } = await workspace()
  try {
    const records = new Map()
    let entriesReads = 0
    const countingStorage = (prefix = 'root') => ({
      namespace: (...parts) => countingStorage(`${prefix}/${parts.join('/')}`),
      get: async key => {
        if (key === 'entries') entriesReads++
        return records.get(`${prefix}#${key}`)
      },
      set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
      async delete(key) { records.delete(`${prefix}#${key}`) },
      keys: async () => [...records.keys()],
    })
    const { run } = fakeRun(dir)
    run.state = { plugin: countingStorage('plugin'), user: countingStorage('user'), profile: countingStorage('profile') }

    let step = 0
    const result = await runAgentTurn({
      run, workspaceDir: dir, system: 'sys', facts: {},
      input: { input: [{ type: 'text', text: '做点事' }], history: [], instructions: [], options: {} },
      execute: async name => (name === 'read_file' ? '文件内容' : '已记录'),
      model: async () => {
        step++
        if (step === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }], finish: 'tool_calls' }
        if (step === 2) return { text: '', toolCalls: [{ id: 'c2', name: 'memory_write', arguments: '{"type":"user","title":"t","body":"b"}' }], finish: 'tool_calls' }
        return { text: '完成', toolCalls: [], finish: 'stop' }
      },
    })
    assert.equal(result.finishReason, 'stop')
    // 开场读一次（全局 + 项目两层）；普通工具步不重读；写入后下一步再读一次（两层）。
    assert.equal(entriesReads, 4)
  } finally { await cleanup() }
})
