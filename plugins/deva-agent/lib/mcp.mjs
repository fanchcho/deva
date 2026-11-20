/**
 * 插件自带的 MCP 客户端：stdio / Streamable HTTP / 旧版 SSE 三种传输。
 *
 * 为什么需要它：Studio 只在「任务计划运行」里给 Agent 注入 run.mcpServers，
 * 普通插件运行拿到的是空对象，所以插件无法依赖宿主把 MCP 接进来。这里用零依赖实现
 * JSON-RPC 2.0（stdio 走按行分帧，HTTP 走 POST + SSE），把发现到的工具并入本插件的工具表。
 *
 * 安全约定：
 *  · 配置里的 env / headers 支持 `${VAR}` 从插件进程环境展开，避免把密钥写进配置文件；
 *    展开不到时连接直接失败并明确报出变量名，不静默跳过。
 *  · 工具结果一律当数据（纯文本 + 图片/资源说明），不解析其中的任何指令。
 *  · 连接与调用都有超时；失败只影响该服务，不中断整轮对话。
 */
import { spawn } from 'node:child_process'
import { spillText } from './spill.mjs'

const PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'deva-studio-plugin', version: '1' }
const CONNECT_TIMEOUT = 30000
const CALL_TIMEOUT = 60000
const MAX_TEXT = 30000
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export class McpError extends Error {}

/** `${VAR}` 展开；缺失变量收集后一次性报错。 */
export function expandEnv(value, env = process.env) {
  const missing = []
  const text = String(value ?? '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    const found = env[name]
    if (found === undefined) { missing.push(name); return '' }
    return found
  })
  return { text, missing }
}

function expandMap(map, env) {
  const out = {}
  const missing = []
  for (const [key, value] of Object.entries(map || {})) {
    const name = String(key).trim()
    if (!name) continue
    const result = expandEnv(value, env)
    missing.push(...result.missing)
    out[name] = result.text
  }
  return { out, missing }
}

