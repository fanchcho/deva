/**
 * 桌面端密钥（`<Deva 根>/secrets.json`）的**只读**访问。
 *
 * 桌面端（apps/desktop/src/main/services/secrets.ts）用 Electron safeStorage 加密：
 *  · 落盘位置：`join(getDevaHome(), 'secrets.json')`，与 config.json 同一根目录（可被 DEVA_HOME 覆盖）；
 *    旧位置是 `app.getPath('userData')/secrets.json`，桌面首次读不到新位置时会一次性搬运密文；
 *  · 键名：providerId（MCP 用 `mcp:<serverId>:<field>`）；
 *  · 值：`safeStorage.encryptString(value).toString('base64')`——Windows 上是 DPAPI 密文的 base64。
 *
 * 这里只做两件事：读这个文件、按需解密某一条。**不写回桌面文件、不写插件状态、不进日志、不回前端**；
 * 解密结果的明文只存在于本模块的短时内存缓存（有上限、有失效）。
 *
 * 解密实现可注入（`decrypt`），便于单测与后续换实现；默认实现是 Windows DPAPI：
 * 调 `powershell.exe` 的 `ProtectedData::Unprotect`，密文走 **stdin**，绝不放进命令行参数或环境变量
 * （那会把密钥暴露在进程列表/系统审计里）。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDevaRoot } from './deva-fs.mjs'

export const DESKTOP_SECRETS_MAX_BYTES = 1024 * 1024

/** 解密失败的原因码：页面与报错只用这些稳定值，不拼底层异常文本。 */
export const DESKTOP_DECRYPT_CODES = Object.freeze({
  OK: 'ok',
  NOT_WINDOWS: 'platform-unsupported',
  NO_TOOL: 'decrypt-tool-missing',
  BAD_BASE64: 'ciphertext-invalid',
  DPAPI_FAILED: 'dpapi-failed',
  TIMEOUT: 'decrypt-timeout',
  EMPTY: 'plaintext-empty',
})

/** 桌面端历史上可能用过的 userData 目录名（package.json name 与产物 productName）。 */
const LEGACY_USERDATA_NAMES = ['@deva/desktop', 'Deva', 'deva']

function appDataRoot(env = process.env) {
  const roaming = env.APPDATA?.trim()
  return roaming || ''
}

/**
 * 候选路径：主位置（与 config.json 同根）优先，其次才是桌面的旧 userData 位置。
 * 旧位置只在主位置不存在时尝试，且只在 Windows 上枚举。
 */
export function desktopSecretsPaths(config = {}, env = process.env) {
  const root = resolveDevaRoot(config)
  const primary = join(root, 'secrets.json')
  const legacy = []
  if (process.platform === 'win32') {
    const appData = appDataRoot(env)
    if (appData) for (const name of LEGACY_USERDATA_NAMES) legacy.push(join(appData, name, 'secrets.json'))
  }
  return { primary, legacy }
}

function statOf(path) {
  try {
    const stat = lstatSync(path)
    return { exists: true, size: stat.size, file: stat.isFile(), symlink: stat.isSymbolicLink(), mtime: stat.mtime.toISOString() }
  } catch (error) {
    return { exists: false, code: error.code || 'unknown' }
  }
}

function readOne(path) {
  const stat = statOf(path)
  if (!stat.exists) return { path, ...stat, entries: {}, structure: 'missing', code: 'missing' }
  if (stat.symlink) return { path, ...stat, entries: {}, structure: 'invalid', code: 'symlink' }
  if (!stat.file) return { path, ...stat, entries: {}, structure: 'invalid', code: 'not-file' }
  if (stat.size > DESKTOP_SECRETS_MAX_BYTES) return { path, ...stat, structure: 'invalid', code: 'too-large' }
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return { path, ...stat, entries: {}, structure: 'invalid', code: error.code || 'unreadable' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { path, ...stat, entries: {}, structure: 'invalid', code: 'parse-error' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { path, ...stat, entries: {}, structure: 'invalid', code: 'not-object' }
  }
  const entries = {}
  for (const [key, value] of Object.entries(parsed)) {
    // 桌面只存字符串密文；其它形状说明文件被改过，保留线索但不当密钥用。
    if (typeof value === 'string' && value) entries[key] = value
  }
  return { path, ...stat, entries, structure: 'ok', code: 'ok', malformed: Object.keys(parsed).length - Object.keys(entries).length }
}

/**
 * 读取桌面密钥文件（主位置 → 旧位置）。**只返回元数据与密文，不解密**；
 * 页面诊断只用这里的字段（路径、是否存在、大小、结构、条目数），不含任何值。
 */
export function readDesktopSecrets(config = {}) {
  const { primary, legacy } = desktopSecretsPaths(config)
  const first = readOne(primary)
  if (first.exists || first.code !== 'missing' || !legacy.length) return { ...first, source: 'primary', tried: [primary] }
  for (const candidate of legacy) {
    const next = readOne(candidate)
    if (next.exists || next.code !== 'missing') return { ...next, source: 'legacy', tried: [primary, candidate] }
  }
  return { ...first, source: 'primary', tried: [primary, ...legacy] }
}

/** 某一 provider 的密文（桌面按 providerId 存；没有 provider 级前缀）。 */
export function desktopCiphertext(file, providerId) {
  if (!file || file.structure !== 'ok' || !providerId) return ''
  return file.entries[providerId] || ''
}

const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  '$bytes=[Convert]::FromBase64String($b64)',
  '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('\n')

function runPowerShell(binary, script, input, timeoutMs) {
  return spawnSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024,
  })
}

