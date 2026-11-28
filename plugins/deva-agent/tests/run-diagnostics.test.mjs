import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createRunDiagnostics, readRunDiagnostics, redact } from '../lib/run-diagnostics.mjs'
import { createCheckpointController } from '../lib/checkpoint.mjs'
import { createAgentDefinition } from '../lib/agent.mjs'
const evidenceDir = process.env.DEVA_DIAGNOSTICS_TEST_DIR || fileURLToPath(new URL('../../../.tmp/plugin-run-diagnostics/', import.meta.url))
const root = join(evidenceDir, 'fixtures')
mkdirSync(root, { recursive: true })
function fixture() {
  const dir = mkdtempSync(join(root, 'run-'))
  const storage = prefix => ({
    namespace: (...parts) => storage(prefix + '-' + parts.join('-')),
    async get(key) { try { return JSON.parse(readFileSync(join(dir, prefix + '-' + key), 'utf8')) } catch(e) { if(e.code !== 'ENOENT') throw e } },
    async set(key, value) { writeFileSync(join(dir, prefix + '-' + key), JSON.stringify(value)) },
  })
  const identity = { userId: 1, sessionId: 'test-session', profile: 'default', agentId: 'plugin:deva/deva', runId: 'first' }
  const controller = new AbortController(), logs = []
  const run = { identity, paths: { runtimeDir: dir, workspaceDir: dir }, signal: controller.signal,
    state: { session: storage('profile'), agentSession: storage('session') },
    log: { info: x => logs.push(x), error: x => logs.push(x), warn: x => logs.push(x) }, output: { emit: async () => {} } }
  const checkpoint = createCheckpointController(identity)
  return { dir, run, controller, checkpoint, logs, diagnostics: createRunDiagnostics(run, checkpoint) }
}
const success = async () => ({ finishReason: 'stop', content: [] })
test('real rejected Agent action survives disk reload and later success with disconnected output', async () => {
  const f = fixture()
  const agent = { async run(run) { await run.output.emit({ type: 'tool.started', name: 'fake_tool' }); throw new Error('UNIQUE_FAILURE_874 token=fake-secret /home/alice/private', { cause: new Error('password=fake-password') }) } }
  await assert.rejects(f.diagnostics.execute(f.run, run => agent.run(run)), /UNIQUE_FAILURE/)
  f.run.identity.runId = 'second'; f.run.output.emit = async () => { throw new Error('disconnected') }
  await f.diagnostics.execute(f.run, success)
  const records = (await readRunDiagnostics(f.run)).records
  assert.equal(records.length, 2); assert.equal(records[0].terminal_state, 'plugin_exception')
  assert.match(records[0].error.message, /UNIQUE_FAILURE_874/)
  assert.equal(records[0].phase, 'tool.started:fake_tool')
  assert.equal((await f.checkpoint.snapshot()).data.runTerminals.length, 2)
  assert.match(f.logs[0], /deva.run_terminal/)
  assert.doesNotMatch(JSON.stringify(records), /fake-secret|fake-password|alice/)
  writeFileSync(join(evidenceDir, 'sample.json'), JSON.stringify(records, null, 2))
  const restored = createRunDiagnostics(f.run, createCheckpointController(f.run.identity))
  f.run.identity.runId = 'third'; await restored.execute(f.run, success)
  assert.equal((await readRunDiagnostics(f.run)).records[0].terminal_state, 'plugin_exception')
})
for (const [code, expected] of [['USER_STOP', 'user_abort'], ['DEADLINE_EXCEEDED', 'timeout'], [undefined, 'abort_unknown']]) {
  test('signal abort classification ' + expected, async () => {
    const f = fixture(), before = process.listenerCount('uncaughtExceptionMonitor')
    await assert.rejects(f.diagnostics.execute(f.run, async () => { f.controller.abort(Object.assign(new Error('cancelled'), { code })); f.controller.signal.throwIfAborted() }))
    assert.equal((await readRunDiagnostics(f.run)).records[0].terminal_state, expected)
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), before)
  })
}
test('dispose and observed shutdown flush synchronously without waiting for client', async () => {
  for (const state of ['plugin_dispose', 'host_shutdown', 'uncaught_exception']) {
    const f = fixture(), host = () => {}
    process.on('SIGTERM', host)
    const count = process.listenerCount('SIGTERM')
    try {
      await f.diagnostics.execute(f.run, async () => {
        if (state === 'plugin_dispose') f.diagnostics.dispose()
        else if (state === 'host_shutdown') process.emit('SIGTERM')
        else process.emit('uncaughtExceptionMonitor', new Error('UNIQUE_UNCAUGHT'))
        assert.equal(JSON.parse(readFileSync(join(f.dir, 'run-terminals.json'))).records[0].terminal_state, state)
        return success()
      })
      assert.equal(process.listenerCount('SIGTERM'), count)
    } finally { process.removeListener('SIGTERM', host) }
  }
})
test('ring bound, tool_limit and secret formats', async () => {
  const f = fixture()
  for (let i = 0; i < 23; i++) { f.run.identity.runId = String(i); await f.diagnostics.execute(f.run, async () => ({ finishReason: i === 22 ? 'tool_limit' : 'stop' })) }
  const records = (await readRunDiagnostics(f.run)).records
  assert.equal(records.length, 20); assert.equal(records.at(-1).terminal_state, 'tool_limit')
  assert.doesNotMatch(redact('Authorization: Bearer fake-auth\nCookie: session=fake-cookie\n{"api_key":"fake-key","password":"fake-pass"}\n/home/alice/x C:\\Users\\bob\\x'), /fake-|alice|bob/)
})
test('real Agent entry validation exception is captured without replacing original error', async () => {
  const f = fixture()
  const session = await createAgentDefinition({ log: f.run.log }).runtime.createSession(f.run)
  await assert.rejects(session.run({}, { ...f.run, mode: 'scoped', model: {} }), /scoped/)
  assert.equal((await readRunDiagnostics(f.run)).records[0].terminal_state, 'plugin_exception')
  session.dispose()
})

test('actual deadline timer produces timeout and leaves no abort listeners', async () => {
  const f = fixture(), c = new AbortController()
  f.run.signal = c.signal; f.run.deadlineAt = Date.now() + 10
  const timer = setTimeout(() => c.abort(new DOMException('deadline reached', 'TimeoutError')), 10)
  try {
    await assert.rejects(f.diagnostics.execute(f.run, run => new Promise((resolve, reject) => run.signal.addEventListener('abort', () => reject(run.signal.reason), { once: true }))))
    assert.equal((await readRunDiagnostics(f.run)).records[0].terminal_state, 'timeout')
  } finally { clearTimeout(timer) }
})
