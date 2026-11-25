import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgentTurn } from '../lib/loop.mjs'

const runScript = (model, execute, emit = async () => {}) => runAgentTurn({
  run: { signal: new AbortController().signal, output: { emit } },
  input: { input: [{ type: 'text', text: 'test' }], history: [] }, system: 'test',
  model, execute,
})

test('partial multi-step usage remains unknown rather than a false exact sum', async () => {
  let step = 0
  const result = await runScript(async () => ++step === 1
    ? { text: '', toolCalls: [{ id: 'one', name: 'list_dir', arguments: '{}' }] }
    : { text: 'done', toolCalls: [], usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0 } }, async () => 'ok')
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, cacheReadTokens: null, costUsd: null, isEstimated: false })
})

test('usage accumulation cannot overflow the SDK safe integer range', async () => {
  let step = 0
  const result = await runScript(async () => ({ text: ++step === 1 ? '' : 'done',
    toolCalls: step === 1 ? [{ id: 'one', name: 'list_dir', arguments: '{}' }] : [],
    usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, cacheReadTokens: 0 },
  }), async () => 'ok')
  assert.equal(result.usage.inputTokens, null)
  assert.equal(result.usage.outputTokens, 2)
})

for (const calls of [
  [{ id: '', name: 'read_file' }],
  [{ id: 'one', name: '' }],
  [{ id: 'same', name: 'read_file' }, { id: 'same', name: 'read_file' }],
]) {
  test(`invalid tool batch fails before events or execution: ${JSON.stringify(calls)}`, async () => {
    const events = [], executed = []
    await assert.rejects(runScript(async () => ({ text: '', toolCalls: calls }),
      async name => { executed.push(name); return 'ok' }, async event => events.push(event)), /工具调用.*标识/)
    assert.deepEqual(executed, [])
    assert.deepEqual(events.filter(event => event.type.startsWith('tool.')), [])
  })
}

test('usage remains unknown when repetition interrupts a charged model attempt', async () => {
  let step = 0
  const result = await runScript(async request => {
    if (++step === 1) await request.onDelta('重复片段'.repeat(100))
    return { text: 'done', toolCalls: [], usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0 } }
  })
  assert.equal(step, 2)
  assert.equal(result.usage.inputTokens, null)
  assert.equal(result.usage.outputTokens, null)
})
