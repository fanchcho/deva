import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { clientDeliveryInterceptor } from '../lib/client-delivery.mjs'
test('client delivery records authenticated identity and actual bytes only', () => {
  const rows = [], hook = clientDeliveryInterceptor(x => rows.push(x))
  const response = { status: 200, headers: {}, body: { source: 'Deva 0.8.36' } }
  const http = { originalUrl: '/api/studio/plugins/deva/client?token=never-log', identity: { userId: 7, profile: 'work' }, request: { method: 'GET', headers: { host: 'localhost:8648', authorization: 'never-log' } } }
  hook.onResponse(response, http)
  assert.equal(rows[0].userId, 7)
  assert.equal(rows[0].profile, 'work')
  assert.equal(rows[0].clientSha256, createHash('sha256').update(response.body.source).digest('hex'))
  assert.equal(rows[0].clientVersion, '0.8.36')
  assert.ok(!JSON.stringify(rows).includes('never-log'))
  hook.onResponse(response, { ...http, originalUrl: '/api/auth/me' })
  assert.equal(rows.length, 1)
  hook.onResponse({ status: 401, body: {} }, { ...http, identity: undefined })
  assert.equal(rows[1].userId, 0)
  assert.equal(rows[1].clientSha256, 'unavailable')
  assert.doesNotThrow(() => clientDeliveryInterceptor(() => { throw Error('disk full') }).onResponse(response, http))
  assert.deepEqual(response.headers, {})
})

test('client version is detected without a visible version label', () => {
  const rows = []
  clientDeliveryInterceptor(row => rows.push(row)).onResponse({ status: 200, body: { source: "const payload = { version: '0.8.41' }" } }, { request: { method: 'GET', headers: {host:'localhost:8648'} }, originalUrl: '/api/studio/plugins/deva/client', identity: {userId:1,profile:'default'} })
  assert.equal(rows[0].clientVersion, '0.8.41')
})
