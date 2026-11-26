import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readModelSelection, saveModelSelection } from '../lib/model-selection.mjs'
const p = { id: 'p', name: 'Provider', baseUrl: 'https://example.com/v1', models: ['qwen:8b'], headers: { 'x-fixture': 'keep' } }
const cases = {
  nested: { models: { providers: [p], activeModelId: 'p:qwen:8b' } },
  top: { providers: [p], defaultModel: 'qwen:8b' },
  single: { provider: p, defaultModel: { providerId: 'p', modelId: 'qwen:8b' } },
  object: { models: { providers: p, defaultModel: 'qwen:8b' } },
  singleModel: { models: { provider: { ...p, models: undefined, model: 'qwen:8b' }, defaultModel: 'qwen:8b' } },
  nameOnly: { providers: [{ ...p, models: [{ name: 'qwen:8b', tags: ['keep'] }] }], defaultModel: 'qwen:8b' },
  bare: { provider: 'p', baseURL: p.baseUrl, model: 'qwen:8b' },
  empty: { providers: [{ ...p, models: [] }] },
  missing: { providers: [{ id: 'p', baseUrl: p.baseUrl }] },
}
for (const [name, value] of Object.entries(cases)) test(`legacy ${name} reads and saves through the same file`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-legacy-')), path = join(dir, 'config.json')
  const storage = { namespace() { return this }, async get() {}, async delete() {} }
  const run = { config: { sharedDevaHome: dir, sharedDevaUserId: 1 }, identity: { userId: 1 }, state: { profile: storage } }
  try {
    value.opaque = { untouched: true }
    const original = JSON.stringify(value)
    writeFileSync(path, original, { mode: 0o600 })
    const result = await readModelSelection(run)
    assert.equal(result.desktopProviders.length, 1)
    assert.equal(readFileSync(path, 'utf8'), original, 'reads never migrate')
    if (['empty', 'missing'].includes(name)) { assert.equal(result.desktopModels.length, 0); return }
    assert.equal(result.modelRef, 'p:qwen:8b')
    assert.equal(result.desktopModels.length, 1)
    await saveModelSelection(run, { modelRef: result.modelRef, baseUrl: result.baseUrl, modelName: result.modelName, reasoningEffort: 'high' })
    const after = JSON.parse(readFileSync(path))
    assert.deepEqual(after.opaque, value.opaque)
    assert.equal(after.models.activeModelId, 'p:qwen:8b')
    const reopened = await readModelSelection(run)
    assert.equal(reopened.modelRef, 'p:qwen:8b')
    if (name !== 'bare') assert.deepEqual(after.models.providers[0].headers, p.headers)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
for (const [name, value] of Object.entries({ malformed: { providers: [17] }, missingId: { providers: [{ models: [{}] }] }, ambiguous: { providers: [p, { ...p, id: 'q' }], defaultModel: 'qwen:8b' } })) test(`${name} returns a copyable failure, never empty success`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-invalid-')), path = join(dir, 'config.json')
  try {
    const raw = JSON.stringify(value); writeFileSync(path, raw, { mode: 0o600 })
    const result = await readModelSelection({ config: { sharedDevaHome: dir } })
    const diagnostic = JSON.parse(result.desktopDiagnostics)
    assert.equal(result.desktopWriteRequired, true)
    assert.equal(diagnostic.path, path)
    assert.equal(diagnostic.json, 'parsed')
    assert.ok(diagnostic.error)
    assert.equal(readFileSync(path, 'utf8'), raw)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