/** 把显示名收敛成模型 API 与 Studio 都能接受的短名。 */
export function sanitizeName(raw, fallback = 'server') {
  const slug = String(raw ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return NAME_PATTERN.test(slug) ? slug : fallback
}

/** 解析配置：接受对象、JSON 字符串；单条坏配置只跳过它自己，不拖垮整张表。 */
export function parseServerConfig(raw) {
  let value = raw
  if (typeof value === 'string') {
    if (!value.trim()) return { servers: [], problems: [] }
    try { value = JSON.parse(value) } catch (error) { throw new McpError(`mcpServers 不是合法 JSON：${error.message}`) }
  }
  if (value === null || value === undefined) return { servers: [], problems: [] }
  if (typeof value !== 'object' || Array.isArray(value)) throw new McpError('mcpServers 必须是「名称 → 配置」的对象')
  const map = value.mcpServers && typeof value.mcpServers === 'object' ? value.mcpServers : value
  const servers = []
  const problems = []
  for (const [key, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${key}: 配置必须是对象`); continue }
    if (entry.enabled === false) continue
    const name = sanitizeName(key)
    if (!NAME_PATTERN.test(name)) { problems.push(`${key}: 名称无法用作工具命名空间`); continue }
    const type = String(entry.type || entry.transport || (entry.command ? 'stdio' : entry.url ? 'http' : '')).toLowerCase()
    if (type === 'stdio' || (!type && entry.command)) {
      if (typeof entry.command !== 'string' || !entry.command.trim()) { problems.push(`${key}: stdio 缺少 command`); continue }
      servers.push({ name, type: 'stdio', command: entry.command, args: Array.isArray(entry.args) ? entry.args.map(String) : [], env: entry.env || {}, cwd: entry.cwd })
      continue
    }
    if (type === 'http' || type === 'streamable_http' || type === 'streamablehttp') {
      if (typeof entry.url !== 'string' || !entry.url.trim()) { problems.push(`${key}: http 缺少 url`); continue }
      servers.push({ name, type: 'http', url: entry.url, headers: entry.headers || {} })
      continue
    }
    if (type === 'sse') {
      if (typeof entry.url !== 'string' || !entry.url.trim()) { problems.push(`${key}: sse 缺少 url`); continue }
      servers.push({ name, type: 'sse', url: entry.url, headers: entry.headers || {} })
      continue
    }
    problems.push(`${key}: 未知传输类型 ${type || '（空）'}`)
  }
  return { servers, problems }
}

/** 宿主注入的 run.mcpServers 与配置表合并：同名时宿主优先（本轮凭证更新）。 */
export function mergeServers(configured, injected) {
  const merged = new Map()
  for (const server of configured) merged.set(server.name, server)
  for (const server of injected) merged.set(server.name, server)
  return [...merged.values()]
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new McpError(`${label} 超时（>${Math.round(ms / 1000)}s）`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function abortError() {
  return new McpError('本轮已被取消')
}

/** 统一的 JSON-RPC 客户端外壳：子类只需实现 send/close。 */
class RpcClient {
  constructor(label) {
    this.label = label
    this.seq = 0
    this.pending = new Map()
    this.closed = false
  }

  nextId() { return ++this.seq }

  /** initialize 握手：三种传输共用。 */
  async initialize(signal) {
    this.initializeResult = await withTimeout(this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, { signal, timeout: CONNECT_TIMEOUT }), CONNECT_TIMEOUT, `${this.label} 初始化`)
    this.notify('notifications/initialized', {})
    return this
  }

  request(method, params, { signal, timeout = CALL_TIMEOUT } = {}) {
    if (this.closed) return Promise.reject(new McpError(`${this.label} 已断开`))
    const id = this.nextId()
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const onAbort = () => { this.fail(id, abortError()) }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      const timer = setTimeout(() => this.fail(id, new McpError(`${this.label} 调用超时（>${Math.round(timeout / 1000)}s）`)), timeout)
      this.pending.get(id).cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
      }
    })
    this.deliver(id, String(method), params || {}).catch(error => this.fail(id, error))
    return promise
  }

  fail(id, error) {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.cleanup?.()
    entry.reject(error)
  }

  settle(id, message) {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.cleanup?.()
    if (message.error) entry.reject(new McpError(`${this.label}：${message.error.message || '调用失败'}`))
    else entry.resolve(message.result)
  }

  handlePayload(payload) {
    if (Array.isArray(payload)) { for (const item of payload) this.handlePayload(item); return }
    if (!payload || typeof payload !== 'object') return
    if (payload.id === undefined || payload.id === null) return
    this.settle(payload.id, payload)
  }

  shutdown(reason) {
    this.closed = true
    for (const [id, entry] of this.pending) {
      this.pending.delete(id)
      entry.cleanup?.()
      entry.reject(new McpError(`${this.label} 已断开${reason ? `：${reason}` : ''}`))
    }
  }
}

/** stdio：子进程 + 换行分帧的 JSON-RPC。 */
class StdioClient extends RpcClient {
  constructor(config, env) {
    super(`MCP ${config.name}`)
    this.config = config
    this.env = env
  }

  async connect(signal) {
    const child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd || undefined,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line) continue
        try { this.handlePayload(JSON.parse(line)) } catch { /* 非 JSON 行（日志）忽略 */ }
      }
    })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-2000) })
    child.on('error', error => this.shutdown(error.message))
    child.on('exit', code => this.shutdown(stderr.trim() || `进程退出 ${code}`))
    await this.initialize(signal)
    return this
  }

  async deliver(id, method, params) {
    if (this.closed || !this.child?.stdin?.writable) throw new McpError(`${this.label} 不可写入`)
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  }

  notify(method, params) {
    if (!this.closed && this.child?.stdin?.writable) {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    }
  }

  close() {
    this.shutdown('主动关闭')
    try { this.child?.kill('SIGKILL') } catch { /* 已经退出 */ }
  }
}

function sseDataFrames(buffer, onFrame) {
  let rest = buffer
  let index
  while ((index = rest.indexOf('\n\n')) >= 0) {
    const frame = rest.slice(0, index)
    rest = rest.slice(index + 2)
    let event = 'message'
    const data = []
    for (const raw of frame.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    onFrame(event, data.join('\n'))
  }
  return rest.replace(/\r\n/g, '\n')
}

/** Streamable HTTP：POST JSON-RPC，响应可能是 JSON，也可能是同一条请求的 SSE 流。 */
class HttpClient extends RpcClient {
  constructor(config, headers) {
    super(`MCP ${config.name}`)
    this.config = config
    this.headers = headers
    this.sessionId = null
  }

  async connect(signal) {
    this.signal = signal
    await this.initialize(signal)
    return this
  }

  async deliver(id, method, params) {
    const response = await fetch(this.config.url, {
      method: 'POST',
      signal: this.signal,
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    const session = response.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    if (!response.ok) throw new McpError(`${this.label}：HTTP ${response.status}`)
    const type = String(response.headers.get('content-type') || '')
    if (type.includes('text/event-stream')) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer = sseDataFrames(buffer + decoder.decode(value, { stream: true }), (event, data) => {
            if (event !== 'message' || !data) return
            try { this.handlePayload(JSON.parse(data)) } catch { /* 忽略坏帧 */ }
          })
        }
      } finally {
        try { await reader.cancel() } catch { /* 已结束 */ }
      }
      return
    }
    const body = await response.json().catch(() => null)
    if (body) this.handlePayload(body)
  }

  notify() { /* Streamable HTTP 无状态服务器不接受通知；initialize 后无需发送 */ }

  close() { this.shutdown('主动关闭') }
}

/**
 * 旧版 SSE：GET 建立长连接，服务器先发 `endpoint` 事件给出 POST 地址，
 * 之后每条响应当 SSE `message` 推送。
 */
class SseClient extends RpcClient {
  constructor(config, headers) {
    super(`MCP ${config.name}`)
    this.config = config
    this.headers = headers
    this.endpoint = null
  }

  async connect(signal) {
    const controller = new AbortController()
    this.signal = controller.signal
    const onAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
    const response = await withTimeout(fetch(this.config.url, {
      signal: controller.signal,
      headers: { ...this.headers, accept: 'text/event-stream' },
    }), CONNECT_TIMEOUT, this.label)
    if (!response.ok || !response.body) throw new McpError(`${this.label}：HTTP ${response.status}`)
    const endpointReady = new Promise((resolve, reject) => { this.resolveEndpoint = resolve; this.rejectEndpoint = reject })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    this.reader = reader
    ;(async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer = sseDataFrames(buffer + decoder.decode(value, { stream: true }), (event, data) => {
            if (event === 'endpoint') {
              try { this.endpoint = new URL(data, this.config.url).href; this.resolveEndpoint?.(this.endpoint) } catch { this.rejectEndpoint?.(new McpError('endpoint 地址无效')) }
              return
            }
            if (event !== 'message' || !data) return
            try { this.handlePayload(JSON.parse(data)) } catch { /* 忽略坏帧 */ }
          })
        }
        this.shutdown('连接结束')
        this.rejectEndpoint?.(new McpError(`${this.label}：未收到 endpoint`))
      } catch (error) {
        this.shutdown(error?.message)
        this.rejectEndpoint?.(error)
      }
    })()
    await withTimeout(endpointReady, CONNECT_TIMEOUT, `${this.label} 握手`)
    await this.initialize(signal)
    return this
  }

  async deliver(id, method, params) {
    if (!this.endpoint) throw new McpError(`${this.label}：尚未收到 endpoint`)
    const response = await fetch(this.endpoint, {
      method: 'POST',
      signal: this.signal,
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    if (!response.ok) throw new McpError(`${this.label}：HTTP ${response.status}`)
  }

  notify(method, params) {
    if (!this.endpoint) return
    void fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {})
  }

  close() {
    this.shutdown('主动关闭')
    try { this.reader?.cancel() } catch { /* 已结束 */ }
  }
}

/** initialize 握手在 RpcClient 上实现，见 RpcClient#initialize。 */

export function createClient(config, { signal, env = process.env } = {}) {
  if (config.type === 'stdio') {
    const resolved = expandMap(config.env, env)
    if (resolved.missing.length) throw new McpError(`${config.name} 缺少环境变量：${resolved.missing.join('、')}`)
    return new StdioClient(config, resolved.out)
  }
  const resolved = expandMap(config.headers, env)
  if (resolved.missing.length) throw new McpError(`${config.name} 缺少请求头变量：${resolved.missing.join('、')}`)
  if (config.type === 'sse') return new SseClient(config, resolved.out)
  return new HttpClient(config, resolved.out)
}

/** tools/list 分页拉全量。 */
async function listAllTools(client, signal) {
  const tools = []
  let cursor
  for (let page = 0; page < 20; page++) {
    const result = await client.request('tools/list', cursor ? { cursor } : {}, { signal })
    for (const tool of result?.tools || []) {
      if (!tool?.name) continue
      const schema = tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
        ? tool.inputSchema
        : { type: 'object', properties: {}, required: [] }
      tools.push({ name: String(tool.name), description: String(tool.description || ''), inputSchema: schema })
    }
    cursor = result?.nextCursor
    if (!cursor) break
  }
  return tools
}

/**
 * 结果统一收敛成文本：文本块拼接，图片/资源只留说明，避免伪造结构。
 * 这里不截断——长度治理在 McpPool.call 里做（超长时全文落盘、只回首尾预览），
 * 先截断会把结尾的报错与汇总丢掉。
 */
export function flattenResult(result) {
  const parts = []
  for (const block of result?.content || []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push(`（图片内容：${block.mimeType || '未知类型'}，本插件未转交图片）`)
    else if (block.type === 'resource') {
      const resource = block.resource || {}
      parts.push(resource.text !== undefined
        ? String(resource.text)
        : `（资源：${resource.uri || '未知地址'}${resource.mimeType ? `，${resource.mimeType}` : ''}，本插件未转交二进制）`)
    } else if (block.type === 'resource_link') parts.push(`（资源链接：${block.uri || '未知地址'}）`)
    else parts.push(`（未识别的内容块：${block.type || '无类型'}）`)
  }
  const text = parts.join('\n').trim()
  return { text: text || '（MCP 工具没有返回内容）', isError: result?.isError === true }
}

/**
 * 一轮运行内的 MCP 连接池。
 * connectAll 在全量服务上并行发起，单点失败只记录原因；
 * tools() 返回命名空间化后的工具定义（mcp__<server>__<tool>）。
 */
export class McpPool {
  constructor({ log = console, env = process.env } = {}) {
    this.log = log
    this.env = env
    this.clients = new Map()
    this.tools = new Map()
    this.failures = new Map()
    this.problems = []
  }

  async connectAll(servers, signal) {
    this.problems = []
    await Promise.all(servers.map(async config => {
      if (this.clients.has(config.name)) return
      try {
        const client = createClient(config, { signal, env: this.env })
        await client.connect(signal)
        const discovered = await listAllTools(client, signal)
        this.clients.set(config.name, client)
        for (const tool of discovered) {
          const fqName = `mcp__${config.name}__${sanitizeName(tool.name, `tool-${this.tools.size}`)}`
          if (this.tools.has(fqName)) continue
          this.tools.set(fqName, {
            name: fqName,
            description: `[MCP:${config.name}] ${tool.description || tool.name}`.slice(0, 1024),
            inputSchema: tool.inputSchema,
            server: config.name,
            original: tool.name,
          })
        }
        this.log.info?.(`deva: MCP ${config.name} 已连接，工具 ${discovered.length} 个`)
      } catch (error) {
        const message = error?.message || String(error)
        this.failures.set(config.name, message)
        this.problems.push(`${config.name}: ${message}`)
        this.log.warn?.(`deva: MCP ${config.name} 连接失败：${message}`)
      }
    }))
    return this
  }

  definitions() { return [...this.tools.values()] }

  async call(fqName, input, { signal, runtimeDir } = {}) {
    const tool = this.tools.get(fqName)
    if (!tool) throw new McpError(`未知的 MCP 工具：${fqName}`)
    const client = this.clients.get(tool.server)
    if (!client) throw new McpError(`MCP 服务 ${tool.server} 未连接（${this.failures.get(tool.server) || '原因未知'}）`)
    const result = await client.request('tools/call', { name: tool.original, arguments: input || {} }, { signal, timeout: CALL_TIMEOUT })
    const flat = flattenResult(result)
    // 错误文本原样抛出（调用方记成 tool.failed）；成功结果超长时全文落盘、只回首尾预览。
    if (flat.isError) throw new McpError(await spillText(flat.text, MAX_TEXT, { runtimeDir, label: 'mcp' }))
    return await spillText(flat.text, MAX_TEXT, { runtimeDir, label: 'mcp' })
  }

  /** 本轮结束后断开：凭证随本轮失效，不跨轮保留连接。 */
  close() {
    for (const client of this.clients.values()) {
      try { client.close() } catch { /* 已经关闭 */ }
    }
    this.clients.clear()
    this.tools.clear()
  }
}
