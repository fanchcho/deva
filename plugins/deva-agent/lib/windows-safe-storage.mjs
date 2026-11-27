/**
 * Windows 桌面 safeStorage 解密（Chromium OSCrypt v10 / AES-256-GCM）。
 *
 * Electron 33 在 Windows 上的 safeStorage **不是**“把明文直接 DPAPI 加密后写盘”：
 *  · 明文由随机 32 字节 AES 密钥做 AES-256-GCM，落盘格式 `v10` + nonce(12B) + 密文（tag 16B 附在末尾）；
 *    （Chromium 130 `components/os_crypt/sync/os_crypt_win.cc:42-48,191-240`）
 *  · 这把 32B AES 密钥用 DPAPI(CurrentUser) 保护，base64 后带 `DPAPI` 前缀存进 `<userData>/Local State`
 *    的 `os_crypt.encrypted_key`（同上 `:109-125,256-295`；Electron 的 Local State 路径见
 *    `shell/browser/browser_process_impl.cc:110-122`：`DIR_SESSION_DATA/Local State`）。
 *
 * 所以拿 `v10...` 直接喂 `ProtectedData.Unprotect` 会得到「参数无效」（0x80131501）——这和用户/机器归属无关。
 * 本模块按两层实现：Local State → DPAPI 解出 32B key → GCM 解 v10；两层都可注入。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  SAFE_STORAGE_CODES, decryptWindowsV10, describeValuePrefix, looksLikeSecret,
  parseSafeStorageEnvelope, strictBase64,
} from './safe-storage.mjs'

export const WIN_CODES = Object.freeze({
  OK: 'ok',
  NOT_WIN: 'platform-unsupported',
  TOOL_MISSING: 'decrypt-tool-missing',
  LOCAL_STATE_MISSING: 'local-state-missing',
  ENCRYPTED_KEY_INVALID: 'encrypted-key-invalid',
  KEY_UNPROTECT_FAILED: 'key-unprotect-failed',
  GCM_AUTH_FAILED: 'gcm-auth-failed',
  LEGACY_RAW_DPAPI_OK: 'legacy-raw-dpapi-ok',
  BLOB_NOT_DPAPI: 'blob-not-dpapi',
  V10_DETECTED: 'v10-detected',
  CIPHERTEXT_INVALID: 'ciphertext-invalid',
  EMPTY: 'plaintext-empty',
  TIMEOUT: 'decrypt-timeout',
})

/** 候选 Local State 路径：Electron app name 可能是 productName / package name / 默认名；APPDATA 与 LOCALAPPDATA 都试。 */
const APP_NAMES = ['Deva', 'deva', '@deva/desktop', 'Electron']
export function localStateCandidates(env = process.env) {
  const roots = [env.APPDATA, env.LOCALAPPDATA].filter(Boolean)
  const out = []
  for (const root of roots) for (const name of APP_NAMES) out.push(join(root, name, 'Local State'))
  return [...new Set(out)]
}

function fileInfo(path) {
  try {
    const stat = statSync(path)
    return { path, exists: true, size: stat.size, mode: stat.mode & 0o777 }
  } catch {
    return { path, exists: false, size: null, mode: null }
  }
}

/** 只读 Local State：返回 `os_crypt.encrypted_key` 的元数据与原始 base64 字符串（不输出值）。 */
export function readLocalStateInfo(path) {
  const info = fileInfo(path)
  if (!info.exists) return { ...info, structure: 'missing' }
  let parsed
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { return { ...info, structure: 'invalid-json' } }
  const raw = parsed?.os_crypt?.encrypted_key ?? parsed?.['os_crypt.encrypted_key']
  if (typeof raw !== 'string' || !raw) return { ...info, structure: 'ok', encryptedKey: null }
  const decoded = strictBase64(raw)
  const prefix = decoded ? decoded.subarray(0, 5).toString('ascii') : ''
  return {
    ...info, structure: 'ok', encryptedKey: raw,
    encryptedKeyChars: raw.length,
    hasDpapiPrefix: prefix === 'DPAPI',
    decodedBytes: decoded ? decoded.length : null,
  }
}

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  '$bytes=[Convert]::FromBase64String($b64)',
  '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.WriteLine("DEVADPAPI ok")',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('\n')

