import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import {
  createWindowsSafeStorageDecoder, WIN_CODES, localStateCandidates, readLocalStateInfo,
} from '../lib/windows-safe-storage.mjs'
import { classifyOwnership } from '../lib/safe-storage.mjs'
import { resolveCredential } from '../lib/model-selection.mjs'

/**
 * Windows safeStorage 链路夹具（全部自造，不碰用户真实密钥）：
 *  · v10 = `v10` + nonce(12) + AES-256-GCM 密文（tag 16 附末尾），密钥来自 Local State 的
 *    `os_crypt.encrypted_key`（base64("DPAPI" + DPAPI(32B key))）——依据 Chromium 130 os_crypt_win.cc。
 *  · legacy = 旧版 safeStorage 直接 DPAPI 明文（裸 blob）。
 */

const KEY = randomBytes(32)
const LOCAL_STATE_PATH = '/tmp/fixture-userData/Local State'

function encryptV10(plaintext, key = KEY) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final(), cipher.getAuthTag()])
  return Buffer.concat([Buffer.from('v10'), nonce, body]).toString('base64')
}

function localState(encryptedKey = Buffer.concat([Buffer.from('DPAPI'), Buffer.from('fixture-dpapi-blob')]).toString('base64')) {
  return JSON.stringify({ os_crypt: { encrypted_key: encryptedKey, audit_enabled: true } })
}

function decoderWith({ unprotectResult = { ok: true, bytes: KEY }, local = localState() } = {}) {
  return createWindowsSafeStorageDecoder({
    platform: 'win32',
    candidates: [LOCAL_STATE_PATH],
    readLocalState: path => {
      if (path !== LOCAL_STATE_PATH || local === null) return { path, exists: false, structure: 'missing' }
      const raw = JSON.parse(local).os_crypt.encrypted_key
      const decoded = Buffer.from(raw, 'base64')
      return { path, exists: true, size: local.length, mode: 0o600, structure: 'ok', encryptedKey: raw, encryptedKeyChars: raw.length, hasDpapiPrefix: decoded.subarray(0, 5).toString('ascii') === 'DPAPI', decodedBytes: decoded.length }
    },
    unprotect: () => unprotectResult,
    dpapiSelfCheck: async () => ({ ok: true, code: 'ok', user: 'example-pc\\example', machine: 'EXAMPLE-PC', variants: [{ binary: 'powershell.exe', ok: true, runtime: 'windows-powershell', version: '5.1', user: 'example-pc\\example', machine: 'EXAMPLE-PC', languageMode: 'FullLanguage', assembly: true, roundtrip: true, code: '' }] }),
    env: {},
  })
}

test('windows 1/6 — native v10 + injected DPAPI key decrypts the expected value', async () => {
  const d = decoderWith()
  const r = await d(encryptV10('fixture.windows.token.0001'))
  assert.equal(r.ok, true)
  assert.equal(r.plaintext, 'fixture.windows.token.0001')
  assert.equal(r.v10, true)
  assert.equal(r.prefix, 'v10')
})

test('windows 2/6 — v10 with the wrong Local State key reports gcm-auth-failed, never foreign-blob', async () => {
  const d = decoderWith({ unprotectResult: { ok: true, bytes: randomBytes(32) } })
  const r = await d(encryptV10('fixture.windows.token.0001'))
  assert.equal(r.ok, false)
  assert.equal(r.code, WIN_CODES.GCM_AUTH_FAILED)
  assert.equal(/foreign|跨用户|跨机器/.test(JSON.stringify(r)), false)
})

test('windows 3/6 — a true raw DPAPI blob follows the legacy path: legacy-raw-dpapi-ok', async () => {
  const d = decoderWith({ unprotectResult: { ok: true, bytes: Buffer.from('fixture.legacy.token', 'utf8') } })
  const r = await d(Buffer.from('raw-dpapi-blob').toString('base64'))
  assert.equal(r.ok, true)
  assert.equal(r.code, WIN_CODES.LEGACY_RAW_DPAPI_OK)
  assert.equal(r.plaintext, 'fixture.legacy.token')
})

