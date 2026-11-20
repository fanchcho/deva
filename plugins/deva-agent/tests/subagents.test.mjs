import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_SUBAGENTS, FORK_AGENT, GENERAL_SUBAGENT, SUBAGENT_EXCLUDED, SUBAGENT_TOOLS,
  buildSubagentSystem, executeSubagentTool, getSubagentByName, isForkAgent, subagentSummaries, subagentTools,
} from '../lib/subagents.mjs'
import { TOOL_DEFINITIONS } from '../lib/tools.mjs'
import { runAgentTurn } from '../lib/loop.mjs'

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
  return {
    plugin: memoryStorage(records, 'plugin'),
    user: memoryStorage(records, 'user'),
    profile: memoryStorage(records, 'profile'),
    agentSession: memoryStorage(records, 'agent-session'),
  }
}

function fakeRun({ workspaceDir = null, sessionId = 's1' } = {}) {
  const events = []
  const controller = new AbortController()
  return {
    events,
    run: {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir, runtimeDir: workspaceDir },
      state: memoryState(),
      signal: controller.signal,
      log: { info() {}, warn() {}, error() {} },
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId, runId: 'r1' },
      output: { emit: async event => { events.push(event) } },
      attachments: { resolve: async () => ({ localPath: '/tmp/x', mediaType: 'text/plain' }), read: async () => new Uint8Array() },
    },
  }
}

test('builtin subagents match the desktop catalogue and keep read-only tool sets', () => {
  assert.deepEqual(BUILTIN_SUBAGENTS.map(item => item.name), ['General', 'Explore', 'Research', 'Plan'])
  assert.deepEqual(subagentSummaries().map(item => item.name), ['General', 'Explore', 'Research', 'Plan', 'fork'])
  assert.equal(getSubagentByName('explore').name, 'Explore')
  assert.equal(getSubagentByName('general-purpose').name, 'General')
  assert.equal(getSubagentByName('ghost'), null)
  assert.equal(isForkAgent('FORK'), true)
  for (const name of ['Explore', 'Research', 'Plan']) {
    const def = getSubagentByName(name)
    assert.ok(!def.tools.includes('write_file'), `${name} 不应有 write_file`)
    assert.ok(!def.tools.includes('edit_file'), `${name} 不应有 edit_file`)
    assert.ok(def.tools.includes('read_file') && def.tools.includes('grep') && def.tools.includes('run_command'))
    assert.match(buildSubagentSystem(def, '/repo'), /你无法向用户提问/)
  }
  assert.equal(GENERAL_SUBAGENT.tools, '*')
  assert.equal(FORK_AGENT.name, 'fork')
})

test('subagent tool table narrows builtins, strips interaction tools and keeps MCP tools', () => {
  const mcp = { name: 'mcp__svc__ping', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } }
  const general = subagentTools(getSubagentByName('General'), { baseTools: TOOL_DEFINITIONS, extraTools: [mcp] })
  const names = general.map(tool => tool.name)
  for (const banned of SUBAGENT_EXCLUDED) assert.ok(!names.includes(banned), `${banned} 应被剔除`)
  assert.ok(names.includes('write_file'))
  assert.ok(names.includes('mcp__svc__ping'))

  const explore = subagentTools(getSubagentByName('Explore'), { baseTools: TOOL_DEFINITIONS, extraTools: [mcp] })
  // 顺序沿用本插件工具表的定义顺序，MCP 工具追加在后。
  assert.deepEqual(explore.map(tool => tool.name), ['read_file', 'list_dir', 'glob', 'grep', 'run_command', 'web_fetch', 'mcp__svc__ping'])
  assert.ok(!explore.some(tool => tool.name === 'write_file'))
})

