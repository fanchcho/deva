import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolatedDevaHome } from './support/deva-home.mjs'
import { listAgentModels } from '../lib/agent-model-catalog.mjs'
import { agentModelId } from '../lib/agent-model-ref.mjs'
import { readCustomModel } from '../lib/model-selection.mjs'

const root = isolatedDevaHome('deva-agent-catalog-')
const file = join(root, 'config.json')
const storage = { namespace() { return this }, async get() {} }
function setup(baseUrl, extra = []) {
  const provider = { id: 'one', name: 'One', adapter: 'openai', purpose: 'llm', enabled: true, apiHost: baseUrl, models: [{ id: 'local', enabled: true }, { id: 'off', enabled: false }] }
  writeFileSync(file, JSON.stringify({ models: { providers: [provider, ...extra], activeModelId: 'one:local' } }), { mode: 0o600 })
  return { config: { sharedDevaHome: root, sharedDevaUserId: 1, modelTrustedBases: [baseUrl] }, state: { profile: storage }, identity: { userId: 1, profile: 'default' } }
}
async function upstream(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}/v1`
}

test('Agent catalog merges all enabled providers, deduplicates and never writes Desktop configuration', async t => {
  const calls = []
  const base = await upstream(t, (req, res) => { calls.push(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'local' }, { id: 'remote:one' }, { id: 'off' }, { id: 'remote:one' }] })) })
  const run = setup(base, [{ id: 'two', name: 'Two', enabled: true, adapter: 'openai', apiHost: base, models: [] }])
  const before = readFileSync(file, 'utf8')
  const catalog = await listAgentModels(run)
  assert.equal(catalog.status, 'ready')
  assert.equal(catalog.models.filter(m => m.isDefault).length, 1)
  const concrete = catalog.models.filter(m => m.id.startsWith('deva-model:'))
  assert.equal(concrete.length, 5)
  assert.equal(new Set(concrete.map(m => m.id)).size, 5)
  assert.equal(calls.length, 2)
  assert.equal(JSON.stringify(catalog).includes(base), false)
  assert.equal(readFileSync(file, 'utf8'), before)
  const selected = await readCustomModel({ ...run, mode: 'global', model: { model: agentModelId('two:remote:one') } })
  assert.deepEqual([selected.providerId, selected.modelName], ['two', 'remote:one'])
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal((await readCustomModel({ ...run, mode: 'global', model: {} })).modelName, 'local')
  await assert.rejects(readCustomModel({ ...run, mode: 'global', model: { model: agentModelId('one:off') } }), /已禁用/)
  await assert.rejects(readCustomModel({ ...run, mode: 'global', model: { model: agentModelId('missing:local') } }), /提供商已移除/)
})

test('unapproved and HTTP failures retain local catalog, and empty failures are explicit', async t => {
  let calls = 0
  const base = await upstream(t, (_req, res) => { calls++; res.writeHead(401); res.end('unauthorized') })
  const run = setup(base)
  run.config.modelTrustedBases = []
  const denied = await listAgentModels(run)
  assert.equal(denied.status, 'ready')
  assert.match(denied.message, /modelTrustedBases/)
  assert.ok(denied.models.some(m => m.id === agentModelId('one:local')))
  assert.equal(calls, 0)
  run.config.modelTrustedBases = [base]
  const failed = await listAgentModels(run)
  assert.match(failed.message, /HTTP 401/)
  assert.ok(failed.models.some(m => m.id === agentModelId('one:local')))
  const raw = JSON.parse(readFileSync(file, 'utf8')); raw.models.providers[0].models = []; delete raw.models.activeModelId
  writeFileSync(file, JSON.stringify(raw))
  const empty = await listAgentModels(run)
  assert.equal(empty.status, 'error')
  assert.equal(empty.models.length, 0)
  assert.match(empty.message, /HTTP 401/)
})

test('session selection fails explicitly for malformed IDs and does not affect scoped mode', async () => {
  const run = setup('https://example.com/v1')
  for (const id of ['bad', 'deva-model:%FF', agentModelId('one:')]) {
    await assert.rejects(readCustomModel({ ...run, mode: 'global', model: { model: id } }), /无效/)
  }
  assert.equal((await readCustomModel({ ...run, mode: 'scoped', model: { model: 'a-studio-id' } })).modelName, 'local')
})
