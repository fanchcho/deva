/**
 * macOS 桌面密钥（Electron safeStorage / Chromium OSCrypt）的只读解密。
 *
 * 依据（本机可复核的源码，非猜测）：
 *  · Electron 33 `shell/browser/electron_browser_main_parts.cc:539-540`：
 *      `KeychainPassword::GetServiceName() = app_name + " Safe Storage";`
 *      `KeychainPassword::GetAccountName() = app_name;`
 *  · Chromium 130 `components/os_crypt/sync/os_crypt_mac.mm`：
 *      `kSalt = "saltysalt"`（:33）、`kEncryptionIterations = 1003`（:39）、
 *      `kDerivedKeySizeInBits = 128`（:36）、`kEncryptionVersionPrefix = "v10"`（:44）、
 *      IV = 16 个空格（:168 `std::string iv(kCCBlockSizeAES128, ' ')`），AES-128-CBC + PKCS#7。
 *  · Keychain 密码由 Chromium 生成：`keychain_password_mac.mm` 随机 16 字节 → **base64 字符串**存入
 *    generic password 的 value；PBKDF2 的 password 就是这串 base64 文本（不是解码后的字节）。
 *
 * 因此解密链路是：`security find-generic-password -s "<App> Safe Storage" -a "<App>" -w`
 * → PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16) → AES-128-CBC(IV=16*0x20) → 去 PKCS#7。
 *
 * 安全：明文只在内存；不做任何写回；错误码稳定且不含密文/明文/Key；stderr 只保留脱敏摘要。
 */

import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { spawnSync } from 'node:child_process'

/** macOS/Chromium OSCrypt 的固定参数（与上面 file:line 对应）。 */
export const MAC_OSCRYPT = Object.freeze({
  SALT: 'saltysalt',
  ITERATIONS: 1003,
  KEY_BYTES: 16,
  PREFIX_V10: 'v10',
  PREFIX_V11: 'v11',
  IV: Buffer.alloc(16, 0x20),
})

/** 解密失败原因码：稳定、可区分、可操作；不含底层异常原文。 */
export const MAC_CODES = Object.freeze({
  OK: 'ok',
  NOT_DARWIN: 'platform-unsupported',
  SECURITY_MISSING: 'mac-keychain-tool-missing',
  ITEM_MISSING: 'mac-keychain-item-missing',
  DENIED: 'mac-keychain-denied',
  NO_SESSION: 'mac-keychain-no-session',
  TIMEOUT: 'mac-keychain-timeout',
  KEYCHAIN_ERROR: 'mac-keychain-error',
  CIPHERTEXT_INVALID: 'ciphertext-invalid',
  TRUNCATED: 'mac-ciphertext-truncated',
  UNSUPPORTED_FORMAT: 'mac-unsupported-format',
  KEY_MISMATCH: 'mac-key-mismatch',
  EMPTY: 'plaintext-empty',
})

export const MAC_TOOLCHAIN_CODES = Object.freeze([
  MAC_CODES.SECURITY_MISSING,
  MAC_CODES.DENIED,
  MAC_CODES.NO_SESSION,
  MAC_CODES.TIMEOUT,
  MAC_CODES.KEYCHAIN_ERROR,
])

export function isMacToolchainFailure(code) {
  return MAC_TOOLCHAIN_CODES.includes(code) || code === MAC_CODES.NOT_DARWIN
}

/**
 * 候选 service/account。Electron 用 `app.getName()`：
 *  · 打包产物（electron-builder `productName: Deva`）通常是 `Deva`；
 *  · 开发/未设 productName 时是 package.json 的 `name`（本仓库为 `@deva/desktop`）；
 *  · Electron 自带默认应用名是 `Electron`。
 * 逐个尝试是**必要**的：service 名对不上就是 `errSecItemNotFound`，不能据此断定“没有密钥”。
 */
export const MAC_KEYCHAIN_CANDIDATES = Object.freeze([
  { app: 'Deva', source: 'productName' },
  { app: 'deva', source: 'executableName' },
  { app: '@deva/desktop', source: 'package-name' },
  { app: 'Electron', source: 'electron-default' },
])

function defaultRunSecurity(binary, args, timeoutMs) {
  return spawnSync(binary, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 })
}