test('windows 4/6 — v10 but no Local State reports local-state-missing', async () => {
  const d = decoderWith({ local: null })
  const r = await d(encryptV10('x'))
  assert.equal(r.ok, false)
  assert.equal(r.code, WIN_CODES.LOCAL_STATE_MISSING)
})

test('windows 5/6 — owner differs only by case is the SAME user (regression for the reported misjudgement)', () => {
  const ownership = classifyOwnership({
    fileOwner: 'EXAMPLE-PC\\example',
    processUser: 'example-pc\\example',
    fileMachine: 'EXAMPLE-PC',
    processMachine: 'example-pc',
  })
  assert.equal(ownership.sameUser, true)
  assert.equal(ownership.sameMachine, true)
  assert.equal(ownership.method, 'normalized-string')
  assert.equal(ownership.provenDifferent, false)
  // 真正不同的用户/机器才允许 provenDifferent
  assert.equal(classifyOwnership({ fileOwner: 'EXAMPLE-PC\\other', processUser: 'example-pc\\example', fileMachine: 'EXAMPLE-PC', processMachine: 'example-pc' }).provenDifferent, true)
  assert.equal(classifyOwnership({ fileOwner: 'OTHERPC\\other', processUser: 'example-pc\\example', fileMachine: 'OTHERPC', processMachine: 'EXAMPLE-PC' }).provenDifferent, false, '不同机器不能仅凭 owner 推断')
})

test('windows 6/6 — plugin-saved key wins when both plugin and desktop keys exist', async () => {
  const records = new Map()
  const layer = name => ({
    namespace: (...p) => layer([name, ...p].join('/')),
    async get(key) { return records.get(`${[name]}#${key}`) },
    async set(key, value) { records.set(`${[name]}#${key}`, value) },
    async delete(key) { records.delete(`${[name]}#${key}`) },
  })
  const { createHash } = await import('node:crypto')
  const id = createHash('sha256').update('alpha\0https://alpha.example/v1').digest('hex')
  const run = {
    config: { modelTrustedBases: [] },
    identity: { userId: 1, profile: 'default' },
    state: { user: layer('user:1'), profile: layer('p:1:default') },
  }
  await run.state.user.namespace('desktopModelKeys').set(id, { providerId: 'alpha', baseUrl: 'https://alpha.example/v1', apiKey: 'fixture.plugin.token.0002' })
  const resolved = await resolveCredential(run, { providerId: 'alpha', baseUrl: 'https://alpha.example/v1' }, { decrypt: async () => ({ ok: true, plaintext: 'fixture.desktop.token.0003' }) })
  assert.equal(resolved.source, 'plugin')
  assert.equal(resolved.key, 'fixture.plugin.token.0002')
})

test('windows diagnostics: encrypted_key metadata only, never the value; missing/invalid keys are distinct codes', async () => {
  const d = decoderWith({ local: JSON.stringify({ os_crypt: { encrypted_key: 'bm90LWRwYXBpLWtleQ==' } }) })
  const r = await d(encryptV10('x'))
  assert.equal(r.code, WIN_CODES.ENCRYPTED_KEY_INVALID)
  const health = await d.selfCheck(true)
  assert.equal(health.localState.encryptedKeyChars > 0, true)
  assert.equal(health.localState.hasDpapiPrefix, false)
  assert.equal(JSON.stringify(health).includes('bm90LWRwYXBpLWtleQ=='), false, '诊断不输出 encrypted_key 值')
})

test('windows Local State candidates cover productName/package-name/Electron under APPDATA and LOCALAPPDATA', () => {
  const paths = localStateCandidates({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' })
  for (const expected of ['Deva', 'deva', '@deva/desktop', 'Electron']) {
    assert.equal(paths.some(path => path.includes(expected) && path.endsWith('Local State')), true)
  }
})

test('readLocalStateInfo never throws on missing/invalid JSON and reports structure', () => {
  assert.equal(readLocalStateInfo('/definitely/not/there/Local State').structure, 'missing')
})
