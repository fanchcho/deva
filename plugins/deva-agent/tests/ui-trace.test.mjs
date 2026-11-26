import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('trace uses bounded rotation, restricted permissions and never copies RPC secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deva-trace-'))
  try {
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({version:'9.8.7'}))
    copyFileSync(new URL('../lib/ui-trace.mjs', import.meta.url), join(dir, 'lib/ui-trace.mjs'))
    const { writeUiTrace, tracedModelRpc, tracePath } = await import(pathToFileURL(join(dir, 'lib/ui-trace.mjs')))
    writeUiTrace({ phase: 'mount', bottom: 125, modelName: 'route-model', reasoningEffort: 'low', apiKey: 'never-log-this', input: { secret: 'never-log-this' } })
    assert.equal(JSON.parse(readFileSync(tracePath, 'utf8')).version, '9.8.7')
    assert.equal(JSON.parse(readFileSync(tracePath, 'utf8')).bottom, 125)
    assert.equal(JSON.parse(readFileSync(tracePath, 'utf8')).modelName, 'route-model')
    assert.equal(JSON.parse(readFileSync(tracePath, 'utf8')).reasoningEffort, 'low')
    assert.equal(statSync(tracePath).mode & 0o777, 0o600)
    assert.equal(statSync(join(dir, 'diagnostics')).mode & 0o777, 0o700)
    assert.ok(!readFileSync(tracePath, 'utf8').includes('never-log-this'))
    writeFileSync(tracePath, 'x'.repeat(262145))
    await tracedModelRpc('get-model-selection', async () => ({ desktopModels: [] }))(null, {})
    assert.equal(statSync(tracePath + '.1').size, 262145)
    const rows = readFileSync(tracePath, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(rows.at(-1).count, 0)
    assert.equal(rows.at(-1).phase, 'resolved')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
