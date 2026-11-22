import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpPool, parseServerConfig, expandEnv, sanitizeName, mergeServers, flattenResult, serverFingerprint } from '../lib/mcp.mjs'

/** 一个最小 MCP stdio 服务器：换行分帧的 JSON-RPC，工具 echo/慢/sse 由调用方按需选。 */
const STDIO_SERVER = `
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
if (process.env.START_LOG) appendFileSync(process.env.START_LOG, 'start\\n')
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } })
  else if (message.method === 'notifications/initialized') { /* 通知不需要回复 */ }
  else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [
    { name: 'echo', description: '原样返回', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'fail', description: '总是失败', inputSchema: { type: 'object', properties: {} } },
  ] } })
  else if (message.method === 'tools/call') {
    if (message.params.name === 'fail') send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: '炸了' }] } })
    else send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echo:' + JSON.stringify(message.params.arguments) }] } })
  }
  else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown ' + message.method } })
})
`

async function fakeStdioServer() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-'))
  const file = join(dir, 'server.mjs')
  await writeFile(file, STDIO_SERVER)
  await chmod(file, 0o755)
  return { dir, file, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('parseServerConfig accepts the desktop mcp.json shape and skips disabled entries', () => {
  const { servers, problems } = parseServerConfig({
    mcpServers: {
      fs: { command: 'node', args: ['x.mjs'], env: { TOKEN: '${TOKEN}' } },
      web: { type: 'streamable_http', url: 'https://example.test/mcp', headers: { authorization: 'Bearer ${KEY}' } },
      old: { type: 'sse', url: 'https://example.test/sse' },
      off: { command: 'x', enabled: false },
      broken: { type: 'stdio' },
      weird: { type: 'carrier-pigeon' },
    },
  })
  assert.deepEqual(servers.map(server => [server.name, server.type]), [['fs', 'stdio'], ['web', 'http'], ['old', 'sse']])
  assert.equal(problems.length, 2)
  assert.match(problems.join('\n'), /broken: stdio 缺少 command/)
  assert.match(problems.join('\n'), /weird: 未知传输类型 carrier-pigeon/)
})

test('config parsing rejects garbage instead of silently connecting nothing', () => {
  assert.throws(() => parseServerConfig('[1,2]'), /必须是/)
  assert.throws(() => parseServerConfig('{oops'), /不是合法 JSON/)
  assert.deepEqual(parseServerConfig('').servers, [])
})

test('env expansion reports missing variables and host-injected servers win on name clashes', () => {
  assert.deepEqual(expandEnv('a-${HAS}-b', { HAS: '1' }), { text: 'a-1-b', missing: [] })
  assert.deepEqual(expandEnv('${NOPE}', {}).missing, ['NOPE'])
  const merged = mergeServers([{ name: 'x', type: 'stdio', command: 'a' }], [{ name: 'x', type: 'http', url: 'b' }])
  assert.deepEqual(merged, [{ name: 'x', type: 'http', url: 'b' }])
  assert.equal(sanitizeName('My Server!'), 'My-Server')
})

test('flattenResult keeps text and marks errors without inventing structure', () => {
  const flat = flattenResult({ content: [{ type: 'text', text: 'hi' }, { type: 'image', mimeType: 'image/png' }] })
  assert.match(flat.text, /^hi/)
  assert.match(flat.text, /图片内容/)
  assert.equal(flat.isError, false)
  assert.equal(flattenResult({ isError: true, content: [{ type: 'text', text: 'bad' }] }).isError, true)
})

test('stdio MCP connects, lists namespaced tools, calls them, and surfaces errors', async () => {
  const { file, cleanup } = await fakeStdioServer()
  const pool = new McpPool({ log: { info() {}, warn() {} } })
  try {
    await pool.connectAll([{ name: 'fake', type: 'stdio', command: process.execPath, args: [file], env: {} }], new AbortController().signal)
    const names = pool.definitions().map(tool => tool.name)
    assert.deepEqual(names, ['mcp__fake__echo', 'mcp__fake__fail'])
    assert.match(pool.definitions()[0].description, /^\[MCP:fake\] 原样返回/)
    assert.equal(await pool.call('mcp__fake__echo', { text: '你好' }), 'echo:{"text":"你好"}')
    await assert.rejects(pool.call('mcp__fake__fail', {}), /炸了/)
  } finally {
    pool.close()
    await cleanup()
  }
})

test('a failing MCP server is reported and never blocks the other tools', async () => {
  const { file, cleanup } = await fakeStdioServer()
  const pool = new McpPool({ log: { info() {}, warn() {} } })
  try {
    await pool.connectAll([
      { name: 'good', type: 'stdio', command: process.execPath, args: [file], env: {} },
      { name: 'bad', type: 'stdio', command: '/definitely/not/a/binary', args: [], env: {} },
      { name: 'missing-env', type: 'stdio', command: process.execPath, args: [file], env: { TOKEN: '${DEVA_MCP_TEST_MISSING}' } },
    ], new AbortController().signal)
    assert.ok(pool.definitions().some(tool => tool.name === 'mcp__good__echo'))
    const reasons = [...pool.failures.entries()]
    assert.equal(reasons.length, 2)
    assert.match(reasons.find(([name]) => name === 'missing-env')[1], /缺少环境变量：DEVA_MCP_TEST_MISSING/)
    assert.ok(pool.problems.length >= 2)
  } finally {
    pool.close()
    await cleanup()
  }
})

test('serverFingerprint ignores key order but notices credential changes', () => {
  const a = serverFingerprint({ name: 'x', type: 'http', url: 'u', headers: { a: '1', b: '2' } })
  const b = serverFingerprint({ headers: { b: '2', a: '1' }, url: 'u', type: 'http', name: 'x' })
  assert.equal(a, b)
  assert.notEqual(a, serverFingerprint({ name: 'x', type: 'http', url: 'u', headers: { a: '1', b: '3' } }))
  assert.notEqual(a, serverFingerprint({ name: 'x', type: 'http', url: 'u2', headers: { a: '1', b: '2' } }))
})

test('connections are reused across connectAll and rebuilt only when the config changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-mcp-reuse-'))
  const file = join(dir, 'server.mjs')
  const startsFile = join(dir, 'starts.log')
  await writeFile(file, STDIO_SERVER)
  await chmod(file, 0o755)
  const pool = new McpPool({ log: { info() {}, warn() {} } })
  const signal = new AbortController().signal
  const config = extra => ({
    name: 'fake', type: 'stdio', command: process.execPath, args: [file],
    env: { START_LOG: startsFile, ...extra },
  })
  const starts = async () => (await readFile(startsFile, 'utf8')).trim().split('\n').filter(Boolean).length
  try {
    await pool.connectAll([config()], signal)
    assert.equal(await starts(), 1)

    // 同配置再来一轮：不重新握手，连接与工具定义都还在
    await pool.connectAll([config()], signal)
    assert.equal(await starts(), 1)
    assert.equal(await pool.call('mcp__fake__echo', { text: 'still' }), 'echo:{"text":"still"}')

    // 凭证/配置变了：旧连接断开，重新握手
    await pool.connectAll([config({ EXTRA: '1' })], signal)
    assert.equal(await starts(), 2)
    assert.equal(await pool.call('mcp__fake__echo', { text: 'new' }), 'echo:{"text":"new"}')

    // 服务被移除：连接关闭，工具定义一并消失
    await pool.connectAll([], signal)
    assert.deepEqual(pool.definitions(), [])
    await assert.rejects(pool.call('mcp__fake__echo', { text: 'gone' }), /未知的 MCP 工具/)
  } finally {
    pool.close()
    await rm(dir, { recursive: true, force: true })
  }
})