test('run_subagent runs an isolated child turn and returns only its conclusion', async () => {
  const { run } = fakeRun()
  const seen = []
  const result = await executeSubagentTool('run_subagent', { description: '查版本', agent: 'Explore', prompt: '找出 package.json 的版本' }, {
    run,
    callId: 'call-1',
    depth: 0,
    workspaceDir: null,
    system: '主对话系统提示词',
    messages: [{ role: 'user', text: '主对话里的内容' }],
    runTurn: async args => {
      seen.push(args)
      return { content: [{ type: 'text', text: '版本是 0.7.0，位于 package.json:2' }], finishReason: 'stop' }
    },
  })
  assert.match(result, /结论（子智能体 Explore）/)
  assert.match(result, /0\.7\.0/)
  assert.match(result, /子智能体 ID：sub-[0-9a-f]{8}/)
  const child = seen[0]
  assert.deepEqual(child.initialMessages, [{ role: 'user', text: '找出 package.json 的版本' }], '子智能体只带本次任务，不继承主对话')
  assert.match(child.system, /你是子智能体「Explore」/)
  assert.doesNotMatch(child.system, /主对话系统提示词/)
  assert.ok(child.tools.every(tool => ['read_file', 'list_dir', 'glob', 'grep', 'run_command', 'web_fetch'].includes(tool.name)))
  assert.equal(child.depth, 1)
  assert.equal(child.silent, true)
})

test('unknown agent falls back to General with an explicit note; missing prompt fails', async () => {
  const { run } = fakeRun()
  let childSystem = ''
  const result = await executeSubagentTool('run_subagent', { description: 'x', agent: 'Ghost', prompt: '做事' }, {
    run, callId: 'c2', runTurn: async args => { childSystem = args.system; return { content: [{ type: 'text', text: 'done' }], finishReason: 'stop' } },
  })
  assert.match(result, /没有名为「Ghost」的子智能体/)
  assert.match(result, /通用子智能体 General/)
  assert.match(childSystem, /你是子智能体「General」/)
  await assert.rejects(executeSubagentTool('run_subagent', { description: 'x' }, { run, runTurn: async () => ({}) }), /需要 prompt/)
})

test('subagents cannot spawn subagents, and fork inherits the parent conversation', async () => {
  const { run } = fakeRun()
  await assert.rejects(
    executeSubagentTool('run_subagent', { description: 'x', prompt: 'y' }, { run, depth: 1, runTurn: async () => ({}) }),
    /不能再派生/,
  )
  const seen = []
  const result = await executeSubagentTool('run_subagent', { description: '接着看', agent: 'fork', prompt: '继续分析' }, {
    run,
    callId: 'c3',
    depth: 0,
    system: '主对话系统提示词',
    messages: [{ role: 'user', text: '早先的问题' }, { role: 'assistant', text: '早先的回答' }],
    tools: TOOL_DEFINITIONS,
    runTurn: async args => { seen.push(args); return { content: [{ type: 'text', text: '接着的结论' }], finishReason: 'stop' } },
  })
  assert.match(result, /子智能体 fork/)
  assert.equal(seen[0].system, '主对话系统提示词')
  assert.deepEqual(seen[0].initialMessages, [
    { role: 'user', text: '早先的问题' },
    { role: 'assistant', text: '早先的回答' },
    { role: 'user', text: '继续分析' },
  ])
  assert.ok(!seen[0].tools.some(tool => tool.name === 'run_subagent'), 'fork 工具表里也要去掉派生工具')
})

