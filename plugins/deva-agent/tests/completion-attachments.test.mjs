import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAttachmentReader, convertHistory } from '../lib/attachments.mjs'

async function fixture(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'attachments-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = join(dir, 'work'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  const store = new Map(), assets = new Map()
  const run = { paths: { workspaceDir: root }, config, state: { agentSession: { get: async k => store.get(k), set: async (k,v) => store.set(k, structuredClone(v)) } }, attachments: {
    resolve: async id => assets.get(id), read: async () => { throw new Error('text/binary files must use bounded local reads') },
  } }
  async function asset(id, body, mediaType = 'text/plain', path = root) {
    const localPath = join(path, id); await writeFile(localPath, body)
    assets.set(id, { assetId: id, name: id, localPath, mediaType, size: Buffer.byteLength(body) })
    return { type: 'file', assetId: id, name: id, mediaType }
  }
  return { dir, root, outside, store, run, asset, assets }
}
test('history attachments are retained and text inside an allowed root is read', async t => {
  const f = await fixture(t), block = await f.asset('a', 'actual text')
  const reader = await createAttachmentReader(f.run)
  const history = await convertHistory([{ role: 'user', content: [block] }], reader)
  assert.match(history[0].text, /actual text/)
  assert.equal((await reader.read(block)).status, 'ok')
})
test('attachment paths outside roots and symlink escapes are explicitly rejected', async t => {
  const f = await fixture(t), block = await f.asset('a', 'secret', 'text/plain', f.outside)
  const reader = await createAttachmentReader(f.run)
  assert.equal((await reader.read(block)).code, 'OUTSIDE_AUTHORIZED_ROOT')
  await symlink(join(f.outside, 'a'), join(f.root, 'link'))
  f.assets.set('link', { ...f.assets.get('a'), assetId: 'link', localPath: join(f.root, 'link') })
  assert.equal((await reader.read({ ...block, assetId: 'link' })).code, 'OUTSIDE_AUTHORIZED_ROOT')
})
test('explicit host configuration can authorize an additional attachment root', async t => {
  const f = await fixture(t); f.run.config.attachmentAllowedRoots = [f.outside]
  const block = await f.asset('a', 'allowed', 'text/plain', f.outside)
  assert.equal((await (await createAttachmentReader(f.run)).read(block)).text, 'allowed')
})
test('attachment single-file and persisted session budgets reject without silent omission', async t => {
  const f = await fixture(t, { attachmentMaxFileBytes: 4, attachmentMaxSessionBytes: 6 })
  const a = await f.asset('a', '1234'), b = await f.asset('b', '1234'), c = await f.asset('c', '12345')
  const reader = await createAttachmentReader(f.run)
  assert.equal((await reader.read(a)).status, 'ok')
  assert.equal((await reader.read(a)).status, 'ok', 'same asset counts once')
  assert.equal((await reader.read(c)).code, 'FILE_BUDGET_EXCEEDED')
  assert.equal((await (await createAttachmentReader(f.run)).read(b)).code, 'SESSION_BUDGET_EXCEEDED')
})
test('binary attachments return metadata and absolute path without decoding bytes as text', async t => {
  const f = await fixture(t), block = await f.asset('a.pdf', Buffer.from('%PDF-1.7\n\0binary'), 'application/pdf')
  const result = await (await createAttachmentReader(f.run)).read(block)
  assert.equal(result.kind, 'binary'); assert.equal(result.localPath, join(f.root, 'a.pdf'))
  assert.equal(result.text, undefined)
})
test('attachment expiry is stable across turns and cannot be reset by re-reading', async t => {
  const f = await fixture(t, { attachmentTtlMs: 10 }), block = await f.asset('a', '123')
  assert.equal((await (await createAttachmentReader(f.run, { now: () => 100 })).read(block)).status, 'ok')
  assert.equal((await (await createAttachmentReader(f.run, { now: () => 111 })).read(block)).code, 'ATTACHMENT_EXPIRED')
})

test('resuming a checkpoint refreshes attachments and removes expired cached contents', async t => {
  const { refreshAttachments, convertContent } = await import('../lib/attachments.mjs')
  const f = await fixture(t, { attachmentTtlMs: 10 }), block = await f.asset('a', 'private-old-body')
  const message = await convertContent('user', [block], await createAttachmentReader(f.run, { now: () => 100 }))
  assert.match(message.text, /private-old-body/)
  await refreshAttachments([message], await createAttachmentReader(f.run, { now: () => 111 }))
  assert.match(message.text, /ATTACHMENT_EXPIRED/); assert.doesNotMatch(message.text, /private-old-body/)
})
test('read_file uses the same attachment budget, binary and expiry policy', async t => {
  const { executeTool } = await import('../lib/tools.mjs')
  const f = await fixture(t), block = await f.asset('a.pdf', '%PDF-1.7 text-shaped bytes', 'application/pdf')
  const reader = await createAttachmentReader(f.run); await reader.read(block)
  const output = JSON.parse(await executeTool('read_file', { path: join(f.root, 'a.pdf') }, { workspaceDir: f.root, attachmentReader: reader }))
  assert.equal(output.attachment.status, 'metadata_only')
  assert.equal(output.attachment.text, undefined)
})
