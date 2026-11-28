import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAttachment, pickAttachments } from '../src/web/attachments.js'

test('file picker uploads binary bytes, cleans up on selection and cancellation', async () => {
  const previous = globalThis.document
  let input, removed = 0
  const bytes = new Uint8Array([0, 127, 128, 255])
  globalThis.document = {
    body: { appendChild() {} },
    createElement() {
      const events = {}
      input = { files: [{ name: 'data.txt', type: 'text/plain', size: 4, arrayBuffer: async () => bytes.buffer }],
        addEventListener: (event, fn) => { events[event] = fn },
        click() {}, remove() { removed++ }, events }
      return input
    }
  }
  try {
    const pending = pickAttachments(async file => {
      const wire = JSON.parse(JSON.stringify(encodeAttachment(file)))
      assert.deepEqual(Buffer.from(wire.data.base64, 'base64'), Buffer.from(bytes))
      return { name: file.name }
    })
    await input.events.change()
    assert.deepEqual(await pending, [{ name: 'data.txt' }])
    const canceled = pickAttachments(() => assert.fail('canceled picker must not upload'))
    input.events.cancel()
    assert.deepEqual(await canceled, [])
    assert.equal(removed, 2)
  } finally { globalThis.document = previous }
})

test('web clipboard uses the browser clipboard and dropped files never claim server paths', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
  let text = ''
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: {
    readText: async () => text,
    writeText: async value => { text = value }
  } })
  try {
    const { ipcRenderer, webUtils } = await import('../src/electron-shim.js')
    assert.deepEqual(await ipcRenderer.invoke('clipboard:write-text', '浏览器 clipboard'), { ok: true })
    assert.equal(await ipcRenderer.invoke('clipboard:read-text'), '浏览器 clipboard')
    assert.equal(webUtils.getPathForFile({ name: 'secret.txt', path: '/server/secret.txt' }), '')
  } finally {
    if (old) Object.defineProperty(globalThis.navigator, 'clipboard', old)
    else delete globalThis.navigator.clipboard
  }
})
