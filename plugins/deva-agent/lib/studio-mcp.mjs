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
import { parseServerConfig } from './mcp.mjs'

const STORAGE_KEY = 'mcp'
const SERVERS_PATH = '/api/ekko/mcp/servers'
/** 与 Studio 的 MCP 服务名规则一致（`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`）。 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 单个 Agent 最多纳入的 Studio MCP 服务数（与 contracts/plugin.json 的 maxItems 一致）。 */
export const MAX_SELECTED_SERVERS = 32

/** 服务名是否与 Studio 接受的一致。 */
export function isServerName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

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

/** 用户+profile 作用域的 MCP 选择存储：profile 存储按 Profile 分区，再按用户分一层。 */
export function selectionStore(state, identity) {
  if (!state?.profile || typeof state.profile.namespace !== 'function') {
    throw new Error('缺少 profile 存储作用域，无法读写 Studio MCP 选择')
  }
  return state.profile.namespace(String(identity?.userId ?? 'anonymous'))
}

/** 读已选服务名；记录缺失、损坏或名字非法时按空列表处理（下次保存会重写）。 */
export async function readSelection(state, identity) {
  const stored = await selectionStore(state, identity).get(STORAGE_KEY)
  const list = Array.isArray(stored?.servers) ? stored.servers : []
  return [...new Set(list.filter(name => isServerName(name)))].slice(0, MAX_SELECTED_SERVERS)
}

/** 保存已选服务名；只接受合法服务名，重名去重，超上限报错。 */
export async function writeSelection(state, identity, names) {
  if (!Array.isArray(names)) throw new Error('servers 必须是服务名数组')
  const unique = [...new Set(names)]
  for (const name of unique) assertServerName(name)
  if (unique.length > MAX_SELECTED_SERVERS) throw new Error(`最多选择 ${MAX_SELECTED_SERVERS} 个 MCP 服务`)
  await selectionStore(state, identity).set(STORAGE_KEY, { servers: unique })
  return unique
}

function requireHost(host) {
  if (!host || typeof host.request !== 'function') {
    throw new Error('当前运行环境没有 Studio 宿主通道（host.request），无法读写 Studio 的 MCP 服务')
  }
  return host
}

/** 宿主失败时保留原始说明，方便定位是权限、Profile 还是服务端问题。 */
function describe(error) {
  return error?.body?.error?.message || error?.body?.error || error?.message || String(error)
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
  const data = await requireHost(host).request(SERVERS_PATH)
  const entries = Array.isArray(data?.servers) ? data.servers : []
  return entries.map(normalizeStudioServer).filter(server => server !== null)
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
  if (!server) throw new Error(`Studio 没有返回 ${expectedName} 的规范化配置`)
  return server
}

/** 新增服务：Studio 校验配置形状（类型、command/url、args/env/headers 等），错误原样抛出。 */
export async function createStudioServer(host, { name, config }) {
  const wanted = assertServerName(name)
  const data = await requireHost(host).request(SERVERS_PATH, { method: 'POST', body: { name: wanted, config: assertConfig(config) } })
  return serverFromResponse(data, wanted)
}

/** 覆盖已有服务的连接配置。 */
export async function updateStudioServer(host, { name, config }) {
  const wanted = assertServerName(name)
  const data = await requireHost(host).request(`${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'PATCH', body: { config: assertConfig(config) } })
  return serverFromResponse(data, wanted)
}

/** 在 Studio 里启用/停用服务；停用的服务本轮不连接。 */
export async function setStudioServerEnabled(host, { name, enabled }) {
  const wanted = assertServerName(name)
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
  const data = await requireHost(host).request(`${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'PATCH', body: { enabled } })
  return serverFromResponse(data, wanted)
}

/** 删除服务；Studio 里不存在时抛错（不会静默成功）。 */
export async function deleteStudioServer(host, { name }) {
  const wanted = assertServerName(name)
  await requireHost(host).request(`${SERVERS_PATH}/${encodeURIComponent(wanted)}`, { method: 'DELETE' })
  return { name: wanted }
}

/** 让 Studio 连一次服务并列出工具；停用的服务 Studio 会直接报错。 */
export async function testStudioServer(host, { name }) {
  const wanted = assertServerName(name)
  const data = await requireHost(host).request(`${SERVERS_PATH}/${encodeURIComponent(wanted)}/test`, { method: 'POST', body: {} })
  const tools = Array.isArray(data?.tools) ? data.tools : null
  if (!tools) throw new Error(`Studio 没有返回 ${wanted} 的工具清单`)
  return tools.map(tool => ({ name: String(tool?.name ?? ''), description: String(tool?.description ?? '') }))
}

/**
 * 本轮实际要连接的 Studio 服务：只取已选条目，按 config 转成本插件的客户端配置。
 * 没有选择时完全不访问宿主。任何一步失败都返回 problems，由调用方写进系统提示词。
 */
export async function resolveStudioServers({ host, state, identity, log = console } = {}) {
  let selected
  try {
    selected = await readSelection(state, identity)
  } catch (error) {
    return { servers: [], problems: [`读取 Studio MCP 选择失败：${error.message}`] }
  }
  if (!selected.length) return { servers: [], problems: [] }
  let available
  try {
    available = await listStudioServers(host)
  } catch (error) {
    return { servers: [], problems: [`读取 Studio MCP 服务失败：${describe(error)}（已选：${selected.join('、')}）`] }
  }
  const byName = new Map(available.map(server => [server.name, server]))
  const problems = []
  const configs = {}
  for (const name of selected) {
    const server = byName.get(name)
    if (!server) { problems.push(`${name}: Studio 里已不存在这个 MCP 服务`); continue }
    if (!server.enabled) { problems.push(`${name}: 在 Studio 里已停用`); continue }
    if (!server.config) { problems.push(`${name}: Studio 没有返回可用的连接配置`); continue }
    configs[name] = server.config
  }
  let parsed
  try {
    parsed = parseServerConfig({ mcpServers: configs })
  } catch (error) {
    return { servers: [], problems: [...problems, `Studio MCP 配置无法解析：${error.message}`] }
  }
  problems.push(...parsed.problems)
  if (parsed.servers.length) log.info?.(`deva: Studio MCP 已选 ${parsed.servers.length} 个服务（${parsed.servers.map(server => server.name).join('/')}）`)
  return { servers: parsed.servers, problems }
}
