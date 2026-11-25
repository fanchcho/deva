import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readModelSelection, saveModelSelection } from '../lib/model-selection.mjs'
import { readModels } from '../lib/desktop-model-schema.mjs'

const base = () => ({ extraDesktop: { untouched: true }, models: { activeModelId: 'p:qwen:8b', desktopOnly: 'keep', providers: [{ id: 'p', name: '桌面名称', apiHost: 'https://example.com/v1', adapter: 'openai', headers: { 'x-fixture': 'keep' }, threshold: 0.7, models: [{ id: 'qwen:8b', name: '本地显示名', tags: ['keep'], contextWindow: 4096 }] }] } })
const unsupported = [
  ['top-providers', { providers: [] }], ['single-provider', { models: { provider: { id: 'p' } } }],
  ['providers-object', { models: { providers: { id: 'p' } } }], ['top-model', { model: 'm' }],
  ['single-model', { models: { providers: [{ id: 'p', model: 'm' }] } }],
  ['models-string', { models: { providers: [{ id: 'p', models: 'm' }] } }],
  ['defaultModel', { models: { providers: [], defaultModel: 'p:m' } }],
  ['baseUrl', { models: { providers: [{ id: 'p', baseUrl: 'https://example.com', models: [{ id: 'm' }] }] } }],
]
for (const [name, config] of unsupported) test(`unsupported desktop shape ${name} is explicit and never written`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-shape-'))
  try {
    const raw = JSON.stringify(config), path = join(dir, 'config.json')
    writeFileSync(path, raw, { mode: 0o600 })
    const result = await readModelSelection({ config: { sharedDevaHome: dir } })
    assert.equal(result.desktopWriteRequired, true)
    const diagnostic = JSON.parse(result.desktopDiagnostics)
    assert.equal(diagnostic.path, path)
    assert.equal(diagnostic.exists, true)
    assert.match(diagnostic.error, /不兼容/)
    assert.equal(readFileSync(path, 'utf8'), raw)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('canonical legacy optional fields and colon model IDs read and save without erasing Desktop fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-preserve-'))
  const storage = { namespace() { return this }, async get() {}, async delete() {} }
  try {
    const config = base(), path = join(dir, 'config.json')
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
    const run = { config: { sharedDevaHome: dir, sharedDevaUserId: 1 }, identity: { userId: 1 }, state: { profile: storage } }
    const before = await readModelSelection(run)
    assert.equal(before.modelRef, 'p:qwen:8b')
    assert.equal(before.desktopModels.length, 1)
    assert.equal(before.providerName, '桌面名称')
    assert.equal(before.baseUrl, 'https://example.com/v1')
    await saveModelSelection(run, { modelRef: before.modelRef, baseUrl: before.baseUrl, modelName: before.modelName, reasoningEffort: 'high' })
    assert.deepEqual(JSON.parse(readFileSync(path)), { ...config, models: { ...config.models, activeEffort: 'high' } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('genuinely empty desktop config is distinct from unsupported aliases', () => {
  assert.deepEqual(readModels({}), { models: {}, providers: [] })
  assert.deepEqual(readModels({ models: { providers: [] } }).providers, [])
})
