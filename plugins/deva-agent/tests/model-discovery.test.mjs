import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseModels, discoverModels } from '../lib/model-discovery.mjs'
import { readModelSelection, saveModelSelection, readCustomModel } from '../lib/model-selection.mjs'
import { createCustomModel } from '../lib/studio-model.mjs'
import { validateStoredModel } from '../lib/storage-contracts.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()

test('models parser accepts both envelopes and only explicit positive integer limits', () => {
  const rows = [
    { id: 'context', context_length: 128000, max_output_tokens: 4096 },
    { id: 'vllm', max_model_len: 32768 },
    { id: 'window', context_window: 65536 },
    { id: 'router', top_provider: { context_length: 200000, max_completion_tokens: 8192 } },
    { id: 'input-only', max_input_tokens: 12345, max_completion_tokens: 1234 },
    { id: 'unknown', context_length: '100', max_model_len: -3, context_window: 1.5, max_output_tokens: Infinity, unknown_limit: 123 },
    { id: 'empty' }, { id: 'empty' }, { id: '' }, { id: 'bad\nname' }, null, 'string',
  ]
  const expected = [
    { id: 'context', contextWindow: 128000, maxOutput: 4096 }, { id: 'vllm', contextWindow: 32768 },
    { id: 'window', contextWindow: 65536 }, { id: 'router', contextWindow: 200000, maxOutput: 8192 },
    { id: 'input-only', maxInput: 12345, maxOutput: 1234 }, { id: 'unknown' }, { id: 'empty' },
  ]
  assert.deepEqual(parseModels({ data: rows }), expected)
  assert.deepEqual(parseModels(rows), expected)
  assert.deepEqual(parseModels({ data: [] }), [])
  assert.throws(() => parseModels({ models: [] }), /格式不支持/)
  validateStoredModel('modelDiscoveryView', { models: expected })
})

async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'deva-discovery-'))
  const records = new Map()
  const store = (prefix = '') => ({ namespace: (...p) => store(prefix + '/' + p.join('/')), get: async k => records.get(prefix + k), set: async (k, v) => records.set(prefix + k, v), delete: async k => records.delete(prefix + k) })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const run = { config: { sharedDevaHome: root, sharedDevaUserId: 1, modelTrustedBases: [baseUrl] }, identity: { userId: 1 }, state: { profile: store() } }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  return { run, baseUrl, root }
}

for (const [label, status, body, expected] of [
  ['401', 401, 'upstream secret text must never appear', /HTTP 401.*API Key/],
  ['403', 403, 'upstream secret text must never appear', /HTTP 403.*API Key/],
  ['404', 404, '<html>not found</html>', /HTTP 404.*手动/],
  ['500', 500, 'upstream secret text must never appear', /HTTP 500/],
  ['non-json', 200, '<html>login</html>', /非 JSON/],
  ['bad-shape', 200, '{"error":"unknown"}', /格式不支持/],
  ['redirect', 302, '', /HTTP 302/],
]) test(`model discovery maps ${label} without reflecting upstream response`, async t => {
  const { run, baseUrl } = await fixture(t, (_, res) => { res.writeHead(status, { location: '/elsewhere' }); res.end(body) })
  await assert.rejects(discoverModels(run, { baseUrl, apiKey: randomBytes(16).toString('hex') }), e => expected.test(e.message) && !e.message.includes('upstream secret'))
})

test('model discovery times out, supports cancellation, and reports an empty list explicitly', async t => {
  let hang = true
  const { run, baseUrl } = await fixture(t, (_, res) => { if (!hang) res.end('{"data":[]}') })
  await assert.rejects(discoverModels(run, { baseUrl, apiKey: '' }, { timeoutMs: 30 }), /超时/)
  const controller = new AbortController()
  const pending = discoverModels({ ...run, signal: controller.signal }, { baseUrl, apiKey: '' })
  controller.abort()
  await assert.rejects(pending, /已取消/)
  hang = false
  assert.deepEqual(await discoverModels(run, { baseUrl, apiKey: '' }), { models: [] })
})

test('real GET shares exact approval and server credential scope; no host catalog fallback', async t => {
  const key = randomBytes(24).toString('hex'), seen = []
  const { run, baseUrl } = await fixture(t, (req, res) => {
    seen.push({ method: req.method, path: req.url, authorized: req.headers.authorization === `Bearer ${key}` })
    res.end(JSON.stringify({ data: [{ id: 'cn:available', context_length: 64000 }, { id: 'without-length' }] }))
  })
  await saveModelSelection(run, { baseUrl, modelName: 'manual', apiKey: key })
  const result = await discoverModels(run, { baseUrl: baseUrl + '/' })
  assert.deepEqual(result, { models: [{ id: 'cn:available', contextWindow: 64000 }, { id: 'without-length' }] })
  assert.deepEqual(seen, [{ method: 'GET', path: '/v1/models', authorized: true }])
  assert.equal(JSON.stringify(result).includes(key), false)
  await assert.rejects(discoverModels({ ...run, config: { ...run.config, modelTrustedBases: [] } }, { baseUrl }), /modelTrustedBases/)
  assert.equal(seen.length, 1)
  const otherBase = baseUrl + '/other'
  run.config.modelTrustedBases.push(otherBase)
  await discoverModels(run, { baseUrl: otherBase })
  assert.equal(seen.at(-1).authorized, false, 'stored key is never copied to a different Base URL')
  await discoverModels({ ...run, identity: { userId: 2 } }, { baseUrl })
  assert.equal(seen.at(-1).authorized, false, 'stored key is user scoped')
  console.log(JSON.stringify({ discoveryRequests: seen, result }))
})

test('a reflected credential in a model id is blocked', async t => {
  const key = randomBytes(24).toString('hex')
  const { run, baseUrl } = await fixture(t, (_, res) => res.end(JSON.stringify([{ id: key }])))
  await assert.rejects(discoverModels(run, { baseUrl, apiKey: key }), e => /敏感凭据/.test(e.message) && !e.message.includes(key))
})

test('selected lengths persist, clear independently, and never change chat payload; manual models still work', async t => {
  let payload
  const { run, baseUrl, root } = await fixture(t, async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions')
    let body = ''; for await (const chunk of req) body += chunk
    payload = JSON.parse(body)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  const saved = await saveModelSelection(run, { baseUrl, modelName: 'selected', contextWindow: 128000, maxOutput: 4096, maxInput: 120000 })
  validateStoredModel('modelSettingsView', saved)
  assert.equal(saved.contextWindow, 128000)
  assert.equal(saved.desktopModels[0].maxOutput, 4096)
  const route = await readCustomModel(run)
  await createCustomModel(run, route)({ messages: [{ role: 'user', text: 'hello' }], tools: [] })
  assert.equal(payload.model, 'selected')
  for (const k of ['contextWindow', 'maxOutput', 'maxInput', 'max_tokens', 'max_completion_tokens']) assert.equal(payload[k], undefined)
  await saveModelSelection(run, { baseUrl, modelName: 'selected', contextWindow: 0, maxOutput: 0, maxInput: 0 })
  assert.equal((await readModelSelection(run)).contextWindow, undefined)
  const manual = await saveModelSelection(run, { baseUrl, modelName: 'manual-only', contextWindow: 4096 })
  assert.equal(manual.modelName, 'manual-only')
  assert.equal(manual.contextWindow, 4096)
  assert.equal(manual.maxOutput, undefined)
  const disk = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
  assert.equal(disk.models.providers[0].models.find(m => m.id === 'manual-only').contextWindow, 4096)
})
