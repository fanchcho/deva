import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approveModelBase } from '../scripts/approve-model-base.mjs'

test('administrator approval preserves config, normalizes exact base and verifies readback', async () => {
  let config = { sharedDevaUserId: 7, modelTrustedBases: ['https://example.com/v1'] }
  let revision = 4, writes = 0
  const request = async (_url, options) => {
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body)
      assert.equal(body.revision, revision)
      config = body.config; revision++; writes++
    }
    return { ok: true, json: async () => ({ revision, plugins: [{ manifest: { id: 'deva' }, config }] }) }
  }
  const options = { studio: 'http://localhost:3000', base: 'http://127.0.0.1:7863/v1/', token: 'fixture', request }
  assert.equal((await approveModelBase(options)).approvedBase, 'http://127.0.0.1:7863/v1')
  assert.equal(config.sharedDevaUserId, 7)
  await approveModelBase(options)
  assert.equal(writes, 1)
  await assert.rejects(approveModelBase({ ...options, base: 'http://*/v1' }), /wildcards/)
  await assert.rejects(approveModelBase({ ...options, request: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
})
