import './support/memory-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeMemory, listMemories, deleteMemory, projectMemoryKey } from '../lib/memory.mjs'
import { memoryPage } from '../lib/memory-settings.mjs'
import { executeTool } from '../lib/tools.mjs'
const context = () => ({ config: {}, identityId: 'general', workspaceDir: process.env.DEVA_HOME })
test('shared files round trip all three desktop scopes with stable IDs and order', async () => {
  for (const scope of ['global', 'role', 'project']) {
    const ctx = context()
    const a = await writeMemory({ scope, type: 'user', title: 'first', body: 'body' }, ctx)
    const b = await writeMemory({ scope, type: 'reference', title: 'second' }, ctx)
    await writeMemory({ body: 'updated' }, ctx, a.entry.id)
    assert.deepEqual((await listMemories(scope, ctx)).map(e => e.id), [a.entry.id, b.entry.id])
    const path = scope === 'global' ? join(process.env.DEVA_HOME, 'memory.json') : scope === 'role' ? join(process.env.DEVA_HOME, 'personas/memory/general.json') : join(process.env.DEVA_HOME, 'projects', await projectMemoryKey(ctx.workspaceDir), 'memory.json')
    const disk = JSON.parse(readFileSync(path)); assert.equal(disk.version, 2); assert.equal(disk.entries[0].body, 'updated')
    await deleteMemory(a.entry.id, ctx); assert.equal((await listMemories(scope, ctx)).length, 1)
  }
})
test('desktop schema fixture preserves unknown top-level and entry fields on write', async () => {
  const path = join(process.env.DEVA_HOME, 'memory.json')
  const data = JSON.parse(readFileSync(new URL('./fixtures/memory-desktop-v2.json', import.meta.url)))
  data.tidy = 'pending'; data.tidyTries = 1; data.extension = { keep: true }; data.entries[0].extra = 7
  const createdAt = data.entries[0].createdAt
  writeFileSync(path, JSON.stringify(data)); await writeMemory({ body: 'plugin' }, context(), data.entries[0].id)
  const actual = JSON.parse(readFileSync(path)); assert.deepEqual(actual.extension, data.extension); assert.equal(actual.entries[0].extra, 7); assert.equal(actual.entries[0].createdAt, createdAt); assert.equal(actual.tidy, 'pending')
})
for (const raw of ['', '{bad', '{"entries":{}}', '{"entries":[{"id":1}]}']) test(`corrupt file is read-only without overwrite: ${JSON.stringify(raw)}`, async () => {
  const path = join(process.env.DEVA_HOME, 'memory.json'); writeFileSync(path, raw)
  await assert.rejects(listMemories('global', context()))
  await assert.rejects(writeMemory({ type: 'user', title: 'new' }, context()))
  assert.equal(readFileSync(path, 'utf8'), raw)
})
test('agent tool writes the same disk data returned by page and oversized entry fails', async () => {
  const ctx = context()
  await executeTool('memory_write', { type: 'user', title: 'tool', body: 'shared' }, { ...ctx, identity: { identityId: 'general' } })
  const page = await memoryPage({ action: 'list', scope: 'global' }, ctx)
  assert.equal(page.entries[0].body, 'shared')
  await assert.rejects(memoryPage({ action: 'save', scope: 'global', type: 'user', title: 'large', body: 'x'.repeat(1501) }, ctx))
  assert.equal(JSON.parse(readFileSync(join(process.env.DEVA_HOME, 'memory.json'))).entries.length, 1)
})
test('legacy preservation is idempotent and reversible without modifying host data', async () => {
  const legacy = [{ id: 'm_legacy', content: 'old' }]; let reads = 0, writes = 0
  const ctx = { ...context(), state: { user: { namespace: () => ({ get: async () => { reads++; return legacy }, set: async () => { writes++ } }) } } }
  for (let i = 0; i < 2; i++) { const page = await memoryPage({ action: 'list', scope: 'global' }, ctx); assert.equal(page.entries.length, 0); assert.match(page.legacyNotice, /回滚/) }
  assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(existsSync(join(process.env.DEVA_HOME, 'memory.json')), false)
  assert.deepEqual(await ctx.state.user.namespace().get('entries'), legacy)
})

test('concurrent stale snapshot fails explicitly and preserves the winning write', async () => {
  const { fileMemoryStore } = await import('../lib/memory-file.mjs')
  const path = join(process.env.DEVA_HOME, 'memory.json')
  writeFileSync(path, JSON.stringify({version:2, entries:[]}))
  const a = fileMemoryStore(path, 'global', context()), b = fileMemoryStore(path, 'global', context())
  await a.get(); await b.get()
  await a.set('entries', [{id:'m_12345678',type:'user',title:'winner',body:'',createdAt:1,updatedAt:1}])
  await assert.rejects(b.set('entries', []), {code:'DEVA_CONCURRENT_WRITE'})
  assert.equal(JSON.parse(readFileSync(path)).entries[0].title, 'winner')
})