/** 把 `security` 的退出码/stderr 归一成稳定原因码。绝不回显密码。 */
export function classifySecurityFailure(result) {
  const error = result?.error
  if (error?.code === 'ENOENT') return MAC_CODES.SECURITY_MISSING
  if (error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM') return MAC_CODES.TIMEOUT
  const status = result?.status
  const stderr = String(result?.stderr || '')
  if (status === 44 || /could not be found in the keychain|errSecItemNotFound/i.test(stderr)) return MAC_CODES.ITEM_MISSING
  if (/User interaction is not allowed|interaction is not allowed/i.test(stderr)) return MAC_CODES.NO_SESSION
  if (/The authorization was denied|authorization was denied|User canceled|denied/i.test(stderr)) return MAC_CODES.DENIED
  return MAC_CODES.KEYCHAIN_ERROR
}

/** 严格 base64：只接受合法字符与正确长度，避免 Node 静默忽略非法字符。 */
export function strictBase64(value) {
  const text = String(value || '').replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const buffer = Buffer.from(text, 'base64')
  return buffer.length ? buffer : null
}

/** PKCS#7 去填充；不合法返回 null（这就是“密文不属于这把钥匙”的主要证据之一）。 */
export function stripPkcs7(buffer) {
  if (!buffer || buffer.length === 0 || buffer.length % 16 !== 0) return null
  const pad = buffer[buffer.length - 1]
  if (pad < 1 || pad > 16) return null
  for (let i = buffer.length - pad; i < buffer.length; i++) {
    if (buffer[i] !== pad) return null
  }
  return buffer.subarray(0, buffer.length - pad)
}

/** 明文合理性：必须是可打印 UTF-8，且不含控制字符/替换字符。 */
export function looksLikeSecret(text) {
  if (typeof text !== 'string' || !text) return false
  if (text.includes('\uFFFD')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
}

/**
 * 可注入的 macOS 钥匙串解密器。
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   runSecurity?: (binary: string, args: string[], timeoutMs: number) => object,
 *   securityBinary?: string,
 *   candidates?: { app: string, source: string }[],
 *   timeoutMs?: number,
 *   cacheTtlMs?: number,
 * }} options
 */
export function createMacKeychainDecoder({
  platform = process.platform,
  runSecurity = defaultRunSecurity,
  securityBinary = 'security',
  candidates = MAC_KEYCHAIN_CANDIDATES,
  timeoutMs = 10000,
  cacheTtlMs = 5 * 60_000,
} = {}) {
  let selfCheckState = null
  let keyCache = null // { key, service, account, expires }

  function findPassword() {
    const attempts = []
    for (const candidate of candidates) {
      const service = `${candidate.app} Safe Storage`
      const account = candidate.app
      const result = runSecurity(securityBinary, ['find-generic-password', '-s', service, '-a', account, '-w'], timeoutMs)
      if (result && !result.error && result.status === 0) {
        // `security -w` 输出末尾有换行；base64 密码本身不含空白。
        const password = String(result.stdout || '').replace(/\r?\n$/, '')
        if (password) {
          attempts.push({ service, account, ok: true })
          return { ok: true, password, service, account, attempts }
        }
      }
      const code = classifySecurityFailure(result)
      attempts.push({ service, account, ok: false, code })
      // 只有“条目不存在”才继续换候选；授权被拒/无会话/超时是环境结论，继续试也没用。
      if (code !== MAC_CODES.ITEM_MISSING) return { ok: false, code, attempts }
    }
    return { ok: false, code: MAC_CODES.ITEM_MISSING, attempts }
  }

  function deriveKey(password) {
    return pbkdf2Sync(Buffer.from(password, 'utf8'), MAC_OSCRYPT.SALT, MAC_OSCRYPT.ITERATIONS, MAC_OSCRYPT.KEY_BYTES, 'sha1')
  }

  function keychainKey(force = false) {
    if (!force && keyCache && keyCache.expires > Date.now()) {
      return {
        ok: true, key: keyCache.key, service: keyCache.service, account: keyCache.account, cached: true,
        attempts: [{ service: keyCache.service, account: keyCache.account, ok: true }],
      }
    }
    const found = findPassword()
    if (!found.ok) return found
    const key = deriveKey(found.password)
    keyCache = { key, service: found.service, account: found.account, expires: Date.now() + cacheTtlMs }
    return { ok: true, key, service: found.service, account: found.account, cached: false, attempts: found.attempts }
  }

  /** 自检：security 是否可用、候选 service 是否存在、PBKDF2+AES 往返是否可用。不碰用户密文。 */
  async function selfCheck(force = false) {
    if (selfCheckState && !force) return selfCheckState
    const base = { platform, runtime: 'macos-keychain', container: '' }
    if (platform !== 'darwin') {
      selfCheckState = { ...base, ok: false, code: MAC_CODES.NOT_DARWIN, variants: [] }
      return selfCheckState
    }
    const keychain = keychainKey(force)
    const variants = (keychain.attempts || [{ service: `${candidates[0].app} Safe Storage`, account: candidates[0].app, code: MAC_CODES.ITEM_MISSING }])
      .map(item => ({ binary: 'security', service: item.service, account: item.account, ok: Boolean(item.ok), code: item.code || '' }))
    let roundtrip = false
    let code = keychain.ok ? MAC_CODES.OK : keychain.code
    if (keychain.ok) {
      try {
        const probe = Buffer.from('deva-macos-safe-storage-selfcheck', 'utf8')
        const { createCipheriv } = await import('node:crypto')
        const cipher = createCipheriv('aes-128-cbc', keychain.key, MAC_OSCRYPT.IV)
        const encrypted = Buffer.concat([cipher.update(probe), cipher.final()])
        const decipher = createDecipheriv('aes-128-cbc', keychain.key, MAC_OSCRYPT.IV)
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
        roundtrip = decrypted.equals(probe)
        if (!roundtrip) code = MAC_CODES.KEYCHAIN_ERROR
      } catch {
        roundtrip = false
        code = MAC_CODES.KEYCHAIN_ERROR
      }
    }
    selfCheckState = {
      ...base,
      ok: Boolean(keychain.ok && roundtrip),
      code,
      service: keychain.service || '',
      account: keychain.account || '',
      roundtrip,
      variants,
    }
    return selfCheckState
  }

  const decrypt = async ciphertextBase64 => decryptWith(ciphertextBase64)
  decrypt.selfCheck = selfCheck
  decrypt.clearCache = () => { keyCache = null; selfCheckState = null }
  return decrypt

  async function decryptWith(ciphertextBase64) {
    const self = await selfCheck()
    if (platform !== 'darwin') return { ok: false, code: MAC_CODES.NOT_DARWIN, tries: [], selfCheck: self }
    const blob = strictBase64(ciphertextBase64)
    if (!blob) return { ok: false, code: MAC_CODES.CIPHERTEXT_INVALID, tries: [], selfCheck: self }
    // 先确认钥匙串可用：拿不到钥匙时，报“钥匙串”比报“密文格式”更接近根因（也更可操作）。
    const keychain = keychainKey()
    if (!keychain.ok) return { ok: false, code: keychain.code, tries: keychain.attempts || [], selfCheck: self }
    const prefix = blob.subarray(0, 3).toString('ascii')
    if (prefix !== MAC_OSCRYPT.PREFIX_V10 && prefix !== MAC_OSCRYPT.PREFIX_V11) {
      return { ok: false, code: MAC_CODES.UNSUPPORTED_FORMAT, tries: [{ prefix, service: keychain.service }], selfCheck: self }
    }
    const payload = blob.subarray(3)
    if (payload.length === 0 || payload.length % 16 !== 0) {
      return { ok: false, code: MAC_CODES.TRUNCATED, tries: [{ prefix, bytes: payload.length, service: keychain.service }], selfCheck: self }
    }
    let plaintext = ''
    try {
      const decipher = createDecipheriv('aes-128-cbc', keychain.key, MAC_OSCRYPT.IV)
      // 关掉自动去填充：自己校验 PKCS#7，才能区分“key 不匹配”与“密文被截断/格式不对”。
      decipher.setAutoPadding(false)
      const raw = Buffer.concat([decipher.update(payload), decipher.final()])
      const unpadded = stripPkcs7(raw)
      if (!unpadded) return { ok: false, code: MAC_CODES.KEY_MISMATCH, tries: [{ service: keychain.service }], selfCheck: self }
      plaintext = unpadded.toString('utf8')
    } catch {
      // 错 key / 坏填充：AES-CBC 的 final() 会抛 bad decrypt；也可能解出乱码后 PKCS#7 不合法。
      return { ok: false, code: MAC_CODES.KEY_MISMATCH, tries: [{ service: keychain.service }], selfCheck: self }
    }
    if (!plaintext) return { ok: false, code: MAC_CODES.EMPTY, tries: [{ service: keychain.service }], selfCheck: self }
    if (!looksLikeSecret(plaintext)) {
      return { ok: false, code: MAC_CODES.KEY_MISMATCH, tries: [{ service: keychain.service }], selfCheck: self }
    }
    return { ok: true, plaintext, prefix, service: keychain.service, account: keychain.account, selfCheck: self, tries: [{ service: keychain.service, code: MAC_CODES.OK }] }
  }
}
