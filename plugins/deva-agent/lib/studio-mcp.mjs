/**
 * Studio MCP 兼容层：Agent 的 MCP 配置直接落在 Studio 自己的 MCP 服务表里，
 * 插件设置页负责增删改/启停/测试，运行时按用户勾选取连接配置并入本轮 McpPool。
 *
 * 数据面（走 run.host.request / ctx.host.request，读需 api.read，写需 api.write；Profile 固定为本轮身份）：
 *  GET    /api/ekko/mcp/servers          Studio 已配置的 MCP 服务与原始 config
 *  GET    /api/ekko/mcp/servers          （单条配置按名字在清单里取）
 *  POST   /api/ekko/mcp/servers          新增服务 {name,config}
 *  PATCH  /api/ekko/mcp/servers/:name    改配置 {config} 或启停 {enabled}
 *  DELETE /api/ekko/mcp/servers/:name    删除
 *  POST   /api/ekko/mcp/servers/:name/test  连一次并列出工具
 *
 * 插件自己不存 MCP 连接配置，也不复制 Studio 的凭据：服务配置只有一份，在 Studio 里；
 * 插件只保存「这个 Agent 用哪些服务」的名字列表（user+profile 作用域的 storage.mcp），
 * 连接配置每次运行现取，用户在 Studio 或本页改完，下一轮即生效。
 * 失败一律显式暴露（RPC 报错 / 系统提示词的「MCP 连接状态」），不静默当成「没配服务」。
 */
import { validateStored } from './storage-contracts.mjs'
import { safeMcpError } from './mcp-secrets.mjs'
import { isServerName, MAX_SELECTED_SERVERS, readDesktopMcpCompatibility } from './mcp-store.mjs'

const STORAGE_KEY = 'mcp'
const SERVERS_PATH = '/api/ekko/mcp/servers'
function assertServerName(name) {
  if (!isServerName(name)) {
    throw new Error('MCP 服务名需以字母或数字开头，最多 64 位，只能包含字母、数字、点、下划线、连字符')
  }
  return name
}

function assertConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('MCP 连接配置必须是 JSON 对象')
  return config
}

function selectionStore({ state, identity }) {
  if (identity?.userId == null || typeof state?.profile?.namespace !== 'function') {
    throw new Error('缺少 Studio MCP 的用户或 Profile 作用域')
  }
  return state.profile.namespace(String(identity.userId))
}

/** 读取本 Agent 已保存的服务名；没有保存过时返回 null（由调用方决定默认值）。 */
export async function readStoredMcpSelection(run) {
  if (run.identity?.userId == null || typeof run.state?.profile?.namespace !== 'function') return null
  const stored = await selectionStore(run).get(STORAGE_KEY)
  return stored === undefined ? null : validateStored('mcp', stored).servers
}

async function readSelection(run, available) {
  const stored = await readStoredMcpSelection(run)
  if (stored !== null) return stored
  return available.filter(item => item.enabled).map(item => item.name)
}

export async function saveStudioSelection(run, names) {
  const available = await listStudioServers(run.host)
  const wanted = [...new Set(names)]
  const enabled = new Set(available.filter(server => server.enabled).map(server => server.name))
  if (wanted.length > MAX_SELECTED_SERVERS || wanted.some(name => !isServerName(name) || !enabled.has(name))) {
    throw new Error('MCP 清单已变更：只可勾选 Studio 中已启用的服务，请刷新后重试')
  }
  await selectionStore(run).set(STORAGE_KEY, validateStored('mcp', { servers: wanted }))
  return { ok: true, selected: wanted }
}

function requireHost(host) {
  if (!host || typeof host.request !== 'function') {
    throw new Error('当前运行环境没有 Studio 宿主通道（host.request），无法读写 Studio 的 MCP 服务')
  }
  return host
}

// Do not forward arbitrary upstream stderr/config in a page or a prompt.
async function request(host, path, options) {
  try {
    const data = await requireHost(host).request(path, options)
    if (data?.ok !== true) throw new Error()
    return data
  } catch (error) {
    throw new Error(`Studio MCP 请求失败：${path}；${safeMcpError(error).message}`)
  }
}

/**
 * 把 Studio 的一条服务记录收敛成插件内部形状。
 * Studio 只认 stdio / streamable_http；页面统一把后者显示为 http。
 * @returns {{name: string, transport: string, managed: boolean, enabled: boolean, config: object|null} | null}
 */
export function normalizeStudioServer(entry) {
  if (!entry || typeof entry !== 'object' || !isServerName(entry.name)) return null
  const config = entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config) ? entry.config : null
  const declared = String(entry.transport || config?.type || '').trim().toLowerCase()
  const transport = declared === 'streamable_http' || declared === 'streamablehttp' || declared === 'http'
    ? 'http'
    : declared || (config?.url ? 'http' : config?.command ? 'stdio' : '')
  return {
    name: entry.name,
    transport,
    managed: entry.managed === true,
    enabled: entry.enabled !== false && config?.enabled !== false,
    config,
  }
}

