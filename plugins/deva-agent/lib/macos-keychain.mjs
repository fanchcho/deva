/**
 * macOS 桌面密钥（Electron safeStorage / Chromium OSCrypt）的只读解密。
 *
 * 依据（本机可复核的源码，非猜测）：
 *  · Electron 33 `shell/browser/electron_browser_main_parts.cc:539-540`：
 *      `KeychainPassword::GetServiceName() = app_name + " Safe Storage";`
 *      `KeychainPassword::GetAccountName() = app_name;`
 *      但 Electron 33 还打了 Chromium 补丁
 *      `patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch`：
 *      普通 macOS 版 account 实际是 `<app_name> Key`，MAS 版是 `<app_name> App Store Key`；
 *      旧的无后缀 `<app_name>` 仍作为 legacy 兜底并被迁移。
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
import {
  MAC_IV, SAFE_STORAGE_CODES, decryptMacV10, looksLikeSecret, parseSafeStorageEnvelope, strictBase64, stripPkcs7,
} from './safe-storage.mjs'

// 共享格式层的辅助函数从这里再导出，旧 import 路径保持可用。
export { looksLikeSecret, strictBase64, stripPkcs7 }

/** macOS/Chromium OSCrypt 的固定参数（与上面 file:line 对应）。 */
export const MAC_OSCRYPT = Object.freeze({
  SALT: 'saltysalt',
  ITERATIONS: 1003,
  KEY_BYTES: 16,
  PREFIX_V10: 'v10',
  PREFIX_V11: 'v11',
  IV: MAC_IV,
})

