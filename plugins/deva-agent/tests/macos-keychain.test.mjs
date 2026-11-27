import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import {
  createMacKeychainDecoder, MAC_CODES, MAC_OSCRYPT, classifySecurityFailure,
  looksLikeSecret, strictBase64, stripPkcs7,
} from '../lib/macos-keychain.mjs'

/**
 * macOS 钥匙串解密链路的行为矩阵（全部用**可注入假 security**，本机 Linux 不碰真实 Keychain）。
 *
 * 密文按 Chromium OSCrypt 的真实格式构造：`v10` + AES-128-CBC(PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16), IV=16 空格, PKCS#7)。
 * 依据：Chromium 130 `components/os_crypt/sync/os_crypt_mac.mm:33-44,168` 与
 * Electron 33 `shell/browser/electron_browser_main_parts.cc:539-540`。
 */

const PASSWORD = Buffer.from('fixture-keychain-password').toString('base64')
const SERVICE = 'Deva Safe Storage'
const ACCOUNT = 'Deva'

function derive(password) {
  return pbkdf2Sync(Buffer.from(password, 'utf8'), MAC_OSCRYPT.SALT, MAC_OSCRYPT.ITERATIONS, MAC_OSCRYPT.KEY_BYTES, 'sha1')
}

function encryptV10(plaintext, password = PASSWORD) {
  const cipher = createCipheriv('aes-128-cbc', derive(password), MAC_OSCRYPT.IV)
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  return Buffer.concat([Buffer.from('v10'), body]).toString('base64')
}

