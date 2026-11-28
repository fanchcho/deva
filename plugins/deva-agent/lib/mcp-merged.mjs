/** One catalog for the page and Agent. Desktop records remain lossless and authoritative. */
import { readFileSync, lstatSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, fchmodSync, fchownSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDevaRoot } from './deva-fs.mjs'
import { isServerName } from './mcp-store.mjs'
import { McpPool, parseServerConfig } from './mcp.mjs'
const pathPrefix = '/api/ekko/mcp/servers'
const object = value => value && typeof value === 'object' && !Array.isArray(value)
// Names are case sensitive in Studio and on desktop. Never fold distinct IDs together.
const key = name => String(name).trim()

function read(path) {
  let stat
  try { stat = lstatSync(path) } catch (e) { if (e.code === 'ENOENT') return { path, raw: null, value: {} }; throw e }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('MCP 配置必须是普通文件')
  const raw = readFileSync(path, 'utf8'), value = JSON.parse(raw)
  if (!object(value)) throw new Error('MCP 配置必须是对象')
  return { path, raw, value, stat }
}

/** Backup before replace, preserve mode/owner, compare before rename, clean up on failure. */
export function writeMcpDocument(doc, value, beforeRename = () => {}) {
  if (JSON.stringify(doc.value) === JSON.stringify(value)) return
  const tmp = `${doc.path}.${randomUUID()}.tmp`
  const put = (path, content) => {
    const fd = openSync(path, 'wx', doc.stat ? doc.stat.mode & 0o7777 : 0o600)
    try {
      if (doc.stat && typeof process.getuid === 'function') fchownSync(fd, doc.stat.uid, doc.stat.gid)
      if (doc.stat) fchmodSync(fd, doc.stat.mode & 0o7777)
      writeFileSync(fd, content); fsyncSync(fd)
    } finally { closeSync(fd) }
  }
  try {
    put(tmp, JSON.stringify(value, null, 2) + '\n')
    if (doc.raw !== null) put(`${doc.path}.${randomUUID()}.bak`, doc.raw)
    beforeRename()
    let current = null
    try { current = readFileSync(doc.path, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (current !== doc.raw) throw new Error('MCP 配置已被其它进程修改，请刷新')
    renameSync(tmp, doc.path)
  } finally { try { unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') throw e } }
}

function documents(config) {
  const root = resolveDevaRoot(config)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (lstatSync(root).isSymbolicLink()) throw new Error('MCP 配置目录不能是符号链接')
  const mcp = read(join(root, 'mcp.json')), cfg = read(join(root, 'config.json'))
  const servers = mcp.value.mcpServers === undefined ? {} : mcp.value.mcpServers, enabled = cfg.value.mcp?.enabled === undefined ? {} : cfg.value.mcp.enabled
  if (!object(servers) || Object.entries(servers).some(([name, entry]) => !isServerName(name) || !object(entry))) throw new Error('mcpServers 格式非法')
  if ((cfg.value.mcp !== undefined && !object(cfg.value.mcp)) || !object(enabled) || Object.values(enabled).some(v => typeof v !== 'boolean')) throw new Error('mcp.enabled 格式非法')
  return { mcp, cfg, servers: structuredClone(servers), enabled: { ...enabled } }
}
function persist(d) {
  writeMcpDocument(d.mcp, { ...d.mcp.value, mcpServers: d.servers })
  writeMcpDocument(d.cfg, { ...d.cfg.value, mcp: { ...d.cfg.value.mcp, enabled: d.enabled } })
}
function record(name, config, enabled, managed = false) {
  const transport = config.transport || config.type || (config.url ? 'http' : 'stdio')
  return { name, config: { ...config, ...(config.transport ? { type: transport === 'http' ? 'streamable_http' : transport } : {}), enabled }, enabled, managed, transport }
}

/** Unresolved desktop values must fail explicitly, never become '[object Object]' credentials. */
export function runtimeMcpConfig(config) {
  for (const field of ['env', 'headers']) for (const value of Object.values(config[field] || {})) {
    if (typeof value !== 'string') throw new Error('MCP env/headers 含未解析的桌面值或 secretRef，请在桌面解析凭据后配置字符串或 ${VAR}')
  }
  return config
}

export function mergedMcpHost(run, activationUserId) {
  const owner = run.config?.sharedDevaUserId ?? activationUserId
  if (!Number.isSafeInteger(owner) || owner !== run.identity?.userId) return run.host
  const host = run.host
  let snapshot
  async function catalog() {
    const data = await host.request(pathPrefix)
    if (data?.ok !== true || !Array.isArray(data.servers)) throw new Error('Studio MCP 清单格式异常')
    const d = documents(run.config), upstream = new Map()
    for (const entry of data.servers) {
      const hostName = key(entry.name)
      const aliases = Object.entries(d.servers).filter(([, value]) => key(value.name || '') === hostName).map(([id]) => id)
      const name = Object.hasOwn(d.servers, hostName) ? hostName : aliases.length === 1 ? aliases[0] : hostName
      if (!isServerName(name) || !object(entry.config) || upstream.has(name)) throw new Error('Studio MCP 清单格式异常')
      upstream.set(name, entry)
      if (!Object.hasOwn(d.servers, name)) {
        d.servers[name] = { ...structuredClone(entry.config), name, transport: entry.config.type === 'streamable_http' ? 'http' : entry.config.type || (entry.config.url ? 'http' : 'stdio') }
        d.enabled[name] = entry.enabled !== false && entry.config.enabled !== false
      }
    }
    persist(d)
    snapshot = { upstream }
    return { ok: true, servers: Object.entries(d.servers).map(([name, config]) => record(name, config, d.enabled[name] === true, upstream.get(name)?.managed === true)) }
  }
  return { async request(path, options = {}) {
    const method = options.method || 'GET'
    if (path === pathPrefix && method === 'GET') return catalog()
    if (!snapshot) await catalog()
    const name = key(options.body?.name || decodeURIComponent(path.slice(pathPrefix.length + 1).split('/')[0]))
    if (!isServerName(name)) throw new Error('无效 MCP 名称')
    const d = documents(run.config), previous = d.servers[name], upstream = snapshot.upstream.get(name)
    const upstreamPath = upstream ? `${pathPrefix}/${encodeURIComponent(upstream.name)}${path.endsWith('/test') ? '/test' : ''}` : path
    if (path.endsWith('/test')) {
      if (!d.enabled[name]) throw new Error('Enable the MCP server before testing it')
      const config = runtimeMcpConfig(previous)
      // Only delegate a probe when it is testing the exact effective configuration.
      if (upstream && Object.entries(upstream.config).every(([k, v]) => k === 'enabled' || JSON.stringify(config[k]) === JSON.stringify(v))) return host.request(upstreamPath, options)
      const parsed = parseServerConfig({ [name]: { ...config, enabled: true } })
      if (parsed.problems.length) throw new Error(parsed.problems.join('; '))
      const pool = new McpPool({ log: {} })
      try {
        await pool.connectAll(parsed.servers, run.signal)
        if (pool.problems.length) throw new Error(pool.problems.join('; '))
        return { ok: true, tools: pool.definitions().map(t => ({ name: t.original || t.name, description: t.description || '' })) }
      } finally { pool.close() }
    }
    if (method === 'POST') {
      if (previous) throw new Error('MCP server already exists')
      const response = await host.request(path, options)
      if (response?.ok !== true) return response
      d.servers[name] = { ...structuredClone(options.body.config), name, transport: options.body.config.type === 'streamable_http' ? 'http' : options.body.config.type || (options.body.config.url ? 'http' : 'stdio') }
      d.enabled[name] = options.body.config.enabled !== false
    } else if (method === 'DELETE') {
      if (!previous) throw new Error('MCP server not found')
      if (upstream) { const response = await host.request(upstreamPath, options); if (response?.ok !== true) return response }
      delete d.servers[name]; delete d.enabled[name]
    } else if (method === 'PATCH') {
      if (!previous) throw new Error('MCP server not found')
      const body = options.body
      // Keep the lossless desktop entry. Host projection is not allowed to erase extension fields.
      if (body.config) {
        d.servers[name] = { ...previous, ...body.config }
        if (body.config.type) d.servers[name].transport = body.config.type === 'streamable_http' ? 'http' : body.config.type
      }
      if (typeof body.enabled === 'boolean') d.enabled[name] = body.enabled
      else if (typeof body.config?.enabled === 'boolean') d.enabled[name] = body.config.enabled
      if (upstream) {
        const config = d.servers[name]
        const projection = Object.fromEntries(['type', 'command', 'args', 'env', 'url', 'headers'].filter(k => config[k] !== undefined).map(k => [k, config[k]]))
        const representable = ['env', 'headers'].every(k => Object.values(config[k] || {}).every(v => typeof v === 'string'))
        const response = await host.request(upstreamPath, { method, body: body.config && representable ? { config: { ...projection, enabled: d.enabled[name] } } : { enabled: d.enabled[name] } })
        if (response?.ok !== true) return response
      }
    } else throw new Error('Unsupported MCP operation')
    persist(d)
    return { ok: true, ...(method !== 'DELETE' ? { server: record(name, d.servers[name], d.enabled[name], upstream?.managed) } : {}) }
  } }
}