/** 页面需要的展示字段（不含连接配置与密钥）。 */
export function publicServer(server) {
  return { name: server.name, transport: server.transport, managed: server.managed, enabled: server.enabled }
}

/**
 * 读 Studio MCP 服务清单。
 * @returns {Promise<Array<{name: string, transport: string, managed: boolean, enabled: boolean, config: object|null}>>}
 */
export async function listStudioServers(host) {
  const data = await request(host, SERVERS_PATH)
  if (!Array.isArray(data.servers)) throw new Error('Studio MCP 清单格式异常：缺少 servers 数组')
  const entries = data.servers.map(normalizeStudioServer)
  if (entries.some(item => !item?.config) || new Set(entries.map(item => item.name)).size !== entries.length) {
    throw new Error('Studio MCP 清单格式异常：无效或重复服务')
  }
  return entries
}

/** 单条服务的完整配置（编辑时按需取，列表页不下发密钥）。 */
export async function getStudioServer(host, name) {
  const wanted = assertServerName(name)
  const server = (await listStudioServers(host)).find(item => item.name === wanted)
  if (!server) throw new Error(`${wanted}: Studio 里已不存在这个 MCP 服务`)
  return server
}

function serverFromResponse(data, expectedName) {
  const server = normalizeStudioServer(data?.server)
  if (!server || server.name !== expectedName) throw new Error(`Studio 没有返回 ${expectedName} 的规范化配置`)
  return server
}

/** 新增服务：Studio 校验配置形状（类型、command/url、args/env/headers 等），错误原样抛出。 */
export async function createStudioServer(host, { name, config }) {
  const wanted = assertServerName(name)
  const data = await request(host, SERVERS_PATH, { method: 'POST', body: { name: wanted, config: assertConfig(config) } })
  return serverFromResponse(data, wanted)
}

/** 覆盖已有服务的连接配置。 */
export async function updateStudioServer(host, { name, config }) {
  const wanted = assertServerName(name)
  const data = await request(host, `${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'PATCH', body: { config: assertConfig(config) } })
  return serverFromResponse(data, wanted)
}

/** 在 Studio 里启用/停用服务；停用的服务本轮不连接。 */
export async function setStudioServerEnabled(host, { name, enabled }) {
  const wanted = assertServerName(name)
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
  const data = await request(host, `${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'PATCH', body: { enabled } })
  return serverFromResponse(data, wanted)
}

/** 删除服务；Studio 里不存在时抛错（不会静默成功）。 */
export async function deleteStudioServer(host, { name }) {
  const wanted = assertServerName(name)
  await request(host, `${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'DELETE' })
  return { name: wanted }
}

/** 让 Studio 连一次服务并列出工具；停用的服务 Studio 会直接报错。 */
export async function testStudioServer(host, { name }) {
  const wanted = assertServerName(name)
  const data = await request(host, `${SERVERS_PATH}/${encodeURIComponent(wanted)}/test`, { method: 'POST', body: {} })
  const tools = Array.isArray(data?.tools) ? data.tools : null
  if (!tools) throw new Error(`Studio 没有返回 ${wanted} 的工具清单`)
  return tools.map(tool => ({ name: String(tool?.name ?? ''), description: String(tool?.description ?? '') }))
}

/** Mirrors the native Ekko MCP page: probe enabled servers via Studio, never run them in the settings handler.
 * A failed probe is unknown, not a zero; summary count is a lower bound if any probe failed. */
export async function readStudioMcpPage(run, activationUserId) {
  const catalog = await listStudioServers(run.host)
  const selected = await readSelection(run, catalog)
  const byName = new Map(catalog.map(server => [server.name, server]))
  const servers = await Promise.all(catalog.map(async server => {
    const summary = publicServer(server)
    if (!server.enabled) return { ...summary, toolCount: 0 }
    try {
      return { ...summary, toolCount: (await testStudioServer(run.host, server)).length }
    } catch {
      return { ...summary, toolCountUnavailable: true }
    }
  }))
  // 桌面兼容视图只读；失败不影响 Studio 清单。
  const owner = run.config?.sharedDevaUserId ?? activationUserId
  const desktopCompatibility = owner === run.identity?.userId && Number.isSafeInteger(owner)
    ? readDesktopMcpCompatibility(run.config)
    : { path: '', exists: false, entries: [], error: 'DESKTOP_MCP_OWNER_REQUIRED' }
  return { servers, selected: selected.filter(name => byName.get(name)?.enabled !== false), desktopCompatibility }
}