function runPowerShell(binary, script, input, timeoutMs) {
  return spawnSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024,
  })
}

function splitMarker(stdout) {
  const text = String(stdout || '').replace(/\uFEFF/g, '').replace(/\r/g, '')
  const idx = text.lastIndexOf('DEVADPAPI')
  if (idx < 0) return { marker: '', payload: '' }
  const rest = text.slice(idx + 'DEVADPAPI'.length)
  const newline = rest.indexOf('\n')
  if (newline < 0) return { marker: rest.trim().split(/\s+/)[0] || '', payload: '' }
  return { marker: rest.slice(0, newline).trim().split(/\s+/)[0] || '', payload: rest.slice(newline + 1).trim() }
}

/** 默认 DPAPI 解保护（返回原始字节）：供 AES key 解出与 legacy 裸 blob 共用。 */
export function createDpapiByteUnprotector({ platform = process.platform, spawn = runPowerShell, binaries = ['powershell.exe', 'pwsh.exe'], timeoutMs = 15000 } = {}) {
  return function unprotect(base64) {
    if (platform !== 'win32') return { ok: false, code: WIN_CODES.NOT_WIN }
    for (const binary of binaries) {
      const result = spawn(binary, UNPROTECT_SCRIPT, base64, timeoutMs)
      if (!result || result.error) {
        if (result?.error?.code === 'ENOENT') continue
        return { ok: false, code: result?.error?.code === 'ETIMEDOUT' ? WIN_CODES.TIMEOUT : WIN_CODES.KEY_UNPROTECT_FAILED }
      }
      const split = splitMarker(result.stdout)
      if (split.marker === 'ok') {
        const bytes = strictBase64(split.payload)
        if (!bytes) return { ok: false, code: WIN_CODES.KEY_UNPROTECT_FAILED }
        return { ok: true, bytes }
      }
      // 0x80131501 / “参数无效” 是 .NET 对非法 DPAPI blob 的泛化包装，不能证明归属。
      return { ok: false, code: WIN_CODES.BLOB_NOT_DPAPI, stderr: String(result.stderr || '').slice(0, 200) }
    }
    return { ok: false, code: WIN_CODES.TOOL_MISSING }
  }
}

/**
 * Windows safeStorage 解码器。
 * @param {{ platform?: string, env?: object, readLocalState?: Function, unprotect?: Function, dpapiSelfCheck?: Function, candidates?: string[] }} options
 */