test('a dispatched subagent is persisted for send_to_subagent follow-ups', async () => {
  const { run } = fakeRun()
  const replies = ['第一轮结论', '第二轮结论']
  const seen = []
  // 真实的 runTurn 会把结论与工具消息写进 initialMessages；这里按同样规则追加，验证续聊上下文。
  const runTurn = async args => {
    // 记录调用当时的消息快照（数组后续还会被追加）。
    seen.push({ ...args, initialMessages: args.initialMessages.map(message => message.text) })
    const text = replies.shift()
    args.initialMessages.push({ role: 'assistant', text })
    return { content: [{ type: 'text', text }], finishReason: 'stop' }
  }
  const first = await executeSubagentTool('run_subagent', { description: '调研', agent: 'Plan', prompt: '出方案' }, { run, callId: 'call-a', runTurn })
  const id = first.match(/sub-[0-9a-f]{8}/)[0]
  const records = await run.state.agentSession.get('subagents')
  assert.deepEqual(Object.keys(records), [id])
  assert.equal(records[id].agent, 'Plan')

  const second = await executeSubagentTool('send_to_subagent', { to: id, message: '再补一条风险' }, { run, callId: 'call-b', runTurn })
  assert.match(second, /第二轮结论/)
  assert.match(second, new RegExp(id))
  // 续聊要能看到上一轮自己的结论，不能只有用户消息。
  assert.deepEqual(seen[1].initialMessages, ['出方案', '第一轮结论', '再补一条风险'])

  const third = await executeSubagentTool('send_to_subagent', { to: id, message: '再收一次' }, {
    run,
    runTurn: async args => {
      seen.push({ ...args, initialMessages: args.initialMessages.map(message => message.text) })
      args.initialMessages.push({ role: 'assistant', text: '第三轮结论' })
      return { content: [{ type: 'text', text: '第三轮结论' }], finishReason: 'stop' }
    },
  })
  assert.match(third, /第三轮结论/)
  const stored = (await run.state.agentSession.get('subagents'))[id]
  assert.deepEqual(stored.messages.map(message => message.text), ['出方案', '第一轮结论', '再补一条风险', '第二轮结论', '再收一次', '第三轮结论'])
  await assert.rejects(executeSubagentTool('send_to_subagent', { to: 'sub-deadbeef', message: 'x' }, { run, runTurn }), /已不可用/)
  await assert.rejects(executeSubagentTool('send_to_subagent', { to: id }, { run, runTurn }), /需要 to/)
})

test('child failures and missing stores are reported honestly', async () => {
  const { run } = fakeRun()
  await assert.rejects(
    executeSubagentTool('run_subagent', { description: 'x', prompt: 'y' }, { run, runTurn: async () => { throw new Error('模型请求失败：HTTP 500') } }),
    /子智能体「General」运行失败：模型请求失败：HTTP 500/,
  )
  const noStore = fakeRun().run
  noStore.state.agentSession = null
  const result = await executeSubagentTool('run_subagent', { description: 'x', prompt: 'y' }, {
    run: noStore, runTurn: async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' }),
  })
  assert.match(result, /没有会话存储/)
  assert.doesNotMatch(result, /子智能体 ID/)
  await assert.rejects(executeSubagentTool('run_subagent', { description: 'x', prompt: 'y' }, { run }), /缺少子智能体的运行入口/)
})

test('runAgentTurn executes run_subagent end to end and hides child events from the parent stream', async () => {
  const { run, events } = fakeRun()
  const parentSteps = [
    { text: '交给子智能体', toolCalls: [{ id: 'call-1', name: 'run_subagent', arguments: '{"description":"查版本","agent":"Explore","prompt":"找出 package.json 的版本"}' }], finish: 'tool_calls' },
    { text: '子智能体说版本是 0.7.0', toolCalls: [], finish: 'stop' },
  ]
  const result = await runAgentTurn({
    run, workspaceDir: null, system: 'sys', facts: {},
    input: { input: [{ type: 'text', text: '版本多少' }], history: [], instructions: [], options: {} },
    model: async request => {
      // 子轮的模型调用带子智能体系统提示词，返回结论；主轮按脚本继续。
      if (request.system.includes('你是子智能体')) {
        return { text: '版本 0.7.0（package.json）', toolCalls: [], finish: 'stop' }
      }
      const next = parentSteps.shift()
      await request.onDelta(next.text)
      return next
    },
  })
  assert.equal(result.finishReason, 'stop')
  assert.match(result.content[0].text, /子智能体说版本是 0\.7\.0/)
  const toolResult = events.filter(event => event.type === 'tool.completed')
  assert.equal(toolResult.length, 1)
  assert.match(String(toolResult[0].result), /结论（子智能体 Explore）/)
  // 主轮自己的增量照常发；子轮那次模型调用前后没有任何额外事件（子轮是 silent 的）。
  assert.deepEqual(events.map(event => event.type), ['status', 'text.delta', 'tool.started', 'tool.completed', 'status', 'text.delta'])
})

