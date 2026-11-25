import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerCompression, summarizeConversation } from '../lib/compression.mjs'

test('compression is disabled by default and old hosts fall back explicitly', () => {
  let calls = 0; const warnings = []
  const ctx = { config: {}, extensions: {}, lifecycle: { add() { calls++ } }, log: { warn: x => warnings.push(x) } }
  registerCompression(ctx); assert.equal(calls, 0); assert.equal(warnings.length, 0)
  ctx.config.compressionEnabled = true; registerCompression(ctx)
  assert.equal(calls, 0); assert.match(warnings[0], /未提供注册接口/)
})
test('enabled compression uses only the optional host registration and tracks its disposer', () => {
  let fn, tracked, disposed = false
  const dispose = () => { disposed = true }
  registerCompression({ config: { compressionEnabled: true }, extensions: { compression: { register: handler => { fn = handler; return dispose } } }, lifecycle: { add: x => { tracked = x } } })
  assert.equal(fn, summarizeConversation); tracked(); assert.equal(disposed, true)
})
test('compression preserves previous summary, obeys byte budget and never rewrites input', () => {
  const input = { transcript: '开始 中文 text '.repeat(200), history: [{ role: 'user', content: 'keep' }], previousSummary: 'previous facts', summaryBudget: 256 }
  const original = structuredClone(input)
  const summary = summarizeConversation(input, { config: { compressionEnabled: true } })
  assert.match(summary, /^previous facts/); assert.ok(Buffer.byteLength(summary) <= 256)
  assert.deepEqual(input, original)
  assert.equal(summarizeConversation(input, { config: {} }), null)
  assert.equal(summarizeConversation(input, { config: { compressionEnabled: true }, signal: { aborted: true } }), null)
  assert.equal(summarizeConversation({ ...input, previousSummary: 'x'.repeat(300) }, { config: { compressionEnabled: true } }), null)
})
