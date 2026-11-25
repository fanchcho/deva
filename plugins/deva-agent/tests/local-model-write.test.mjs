import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sharedDevaWritePath } from '../lib/shared-deva-model.mjs'
import { readModelSelection, saveModelSelection } from '../lib/model-selection.mjs'

test('local activation account can save without POSIX uid; other accounts, roots and links cannot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'local-model-'))
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DEVA_HOME: process.env.DEVA_HOME }
  const uid = process.getuid
  const root = join(home, '.deva'), file = join(root, 'config.json')
  mkdirSync(root, { mode: 0o700 })
  const provider = { id: 'custom-1794383812625', name: 'cpa', adapter: 'openai', enabled: true, apiHost: 'http://127.0.0.1:7863/v1', models: [{ id: 'cn:deepseek-v4.1-flash', enabled: true }] }
  const config = { personas: { selected: 'xiaomajiang' }, models: { providers: [provider], activeModelId: `${provider.id}:cn:deepseek-v4.1-flash`, activeEffort: 'default' } }
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
  const storage = { namespace() { return this }, async get() {}, async set() {}, async delete() {} }
  const run = { config: {}, desktopActivationUserId: 1, identity: { userId: 1, profile: 'default' }, state: { profile: storage } }
  try {
    Object.assign(process.env, { HOME: home, USERPROFILE: home, DEVA_HOME: root })
    process.getuid = undefined
    assert.equal((await readModelSelection(run)).desktopWriteRequired, false)
    const input = { baseUrl: provider.apiHost, modelName: 'cn:deepseek-v4.1-flash', reasoningEffort: 'high' }
    const view = await saveModelSelection(run, input)
    assert.equal(view.needsNetworkApproval, true)
    const saved = JSON.parse(readFileSync(file))
    assert.equal(saved.models.activeEffort, 'high')
    assert.deepEqual(saved.models.providers, config.models.providers)
    assert.deepEqual(saved.personas, config.personas)
    assert.equal(sharedDevaWritePath({ ...run, identity: { userId: 2 } }), null)
    assert.equal(sharedDevaWritePath({ ...run, config: { sharedDevaUserId: 2 } }), null)
    assert.equal(sharedDevaWritePath({ ...run, desktopActivationUserId: undefined }), null)
    assert.equal(sharedDevaWritePath({ ...run, config: { sharedDevaHome: home + '-other' } }), null)
    const before = readFileSync(file, 'utf8')
    await assert.rejects(saveModelSelection({ ...run, identity: { userId: 2 } }, input), /userId=2; sharedDevaUserId=unset/)
    assert.equal(readFileSync(file, 'utf8'), before)
    rmSync(file)
    const other = join(home, 'other.json')
    writeFileSync(other, '{}')
    symlinkSync(other, file)
    assert.equal(sharedDevaWritePath(run), null)
  } finally {
    process.getuid = uid
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(home, { recursive: true, force: true })
  }
})