function sseServer(handler) {
  return new Promise(resolve => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

test('streamable HTTP MCP speaks JSON-RPC over POST and SSE', async () => {
  let mode = 'json'
  const { server, port } = await sseServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const message = JSON.parse(body)
      const reply = message.method === 'initialize'
        ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } } }
        : message.method === 'tools/list'
          ? { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'ping', description: 'pong', inputSchema: { type: 'object', properties: {} } }] } }
          : { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong+' + (message.params.arguments.n ?? 0) }] } }
      if (mode === 'sse') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 's-1' })
        response.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(reply))
    })
  })
  try {
    const pool = new McpPool({ log: { info() {}, warn() {} } })
    await pool.connectAll([{ name: 'http', type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: {} }], new AbortController().signal)
    assert.equal(await pool.call('mcp__http__ping', { n: 2 }), 'pong+2')
    mode = 'sse'
    assert.equal(await pool.call('mcp__http__ping', { n: 3 }), 'pong+3')
    pool.close()
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('a long MCP result spills to the runtime directory with both ends previewed', async () => {
  const big = `开头\n${'填充内容\n'.repeat(8000)}结尾报错：failed`
  const { server, port } = await sseServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const message = JSON.parse(body)
      const reply = message.method === 'initialize'
        ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } } }
        : message.method === 'tools/list'
          ? { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'big', description: 'big', inputSchema: { type: 'object', properties: {} } }] } }
          : { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: big }] } }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(reply))
    })
  })
  const runtimeDir = await mkdtemp(join(tmpdir(), 'deva-mcp-spill-'))
  const pool = new McpPool({ log: { info() {}, warn() {} } })
  try {
    await pool.connectAll([{ name: 'http', type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: {} }], new AbortController().signal)
    const out = await pool.call('mcp__http__big', {}, { runtimeDir })
    assert.match(out, /完整内容已保存到：/)
    assert.match(out, /开头/)
    assert.match(out, /结尾报错：failed/)
    const file = out.match(/完整内容已保存到：(.+)\n/)[1]
    assert.equal(await readFile(file, 'utf8'), big)
  } finally {
    pool.close()
    await rm(runtimeDir, { recursive: true, force: true })
    await new Promise(resolve => server.close(resolve))
  }
})

