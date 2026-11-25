/**
 * Deva 根目录、错误类型与严格文件 IO。
 *
 * 身份内容与桌面端共用 `<root>/personas/*.md` 和 `<root>/config.json`（见 lib/persona-store.mjs）；
 * 默认和会话选择在 config.json 的 personas 段。共用这里的根解析与写入原语，
 * 避免出现「两套 ~/.deva」或两种权限口径。
 */

import { randomUUID } from 'node:crypto'
import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** 身份/配置相关的明确错误：带稳定 code、路径与可操作提示，绝不回显文件内容。 */
export class DevaIdentityError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'DevaIdentityError'
    this.code = code
    Object.assign(this, detail)
  }
}

/** POSIX 归属能力在调用时判断：Windows 上没有 getuid，模块级缓存会让平台判定与运行期不一致。 */
const hasPosixOwnership = () => typeof process.getuid === 'function'

/**
 * Deva 配置根：`sharedDevaHome` → `DEVA_HOME` → `~/.deva`；必须是绝对路径且不是主目录/根目录。
 * 同时返回来源，供 Windows 这类拿不到 POSIX 归属的平台判断「这个路径是谁给的」。
 */
export function resolveDevaRootSource(config = {}) {
  const configured = typeof config?.sharedDevaHome === 'string' ? config.sharedDevaHome.trim() : ''
  const fromEnv = process.env.DEVA_HOME?.trim() || ''
  const root = configured || fromEnv || join(homedir(), '.deva')
  if (!isAbsolute(root)) throw new DevaIdentityError('DEVA_HOME_NOT_ABSOLUTE', `Deva 配置目录必须是绝对路径：${root}`)
  const path = resolve(root)
  if (path === dirname(path) || path === resolve(homedir())) {
    throw new DevaIdentityError('DEVA_HOME_TOO_BROAD', `Deva 配置目录不能是根目录或用户主目录：${path}`)
  }
  return { path, source: configured ? 'config' : fromEnv ? 'env' : 'home' }
}

export function resolveDevaRoot(config = {}) {
  return resolveDevaRootSource(config).path
}

export function statOrNull(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new DevaIdentityError('DEVA_STAT_FAILED', `无法读取 ${path}（${error.code || '未知错误'}）`, { path })
  }
}

/** 确保目录存在且只有 owner 可访问；返回 true 表示新建或收紧过权限。 */
export function ensurePrivateDirectory(path) {
  let stat = statOrNull(path)
  const created = !stat
  if (!stat) {
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    } catch (error) {
      throw new DevaIdentityError('DEVA_MKDIR_FAILED', `无法创建 Deva 目录 ${path}（${error.code || '未知错误'}）`, { path })
    }
    stat = statOrNull(path)
  }
  if (stat?.isSymbolicLink()) throw new DevaIdentityError('DEVA_DIR_SYMLINK', `Deva 目录不能是符号链接：${path}`, { path })
  if (!stat?.isDirectory()) throw new DevaIdentityError('DEVA_NOT_DIRECTORY', `Deva 路径不是目录：${path}`, { path })
  if (!hasPosixOwnership()) return created
  if (stat.uid !== process.getuid()) {
    throw new DevaIdentityError('DEVA_DIR_OWNER', `Deva 目录不属于当前进程用户（uid ${process.getuid()}）：${path}`, { path })
  }
  if ((stat.mode & 0o7777) !== 0o700) {
    try {
      chmodSync(path, 0o700)
      return true
    } catch (error) {
      throw new DevaIdentityError('DEVA_DIR_CHMOD_FAILED', `无法把 Deva 目录收紧到 0700：${path}（${error.code || '未知错误'}）`, { path })
    }
  }
  return created
}

/**
 * 严格读取一个文件：拒绝符号链接、非常规文件、硬链接、非本用户；顺手把过宽权限收紧到 0600。
 * 文件不存在返回 null。
 */
export function readStrictText(path) {
  const stat = statOrNull(path)
  if (!stat) return null
  if (stat.isSymbolicLink()) throw new DevaIdentityError('DEVA_FILE_SYMLINK', `不能是符号链接：${path}`, { path })
  if (!stat.isFile()) throw new DevaIdentityError('DEVA_NOT_FILE', `不是普通文件：${path}`, { path })
  if (stat.nlink !== 1) throw new DevaIdentityError('DEVA_FILE_HARDLINK', `不能是硬链接：${path}`, { path })
  if (hasPosixOwnership() && stat.uid !== process.getuid()) {
    throw new DevaIdentityError('DEVA_FILE_OWNER', `文件不属于当前进程用户（uid ${process.getuid()}）：${path}`, { path })
  }
  let repaired = false
  if (hasPosixOwnership() && (stat.mode & 0o077)) {
    try {
      chmodSync(path, 0o600)
      repaired = true
    } catch (error) {
      throw new DevaIdentityError('DEVA_FILE_CHMOD_FAILED', `无法把文件收紧到 0600：${path}（${error.code || '未知错误'}）`, { path })
    }
  }
  try {
    return { raw: readFileSync(path, 'utf8'), repaired, stat }
  } catch (error) {
    throw new DevaIdentityError('DEVA_FILE_UNREADABLE', `文件不可读：${path}（${error.code || '未知错误'}）`, { path })
  }
}

/**
 * 原子写：同目录临时文件（0600、独占创建、fsync）+ 可选「写前比对原内容」+ rename。
 * `expectedRaw`：字符串表示必须是这个内容，null 表示文件必须不存在，省略表示不比对。
 */
export function writeAtomic(path, content, { expectedRaw } = {}) {
  const dir = dirname(path)
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  let pending = false
  try {
    let fd
    try {
      fd = openSync(tmp, 'wx', 0o600)
    } catch (error) {
      throw new DevaIdentityError('DEVA_WRITE_FAILED', `无法在 ${dir} 创建临时文件（${error.code || '未知错误'}）`, { path })
    }
    pending = true
    try {
      writeFileSync(fd, content, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (expectedRaw !== undefined) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (current !== expectedRaw) {
        throw new DevaIdentityError('DEVA_CONCURRENT_WRITE', `文件在保存期间被其它进程修改，没有覆盖：${path}；请重新打开再保存`, { path })
      }
    }
    if (hasPosixOwnership()) {
      try { chmodSync(tmp, 0o600) } catch { /* 创建时已是 0600 */ }
    }
    renameSync(tmp, path)
    pending = false
  } finally {
    if (pending) {
      try { unlinkSync(tmp) } catch { /* 保留原始写入错误 */ }
    }
  }
}

/** 把一段原文备份到 `.deva` 之外（默认 `~/.deva-backups`）；返回绝对路径。 */
export function backupText(config, raw, name) {
  const dir = join(process.env.DEVA_BACKUP_ROOT?.trim() || join(homedir(), '.deva-backups'), `text-${Date.now()}`)
  ensurePrivateDirectory(dir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, name.includes('.') ? `${name}-${stamp}` : `${name}-${stamp}`)
  writeAtomic(path, raw, { expectedRaw: null })
  return path
}
