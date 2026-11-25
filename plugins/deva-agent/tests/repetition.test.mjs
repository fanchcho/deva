import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  trailingRepetition, watchRepetition, cutTrailingRepetition,
} from '../lib/repetition.mjs'
import { runAgentTurn } from '../lib/loop.mjs'

/** 一段 12 字符的中文单元；重复 30 遍 = 360 字符，够格判为复读。 */
const UNIT = '这是一段很长的中文内容。'
const LOOPING = UNIT.repeat(30)

function chunks(text, size = 40) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

function memoryStorage(records = new Map(), prefix = 'root') {
  return {
    namespace: (...parts) => memoryStorage(records, `${prefix}/${parts.join('/')}`),
    get: async key => records.get(`${prefix}#${key}`),
    set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
    async delete(key) { records.delete(`${prefix}#${key}`) },
    keys: async () => [...records.keys()],
  }
}

async function fakeRun() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-repetition-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))
  const records = new Map()
  const events = []
  const controller = new AbortController()
  return {
    dir,
    events,
    run: {
      mode: 'scoped',
      model: { apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:1', token: 'tk', model: 'test' },
      paths: { workspaceDir: dir, runtimeDir: dir },
      state: { agentSession: memoryStorage(records, 'agent-session'), user: memoryStorage(records, 'user') },
      signal: controller.signal,
      log: { info() {}, warn() {}, error() {} },
      identity: { userId: 1, profile: 'default', agentId: 'plugin:deva/deva', sessionId: 's1', runId: 'r1' },
      output: { emit: async event => { events.push(event) } },
      attachments: { resolve: async () => ({ localPath: dir, mediaType: 'text/plain', name: 'x' }), read: async () => new Uint8Array() },
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/** 模拟真实适配器：onDelta 抛出 StreamAbort 时让异常穿出模型调用。 */
async function stream(request, text) {
  for (const delta of chunks(text)) await request.onDelta(delta)
  return { text, toolCalls: [], finish: 'stop' }
}

const input = { input: [{ type: 'text', text: '写点东西' }], history: [], instructions: [], options: {} }

test('trailingRepetition only looks at the tail', () => {
  const text = `开头正常。\n${LOOPING}`
  const hit = trailingRepetition(text)
  assert.ok(hit)
  assert.equal(hit.start, '开头正常。\n'.length)
  // 复读在中间、结尾已经恢复正常：结尾不算复读。
  assert.equal(trailingRepetition(`${LOOPING}然后收尾一句。`), null)
})

test('watchRepetition is throttled and detects across deltas', () => {
  const watch = watchRepetition()
  const hits = []
  for (const delta of chunks(LOOPING, 10)) hits.push(watch(delta))
  assert.ok(hits.some(Boolean))
  // 逐条不同的长文本（正常输出）：从头到尾都不命中。
  const varied = watchRepetition()
  const variedText = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 步：处理编号 ${i * 7 + 3} 的条目`).join('；')
  assert.ok(chunks(variedText, 10).every(delta => !varied(delta)))
})

test('cutTrailingRepetition keeps a single copy', () => {
  assert.equal(cutTrailingRepetition(LOOPING), UNIT)
  assert.equal(cutTrailingRepetition('没有复读'), '没有复读')
})

test('a looping reply is retried once without costing a step', async () => {
  const { run, events, cleanup } = await fakeRun()
  try {
    let attempts = 0
    const result = await runAgentTurn({
      run, workspaceDir: run.paths.workspaceDir, system: 'sys', facts: {}, maxSteps: 2,
      input,
      model: async request => {
        attempts++
        if (attempts === 1) return await stream(request, LOOPING)
        return await stream(request, '这次正常收尾。')
      },
    })
    assert.equal(attempts, 2)
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.content[0].text, '这次正常收尾。')
    // 复读段已经发成增量（没有撤回通道），但最终 content 只有正常的那段。
    assert.ok(events.filter(event => event.type === 'text.delta').length > 1)
    assert.doesNotMatch(result.content[0].text, /逐字重复/)
  } finally { await cleanup() }
})

test('a second loop truncates to the first copy and says so', async () => {
  const { run, cleanup } = await fakeRun()
  try {
    let attempts = 0
    const result = await runAgentTurn({
      run, workspaceDir: run.paths.workspaceDir, system: 'sys', facts: {},
      input,
      model: async request => { attempts++; return await stream(request, LOOPING) },
    })
    assert.equal(attempts, 2)
    assert.equal(result.finishReason, 'length')
    assert.ok(result.content[0].text.startsWith(UNIT))
    assert.equal(result.content[0].text.split(UNIT).length - 1, 1)
    assert.match(result.content[0].text, /逐字重复/)
  } finally { await cleanup() }
})

test('a looping reasoning stream retries the step too', async () => {
  const { run, cleanup } = await fakeRun()
  try {
    let attempts = 0
    const result = await runAgentTurn({
      run, workspaceDir: run.paths.workspaceDir, system: 'sys', facts: {},
      input,
      model: async request => {
        attempts++
        if (attempts === 1) {
          for (const delta of chunks(LOOPING)) await request.onReasoning(delta)
          return { text: '不应采信', toolCalls: [], finish: 'stop' }
        }
        return await stream(request, '想清楚了。')
      },
    })
    assert.equal(attempts, 2)
    assert.equal(result.content[0].text, '想清楚了。')
  } finally { await cleanup() }
})

test('real model errors are not mistaken for the repetition abort', async () => {
  const { run, cleanup } = await fakeRun()
  try {
    await assert.rejects(runAgentTurn({
      run, workspaceDir: run.paths.workspaceDir, system: 'sys', facts: {}, input,
      model: async () => { throw new Error('模型请求失败：HTTP 500') },
    }), /HTTP 500/)
  } finally { await cleanup() }
})