test('subagent tools are part of the main tool set with honest foreground-only wording', () => {
  const names = TOOL_DEFINITIONS.map(tool => tool.name)
  assert.ok(names.includes('run_subagent'))
  assert.ok(names.includes('send_to_subagent'))
  const spec = SUBAGENT_TOOLS.find(tool => tool.name === 'run_subagent')
  assert.match(spec.description, /前台执行/)
  assert.equal(spec.inputSchema.properties.foreground, undefined, '不提供前台/后台开关：插件侧只能前台执行')
  assert.deepEqual(spec.inputSchema.properties.agent.enum, ['General', 'Explore', 'Research', 'Plan', 'fork'])
})

test('sibling subagents in one reply run concurrently and preserve result order', async () => {
  const { run, events } = fakeRun()
  const running = new Set()
  let concurrentPeak = 0
  const parentCalls = []
  const result = await runAgentTurn({
    run, workspaceDir: null, system: 'sys', facts: {},
    input: { input: [{ type: 'text', text: '查两件事' }], history: [], instructions: [], options: {} },
    model: async request => {
      if (request.system.includes('你是子智能体')) {
        const task = request.messages.at(-1).text
        running.add(task)
        concurrentPeak = Math.max(concurrentPeak, running.size)
        // 任务 B 先起跑但更慢：若实现是串行的，峰值最多 1。
        await new Promise(resolve => setTimeout(resolve, task === '任务B' ? 20 : 5))
        running.delete(task)
        return { text: `结论:${task}`, toolCalls: [], finish: 'stop' }
      }
      parentCalls.push(request.messages)
      if (parentCalls.length === 1) {
        return {
          text: '并行派发',
          toolCalls: [
            { id: 'call-a', name: 'run_subagent', arguments: JSON.stringify({ description: 'A', prompt: '任务A' }) },
            { id: 'call-b', name: 'run_subagent', arguments: JSON.stringify({ description: 'B', prompt: '任务B' }) },
          ],
          finish: 'tool_calls',
        }
      }
      return { text: '两件事都查完了', toolCalls: [], finish: 'stop' }
    },
  })
  assert.equal(concurrentPeak, 2, '两个子智能体应同时在跑，而不是一个跑完再跑另一个')
  assert.equal(result.content[0].text, '并行派发两件事都查完了')
  // 回灌顺序按模型给出的调用顺序：call-a 的结论在前，即使 B 更慢。
  const toolMessages = parentCalls[1].filter(message => message.role === 'tool')
  assert.deepEqual(toolMessages.map(message => message.toolCallId), ['call-a', 'call-b'])
  assert.match(toolMessages[0].text, /结论:任务A/)
  assert.match(toolMessages[1].text, /结论:任务B/)
  // 两条记录都落盘，且没有互相覆盖。
  const records = await run.state.agentSession.get('subagents')
  assert.equal(Object.keys(records).length, 2)
  const started = events.filter(event => event.type === 'tool.started').map(event => event.callId)
  assert.deepEqual(started, ['call-a', 'call-b'])
})

test('continuing a subagent closes a dangling tool-call tail left by an aborted turn', async () => {
  const { run } = fakeRun()
  await run.state.agentSession.set('subagents', {
    'sub-abcd1234': {
      id: 'sub-abcd1234',
      agent: 'Explore',
      description: '中断的任务',
      system: 'sys',
      messages: [
        { role: 'user', text: '开始' },
        { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'grep', arguments: '{}' }] },
        { role: 'tool', toolCallId: 't1', name: 'grep', text: '半截结果' },
      ],
      createdAt: 1,
      updatedAt: 1,
    },
  })
  let seenMessages = null
  const result = await executeSubagentTool('send_to_subagent', { to: 'sub-abcd1234', message: '接着做' }, {
    run,
    runTurn: async args => {
      seenMessages = args.initialMessages.map(message => message.role)
      return { content: [{ type: 'text', text: '续上了' }], finishReason: 'stop' }
    },
  })
  assert.match(result, /续上了/)
  // 悬空的 tool / assistant.toolCalls 被收掉，历史以「开始」+ 新消息继续，不会把坏结构交给模型。
  assert.deepEqual(seenMessages, ['user', 'user'])
})