/** 假 security：默认返回 Deva 条目；可用 overrides 覆盖某个 service 的行为。 */
function fakeSecurity({ overrides = {}, notFound = false, stdoutFor = () => PASSWORD } = {}) {
  const calls = []
  const run = (binary, args) => {
    const serviceIndex = args.indexOf('-s')
    const service = serviceIndex >= 0 ? args[serviceIndex + 1] : ''
    calls.push({ binary, args, service })
    if (overrides[service]) return overrides[service]
    if (notFound) return { status: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' }
    return { status: 0, stdout: `${stdoutFor(service)}\n`, stderr: '' }
  }
  return { run, calls }
}

const decoder = (security, extra = {}) => createMacKeychainDecoder({ platform: 'darwin', runSecurity: security.run, ...extra })

test('macOS 1/9 — v10 blob decrypts with the Keychain password', async () => {
  const security = fakeSecurity({ overrides: { 'Electron Safe Storage': { status: 44, stderr: 'not found' } } })
  const d = decoder(security)
  const result = await d(encryptV10('fixture.macos.token.2222'))
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.macos.token.2222')
  assert.equal(result.prefix, 'v10')
  assert.equal(result.service, SERVICE)
  assert.equal(result.account, ACCOUNT)
  assert.equal(security.calls[0].args.includes('find-generic-password'), true, '使用 security find-generic-password')
  assert.equal(security.calls.some(call => call.args.includes(PASSWORD)), false, '密码从不进命令行参数')
})

test('macOS 2/9 — a different Safe Storage key yields mac-key-mismatch, never garbage', async () => {
  const security = fakeSecurity({ stdoutFor: () => Buffer.from('another-keychain-password').toString('base64') })
  const result = await decoder(security)(encryptV10('fixture.macos.token.2222'))
  assert.equal(result.ok, false)
  assert.equal(result.code, MAC_CODES.KEY_MISMATCH)
})

test('macOS 3/9 — truncated v10 blob is reported separately from a wrong key', async () => {
  const truncated = Buffer.concat([Buffer.from('v10'), Buffer.alloc(8)]).toString('base64')
  const result = await decoder(fakeSecurity())(truncated)
  assert.equal(result.ok, false)
  assert.equal(result.code, MAC_CODES.TRUNCATED)
})

test('macOS 4/9 — no Keychain item for any candidate service reports mac-keychain-item-missing', async () => {
  const security = fakeSecurity({ notFound: true })
  const result = await decoder(security)(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.ITEM_MISSING)
  const findCalls = security.calls.filter(call => call.args[0] === 'find-generic-password')
  assert.ok(findCalls.length >= 4, '会依次尝试多个 app 名候选')
  assert.equal(findCalls.every(call => call.args[call.args.indexOf('-s') + 1].endsWith(' Safe Storage')), true)
})

test('macOS 5/9 — user denied the Keychain prompt reports mac-keychain-denied', async () => {
  const security = fakeSecurity({ overrides: { [SERVICE]: { status: 51, stderr: 'The authorization was denied.' } } })
  const result = await decoder(security)(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.DENIED)
  // 自检 + 解密各调一次；两次都停在第一个候选（授权被拒不是“条目不存在”，不该继续换 app 名）。
  assert.equal(security.calls.every(call => call.service === SERVICE), true, '授权被拒后不再无意义地换候选')
})

test('macOS 6/9 — no GUI session reports mac-keychain-no-session', async () => {
  const security = fakeSecurity({ overrides: { [SERVICE]: { status: 128, stderr: 'User interaction is not allowed.' } } })
  const result = await decoder(security)(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.NO_SESSION)
})

test('macOS 7/9 — a Keychain entry with a non-base64 password fails cleanly as a key mismatch', async () => {
  const security = fakeSecurity({ stdoutFor: () => 'not a base64 password!' })
  const result = await decoder(security)(encryptV10('x'))
  // 非法密码仍然参与 PBKDF2，只是解出来填充不合法 → 必须归类为“密钥不匹配”，不能崩。
  assert.equal(result.ok, false)
  assert.equal(result.code, MAC_CODES.KEY_MISMATCH)
})

test('macOS 8/9 — invalid base64 and non-v10 formats get their own codes', async () => {
  const d = decoder(fakeSecurity())
  assert.equal((await d('')).code, MAC_CODES.CIPHERTEXT_INVALID)
  assert.equal((await d('***')).code, MAC_CODES.CIPHERTEXT_INVALID)
  assert.equal((await d(Buffer.from('v11' + 'x'.repeat(16)).toString('base64'))).code, MAC_CODES.KEY_MISMATCH, 'v11 也走同一解密路径')
  assert.equal((await d(Buffer.from('abcd').toString('base64'))).code, MAC_CODES.UNSUPPORTED_FORMAT, '非 v10/v11 前缀单独报')
})

test('macOS 9/9 — self-check reports keychain variants and a real PBKDF2/AES roundtrip', async () => {
  const security = fakeSecurity({ overrides: { 'Electron Safe Storage': { status: 44, stderr: 'not found' } } })
  const health = await decoder(security).selfCheck()
  assert.equal(health.ok, true)
  assert.equal(health.roundtrip, true)
  assert.equal(health.runtime, 'macos-keychain')
  assert.equal(health.service, SERVICE)
  assert.ok(health.variants.some(item => item.service === SERVICE && item.ok))
  // 自检失败：全部候选都不存在
  const missing = await decoder(fakeSecurity({ notFound: true })).selfCheck()
  assert.equal(missing.ok, false)
  assert.equal(missing.code, MAC_CODES.ITEM_MISSING)
  assert.equal(missing.variants.length >= 4, true)
})

test('non-darwin platforms report platform-unsupported without touching security', async () => {
  const security = fakeSecurity()
  const d = createMacKeychainDecoder({ platform: 'linux', runSecurity: security.run })
  const result = await d(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.NOT_DARWIN)
  assert.equal(security.calls.length, 0, '非 darwin 不执行 security 命令')
})

test('security failure classification is stable and never echoes secrets', () => {
  assert.equal(classifySecurityFailure({ error: { code: 'ENOENT' } }), MAC_CODES.SECURITY_MISSING)
  assert.equal(classifySecurityFailure({ status: 44, stderr: 'could not be found in the keychain' }), MAC_CODES.ITEM_MISSING)
  assert.equal(classifySecurityFailure({ status: 1, stderr: 'User interaction is not allowed.' }), MAC_CODES.NO_SESSION)
  assert.equal(classifySecurityFailure({ status: 51, stderr: 'The authorization was denied.' }), MAC_CODES.DENIED)
  assert.equal(classifySecurityFailure({ error: { code: 'ETIMEDOUT' } }), MAC_CODES.TIMEOUT)
})

test('low-level helpers reject malformed input instead of silently accepting it', () => {
  assert.equal(strictBase64('abc'), null)
  assert.equal(strictBase64('!!!!'), null)
  assert.equal(strictBase64('YWJj').toString(), 'abc')
  assert.equal(stripPkcs7(Buffer.from('abc')), null, '长度非 16 倍数')
  assert.equal(stripPkcs7(Buffer.from([1, 2, 0])), null, '填充字节非法')
  assert.equal(looksLikeSecret('fixture.good.token'), true)
  assert.equal(looksLikeSecret('bad\u0000token'), false)
  assert.equal(looksLikeSecret('bad\uFFFDtoken'), false)
})

// ── 钥匙串发现 + 指纹（0.8.50）──
import { collectKeychainEntries, parseKeychainDump } from '../lib/macos-keychain.mjs'
import { likelyV10Format } from '../lib/safe-storage.mjs'

const DUMP = `keychain: "/Users/fixture/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="deva Safe Storage"
    "svce"<blob>="deva Safe Storage"
    "acct"<blob>="deva"
class: "inet"
attributes:
    "srvr"<blob>="example.com"
`

function discoverySecurity({ password = PASSWORD, denied = false } = {}) {
  const calls = []
  const run = (binary, args) => {
    calls.push(args)
    if (args[0] === 'list-keychains') return { status: 0, stdout: '"/Users/fixture/Library/Keychains/login.keychain-db"\n' }
    if (args[0] === 'default-keychain') return { status: 0, stdout: '"/Users/fixture/Library/Keychains/login.keychain-db"\n' }
    if (args[0] === 'dump-keychain') return { status: 0, stdout: DUMP }
    if (args[0] === 'find-generic-password') {
      if (denied) return { status: 51, stderr: 'The authorization was denied.' }
      const s = args[args.indexOf('-s') + 1]
      const a = args.includes('-a') ? args[args.indexOf('-a') + 1] : ''
      if (s === 'deva Safe Storage' && (a === 'deva' || !a)) return { status: 0, stdout: `${password}\n` }
      return { status: 44, stderr: 'The specified item could not be found in the keychain.' }
    }
    return { status: 1, stderr: 'unexpected' }
  }
  return { run, calls }
}

test('keychain discovery: attributes-only dump parses service/account and filters deva entries', () => {
  const entries = parseKeychainDump(DUMP)
  assert.deepEqual(entries.map(e => [e.service, e.account]), [['deva Safe Storage', 'deva']])
  const security = discoverySecurity()
  const info = collectKeychainEntries({ runSecurity: security.run })
  assert.equal(info.paths.length, 1)
  assert.equal(info.totalGenericPasswords, 1)
  assert.equal(info.matched, 1)
  assert.equal(info.entries[0].service, 'deva Safe Storage')
  assert.equal(JSON.stringify(info).includes(PASSWORD), false, '发现结果不含密码值')
})

test('keychain discovery: when the four app-name candidates miss, discovered service-only entry still decrypts', async () => {
  const security = discoverySecurity()
  // 四个真实候选都 miss（模拟用户机器），强制走“发现后 service-only”路径。
  const d = createMacKeychainDecoder({ platform: 'darwin', runSecurity: security.run, candidates: [{ app: 'NoSuchApp' }] })
  const result = await d(encryptV10('fixture.macos.token.3333'))
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.macos.token.3333')
  assert.equal(result.service, 'deva Safe Storage')
  assert.ok(security.calls.some(args => args[0] === 'dump-keychain' && !args.includes('-d')), '只读属性 dump，不带 -d')
})

test('keychain discovery: entry exists but retrieval denied gives mac-keychain-denied, not item-missing', async () => {
  const security = discoverySecurity({ denied: true })
  const d = createMacKeychainDecoder({ platform: 'darwin', runSecurity: security.run })
  const result = await d(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.DENIED)
})

test('keychain discovery: entry visible in attributes but unavailable to this process gives mac-keychain-item-invisible', async () => {
  const run = (binary, args) => {
    if (args[0] === 'list-keychains') return { status: 0, stdout: '"/Users/fixture/Library/Keychains/login.keychain-db"\n' }
    if (args[0] === 'default-keychain') return { status: 0, stdout: '"/Users/fixture/Library/Keychains/login.keychain-db"\n' }
    if (args[0] === 'dump-keychain') return { status: 0, stdout: DUMP }
    return { status: 44, stderr: 'The specified item could not be found in the keychain.' }
  }
  const d = createMacKeychainDecoder({ platform: 'darwin', runSecurity: run })
  const result = await d(encryptV10('x'))
  assert.equal(result.code, MAC_CODES.ITEM_INVISIBLE)
  assert.equal(result.selfCheck.keychain.matched, 1)
})

test('v10 length fingerprint distinguishes mac-cbc / win-gcm / ambiguous', () => {
  assert.equal(likelyV10Format(63), 'win-gcm')      // 3+12+48：Windows 32B 明文
  assert.equal(likelyV10Format(51), 'ambiguous')    // 3+48：mac 也成立
  assert.equal(likelyV10Format(35), 'ambiguous')    // 3+32
  assert.equal(likelyV10Format(19), 'invalid')
  assert.equal(likelyV10Format(83), 'ambiguous')    // 3+80：mac 与 win 长度条件都成立
})
