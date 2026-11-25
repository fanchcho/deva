import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listSkills, listSkillFiles, readSkill, toggleSkill, deleteSkill, formatSkillListing } from '../lib/skills.mjs'
import { deleteDevamcpServer } from '../lib/mcp-store.mjs'
import { safeMcpError } from '../lib/mcp-secrets.mjs'
import { McpPool } from '../lib/mcp.mjs'
const host = payload => ({ request: async () => payload })

test('old Studio catalog shapes and missing mutation acknowledgements never imply success', async () => {
  await assert.rejects(listSkills(host({ legacy: [] })), /skills 数组/)
  await assert.rejects(listSkillFiles(host({}), 'demo'), /files 数组/)
  await assert.rejects(toggleSkill(host({}), 'demo', false), /ok=true/)
  await assert.rejects(deleteSkill(host({}), 'demo'), /ok=true/)
  assert.throws(() => deleteDevamcpServer({ sharedDevaHome: '/tmp/deva-compat-none' }, { name: 'demo' }), /not found/)
  await assert.rejects(readSkill(host({ skill: { name: 'demo' } }), 'demo'), /content/)
})
test('Studio error envelopes retain skill reasons and become named MCP status failures', async () => {
  await assert.rejects(toggleSkill(host({ ok: false, error: 'Built-in skill cannot be edited: demo.' }), 'demo', false), /Built-in skill/)
  await assert.rejects(readSkill(host({ skill: { name: 'demo', validationStatus: 'invalid', validationError: 'missing description' } }), 'demo'), /missing description/)
  assert.match(await formatSkillListing({ host: host({ old: [] }), log: { warn() {} } }), /本轮读取失败.*skills 数组/)
})
test('all missing environment names survive redaction for stdio and HTTP headers', async () => {
  const pool = new McpPool({ env: {}, log: { info() {}, warn() {} } })
  try {
    await pool.connectAll([
      { name: 'stdio', type: 'stdio', command: process.execPath, args: [], env: { A: '${DEVA_QA_ONE}', B: '${DEVA_QA_TWO}' } },
      { name: 'http', type: 'http', url: 'http://127.0.0.1:1', headers: { Authorization: '${DEVA_QA_THREE}' } },
    ])
    assert.match(pool.problems.join('\n'), /stdio:.*DEVA_QA_ONE、DEVA_QA_TWO/)
    assert.match(pool.problems.join('\n'), /http:.*DEVA_QA_THREE/)
  } finally { pool.close() }
  assert.match(safeMcpError(Object.assign(new Error('private error'), { status: 404 })).message, /HTTP 404/)
  assert.doesNotMatch(safeMcpError(Object.assign(new Error('secret=private'), { status: 403 })).message, /private/)
})
