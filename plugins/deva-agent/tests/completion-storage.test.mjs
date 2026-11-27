import './support/memory-home.mjs'
import { writeFileSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeStoredTodos, normalizeSubagents, validateStored } from '../lib/storage-contracts.mjs'
import { listMemories, writeMemory } from '../lib/memory.mjs'
const fixture = async name => JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'))

test('v1 memory read and update preserve original content and unknown fields', async () => {
  let rows = await fixture('memory-v1'); rows[0].extension = { origin: 'v1' }
  const bucket = { get: async () => structuredClone(rows), set: async (_k,v) => { rows = structuredClone(v) } }
  const ctx = { state: { user: { namespace: () => bucket } } }
  writeFileSync(`${process.env.DEVA_HOME}/memory.json`, JSON.stringify({entries: typeof rows === 'undefined' ? raw : rows}))
  const [entry] = await listMemories('global', ctx)
  assert.equal(entry.body, rows[0].content); assert.deepEqual(entry.extension, { origin: 'v1' })
  await writeMemory({ title: '更新标题' }, ctx, entry.id)
  rows = JSON.parse(readFileSync(`${process.env.DEVA_HOME}/memory.json`)).entries
  assert.equal(rows[0].content, '用户偏好简体中文。回复要简短。')
  assert.deepEqual(rows[0].extension, { origin: 'v1' })
})
test('stored todos fill missing status and retain extension fields', () => {
  const rows = normalizeStoredTodos([{ content: 'continue', ext: 7 }])
  assert.deepEqual(rows, [{ content: 'continue', ext: 7, status: 'pending' }])
  assert.throws(() => normalizeStoredTodos([{ content: 'x', status: 'invalid' }]))
})
test('legacy subagent history round trips with defaults and unknown fields', async () => {
  const raw = await fixture('subagents-v1'); raw['sub-abcd1234'].extra = { keep: true }
  delete raw['sub-abcd1234'].updatedAt
  const rows = normalizeSubagents(raw)
  assert.deepEqual(rows['sub-abcd1234'].messages, raw['sub-abcd1234'].messages)
  assert.deepEqual(rows['sub-abcd1234'].extra, { keep: true })
  assert.equal(rows['sub-abcd1234'].updatedAt, 1)
  validateStored('subagents', rows)
})
test('invalid persisted records fail explicitly and cannot silently overwrite old data', () => {
  assert.throws(() => normalizeSubagents({ child: { messages: 'broken' } }))
  assert.throws(() => validateStored('memory', [{ id: 'm_1', title: 'x', type: 'madeup', body: '', createdAt: 1, updatedAt: 1 }]))
})

test('missing memory fields receive defaults without mutating storage on read', async () => {
  const raw = [{ id: 'm_1', extension: 'keep' }]
  let writes = 0
  const ctx = { state: { user: { namespace: () => ({ get: async () => structuredClone(raw), set: async () => { writes++ } }) } } }
  writeFileSync(`${process.env.DEVA_HOME}/memory.json`, JSON.stringify({entries: typeof rows === 'undefined' ? raw : rows}))
  const [entry] = await listMemories('global', ctx)
  assert.deepEqual(entry, { id: 'm_1', extension: 'keep', type: 'user', title: '', body: '', createdAt: 0, updatedAt: 0 })
  assert.equal(writes, 0)
})
