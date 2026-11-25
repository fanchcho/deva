import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCheckpointController } from '../lib/checkpoint.mjs'
import { runAgentTurn } from '../lib/loop.mjs'
import { approveTool } from '../lib/approval.mjs'
const identity = { userId: 1, profile: 'default', sessionId: 's', agentId: 'plugin:deva/deva' }
const call = (id, name = 'write_file') => ({ id, name, arguments: '{"path":"x","content":"a"}' })
function fixture() {
  const values = new Map(), controller = new AbortController()
  const run = { identity, signal: controller.signal, state: { agentSession: { get: async k => structuredClone(values.get(k)), set: async (k,v) => values.set(k, structuredClone(v)) } }, output: { emit: async () => {} } }
  const execute = (checkpoint, model, tool) => runAgentTurn({ run, input: { input: [{ type: 'text', text: 'continue' }], history: [] }, system: 'system', checkpoint, model, execute: tool })
  return { run, values, controller, execute }
}
test('checkpoint resumes after model failure without repeating completed tools', async () => {
  const f = fixture(); let effects = 0, n = 0
  const first = createCheckpointController(identity)
  await assert.rejects(f.execute(first, async () => { if (++n === 1) return { text: '', toolCalls: [call('c1')] }; throw new Error('network') }, async () => { effects++; return 'written' }), /network/)
  const saved = await first.snapshot(); assert.equal(saved.data.active, true)
  const resumed = createCheckpointController(identity, saved)
  const result = await f.execute(resumed, async ({ messages }) => {
    assert.ok(messages.some(m => m.role === 'tool' && m.text === 'written'))
    return { text: 'done', toolCalls: [] }
  }, async () => { effects++; return 'bad' })
  assert.equal(effects, 1); assert.equal(result.content[0].text, 'done')
  assert.equal((await resumed.snapshot()).data.active, false)
})
test('mid-tool cancellation persists unknown outcome and resumes without replay', async () => {
  const f = fixture(); let effects = 0
  const cp = createCheckpointController(identity)
  await assert.rejects(f.execute(cp, async () => ({ text: '', toolCalls: [call('c1')] }), async () => { effects++; f.controller.abort(); throw new Error('aborted after side effect') }))
  assert.equal((await cp.snapshot()).data.calls.c1.status, 'running')
  f.run.signal = new AbortController().signal
  await f.execute(createCheckpointController(identity, await cp.snapshot()), async ({ messages }) => {
    assert.match(messages.filter(m => m.role === 'tool').at(-1).text, /interrupted_unknown/)
    return { text: 'checked', toolCalls: [] }
  }, async () => { effects++; return 'bad' })
  assert.equal(effects, 1)
})
test('recovery deduplicates the same completed action even if model gives it a new callId', async () => {
  const f = fixture(); let effects = 0, n = 0
  const cp = createCheckpointController(identity)
  await assert.rejects(f.execute(cp, async () => { if (++n === 1) return { text: '', toolCalls: [call('c1')] }; throw new Error('network') }, async () => { effects++; return 'written' }))
  n = 0
  await f.execute(createCheckpointController(identity, await cp.snapshot()), async () => ++n === 1 ? { text: '', toolCalls: [call('new-id')] } : { text: 'done', toolCalls: [] }, async () => { effects++; return 'bad' })
  assert.equal(effects, 1)
})
test('checkpoint rejects wrong owner, version and malformed call records', async () => {
  const cp = createCheckpointController(identity), state = await cp.snapshot()
  assert.throws(() => createCheckpointController({ ...identity, userId: 2 }, state), /不匹配/)
  assert.throws(() => createCheckpointController(identity, { ...state, schemaVersion: 2 }))
  state.data.calls.a = { key: 'x', status: 'nonsense', text: '' }
  assert.throws(() => createCheckpointController(identity, state))
})
test('checkpoint storage failure prevents a new tool side effect', async () => {
  const f = fixture(); let effects = 0
  f.run.state.agentSession.set = async () => { throw new Error('disk full') }
  await assert.rejects(f.execute(createCheckpointController(identity), async () => ({ text: '', toolCalls: [call('c1')] }), async () => { effects++ }), /disk full/)
  assert.equal(effects, 0)
})
test('approval is off by default and cannot be enabled/disabled by model tool arguments', async () => {
  let count = 0
  await approveTool({ interactions: { approve: async () => { count++ } } }, call('a'))
  assert.equal(count, 0)
})
for (const outcome of ['approved', 'denied', 'cancelled', 'timeout']) test(`approval outcome ${outcome} controls actual execution`, async () => {
  const f = fixture(); f.run.config = { approvalEnabled: true }; f.run.interactions = { approve: async () => ({ outcome }) }
  let step = 0, effects = 0
  await f.execute(null, async () => ++step === 1 ? { text: '', toolCalls: [call('a')] } : { text: 'done', toolCalls: [] }, async () => { effects++; return 'ok' })
  assert.equal(effects, outcome === 'approved' ? 1 : 0)
})
test('enabled approval fails closed on older hosts with no approve method', async () => {
  await assert.rejects(approveTool({ config: { approvalEnabled: true } }, call('a')), /宿主不支持/)
})

test('newer durable checkpoint wins over stale host resumeState', async () => {
  const f = fixture(), cp = createCheckpointController(identity)
  await cp.begin(f.run, [{ role: 'user', text: 'start' }]); const old = await cp.snapshot()
  await cp.stage([{ role: 'user', text: 'start' }, { role: 'assistant', text: '', toolCalls: [call('a')] }], '', [call('a')])
  await cp.started(call('a')); await cp.finished(call('a'), 'already-done', false)
  const resumed = createCheckpointController(identity, old)
  const data = await resumed.begin(f.run, [{ role: 'user', text: 'continue' }])
  assert.ok(data.messages.some(m => m.text === 'already-done'))
  assert.equal(resumed.replay({ ...call('b'), arguments: '{ "content": "a", "path": "x" }' }).text, 'already-done')
})

test('deduplication ends after the recovered turn and does not suppress a later intentional action', async () => {
  const f = fixture(), cp = createCheckpointController(identity)
  await cp.begin(f.run, [{ role: 'user', text: 'start' }])
  await cp.stage([], '', [call('a')]); await cp.started(call('a')); await cp.finished(call('a'), 'done', false)
  const resumed = createCheckpointController(identity, await cp.snapshot())
  await resumed.begin(f.run, [{ role: 'user', text: 'continue' }])
  assert.ok(resumed.replay(call('b')))
  await resumed.complete([], 'done')
  const revision = (await resumed.snapshot()).data.revision
  await resumed.begin(f.run, [{ role: 'user', text: 'do it again' }])
  assert.equal(resumed.replay(call('c')), null)
  assert.ok((await resumed.snapshot()).data.revision > revision)
})

test('restoring a completed checkpoint returns its result if final delivery was interrupted', async () => {
  const f = fixture(), cp = createCheckpointController(identity)
  await f.execute(cp, async () => ({ text: 'final answer', toolCalls: [] }))
  const result = await f.execute(createCheckpointController(identity, await cp.snapshot()), async () => { throw new Error('must not rerun') })
  assert.equal(result.content[0].text, 'final answer')
})
