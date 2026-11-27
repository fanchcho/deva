/**
 * safeStorage / Chromium OSCrypt 的共享格式层（Windows 与 macOS 共用）。
 *
 * 两个平台都以 `v10` 开头，但**载荷不同**（源码核实，不能混为一谈）：
 *  · Windows（Chromium 130 `components/os_crypt/sync/os_crypt_win.cc:42-48,191-240`）：
 *      `v10` + nonce(12 字节) + AES-256-GCM 密文（GCM tag 16 字节附在密文末尾）；
 *      密钥是 32 字节随机数，存在 `<userData>/Local State` 的 `os_crypt.encrypted_key`，
 *      值为 base64(`DPAPI` + DPAPI(32B key))。
 *  · macOS（Chromium 130 `components/os_crypt/sync/os_crypt_mac.mm:33-44,163-215`）：
 *      `v10` + AES-128-CBC(PKCS#7) 密文，IV 固定为 16 个空格；
 *      密钥来自 Keychain 的 `<App> Safe Storage`（随机 16 字节的 base64 文本）。
 *
 * 本模块只做格式解析与两种密码实现；密钥获取分别由 windows-safe-storage / macos-keychain 负责。
 */

import { createDecipheriv } from 'node:crypto'

export const SAFE_STORAGE_PREFIXES = Object.freeze(['v10', 'v11'])
export const WINDOWS_NONCE_BYTES = 12
export const WINDOWS_KEY_BYTES = 32
export const WINDOWS_TAG_BYTES = 16
export const MAC_KEY_BYTES = 16
export const MAC_IV = Buffer.alloc(16, 0x20)

export const SAFE_STORAGE_CODES = Object.freeze({
  OK: 'ok',
  CIPHERTEXT_INVALID: 'ciphertext-invalid',
  NOT_SAFE_STORAGE: 'blob-not-dpapi',
  V10_DETECTED: 'v10-detected',
  GCM_AUTH_FAILED: 'gcm-auth-failed',
  MAC_KEY_MISMATCH: 'mac-key-mismatch',
  UNSUPPORTED_FORMAT: 'mac-unsupported-format',
  TRUNCATED: 'mac-ciphertext-truncated',
})

/** 严格 base64：非法字符/长度直接拒绝，绝不静默忽略（避免把噪声当密文解）。 */
export function strictBase64(value) {
  const text = String(value || '').replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const buffer = Buffer.from(text, 'base64')
  return buffer.length ? buffer : null
}

/** 解析 `v10`/`v11` 信封；不是这两种前缀的返回 null（调用方按 legacy/DPAPI 原始 blob 处理）。 */
export function parseSafeStorageEnvelope(value) {
  const buffer = strictBase64(value)
  if (!buffer) return { ok: false, code: SAFE_STORAGE_CODES.CIPHERTEXT_INVALID, buffer: null }
  const prefix = buffer.subarray(0, 3).toString('ascii')
  if (!SAFE_STORAGE_PREFIXES.includes(prefix)) return { ok: false, code: SAFE_STORAGE_CODES.NOT_SAFE_STORAGE, buffer, prefix }
  return { ok: true, code: SAFE_STORAGE_CODES.V10_DETECTED, prefix, buffer, body: buffer.subarray(3) }
}

/**
 * Windows v10：nonce = body[0..12)，sealed = body[12..]（含 GCM tag）。
 * 返回 GCM 解密结果；auth tag 校验失败就是 `gcm-auth-failed`（key 不对/数据被改），不是“跨用户”。
 */
export function decryptWindowsV10(envelope, key) {
  if (!envelope?.ok) return { ok: false, code: envelope?.code || SAFE_STORAGE_CODES.CIPHERTEXT_INVALID }
  if (!Buffer.isBuffer(key) || key.length !== WINDOWS_KEY_BYTES) return { ok: false, code: SAFE_STORAGE_CODES.GCM_AUTH_FAILED }
  const body = envelope.body
  if (!body || body.length <= WINDOWS_NONCE_BYTES + WINDOWS_TAG_BYTES) return { ok: false, code: SAFE_STORAGE_CODES.TRUNCATED }
  const nonce = body.subarray(0, WINDOWS_NONCE_BYTES)
  const sealed = body.subarray(WINDOWS_NONCE_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(sealed.subarray(sealed.length - WINDOWS_TAG_BYTES))
    const raw = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - WINDOWS_TAG_BYTES)), decipher.final()])
    const plaintext = raw.toString('utf8')
    return { ok: true, plaintext, prefix: envelope.prefix, bytes: raw.length }
  } catch {
    return { ok: false, code: SAFE_STORAGE_CODES.GCM_AUTH_FAILED }
  }
}

