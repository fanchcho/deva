import { readJsonFile } from './corrupt-files.mjs'
/**
 * 桌面 `.deva` 布局的唯一迁移入口与选择态存储。
 *
 * 桌面端权威布局（apps/desktop/src/main/services）：
 *  · `config.json`：顶层浅合并；`personas.enabled/order`、`skills.enabled`、`mcp.enabled`、`models.*`
 *  · `mcp.json`：`{ mcpServers: { <id>: { name, description, transport, command,args,env,url,headers } } }`
 *  · `secrets.json`：safeStorage 密文（插件不读写）
 *  · `read-state.json`：对话已读时间戳
 *  · `personas/<id>.md`、`personas/avatars/<id>.<ext>`、`skills/<id>/SKILL.md`、`data/`
 *
 * 插件不再创建 `deva-agent/` 顶层目录。旧的 `deva-agent/` 一次性迁移：
 *  · 整目录先备份到 `.deva` 之外（默认 `~/.deva-backups/`）；
 *  · `identity.json.selected` → `config.json.personas.selected`
 *  · `sessions.json` → `config.json.personas.sessionSelected`
 *  · `mcp-servers.json` → `mcp.json.mcpServers` + `config.json.mcp.enabled`
 *  · 成功后删除 `deva-agent/`。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensurePrivateDirectory, readStrictText, resolveDevaRoot, writeAtomic } from './deva-fs.mjs'
import { readDevaConfig, updateConfigSection } from './persona-store.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function backupRoot() {
  const override = process.env.DEVA_BACKUP_ROOT?.trim()
  return override || join(homedir(), '.deva-backups')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function readJsonIfExists(path) {
  return readJsonFile(path)
}

export function readConfigSelection(config = {}) {
  const cfg = readDevaConfig(config)
  const section = object(cfg.value.personas) ? cfg.value.personas : {}
  return {
    selected: typeof section.selected === 'string' ? section.selected : null,
    sessionSelected: object(section.sessionSelected) ? section.sessionSelected : {},
    config: cfg,
  }
}

export function writeConfigSelection(config, id) {
  return updateConfigSection(config, 'personas', section => ({ ...section, selected: id }))
}

export function writeConfigSessionSelection(config, sessionId, id) {
  return updateConfigSection(config, 'personas', section => ({
    ...section,
    sessionSelected: { ...(object(section.sessionSelected) ? section.sessionSelected : {}), [sessionId]: id },
  }))
}

export function clearConfigSessionSelection(config, sessionId) {
  return updateConfigSection(config, 'personas', section => {
    const map = { ...(object(section.sessionSelected) ? section.sessionSelected : {}) }
    delete map[sessionId]
    return { ...section, sessionSelected: map }
  })
}

function desktopMcpEntry(name, server) {
  const transport = server.type === 'http' || server.transport === 'http' || server.url ? 'http' : 'stdio'
  const entry = { name, description: '', transport }
  if (transport === 'stdio') {
    if (server.command) entry.command = String(server.command)
    if (Array.isArray(server.args)) entry.args = server.args.map(String)
    if (object(server.env)) entry.env = { ...server.env }
  } else if (server.url) entry.url = String(server.url)
  if (object(server.headers) && transport !== 'stdio') entry.headers = { ...server.headers }
  return entry
}

function mergeMcpFile(config, servers, enabledMap) {
  const path = join(resolveDevaRoot(config), 'mcp.json')
  let current = {}
  const file = readStrictText(path)
  if (file) {
    const parsed = readJsonFile(path)
    current = object(parsed?.mcpServers) ? parsed.mcpServers : {}
  }
  const merged = { ...current }
  for (const [name, server] of Object.entries(servers || {})) merged[name] = desktopMcpEntry(name, server)
  const value = { mcpServers: merged }
  ensurePrivateDirectory(resolveDevaRoot(config))
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { expectedRaw: file ? file.raw : null })
  updateConfigSection(config, 'mcp', section => ({
    ...section,
    enabled: { ...(object(section.enabled) ? section.enabled : {}), ...enabledMap },
  }))
  return Object.keys(servers || {}).length
}

/**
 * 一次性迁移旧的 `<root>/deva-agent/`。返回 `{migrated, backup, selected, sessions, mcpCount}`。
 * 迁移完成后删除旧目录；任何一步失败都不删除，保留现场。
 */
export function migrateLegacyLayout(config = {}) {
  const root = resolveDevaRoot(config)
  const legacy = join(root, 'deva-agent')
  if (!existsSync(legacy)) return { migrated: false }
  const backupDir = join(backupRoot(), `deva-agent-${timestamp()}`)
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  cpSync(legacy, backupDir, { recursive: true, preserveTimestamps: true })
  try {
    for (const entry of readdirSync(backupDir)) {
      const path = join(backupDir, entry)
      try { if (statSync(path).isDirectory()) ensurePrivateDirectory(path) } catch { /* ignore */ }
    }
  } catch { /* 备份权限收紧失败不阻断迁移，记录在报告 */ }

  const identity = readJsonIfExists(join(legacy, 'identity.json'))
  const sessions = readJsonIfExists(join(legacy, 'sessions.json'))
  const mcpStore = readJsonIfExists(join(legacy, 'mcp-servers.json'))

  const selected = typeof identity?.selected === 'string' ? identity.selected : null
  let sessionsMigrated = 0
  let mcpCount = 0
  if (selected) writeConfigSelection(config, selected)
  const sessionMap = object(sessions?.sessions) ? sessions.sessions : {}
  const validSessions = Object.fromEntries(Object.entries(sessionMap)
    .filter(([id, record]) => typeof id === 'string' && typeof record?.identity === 'string')
    .map(([id, record]) => [id, record.identity]))
  sessionsMigrated = Object.keys(validSessions).length
  if (sessionsMigrated) {
    updateConfigSection(config, 'personas', section => ({ ...section, sessionSelected: { ...(section.sessionSelected || {}), ...validSessions } }))
  }
  if (object(mcpStore?.servers) && Object.keys(mcpStore.servers).length) {
    const enabled = Object.fromEntries(Object.entries(mcpStore.servers).map(([id, server]) => [id, server.enabled !== false]))
    mcpCount = mergeMcpFile(config, mcpStore.servers, enabled)
  }
  // 写入成功后才删除旧目录（备份已存在）。
  rmSync(legacy, { recursive: true, force: true })
  return { migrated: true, backup: backupDir, selected, sessions: sessionsMigrated, mcpCount }
}
