/** Shared MCP name/path validation and legacy read-only inspection helper.
 * The active page and Agent use mcp-merged.mjs; this helper never writes files.
 */

import { join } from 'node:path'
import { DevaIdentityError, resolveDevaRoot } from './deva-fs.mjs'
import { lstatSync, readFileSync } from 'node:fs'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 与 Studio 的 MCP 服务名规则一致。 */
export const MAX_SELECTED_SERVERS = 32

export function isServerName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

export function mcpFilePath(config = {}) {
  return join(resolveDevaRoot(config), 'mcp.json')
}

function transportOf(entry) {
  const declared = String(entry?.transport || entry?.type || '').trim().toLowerCase()
  if (declared === 'sse' || declared === 'http' || declared === 'streamable_http' || declared === 'streamablehttp') return 'http'
  return entry?.url ? 'http' : 'stdio'
}

function readOnlyJson(path) {
  let stat
  try { stat = lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('桌面配置必须是普通文件')
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('桌面配置 JSON 损坏或不可读') }
}

function readDesktopStore(config) {
  const path = mcpFilePath(config)
  const file = readOnlyJson(path)
  if (!file) return { path, exists: false, servers: {} }
  const value = file
  if (!object(value)) throw new DevaIdentityError('DEVA_MCP_INVALID_SHAPE', `桌面 mcp.json 顶层应为对象：${path}`, { path })
  if (!object(value.mcpServers) || Object.entries(value.mcpServers).some(([id, entry]) => !isServerName(id) || !object(entry))) {
    throw new DevaIdentityError('DEVA_MCP_INVALID_SHAPE', 'mcpServers 必须是合法 ID 到对象的映射', { path })
  }
  return { path, exists: true, servers: value.mcpServers }
}

function enabledMap(config) {
  const cfg = readOnlyJson(join(resolveDevaRoot(config), 'config.json')) ?? {}
  if (!object(cfg)) throw new Error('config.json 必须为对象')
  const mcp = cfg.mcp ?? {}
  if (!object(mcp) || (mcp.enabled !== undefined && (!object(mcp.enabled) || Object.values(mcp.enabled).some(value => typeof value !== 'boolean')))) {
    throw new DevaIdentityError('DEVA_MCP_INVALID_SHAPE', 'config.json 的 mcp/enabled 结构非法，拒绝改动')
  }
  return mcp.enabled ?? {}
}

/**
 * 设置页的桌面兼容视图：只读、无 CRUD。
 * @param {object} config run.config（sharedDevaHome 等）
 * @returns {{path: string, exists: boolean, entries: Array<{name: string, transport: string, enabled: boolean}>, error?: string}}
 */
export function readDesktopMcpCompatibility(config = {}) {
  let path = ''
  try { path = mcpFilePath(config) } catch (error) {
    return { path: '', exists: false, entries: [], error: error.message }
  }
  let store, enabled = {}, readError = ''
  try {
    store = readDesktopStore(config)
  } catch (error) {
    return { path, exists: false, entries: [], error: error.message }
  }
  try {
    enabled = enabledMap(config)
  } catch (error) {
    readError = error.message
  }
  const entries = Object.entries(store.servers).map(([id, entry]) => ({
    name: id,
    transport: transportOf(entry),
    enabled: enabled[id] === true,
  }))
  const error = readError
  return { path, exists: store.exists, entries, ...(error ? { error } : {}) }
}