/** PKCS#7 去填充（自校验，不依赖 Node 的自动 padding）。 */
export function stripPkcs7(buffer) {
  if (!buffer || buffer.length === 0 || buffer.length % 16 !== 0) return null
  const pad = buffer[buffer.length - 1]
  if (pad < 1 || pad > 16) return null
  for (let i = buffer.length - pad; i < buffer.length; i++) if (buffer[i] !== pad) return null
  return buffer.subarray(0, buffer.length - pad)
}

/** macOS v10：AES-128-CBC(IV=16×0x20) + PKCS#7；错 key 报 `mac-key-mismatch`。 */
export function decryptMacV10(envelope, key) {
  if (!envelope?.ok) return { ok: false, code: envelope?.code || SAFE_STORAGE_CODES.CIPHERTEXT_INVALID }
  if (!Buffer.isBuffer(key) || key.length !== MAC_KEY_BYTES) return { ok: false, code: SAFE_STORAGE_CODES.MAC_KEY_MISMATCH }
  if (!envelope.body || envelope.body.length === 0 || envelope.body.length % 16 !== 0) return { ok: false, code: SAFE_STORAGE_CODES.TRUNCATED }
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, MAC_IV)
    decipher.setAutoPadding(false)
    const raw = Buffer.concat([decipher.update(envelope.body), decipher.final()])
    const unpadded = stripPkcs7(raw)
    if (!unpadded) return { ok: false, code: SAFE_STORAGE_CODES.MAC_KEY_MISMATCH }
    return { ok: true, plaintext: unpadded.toString('utf8'), prefix: envelope.prefix, bytes: unpadded.length }
  } catch {
    return { ok: false, code: SAFE_STORAGE_CODES.MAC_KEY_MISMATCH }
  }
}

/** 诊断用：只给前缀类型，不给值。 */
export function describeValuePrefix(value) {
  try {
    const buffer = strictBase64(value)
    if (!buffer) return { kind: 'unknown', bytes: null, prefix: '' }
    const prefix = buffer.subarray(0, 3).toString('ascii')
    if (SAFE_STORAGE_PREFIXES.includes(prefix)) return { kind: 'v10', bytes: buffer.length, prefix }
    return { kind: 'raw', bytes: buffer.length, prefix: '' }
  } catch {
    return { kind: 'unknown', bytes: null, prefix: '' }
  }
}

/**
 * 仅凭长度判断 v10 载荷更像哪种平台格式：
 *  · macOS：`v10` + AES-128-CBC(PKCS#7) → (bytes-3) 必须是 16 的倍数；
 *  · Windows：`v10` + nonce(12) + GCM 密文+tag(16) → (bytes-3-12-16) >= 1；
 *  · 两者都满足 → ambiguous（必须结合平台/来源判断，不能拍脑袋）。
 */
export function likelyV10Format(decodedBytes) {
  if (!Number.isInteger(decodedBytes) || decodedBytes < 3) return 'invalid'
  const body = decodedBytes - 3
  const mac = body >= 32 && body % 16 === 0
  const win = body >= 29
  if (mac && win) return 'ambiguous'
  if (mac) return 'mac-cbc'
  if (win) return 'win-gcm'
  return 'invalid'
}

/** 明文合理性：可打印 UTF-8 / 无控制字符。 */
export function looksLikeSecret(text) {
  if (typeof text !== 'string' || !text) return false
  if (text.includes('\uFFFD')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
}

/**
 * 用户/机器归属的**规范化**比较（Windows 账户不区分大小写；域名/机器名同理）。
 * 绝不把“字符串写法不同”当成“不同用户”；只有 `provenDifferent` 才能说“不是本机/本用户”。
 */
export function normalizeAccount(value) {
  return String(value || '').trim().toLowerCase().replace(/^\.\\/, '')
}

export function classifyOwnership({ fileOwner, processUser, fileMachine, processMachine, fileSid, processSid } = {}) {
  const owner = normalizeAccount(fileOwner)
  const user = normalizeAccount(processUser)
  const fMachine = normalizeAccount(fileMachine)
  const pMachine = normalizeAccount(processMachine)
  const bySid = Boolean(fileSid && processSid)
  // POSIX 上 probeFileOwner 给的是 uid:0，不是账户名；这种输入不能拿来判“不同用户”。
  const ownerComparable = Boolean(owner && user && !owner.startsWith('uid:'))
  const sameUser = bySid ? String(fileSid) === String(processSid)
    : (ownerComparable ? owner === user : null)
  const sameMachine = fMachine && pMachine ? fMachine === pMachine : null
  return {
    sameUser,
    sameMachine,
    method: bySid ? 'sid' : (ownerComparable ? 'normalized-string' : 'unavailable'),
    // 只有“同一台机器、不同用户”才是可证明的归属差异；不同机器不能从 owner 字符串推断。
    provenDifferent: sameMachine === true && sameUser === false,
  }
}
