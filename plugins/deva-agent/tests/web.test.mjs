import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { decodeEntities, htmlToText, executeWebFetch } from '../lib/web.mjs'

test('htmlToText drops scripts and keeps readable body text', () => {
  const { title, text } = htmlToText('<html><head><title>A &amp; B</title><style>x{}</style></head><body><h1>标题</h1><p>正文 <b>加粗</b></p><script>alert(1)</script></body></html>')
  assert.equal(title, 'A & B')
  assert.match(text, /标题/)
  assert.match(text, /正文 加粗/)
  assert.doesNotMatch(text, /alert/)
  assert.doesNotMatch(text, /\{x\}/)
})

test('decodeEntities handles named and numeric entities without double decoding', () => {
  assert.equal(decodeEntities('&lt;a&gt; &amp;lt; &#65; &#x42;'), '<a> &lt; A B')
})

function serve(handler) {
  return new Promise(resolve => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

test('web_fetch converts HTML, passes JSON through, and rejects other protocols', async () => {
  const { server, url } = await serve((request, response) => {
    if (request.url === '/json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
      return
    }
    if (request.url === '/bin') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(Buffer.from([0, 1, 2, 3]))
      return
    }
    if (request.url === '/fail') {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('boom')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<html><head><title>文档</title></head><body><p>hello</p></body></html>')
  })
  try {
    const html = await executeWebFetch({ url }, {})
    assert.match(html, /^URL: /)
    assert.match(html, /标题: 文档/)
    assert.match(html, /hello/)
    assert.match(await executeWebFetch({ url: `${url}/json` }, {}), /\{"ok":true\}/)
    await assert.rejects(executeWebFetch({ url: `${url}/bin` }, {}), /非文本内容/)
    await assert.rejects(executeWebFetch({ url: `${url}/fail` }, {}), /HTTP 500/)
    await assert.rejects(executeWebFetch({ url: 'file:///etc/passwd' }, {}), /仅支持 http\/https/)
    await assert.rejects(executeWebFetch({ url: 'not a url' }, {}), /URL 无效/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('long web pages spill to the runtime directory and say where', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-web-'))
  const body = `<html><body>${'字'.repeat(120000)}</body></html>`
  const { server, url } = await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(body)
  })
  try {
    const text = await executeWebFetch({ url }, { runtimeDir: dir })
    assert.match(text, /超过 100000/)
    const match = text.match(/完整内容已写入：(.+?)（可用 read_file/)
    assert.ok(match, '落盘路径必须明确给出')
    const spilled = await readFile(match[1], 'utf8')
    assert.ok(spilled.length > 100000)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})

test('web_fetch reports timeouts and cancellation without hanging', async () => {
  const { server, url } = await serve(() => { /* 永不响应 */ })
  try {
    await assert.rejects(executeWebFetch({ url }, { signal: AbortSignal.timeout(50) }), /取消|超时/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
