import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgentTurn } from '../lib/loop.mjs'

function scenario() {
  const controller = new AbortController()
  const events = []
  const lateEvents = []
  const run = {
    signal: controller.signal,
    model: {},
    paths: {},
    output: { async emit(event) {
      events.push(event)
      if (controller.signal.aborted) lateEvents.push(event)
    } },
  }
  const options = { run, input: { input: [], history: [] }, system: 'test', maxSteps: 1 }
  return { controller, events, lateEvents, options }
}

const call = (id, name) => ({ id, name, arguments: '{}' })

test('cancellation after a model response prevents tool dispatch and late events', async () => {
  const { controller, lateEvents, options } = scenario()
  const executed = []
  await assert.rejects(runAgentTurn({
    ...options,
    model: async () => {
      controller.abort()
      return { text: '', toolCalls: [call('write', 'write_file')] }
    },
    execute: async name => { executed.push(name); return 'written' },
  }), /取消/)
  assert.deepEqual(executed, [])
  assert.deepEqual(lateEvents, [])
})

test('cancelling during a serial tool batch prevents the remaining writes', async () => {
  const { controller, lateEvents, options } = scenario()
  const executed = []
  await assert.rejects(runAgentTurn({
    ...options,
    model: async () => ({ text: '', toolCalls: [call('first', 'write_file'), call('second', 'edit_file')] }),
    execute: async name => {
      executed.push(name)
      controller.abort()
      return 'first write finished'
    },
  }), /取消/)
  assert.deepEqual(executed, ['write_file'])
  assert.deepEqual(lateEvents, [])
})

test('queued subagents do not start after cancellation releases a slot', async () => {
  const { controller, lateEvents, options } = scenario()
  const executed = []
  await assert.rejects(runAgentTurn({
    ...options,
    model: async () => ({ text: '', toolCalls: [1, 2, 3, 4].map(id => call(String(id), 'run_subagent')) }),
    execute: async (_name, _args, ctx) => {
      executed.push(ctx.callId)
      await Promise.resolve()
      controller.abort()
      return 'child finished'
    },
  }), /取消/)
  // Let every dispatched promise and the queued slot settle before checking side effects.
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(executed, ['1', '2', '3'])
  assert.deepEqual(lateEvents, [])
})

test('cancellation suppresses late text and reasoning deltas', async () => {
  for (const callback of ['onDelta', 'onReasoning']) {
    const { controller, lateEvents, options } = scenario()
    await assert.rejects(runAgentTurn({
      ...options,
      model: async request => {
        controller.abort()
        await request[callback]('late text')
        return { text: 'late text', toolCalls: [] }
      },
    }), /取消/)
    assert.deepEqual(lateEvents, [])
  }
})
