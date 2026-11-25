/**
 * 插件管理的 MCP 服务：**与桌面同构**，落在 `~/.deva/mcp.json` 的 `mcpServers`，
 * 启用态落 `~/.deva/config.json → mcp.enabled[id]`（桌面既有位置）。
 *
 * `mcpServers[id]` schema（桌面 `mcp-config.ts`）：
 *   { name, description, transport:'stdio'|'http', command?, args?, env?, url?, headers? }
 * 密钥：桌面允许 env/header 值为明文字符串或 `{secretRef}`；插件不读写桌面 safeStorage，
 * 也不把已加密值解密；插件新建/修改时按用户输入写明文，RPC 只回 `__EKKO_SECRET_UNCHANGED__` 掩码。
 *
 * 不再写 `deva-agent/mcp-servers.json`；旧文件由 lib/deva-layout.mjs 一次性迁移并删除。
 */

import { join } from 'node:path'
import { DevaIdentityError, ensurePrivateDirectory, readStrictText, resolveDevaRoot, writeAtomic } from './deva-fs.mjs'
import { readDevaConfig, updateConfigSection } from './persona-store.mjs'
import { migrateLegacyLayout } from './deva-layout.mjs'
import { createClient, parseServerConfig } from './mcp.mjs'
import { mergeMcpSecrets, safeMcpError } from './mcp-secrets.mjs'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const MAX_SELECTED_SERVERS = 32

export function isServerName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

function assertServerName(name) {
  if (!isServerName(name)) throw new DevaIdentityError('DEVA_MCP_BAD_NAME', 'MCP 服务名需以字母或数字开头，最多 64 位，只能包含字母、数字、点、下划线、连字符')
  return name
}

export function mcpFilePath(config = {}) {
  return join(resolveDevaRoot(config), 'mcp.json')
}

function readStore(config) {
  const path = mcpFilePath(config)
  const file = readStrictText(path)
  if (!file) return { path, raw: null, value: {}, servers: {}, exists: false }
  let value
  try { value = JSON.parse(file.raw) } catch { throw new DevaIdentityError('DEVA_MCP_INVALID_JSON', `桌面 mcp.json 不是合法 JSON：${path}；没有覆盖`, { path }) }
  if (!object(value)) throw new DevaIdentityError('DEVA_MCP_INVALID_SHAPE', `桌面 mcp.json 顶层应为对象：${path}`, { path })
  const servers = object(value.mcpServers) ? value.mcpServers : {}
  return { path, raw: file.raw, value, servers, exists: true }
}

function writeStore(config, store, servers) {
  const value = { ...store.value, mcpServers: servers }
  ensurePrivateDirectory(resolveDevaRoot(config))
  writeAtomic(store.path, `${JSON.stringify(value, null, 2)}\n`, { expectedRaw: store.exists ? store.raw : null })
}

function enabledMap(config) {
  const cfg = readDevaConfig(config)
  const mcp = object(cfg.value.mcp) ? cfg.value.mcp : {}
  return object(mcp.enabled) ? mcp.enabled : {}
}

function writeEnabled(config, id, enabled) {
  updateConfigSection(config, 'mcp', section => ({ ...section, enabled: { ...(object(section.enabled) ? section.enabled : {}), [id]: Boolean(enabled) } }))
}

function removeEnabled(config, id) {
  updateConfigSection(config, 'mcp', section => {
    const map = { ...(object(section.enabled) ? section.enabled : {}) }
    delete map[id]
    return { ...section, enabled: map }
  })
}

function transportOf(entry) {
  return entry?.transport === 'http' || entry?.url ? 'http' : 'stdio'
}

function publicServer(id, entry, enabled) {
  if (id && typeof id === 'object') {
    return { name: id.name, transport: id.transport || transportOf(entry), managed: false, enabled: id.enabled === true }
  }
  return { name: id, transport: transportOf(entry), managed: false, enabled: enabled === true }
}

export { publicServer }

export function listDevamcpServers(config = {}) {
  const { servers } = readStore(config)
  const enabled = enabledMap(config)
  return Object.entries(servers).map(([id, entry]) => publicServer(id, entry, enabled[id]))
}

export function getDevamcpServer(config, name) {
  const id = assertServerName(name)
  const { servers } = readStore(config)
  const entry = servers[id]
  if (!entry) throw new DevaIdentityError('DEVA_MCP_NOT_FOUND', `${id}: Deva MCP 里不存在这个服务`)
  const enabled = enabledMap(config)[id] === true
  const transport = transportOf(entry)
  return {
    name: id, transport, managed: false, enabled,
    config: transport === 'stdio'
      ? { type: 'stdio', command: entry.command || '', args: Array.isArray(entry.args) ? entry.args : [], env: object(entry.env) ? entry.env : {}, enabled }
      : { type: 'http', url: entry.url || '', headers: object(entry.headers) ? entry.headers : {}, enabled },
  }
}

function toDesktopEntry(name, config) {
  const transport = config.type === 'http' ? 'http' : 'stdio'
  const entry = { name, description: '', transport }
  if (transport === 'stdio') {
    entry.command = config.command
    entry.args = Array.isArray(config.args) ? config.args : []
    if (object(config.env)) entry.env = config.env
  } else {
    entry.url = config.url
    if (object(config.headers)) entry.headers = config.headers
  }
  return entry
}

