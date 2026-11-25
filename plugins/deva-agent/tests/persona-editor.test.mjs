import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addStudioPersona, readStudioPersona, updateStudioPersona, listPersonas } from '../lib/persona-store.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'deva-persona-editor-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const config = { sharedDevaHome: root }
  const path = join(root, 'config.json')
  fs.writeFileSync(path, JSON.stringify({ theme: 'dark', personas: { enabled: { previous: false }, order: ['previous'], selected: 'previous', sessionSelected: { s1: 'previous' } } }), { mode: 0o600 })
  const getConfig = () => JSON.parse(fs.readFileSync(path, 'utf8'))
  return { root, config, path, getConfig }
}

test('creation uses desktop ids, one 0600 markdown file, and config enabled/order without selecting it', t => {
  const { root, config, getConfig } = fixture(t)
  if (process.platform !== 'win32') fs.chmodSync(root, 0o2700)
  const input = { name: '量子风筝', description: '描述: # example', prompt: 'Lead\n\n---\n\nNext' }
  const { id } = addStudioPersona(config, input)
  assert.match(id, /^persona-[a-f0-9]{8}$/)
  const dir = join(root, 'personas')
  const path = join(dir, id + '.md')
  assert.deepEqual(fs.readdirSync(dir), [id + '.md'])
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path).mode & 0o777, 0o600)
    assert.equal(fs.statSync(dir).mode & 0o7777, 0o700)
  }
  assert.deepEqual(getConfig(), { theme: 'dark', personas: { enabled: { previous: false, [id]: true }, order: ['previous', id], selected: 'previous', sessionSelected: { s1: 'previous' } } })
  assert.deepEqual(Object.fromEntries(Object.entries(readStudioPersona(config, id)).filter(([key]) => key !== 'revision')), { id, ...input })
  assert.throws(() => addStudioPersona(config, input), { code: 'DEVA_PERSONA_NAME_EXISTS' })
  assert.throws(() => addStudioPersona(config, { ...input, name: 'unsafe\nworkspace: /a' }), { code: 'DEVA_PERSONA_CHARACTERS' })
  const ascii = addStudioPersona(config, { ...input, name: 'Pilot' })
  assert.throws(() => addStudioPersona(config, { ...input, name: 'ＰＩＬＯＴ' }), { code: 'DEVA_PERSONA_NAME_EXISTS' })
  assert.match(ascii.id, /^pilot-[a-f0-9]{8}$/)
  assert.throws(() => readStudioPersona(config, '../config.json'), { code: 'DEVA_PERSONA_BAD_ID' })
})

test('editing preserves desktop and unknown metadata, rejects stale and removed files, and never changes config', t => {
  const { root, config, getConfig } = fixture(t)
  const dir = join(root, 'personas')
  fs.mkdirSync(dir, { mode: 0o700 })
  const path = join(dir, 'existing.md')
  const other = 'avatar: "{\\"shape\\":\\"square\\"}"\r\nmodel: p:m\r\nworkspace: "/path with spaces"\r\ncustom:\r\n  - abc\r\n# keep desktop note\r\n'
  const raw = '\uFEFF---\r\nname: Old\r\ndescription: Old description\r\n' + other + '---\r\n\r\nOld prompt\r\n'
  fs.writeFileSync(path, raw, { mode: 0o600 })
  const originalConfig = getConfig()
  const before = readStudioPersona(config, 'existing')
  const updated = { ...before, name: 'New: name', description: '', prompt: 'New prompt' }
  fs.writeFileSync(path, raw.replace('Old prompt', 'Desktop change'))
  assert.throws(() => updateStudioPersona(config, updated), { code: 'DEVA_PERSONA_STALE' })
  const { revision } = readStudioPersona(config, 'existing')
  assert.deepEqual(updateStudioPersona(config, { ...updated, revision }), { id: 'existing' })
  assert.equal(fs.readFileSync(path, 'utf8'), '\uFEFF---\r\nname: "New: name"\r\n' + other + '---\r\n\r\nNew prompt\r\n')
  assert.deepEqual(getConfig(), originalConfig)
  assert.equal(listPersonas(config).list[0].enabled, false)
  fs.unlinkSync(path)
  assert.throws(() => updateStudioPersona(config, updated), { code: 'DEVA_PERSONA_NOT_FOUND' })
})

test('a failed config rename reports failure and rolls the new persona file back', t => {
  const { root, config, path, getConfig } = fixture(t)
  const before = getConfig()
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (source, dest) => {
    if (dest === path) throw new Error('QA config registration failed')
    rename(source, dest)
  })
  syncBuiltinESMExports()
  try {
    assert.throws(() => addStudioPersona(config, { name: 'Rollback QA', description: '', prompt: 'No partial persona' }), /QA config registration failed/)
    assert.deepEqual(fs.readdirSync(join(root, 'personas')), [])
    assert.deepEqual(fs.readdirSync(root).sort(), ['config.json', 'personas'])
    assert.deepEqual(getConfig(), before)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
