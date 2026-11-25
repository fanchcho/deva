/**
 * 会话级 persona 选择：**写桌面 `config.json → personas.sessionSelected`**（不再是 deva-agent 文件）。
 *
 * 桌面端没有会话 persona 字段；这里只是 personas 段内的扩展键，桌面 `getConfig()` 能读到整段，
 * `writeEnabledMap()` 用 `{...base, enabled}` 合并会保留它。宿主会话存储（`state.session`）仍是运行期
 * 第一来源；文件（config.json）作为持久副本与手工修订入口。
 */

import { identityFilePath } from './deva-home.mjs'
import { DevaIdentityError } from './deva-fs.mjs'
import {
  clearConfigSessionSelection, readConfigSelection, writeConfigSessionSelection,
} from './deva-layout.mjs'

const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function sessionsFilePath(config = {}) {
  return identityFilePath(config)
}

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_RE.test(value)
}

export function readFileSessionIdentity(config, sessionId) {
  if (!isSessionId(sessionId)) return null
  const { sessionSelected } = readConfigSelection(config)
  const value = sessionSelected[sessionId]
  return typeof value === 'string' ? value : null
}

export function writeFileSessionIdentity(config, sessionId, identity) {
  if (!isSessionId(sessionId)) throw new DevaIdentityError('DEVA_SESSION_BAD_ID', `非法会话 id：${String(sessionId)}`)
  writeConfigSessionSelection(config, sessionId, identity)
  return identity
}

export function clearFileSessionIdentity(config, sessionId) {
  if (!isSessionId(sessionId)) return
  clearConfigSessionSelection(config, sessionId)
}

export function inspectSessionSelections(config) {
  const { sessionSelected } = readConfigSelection(config)
  return { path: identityFilePath(config), exists: true, sessions: Object.keys(sessionSelected) }
}