test('streamable HTTP accepts CRLF SSE frames without a trailing blank line', async () => {
  const { server, port } = await sseServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const message = JSON.parse(body)
      const result = message.method === 'initialize'
        ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'ping', description: 'pong', inputSchema: { type: 'object', properties: {} } }] }
          : { content: [{ type: 'text', text: 'ok' }] }
      const reply = { jsonrpc: '2.0', id: message.id, result }
      if (message.method === 'tools/call') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        // 只有 CRLF、且末尾没有空行：帧必须仍然被交付。
        response.end(`event: message\r\ndata: ${JSON.stringify(reply)}\r\n`)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(reply))
    })
  })
  const pool = new McpPool({ log: { info() {}, warn() {} } })
  try {
    await pool.connectAll([{ name: 'http', type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: {} }], new AbortController().signal)
    assert.equal(await pool.call('mcp__http__ping', {}), 'ok')
  } finally {
    pool.close()
    await new Promise(resolve => server.close(resolve))
  }
})

test('legacy SSE MCP uses the endpoint event and streams replies', async () => {
  const { server, port } = await sseServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`event: endpoint\ndata: /messages?session=1\n\n`)
      // 保持连接；收到的 POST 结果通过这个流推回去
      sseServer.current = response
      return
    }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const message = JSON.parse(body)
      const reply = message.method === 'initialize'
        ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } } }
        : message.method === 'tools/list'
          ? { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'hello', description: 'say hi', inputSchema: { type: 'object', properties: {} } }] } }
          : { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'hi' }] } }
      sseServer.current?.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
      response.writeHead(202).end()
    })
  })
  try {
    const pool = new McpPool({ log: { info() {}, warn() {} } })
    await pool.connectAll([{ name: 'sse', type: 'sse', url: `http://127.0.0.1:${port}/sse`, headers: {} }], new AbortController().signal)
    assert.equal(await pool.call('mcp__sse__hello', {}), 'hi')
    pool.close()
  } finally {
    sseServer.current?.end()
    await new Promise(resolve => server.close(resolve))
  }
})