export function createWindowsSafeStorageDecoder({
  platform = process.platform,
  env = process.env,
  readLocalState = readLocalStateInfo,
  unprotect = createDpapiByteUnprotector({ platform }),
  dpapiSelfCheck = null,
  candidates = localStateCandidates(env),
} = {}) {
  let selfCheckState = null
  let cachedKey = null

  function locateLocalState() {
    const tried = []
    for (const path of candidates) {
      const info = readLocalState(path)
      tried.push({ path, exists: Boolean(info.exists), structure: info.structure })
      if (info.exists) return { ok: true, info, tried }
    }
    return { ok: false, code: WIN_CODES.LOCAL_STATE_MISSING, tried }
  }

  function getAesKey(force = false) {
    if (!force && cachedKey && cachedKey.expires > Date.now()) return { ok: true, key: cachedKey.key, path: cachedKey.path, cached: true }
    const local = locateLocalState()
    if (!local.ok) return local
    const { info } = local
    if (info.structure !== 'ok') return { ok: false, code: WIN_CODES.ENCRYPTED_KEY_INVALID, localState: info, tried: local.tried }
    if (!info.encryptedKey || !info.hasDpapiPrefix) return { ok: false, code: WIN_CODES.ENCRYPTED_KEY_INVALID, localState: info, tried: local.tried }
    const decoded = strictBase64(info.encryptedKey)
    if (!decoded || decoded.length <= 5) return { ok: false, code: WIN_CODES.ENCRYPTED_KEY_INVALID, localState: info, tried: local.tried }
    const result = unprotect(decoded.subarray(5).toString('base64'))
    if (!result.ok) return { ok: false, code: result.code || WIN_CODES.KEY_UNPROTECT_FAILED, localState: info, tried: local.tried }
    if (result.bytes.length !== 32) return { ok: false, code: WIN_CODES.ENCRYPTED_KEY_INVALID, localState: info, tried: local.tried }
    cachedKey = { key: result.bytes, path: info.path, expires: Date.now() + 5 * 60_000 }
    return { ok: true, key: result.bytes, path: info.path, localState: info, tried: local.tried }
  }

  async function selfCheck(force = false) {
    if (selfCheckState && !force) return selfCheckState
    if (platform !== 'win32') {
      selfCheckState = { platform, ok: false, code: WIN_CODES.NOT_WIN, runtime: 'windows-safe-storage', variants: [] }
      return selfCheckState
    }
    const dpapi = dpapiSelfCheck ? await dpapiSelfCheck(force) : null
    const local = locateLocalState()
    const info = local.info || null
    const ok = Boolean(dpapi?.ok) && Boolean(local.ok) && Boolean(info?.hasDpapiPrefix)
    const code = !dpapi?.ok ? (dpapi?.code || WIN_CODES.KEY_UNPROTECT_FAILED)
      : !local.ok ? WIN_CODES.LOCAL_STATE_MISSING
        : !info?.hasDpapiPrefix ? WIN_CODES.ENCRYPTED_KEY_INVALID : WIN_CODES.OK
    selfCheckState = {
      platform,
      runtime: 'windows-safe-storage',
      ok,
      code,
      user: dpapi?.user || '',
      machine: dpapi?.machine || '',
      dpapi: dpapi ? { ok: Boolean(dpapi.ok), code: dpapi.code || '', variants: dpapi.variants || [] } : null,
      localState: info ? {
        path: info.path, exists: Boolean(info.exists), structure: info.structure,
        encryptedKeyChars: info.encryptedKeyChars ?? null,
        hasDpapiPrefix: Boolean(info.hasDpapiPrefix),
        decodedBytes: info.decodedBytes ?? null,
      } : null,
      localStateTried: local.tried,
      variants: dpapi?.variants || [],
    }
    return selfCheckState
  }

  const decrypt = async value => {
    const self = await selfCheck()
    if (platform !== 'win32') return { ok: false, code: WIN_CODES.NOT_WIN, selfCheck: self }
    const envelope = parseSafeStorageEnvelope(value)
    if (envelope.ok) {
      const key = getAesKey()
      if (!key.ok) return { ok: false, code: key.code, selfCheck: self, v10: true, localState: key.localState || null }
      const result = decryptWindowsV10(envelope, key.key)
      if (!result.ok) return { ok: false, code: result.code, selfCheck: self, v10: true, service: key.path }
      if (!looksLikeSecret(result.plaintext)) return { ok: false, code: WIN_CODES.GCM_AUTH_FAILED, selfCheck: self, v10: true, service: key.path }
      return { ok: true, plaintext: result.plaintext, code: WIN_CODES.OK, v10: true, service: key.path, selfCheck: self, prefix: envelope.prefix }
    }
    if (envelope.code === SAFE_STORAGE_CODES.CIPHERTEXT_INVALID) {
      return { ok: false, code: WIN_CODES.CIPHERTEXT_INVALID, selfCheck: self }
    }
    // 不是 v10：按 legacy 裸 DPAPI blob 处理（Electron 旧版 safeStorage 直接 DPAPI 明文）。
    const raw = unprotect(String(value || ''))
    if (!raw.ok) return { ok: false, code: raw.code === WIN_CODES.KEY_UNPROTECT_FAILED ? WIN_CODES.BLOB_NOT_DPAPI : raw.code, selfCheck: self, legacy: true }
    const plaintext = raw.bytes.toString('utf8')
    if (!looksLikeSecret(plaintext)) return { ok: false, code: WIN_CODES.BLOB_NOT_DPAPI, selfCheck: self, legacy: true }
    return { ok: true, plaintext, code: WIN_CODES.LEGACY_RAW_DPAPI_OK, legacy: true, selfCheck: self }
  }
  decrypt.selfCheck = selfCheck
  decrypt.clearCache = () => { cachedKey = null; selfCheckState = null }
  decrypt.localStateCandidates = candidates
  decrypt.describeValuePrefix = describeValuePrefix
  return decrypt
}