/**
 * 默认解密器：Windows DPAPI（CurrentUser）。密文经 stdin 传入，参数里只有脚本。
 * 兼容 Electron/Chromium 可能带上的版本前缀（`v10`/`v11`/`v20`）：先按原样解，失败再去前缀重试。
 * 返回 `{ ok, plaintext, code }`；失败路径**不含**任何密文或明文片段。
 */
export function createDpapiDecoder({ platform = process.platform, spawn = runPowerShell, binaries = ['powershell.exe', 'pwsh.exe'], timeoutMs = 15000 } = {}) {
  return async function decrypt(ciphertextBase64) {
    if (platform !== 'win32') return { ok: false, code: DESKTOP_DECRYPT_CODES.NOT_WINDOWS }
    let buffer
    try {
      buffer = Buffer.from(String(ciphertextBase64 || ''), 'base64')
    } catch {
      return { ok: false, code: DESKTOP_DECRYPT_CODES.BAD_BASE64 }
    }
    if (!buffer.length) return { ok: false, code: DESKTOP_DECRYPT_CODES.BAD_BASE64 }
    const candidates = [buffer]
    const head = buffer.subarray(0, 3).toString('ascii')
    if (head === 'v10' || head === 'v11' || head === 'v20') candidates.push(buffer.subarray(3))
    let lastCode = DESKTOP_DECRYPT_CODES.DPAPI_FAILED
    for (const candidate of candidates) {
      const input = candidate.toString('base64')
      let failure = null
      for (const binary of binaries) {
        const result = spawn(binary, POWERSHELL_SCRIPT, input, timeoutMs)
        if (!result || result.error) {
          failure = result?.error?.code === 'ENOENT' ? DESKTOP_DECRYPT_CODES.NO_TOOL : result?.error?.code === 'ETIMEDOUT' ? DESKTOP_DECRYPT_CODES.TIMEOUT : DESKTOP_DECRYPT_CODES.DPAPI_FAILED
          if (failure === DESKTOP_DECRYPT_CODES.NO_TOOL) continue
          break
        }
        if (result.status !== 0) { failure = DESKTOP_DECRYPT_CODES.DPAPI_FAILED; break }
        let plaintext = ''
        try {
          plaintext = Buffer.from(String(result.stdout || '').trim(), 'base64').toString('utf8')
        } catch {
          failure = DESKTOP_DECRYPT_CODES.DPAPI_FAILED
          break
        }
        if (!plaintext) { failure = DESKTOP_DECRYPT_CODES.EMPTY; break }
        return { ok: true, plaintext, prefix: head === 'v10' || head === 'v11' || head === 'v20' ? head : '' }
      }
      lastCode = failure || lastCode
    }
    return { ok: false, code: lastCode }
  }
}

/** 明文只在内存里放一小会儿：按密文摘要缓存，有上限、有失效；进程退出即消失。 */
const cache = new Map()

export function clearDesktopKeyCache() {
  cache.clear()
}

function cacheKey(path, ciphertext) {
  return createHash('sha256').update(path).update('\0').update(ciphertext).digest('hex')
}

function lookupCache(key, now) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires <= now) { cache.delete(key); return null }
  // 触碰即刷新 LRU 顺序（Map 保持插入顺序）。
  cache.delete(key); cache.set(key, hit)
  return hit.plaintext
}

function storeCache(key, plaintext, now, ttlMs, maxEntries) {
  cache.set(key, { plaintext, expires: now + ttlMs })
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
}

/**
 * 解析某 provider 在桌面端保存的密钥。
 * 返回元数据 + 可选明文；明文只用于当前这一次请求，**调用方不得持久化**。
 *
 * @param {{ config?: object, providerId?: string, decrypt?: Function, now?: Function, ttlMs?: number, maxEntries?: number }} options
 */
export async function resolveDesktopCredential({ config = {}, providerId, decrypt = createDpapiDecoder(), now = Date.now, ttlMs = 5 * 60_000, maxEntries = 8 } = {}) {
  let file
  try {
    file = readDesktopSecrets(config)
  } catch (error) {
    return { status: 'error', code: (error?.code || 'root-unavailable'), path: '', exists: null, entryCount: null, present: false, plaintext: '' }
  }
  const base = {
    path: file.path,
    source: file.source,
    exists: file.exists,
    size: file.size ?? null,
    structure: file.structure,
    code: file.code,
    entryCount: file.structure === 'ok' ? Object.keys(file.entries).length : null,
  }
  if (!file.exists) return { status: 'missing-file', ...base, present: false, plaintext: '' }
  if (file.structure !== 'ok') return { status: 'unreadable', ...base, present: false, plaintext: '' }
  const ciphertext = desktopCiphertext(file, providerId)
  if (!ciphertext) return { status: 'missing', ...base, present: false, plaintext: '' }
  const key = cacheKey(file.path, ciphertext)
  const cached = lookupCache(key, now())
  if (cached) return { status: 'decrypted', ...base, present: true, cached: true, plaintext: cached }
  let result
  try {
    result = await decrypt(ciphertext)
  } catch {
    result = { ok: false, code: DESKTOP_DECRYPT_CODES.DPAPI_FAILED }
  }
  if (!result?.ok) return { status: 'undecryptable', ...base, present: true, cached: false, plaintext: '', decryptCode: result?.code || DESKTOP_DECRYPT_CODES.DPAPI_FAILED }
  storeCache(key, result.plaintext, now(), ttlMs, maxEntries)
  return { status: 'decrypted', ...base, present: true, cached: false, prefix: result.prefix || '', plaintext: result.plaintext }
}

/** 页面/诊断用的**脱敏**视图：只有元数据与结论，绝不含密文或明文。 */
export function publicDesktopCredential(credential) {
  if (!credential) return null
  const { plaintext, ...rest } = credential
  void plaintext
  return rest
}