/** 解密失败原因码：稳定、可区分、可操作；不含底层异常原文。 */
export const MAC_CODES = Object.freeze({
  OK: 'ok',
  NOT_DARWIN: 'platform-unsupported',
  SECURITY_MISSING: 'mac-keychain-tool-missing',
  ITEM_MISSING: 'mac-keychain-item-missing',
  ITEM_INVISIBLE: 'mac-keychain-item-invisible',
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

/**
 * 解析 `security dump-keychain` 的**属性**输出（不加 -d，不读取密码数据）。
 * 只提取 genp（generic password）的 service/account；绝不读取 value。
 */
export function parseKeychainDump(text) {
  const entries = []
  let current = null
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    if (/^\s*class:\s*"genp"/.test(line)) {
      current = { service: '', account: '' }
      entries.push(current)
      continue
    }
    if (/^\s*class:\s*"/.test(line)) { current = null; continue }
    if (!current) continue
    const match = line.match(/^\s*"([A-Za-z0-9]+)"<[^>]*>="(.*)"\s*$/)
    if (!match) continue
    const [, key, value] = match
    const decoded = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    if (key === 'svce') current.service = decoded
    if (key === 'acct') current.account = decoded
  }
  return entries.filter(entry => entry.service || entry.account)
}

function parseKeychainList(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/**
 * 只读发现：`security list-keychains -d user` + `default-keychain`，
 * 对每个 keychain 执行 `dump-keychain`（**不带 -d**，不读取任何密码数据），
 * 只统计 genp 条目并过滤 /deva|safe ?storage|electron/i。绝不写、不修复、不 upgrade keychain。
 */
export function collectKeychainEntries({ runSecurity = defaultRunSecurity, securityBinary = 'security', timeoutMs = 10000 } = {}) {
  const list = runSecurity(securityBinary, ['list-keychains', '-d', 'user'], timeoutMs)
  const paths = list && !list.error && list.status === 0 ? parseKeychainList(list.stdout) : []
  const def = runSecurity(securityBinary, ['default-keychain', '-d', 'user'], timeoutMs)
  const defaultKeychain = def && !def.error && def.status === 0 ? parseKeychainList(def.stdout)[0] || '' : ''
  const keychains = [...new Set([...paths, defaultKeychain].filter(Boolean))]
  const errors = []
  const all = []
  for (const keychain of keychains) {
    const dump = runSecurity(securityBinary, ['dump-keychain', keychain], timeoutMs)
    if (!dump || dump.error || dump.status !== 0) {
      errors.push({ keychain, code: classifySecurityFailure(dump) })
      continue
    }
    for (const entry of parseKeychainDump(dump.stdout)) all.push({ ...entry, keychain })
  }
  const filtered = all.filter(entry => /deva|safe\s?storage|electron/i.test(`${entry.service} ${entry.account}`))
  return {
    paths: keychains,
    defaultKeychain,
    totalGenericPasswords: all.length,
    matched: filtered.length,
    entries: filtered.slice(0, 20),
    errors,
  }
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

  function tryPassword(args) {
    const result = runSecurity(securityBinary, args, timeoutMs)
    if (result && !result.error && result.status === 0) {
      // 只去掉末尾一个换行；不 trim 其它字节（密码可能是二进制/hex/base64）。
      const raw = String(result.stdout ?? '').replace(/\r?\n$/, '')
      if (raw) return { ok: true, raw }
      return { ok: false, code: MAC_CODES.KEYCHAIN_ERROR }
    }
    return { ok: false, code: classifySecurityFailure(result) }
  }

  /** 把 security -w 的原始输出按 UTF-8 / hex / base64 / binary 依次尝试；不打印内容。 */
  function passwordCandidates(raw) {
    const text = String(raw ?? '')
    const out = []
    const add = (format, bytes) => {
      if (!bytes || !bytes.length) return
      if (!out.some(item => item.bytes.equals(bytes))) out.push({ format, bytes })
    }
    add('utf8', Buffer.from(text, 'utf8'))
    if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) add('hex', Buffer.from(text, 'hex'))
    try {
      const decoded = Buffer.from(text, 'base64')
      if (decoded.length) add('base64', decoded)
    } catch { /* not base64 */ }
    add('binary', Buffer.from(text, 'latin1'))
    return out
  }

  /** Electron 的 account 有后缀：普通 macOS 版 `<app> Key`，MAS 版 `<app> App Store Key`；旧版才是 `<app>`。 */
  function accountNames(app) {
    return [`${app} Key`, `${app} App Store Key`, app]
  }

  function findPassword() {
    const attempts = []
    for (const candidate of candidates) {
      const service = `${candidate.app} Safe Storage`
      for (const account of accountNames(candidate.app)) {
        const got = tryPassword(['find-generic-password', '-s', service, '-a', account, '-w'])
        if (got.ok) {
          attempts.push({ service, account, ok: true })
          return { ok: true, passwords: passwordCandidates(got.raw), service, account, attempts }
        }
        attempts.push({ service, account, ok: false, code: got.code })
        if (got.code !== MAC_CODES.ITEM_MISSING) return { ok: false, code: got.code, attempts }
      }
    }
    // 候选全 miss：只读枚举钥匙串属性，看看是否“条目存在但当前进程看不到/名字不同”。
    const discovery = collectKeychainEntries({ runSecurity, securityBinary, timeoutMs })
    const seen = new Set()
    for (const entry of discovery.entries) {
      const id = `${entry.keychain}\0${entry.service}\0${entry.account}`
      if (seen.has(id)) continue
      seen.add(id)
      const tries = []
      if (entry.service && entry.account) tries.push({ service: entry.service, account: entry.account, keychain: entry.keychain })
      if (entry.service) tries.push({ service: entry.service, account: '', keychain: entry.keychain, serviceOnly: true })
      for (const attempt of tries) {
        const args = ['find-generic-password', '-s', attempt.service]
        if (attempt.account) args.push('-a', attempt.account)
        args.push('-w', attempt.keychain)
        const got = tryPassword(args)
        if (got.ok) {
          attempts.push({ ...attempt, ok: true })
          return { ok: true, passwords: passwordCandidates(got.raw), service: attempt.service, account: attempt.account || '', attempts, discovery, selected: attempt }
        }
        attempts.push({ ...attempt, ok: false, code: got.code })
        if (got.code !== MAC_CODES.ITEM_MISSING) return { ok: false, code: got.code, attempts, discovery }
      }
    }
    const code = discovery.matched > 0 ? MAC_CODES.ITEM_INVISIBLE : MAC_CODES.ITEM_MISSING
    return { ok: false, code, attempts, discovery }
  }

  function deriveKey(passwordBytes) {
    return pbkdf2Sync(passwordBytes, MAC_OSCRYPT.SALT, MAC_OSCRYPT.ITERATIONS, MAC_OSCRYPT.KEY_BYTES, 'sha1')
  }

  function keychainKey(force = false) {
    if (!force && keyCache && keyCache.expires > Date.now()) {
      return {
        ok: true, keys: keyCache.keys, service: keyCache.service, account: keyCache.account, cached: true,
        attempts: [{ service: keyCache.service, account: keyCache.account, ok: true }],
      }
    }
    const found = findPassword()
    if (!found.ok) return found
    const keys = (found.passwords || []).map(item => ({ key: deriveKey(item.bytes), format: item.format }))
    if (!keys.length) return { ok: false, code: MAC_CODES.KEYCHAIN_ERROR, attempts: found.attempts }
    keyCache = { keys, service: found.service, account: found.account, expires: Date.now() + cacheTtlMs }
    return {
      ok: true, keys, service: found.service, account: found.account, cached: false, attempts: found.attempts,
      discovery: found.discovery || null, selected: found.selected || null,
    }
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
        const cipher = createCipheriv('aes-128-cbc', keychain.keys[0].key, MAC_OSCRYPT.IV)
        const encrypted = Buffer.concat([cipher.update(probe), cipher.final()])
        const decipher = createDecipheriv('aes-128-cbc', keychain.keys[0].key, MAC_OSCRYPT.IV)
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
      ...(keychain.selected ? { selected: keychain.selected } : {}),
      roundtrip,
      ...(keychain.discovery ? { keychain: keychain.discovery } : {}),
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
    const envelope = parseSafeStorageEnvelope(ciphertextBase64)
    if (!envelope.ok) {
      const code = envelope.code === SAFE_STORAGE_CODES.CIPHERTEXT_INVALID ? MAC_CODES.CIPHERTEXT_INVALID
        : envelope.code === SAFE_STORAGE_CODES.TRUNCATED ? MAC_CODES.TRUNCATED : MAC_CODES.UNSUPPORTED_FORMAT
      return { ok: false, code, tries: [], selfCheck: self }
    }
    // 先确认钥匙串可用：拿不到钥匙时，报“钥匙串”比报“密文格式”更接近根因（也更可操作）。
    const keychain = keychainKey()
    if (!keychain.ok) return { ok: false, code: keychain.code, tries: keychain.attempts || [], selfCheck: self }
    let lastCode = MAC_CODES.KEY_MISMATCH
    for (const candidate of keychain.keys) {
      const result = decryptMacV10(envelope, candidate.key)
      if (!result.ok) {
        lastCode = result.code === SAFE_STORAGE_CODES.TRUNCATED ? MAC_CODES.TRUNCATED : MAC_CODES.KEY_MISMATCH
        continue
      }
      if (!result.plaintext) { lastCode = MAC_CODES.EMPTY; continue }
      if (!looksLikeSecret(result.plaintext)) { lastCode = MAC_CODES.KEY_MISMATCH; continue }
      return {
        ok: true, plaintext: result.plaintext, prefix: envelope.prefix,
        service: keychain.service, account: keychain.account || '', passwordFormat: candidate.format,
        selfCheck: self, tries: [{ service: keychain.service, account: keychain.account || '', code: MAC_CODES.OK }],
      }
    }
    return { ok: false, code: lastCode, tries: [{ service: keychain.service, account: keychain.account || '' }], selfCheck: self }
  }
}
