import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStaticHandler } from '../src/server/static.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deva-static-'))
  const assets = join(root, 'web-assets')
  await mkdir(assets)
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head></head><body>hi</body></html>')
  await writeFile(join(root, 'app.js'), 'console.log(1)')
  await writeFile(join(assets, 'mobile.css'), 'body{color:red}')
  return { root, assets }
}

async function serve(handler) {
  const server = http.createServer((req, res) => {
    handler(req, res, new URL(req.url ?? '/', 'http://localhost').pathname).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

test('static handler serves renderer files with ETag, 304 and streaming headers', async (t) => {
  const { root, assets } = await fixture()
  const handler = createStaticHandler({
    rendererDir: root,
    assetsDir: assets,
    injectIndex: source => source.replace('</head>', '<script src="/boot.js"></script></head>')
  })
  const server = await serve(handler)
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const first = await fetch(`${server.base}/app.js`)
  assert.equal(first.status, 200)
  assert.match(first.headers.get('content-type'), /text\/javascript/)
  assert.equal(first.headers.get('cache-control'), 'public, max-age=3600')
  assert.equal(first.headers.get('content-length'), '14')
  const etag = first.headers.get('etag')
  assert.ok(etag, '应返回 ETag')
  assert.equal(await first.text(), 'console.log(1)')

  const byEtag = await fetch(`${server.base}/app.js`, { headers: { 'if-none-match': etag } })
  assert.equal(byEtag.status, 304)
  assert.equal(await byEtag.text(), '')

  const byTime = await fetch(`${server.base}/app.js`, {
    headers: { 'if-modified-since': new Date().toUTCString() }
  })
  assert.equal(byTime.status, 304)

  const head = await fetch(`${server.base}/app.js`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), '14')
  assert.equal(await head.text(), '')

  const index = await fetch(`${server.base}/`)
  assert.equal(index.status, 200)
  assert.match(await index.text(), /<script src="\/boot\.js"><\/script>/)
  assert.equal(index.headers.get('cache-control'), 'no-store')

  const css = await fetch(`${server.base}/mobile.css`)
  assert.equal(css.status, 200)
  assert.equal(css.headers.get('cache-control'), 'no-store')
  assert.equal(await css.text(), 'body{color:red}')

  const missing = await fetch(`${server.base}/nope.js`)
  assert.equal(missing.status, 404)

  // 编码后的 ../ 也必须被挡在 renderer 根外。
  const escape = await fetch(`${server.base}/..%2Fetc%2Fpasswd`)
  assert.equal(escape.status, 403)
})
