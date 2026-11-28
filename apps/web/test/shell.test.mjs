import test from 'node:test'
import assert from 'node:assert/strict'
import { shell } from '../src/backend/shell.mjs'
import { downloadDeliverable } from '../src/web/deliverables.js'

test('native shell operations fail with actionable codes rather than silent success', async () => {
  await assert.rejects(shell.openPath('/file'), { code: 'WEB_NATIVE_OPEN_UNSUPPORTED' })
  await assert.rejects(shell.openExternal('https://example.com'), { code: 'WEB_EXTERNAL_OPEN_UNSUPPORTED' })
  assert.throws(() => shell.showItemInFolder('/file'), { code: 'WEB_REVEAL_UNSUPPORTED' })
})

test('browser download preserves bytes and filename; unsupported response rejects', async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document }
  let clicked = 0, removed = 0, link
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => (link = { click() { clicked++ }, remove() { removed++ } })
  }
  try {
    globalThis.fetch = async url => {
      assert.equal(new URL(url, 'http://local').searchParams.get('toolUseId'), 'tool')
      return new Response('download-bytes', { headers: { 'content-disposition': "attachment; filename*=UTF-8''report.txt" } })
    }
    assert.deepEqual(await downloadDeliverable(['session', 'tool', 0]), { ok: true })
    assert.equal(clicked, 1)
    assert.equal(removed, 1)
    assert.equal(link.download, 'report.txt')
    assert.equal(await (await previous.fetch(link.href)).text(), 'download-bytes')
    globalThis.fetch = async () => new Response(JSON.stringify({
      code: 'WEB_FILE_TYPE_UNSUPPORTED', error: '此文件类型不支持通过 Web 打开'
    }), { status: 415 })
    await assert.rejects(downloadDeliverable(['session', 'tool', 1]), { code: 'WEB_FILE_TYPE_UNSUPPORTED' })
    assert.equal(clicked, 1)
  } finally { Object.assign(globalThis, previous) }
})

test('reveal notifies browser user and preserves explicit error code', async () => {
  const previous = globalThis.window
  const notices = []
  globalThis.window = { alert: message => notices.push(message) }
  try {
    const { ipcRenderer } = await import('../src/electron-shim.js')
    await assert.rejects(ipcRenderer.invoke('deliverables:reveal', 's', 't', 0), { code: 'WEB_REVEAL_UNSUPPORTED' })
    assert.match(notices[0], /WEB_REVEAL_UNSUPPORTED.*下载/)
  } finally { globalThis.window = previous }
})
