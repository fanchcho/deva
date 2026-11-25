import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskMcpConfig, mergeMcpSecrets, SECRET_MASK, safeMcpError } from '../lib/mcp-secrets.mjs'
import { McpPool } from '../lib/mcp.mjs'

test('header secrets use the same preserve/replace/null-clear contract', () => {
  const prior = { headers: { Authorization: 'secret-a', Extra: 'secret-b' } }
  assert.deepEqual(maskMcpConfig(prior).headers, { Authorization: SECRET_MASK, Extra: SECRET_MASK })
  assert.deepEqual(mergeMcpSecrets(maskMcpConfig(prior), prior), prior)
  assert.deepEqual(mergeMcpSecrets({ headers: { Authorization: 'new', Extra: null } }, prior).headers, { Authorization: 'new' })
  assert.throws(() => mergeMcpSecrets({ env: { A: SECRET_MASK } }), /掩码/)
})
test('MCP connection stderr secrets are removed from logs and problem summaries', async () => {
  const logs = [], pool = new McpPool({ log: { info() {}, warn: x => logs.push(x) } })
  try {
    await pool.connectAll([{ name: 'secret', type: 'stdio', command: process.execPath, args: ['-e', 'process.stderr.write("password=private-123");process.exit(1)'], env: { KEY: 'private-123' } }], new AbortController().signal)
    assert.doesNotMatch(JSON.stringify([logs, pool.problems]), /private-123/)
    assert.ok(pool.problems.length)
    assert.doesNotMatch(safeMcpError(new Error('already exists private-123')).message, /private-123/)
  } finally { pool.close() }
})
