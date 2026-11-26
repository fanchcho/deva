import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skillPage, skillDirectories, registerDevaSkills, setSkillEnabled } from '../lib/skill-settings.mjs'

test('skill page preserves metadata and warns about malformed rows', async () => {
  const data = await skillPage({ request: async () => ({ skills: [{ name: 'a', source: 'external', path: '/skills/a', warnings: ['bad file'] }, null], directory: '/skills', warnings: ['host warning'] }) })
  assert.equal(data.skills.length, 1)
  assert.equal(data.skills[0].path, '/skills/a')
  assert.equal(data.warnings.length, 2)
})
test('skill page distinguishes empty, non JSON and missing list', async () => {
  assert.deepEqual((await skillPage({ request: async () => ({ skills: [] }) })).skills, [])
  await assert.rejects(skillPage({ request: async () => '<html>login</html>' }), /非 JSON/)
  await assert.rejects(skillPage({ request: async () => ({}) }), /skills/)
})
test('skill page preserves permission and network errors', async () => {
  for (const message of ['HTTP 401 unauthorized', 'HTTP 403 permission denied', 'request timed out']) {
    await assert.rejects(skillPage({ request: async () => { throw new Error(message) } }), { message })
  }
})
test('unsupported directory endpoint retains 404', async () => {
  await assert.rejects(skillDirectories({ host: { request: async () => { throw new Error('HTTP 404 external-directories') } } }), /404/)
})
test('register directory preserves existing directories and verifies readback', async () => {
  let directories = ['/existing']
  const run = { config: { sharedDevaHome: '/configured/deva' }, host: { request: async (_path, options) => {
    if (options?.method === 'PUT') { directories = options.body.directories; return { ok: true } }
    return { directories }
  } } }
  assert.deepEqual((await registerDevaSkills(run)).directories, ['/existing', '/configured/deva/skills'])
  assert.deepEqual((await registerDevaSkills(run)).directories, directories)
})
test('toggle rejects host success when effective state is filtered', async () => {
  const host = { request: async path => path.endsWith('/toggle') ? { ok: true } : { skill: { name: 'a', enabled: false, content: 'body' } } }
  await assert.rejects(setSkillEnabled(host, { name: 'a', enabled: true }), /全局过滤/)
  assert.equal((await setSkillEnabled(host, { name: 'a', enabled: false })).enabled, false)
})

test('real host directory metadata is normalized and missing paths remain visible', async () => {
  const result = await skillDirectories({ config: { sharedDevaHome: '/configured/deva' }, host: { request: async () => ({ directories: [{ raw: '/missing', expanded: '/missing', exists: false, isDir: false }] }) } })
  assert.deepEqual(result.directories, ['/missing'])
  assert.match(result.warnings[0], /exists=false, isDir=false/)
})