/** 校验并规范化插件/Studio 侧输入为插件内部配置形状（stdio/http + command|url）。 */
export function normalizeConfig(input, { previous } = {}) {
  if (!object(input)) throw new DevaIdentityError('DEVA_MCP_INVALID_CONFIG', 'MCP 连接配置必须是 JSON 对象')
  const merged = previous ? mergeMcpSecrets(input, previous) : mergeMcpSecrets(input, {})
  const declared = String(merged.type || merged.transport || (merged.command ? 'stdio' : merged.url ? 'http' : '')).toLowerCase()
  const type = declared === 'streamable_http' || declared === 'streamablehttp' || declared === 'http' ? 'http' : declared
  if (type === 'stdio') {
    if (typeof merged.command !== 'string' || !merged.command.trim()) throw new DevaIdentityError('DEVA_MCP_INVALID_CONFIG', 'stdio MCP 缺少 command')
    const config = {
      type: 'stdio', command: merged.command.trim(),
      args: Array.isArray(merged.args) ? merged.args.map(String) : [],
      env: object(merged.env) ? Object.fromEntries(Object.entries(merged.env).map(([k, v]) => [k, String(v)])) : {},
      enabled: merged.enabled !== false,
    }
    return config
  }
  if (type === 'http') {
    if (typeof merged.url !== 'string' || !/^https?:\/\//.test(merged.url)) throw new DevaIdentityError('DEVA_MCP_INVALID_CONFIG', 'HTTP MCP 需要 http(s) 的 url')
    return {
      type: 'http', url: merged.url,
      headers: object(merged.headers) ? Object.fromEntries(Object.entries(merged.headers).map(([k, v]) => [k, String(v)])) : {},
      enabled: merged.enabled !== false,
    }
  }
  throw new DevaIdentityError('DEVA_MCP_INVALID_CONFIG', 'MCP 类型只支持 stdio 或 streamable_http')
}

export function createDevamcpServer(config, { name, config: input }) {
  const id = assertServerName(name)
  const store = readStore(config)
  if (store.servers[id]) throw new Error(`MCP server already exists: ${id}`)
  if (Object.keys(store.servers).length >= MAX_SELECTED_SERVERS) throw new Error(`最多 ${MAX_SELECTED_SERVERS} 个 MCP 服务`)
  const normalized = normalizeConfig(input)
  const servers = { ...store.servers, [id]: toDesktopEntry(id, normalized) }
  writeStore(config, store, servers)
  writeEnabled(config, id, normalized.enabled !== false)
  return publicServer(id, servers[id], normalized.enabled !== false)
}

export function updateDevamcpServer(config, { name, config: input }) {
  const id = assertServerName(name)
  const store = readStore(config)
  const previousEntry = store.servers[id]
  if (!previousEntry) throw new Error('MCP server not found')
  const previous = getDevamcpServer(config, id).config
  const normalized = normalizeConfig({ ...input, enabled: input?.enabled ?? previous.enabled }, { previous })
  const servers = { ...store.servers, [id]: toDesktopEntry(id, normalized) }
  writeStore(config, store, servers)
  writeEnabled(config, id, normalized.enabled !== false)
  return publicServer(id, servers[id], normalized.enabled !== false)
}

export function setDevamcpServerEnabled(config, { name, enabled }) {
  const id = assertServerName(name)
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
  const store = readStore(config)
  if (!store.servers[id]) throw new Error('MCP server not found')
  writeEnabled(config, id, enabled)
  return publicServer(id, store.servers[id], enabled)
}

export function deleteDevamcpServer(config, { name }) {
  const id = assertServerName(name)
  const store = readStore(config)
  if (!store.servers[id]) throw new Error('MCP server not found')
  const servers = { ...store.servers }
  delete servers[id]
  writeStore(config, store, servers)
  removeEnabled(config, id)
  return { name: id }
}

export async function testDevamcpServer(config, { name }) {
  const id = assertServerName(name)
  const server = getDevamcpServer(config, id).config
  const parsed = parseServerConfig({ mcpServers: { [id]: { ...server, enabled: true } } })
  if (!parsed.servers.length) throw new DevaIdentityError('DEVA_MCP_INVALID_CONFIG', parsed.problems[0] || 'MCP 配置无法解析')
  let client
  try {
    client = await createClient(parsed.servers[0])
    const result = await client.request('tools/list', {})
    const tools = Array.isArray(result?.tools) ? result.tools : []
    return tools.map(tool => ({ name: String(tool?.name ?? ''), description: String(tool?.description ?? '') }))
  } catch (error) {
    throw safeMcpError(error)
  } finally {
    try { client?.close() } catch { /* ignore */ }
  }
}

/** 旧 deva-agent 迁移由 layout 负责；这里只触发一次（幂等）。 */
export async function ensureDevamcpStore(config, _options = {}) {
  const migration = migrateLegacyLayout(config)
  return { migrated: Boolean(migration.migrated), problems: [] }
}

export function resolveDevamcpServers({ config, log = console } = {}) {
  const { servers } = readStore(config)
  const enabled = enabledMap(config)
  const selected = Object.entries(servers).filter(([id]) => enabled[id] === true)
  const configs = Object.fromEntries(selected.map(([id, entry]) => [id, toDesktopEntry(id, {
    type: transportOf(entry), command: entry.command, args: entry.args, env: entry.env, url: entry.url, headers: entry.headers, enabled: true,
  })]))
  const problems = []
  let parsed
  try { parsed = parseServerConfig({ mcpServers: configs }) } catch (error) { return { servers: [], problems: [`Deva MCP 配置无法解析：${error.message}`] } }
  problems.push(...parsed.problems)
  if (parsed.servers.length) log.info?.(`deva: 自带 MCP ${parsed.servers.length} 个服务（${parsed.servers.map(server => server.name).join('/')}）`)
  return { servers: parsed.servers, problems }
}
