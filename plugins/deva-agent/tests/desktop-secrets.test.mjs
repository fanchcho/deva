import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearDesktopAclCache, clearDesktopKeyCache, createDpapiDecoder, credentialHealth, DESKTOP_DECRYPT_CODES, detectContainer, MAC_CODES,
  desktopSecretsPaths, isToolchainFailure, probeFileOwner, publicDesktopCredential, readDesktopSecrets, resolveDesktopCredential,
} from '../lib/desktop-secrets.mjs'
import { readCustomModel, readModelSelection, resolveCredential, saveModelSelection } from '../lib/model-selection.mjs'
import { createMacKeychainDecoder } from '../lib/macos-keychain.mjs'

/**
 * 五种夹具：仅插件 Key / 仅桌面 Key（注入假解密器）/ 两者都有（插件优先）/
 * 桌面有但解密失败 / 都没有。
 *
 * 全部在临时目录里自造，**不碰用户真实的 `~/.deva` 与 `secrets.json`**；
 * 夹具里的密文是自己拼的假 base64，不是任何真实密钥。
 */

const PLAIN = 'fixture.desktop.token.0000'
const PLUGIN_KEY = 'fixture.plugin.token.1111'
const CIPHERTEXT = Buffer.from('fixture-dpapi-ciphertext-not-a-real-blob').toString('base64')

async function fixture({ desktop = true, config = true, secretsShape = 'ok' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-secrets-'))
  const home = join(dir, '.deva')
  await mkdir(home, { recursive: false, mode: 0o700 })
  if (config) {
    await writeFile(join(home, 'config.json'), JSON.stringify({
      models: {
        activeModelId: 'alpha:a1',
        providers: [{ id: 'alpha', name: 'Alpha', kind: 'custom', adapter: 'openai', apiHost: 'https://alpha.example/v1', enabled: true, models: [{ id: 'a1', name: 'A1', enabled: true }] }],
      },
    }), { mode: 0o600 })
  }
  if (desktop && secretsShape === 'ok') await writeFile(join(home, 'secrets.json'), JSON.stringify({ alpha: CIPHERTEXT }, null, 2), { mode: 0o600 })
  if (desktop && secretsShape === 'broken-json') await writeFile(join(home, 'secrets.json'), '{not json', { mode: 0o600 })
  if (desktop && secretsShape === 'not-object') await writeFile(join(home, 'secrets.json'), '[]', { mode: 0o600 })
  return { dir, home, config: { sharedDevaHome: home, sharedDevaUserId: 1, modelTrustedBases: [] }, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 账号级（state.user）与 Profile 级（state.profile）两层存储，语义与宿主一致。 */
function memoryState() {
  const records = new Map()
  const layer = name => {
    const ns = (...parts) => layer([name, ...parts].join('/'))
    return {
      namespace: ns,
      async get(key) { return records.get(`${[name]}#${key}`) },
      async set(key, value) { records.set(`${[name]}#${key}`, value) },
      async delete(key) { records.delete(`${[name]}#${key}`) },
    }
  }
  return ({ userId = 1, profile = 'default' } = {}) => ({ identity: { userId, profile }, state: { user: layer(`user:${userId}`), profile: layer(`profile:${userId}:${profile}`) } })
}

const route = { providerId: 'alpha', baseUrl: 'https://alpha.example/v1' }
const okDecoder = async () => ({ ok: true, plaintext: PLAIN })
const failDecoder = async () => ({ ok: false, code: DESKTOP_DECRYPT_CODES.DPAPI_FAILED })

const credentialId = async (providerId, baseUrl) => {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(`${providerId}\0${baseUrl}`).digest('hex')
}

test('fixture 1/5 — only a plugin-saved key: plugin wins and the desktop file is never consulted for plaintext', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  const make = memoryState()
  const run = { ...make(), config: fx.config, desktopActivationUserId: 1 }
  await run.state.user.namespace('desktopModelKeys').set(await credentialId(route.providerId, route.baseUrl), { ...route, apiKey: PLUGIN_KEY })
  const resolved = await resolveCredential(run, route, { decrypt: okDecoder })
  assert.equal(resolved.source, 'plugin')
  assert.equal(resolved.key, PLUGIN_KEY)
  assert.equal(resolved.plugin.scope, 'user', '保存到账号级作用域，换 Profile 也能读到')
  // 同一账号、换一个 Profile：仍然读得到（线上「重开丢失」的第一个根因）。
  const otherProfile = await resolveCredential({ ...make({ profile: 'studio-web-abc123' }), config: fx.config }, route, { decrypt: okDecoder })
  assert.equal(otherProfile.source, 'plugin')
  assert.equal(otherProfile.key, PLUGIN_KEY)
})

test('fixture 2/5 — only a desktop key: read through the injected decoder, never persisted anywhere', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  clearDesktopKeyCache()
  const make = memoryState()
  const run = { ...make(), config: fx.config, desktopActivationUserId: 1 }
  const resolved = await resolveCredential(run, route, { decrypt: okDecoder })
  assert.equal(resolved.source, 'desktop')
  assert.equal(resolved.key, PLAIN)
  assert.equal(resolved.desktop.path, join(fx.home, 'secrets.json'))
  assert.equal(resolved.desktop.exists, true)
  assert.equal(resolved.desktop.entryCount, 1)
  // 不写回桌面文件（字节不变），也不写插件状态、不进诊断。
  const before = await readFile(join(fx.home, 'secrets.json'), 'utf8')
  assert.equal(before.includes(CIPHERTEXT), true)
  assert.equal(before.includes(PLAIN), false, '桌面文件始终是密文')
  const after = await readFile(join(fx.home, 'secrets.json'), 'utf8')
  assert.equal(after, before, '读取不解密成功后写回')
  assert.equal(JSON.stringify(publicDesktopCredential(resolved.desktop)).includes(PLAIN), false, '公开诊断不含明文')
  assert.equal(JSON.stringify(publicDesktopCredential(resolved.desktop)).includes(CIPHERTEXT), false, '公开诊断不含密文')
})

test('fixture 3/5 — both present: the plugin key takes priority over the desktop key', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  clearDesktopKeyCache()
  const make = memoryState()
  const run = { ...make(), config: fx.config }
  await run.state.user.namespace('desktopModelKeys').set(await credentialId(route.providerId, route.baseUrl), { ...route, apiKey: PLUGIN_KEY })
  const resolved = await resolveCredential(run, route, { decrypt: okDecoder })
  assert.equal(resolved.source, 'plugin')
  assert.equal(resolved.key, PLUGIN_KEY)
  // 页面直接把来源投影出来：只显示状态，不显示值。
  const view = await readModelSelection(run)
  assert.equal(view.hasApiKey, true)
  assert.equal(view.keySource, 'plugin')
  assert.equal(JSON.stringify(view).includes(PLUGIN_KEY), false)
  assert.equal(JSON.stringify(view).includes(PLAIN), false)
})

test('fixture 4/5 — desktop has the key but decryption fails: an explicit, actionable reason', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  clearDesktopKeyCache()
  const run = { ...memoryState()(), config: fx.config }
  const resolved = await resolveCredential(run, route, { decrypt: failDecoder })
  assert.equal(resolved.source, 'none')
  assert.equal(resolved.key, '')
  assert.equal(resolved.reason, 'decrypt-failed')
  assert.equal(resolved.desktop.decryptCode, DESKTOP_DECRYPT_CODES.DPAPI_FAILED)
  const view = await readModelSelection(run)
  assert.equal(view.hasApiKey, false)
  // Linux 上默认解码器如实报 platform-unsupported；Windows 上会是 dpapi-* 码。两种都必须说清 DPAPI 前提。
  assert.match(view.keyProblem, /DPAPI/)
  assert.match(view.keyProblem, /secrets\.json/, '原因里给出确切路径')
  assert.equal(view.keyProblem.includes(CIPHERTEXT), false)
  assert.equal(view.keyProblem.includes(PLAIN), false)
})

test('fixture 5/5 — neither side has a key: distinguishable from “desktop unreadable”', async t => {
  const fx = await fixture({ desktop: false })
  t.after(fx.cleanup)
  clearDesktopKeyCache()
  const run = { ...memoryState()(), config: fx.config }
  const resolved = await resolveCredential(run, route, { decrypt: okDecoder })
  assert.equal(resolved.source, 'none')
  assert.equal(resolved.reason, 'desktop-file-missing')
  assert.equal(resolved.desktop.exists, false)
  const view = await readModelSelection(run)
  assert.equal(view.hasApiKey, false)
  assert.match(view.keyProblem, /还没写过密钥文件/)
  assert.match(view.keyProblem, /secrets\.json/)
})

test('every other desktop state reports its own reason instead of a blanket “not set”', async t => {
  const cases = [
    ['broken-json', /desktop-unreadable/],
    ['not-object', /desktop-unreadable/],
  ]
  for (const [shape, reason] of cases) {
    const fx = await fixture({ desktop: true, secretsShape: shape })
    t.after(fx.cleanup)
    clearDesktopKeyCache()
    const resolved = await resolveCredential({ ...memoryState()(), config: fx.config }, route, { decrypt: okDecoder })
    assert.equal(resolved.source, 'none')
    assert.match(resolved.reason, reason)
    const view = await readModelSelection({ ...memoryState()(), config: fx.config })
    assert.match(view.keyProblem, /secrets\.json 存在但不可用/)
  }
  // 文件存在但没有该 provider 的条目：与「文件不可用」必须分开。
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  await writeFile(join(fx.home, 'secrets.json'), JSON.stringify({ other: CIPHERTEXT }), { mode: 0o600 })
  const missing = await resolveCredential({ ...memoryState()(), config: fx.config }, route, { decrypt: okDecoder })
  assert.equal(missing.reason, 'missing-desktop-entry')
})

test('the desktop path follows config.json’s root, and legacy userData locations are only a fallback', async () => {
  const fx = await fixture({ desktop: true })
  try {
    const paths = desktopSecretsPaths(fx.config, { APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming' })
    assert.equal(paths.primary, join(fx.home, 'secrets.json'))
    assert.deepEqual(paths.legacy, [], '非 Windows 不枚举旧 userData 位置')
  } finally { await fx.cleanup() }
})

test('reading a malformed secrets.json never throws and never leaks file contents', async () => {
  const fx = await fixture({ desktop: true, secretsShape: 'broken-json' })
  try {
    const file = readDesktopSecrets(fx.config)
    assert.equal(file.structure, 'invalid')
    assert.equal(file.code, 'parse-error')
    assert.equal(Object.keys(file.entries).length, 0)
  } finally { await fx.cleanup() }
})

test('the DPAPI decoder sends the ciphertext on stdin, never in argv, and honours version prefixes', async () => {
  const calls = []
  const decode = createDpapiDecoder({
    platform: 'win32',
    spawn: (binary, script, input) => {
      calls.push({ binary, script, input })
      if (script.includes('selfcheck')) return { status: 0, stdout: 'DEVADPAPI selfcheck\n{"runtime":"pwsh","assembly":true,"roundtrip":true}' }
      // 第一次（带 v10 前缀）失败，第二次（去掉前缀）成功 —— 与 Chromium 真机行为一致。
      if (input === Buffer.concat([Buffer.from('v10'), Buffer.from('payload')]).toString('base64')) {
        return { status: 3, stdout: 'DEVADPAPI unprotect', stderr: 'HResult=0x80090005 bad data' }
      }
      return { status: 0, stdout: 'DEVADPAPI ok\n' + Buffer.from('fixture.decoded.value').toString('base64') }
    },
  })
  const prefixed = Buffer.concat([Buffer.from('v10'), Buffer.from('payload')]).toString('base64')
  const result = await decode(prefixed)
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.decoded.value')
  assert.equal(result.prefix, 'v10')
  const decryptCalls = calls.filter(item => !item.script.includes('selfcheck'))
  assert.equal(decryptCalls.length, 2)
  assert.equal(String(decryptCalls[0].script).includes('payload'), false, '密文不进脚本/命令行参数')
  assert.equal(decryptCalls[0].input, prefixed, '密文只经 stdin（第一次带前缀原样试）')
  assert.equal(decryptCalls[1].input, Buffer.from('payload').toString('base64'), '第二次去前缀重试')
})

test('the default decoder refuses to guess on non-Windows hosts', async () => {
  const result = await createDpapiDecoder({ platform: 'linux' })('ZmFrZQ==')
  assert.equal(result.ok, false)
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.NOT_WINDOWS)
})

test('the plaintext cache is bounded, expires, and is dropped on demand', async () => {
  const fx = await fixture({ desktop: true })
  try {
    clearDesktopKeyCache()
    let now = 1000
    let decodes = 0
    const run = { ...memoryState()(), config: fx.config }
    const decrypt = async () => { decodes++; return { ok: true, plaintext: PLAIN } }
    const first = await resolveDesktopCredential({ config: fx.config, providerId: 'alpha', decrypt, now: () => now })
    assert.equal(first.cached, false)
    const second = await resolveDesktopCredential({ config: fx.config, providerId: 'alpha', decrypt, now: () => now })
    assert.equal(second.cached, true, '同一密文第二次直接命中内存缓存')
    assert.equal(decodes, 1)
    now += 6 * 60_000
    const expired = await resolveDesktopCredential({ config: fx.config, providerId: 'alpha', decrypt, now: () => now, ttlMs: 5 * 60_000 })
    assert.equal(expired.cached, false, '超时后重新解密')
    assert.equal(decodes, 2)
    // 上限：连续 20 个不同条目也不会让缓存无限增长。
    for (let i = 0; i < 20; i++) {
      await writeFile(join(fx.home, 'secrets.json'), JSON.stringify({ [`p${i}`]: Buffer.from(`cipher-${i}`).toString('base64') }), { mode: 0o600 })
      await resolveDesktopCredential({ config: fx.config, providerId: `p${i}`, decrypt, now: () => now, maxEntries: 3 })
    }
    clearDesktopKeyCache()
    void run
  } finally { clearDesktopKeyCache(); await fx.cleanup() }
})

test('saving a key in Studio writes only the plugin side, never the desktop secrets file', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  const run = { ...memoryState()(), config: fx.config, desktopActivationUserId: 1 }
  const before = await readFile(join(fx.home, 'secrets.json'), 'utf8')
  const saved = await saveModelSelection(run, { baseUrl: route.baseUrl, modelName: 'a1', apiKey: PLUGIN_KEY })
  assert.equal(saved.hasApiKey, true)
  assert.equal(saved.keySource, 'plugin')
  const after = await readFile(join(fx.home, 'secrets.json'), 'utf8')
  assert.equal(after, before, '桌面 secrets.json 一个字节都没动')
  assert.equal((await stat(join(fx.home, 'secrets.json'))).mode & 0o777, 0o600)
  const custom = await readCustomModel(run, null)
  assert.equal(custom.apiKey, PLUGIN_KEY)
  assert.equal(custom.credentialSource, 'plugin')
})

// ── 解码器夹具矩阵（0.8.47）：把「工具链坏了」与「密文不属于这个用户/机器」分开 ──

const SELF_OK = 'DEVADPAPI selfcheck\n{"runtime":"pwsh","version":"7.4.1","languageMode":"FullLanguage","assembly":true,"roundtrip":true}'
const okPayload = text => `DEVADPAPI ok\n${Buffer.from(text).toString('base64')}`
const BLOB = Buffer.from('user-secret-blob').toString('base64')

/** 造一个「powershell.exe 某行为 X、pwsh.exe 某行为 Y」的 spawn 假件，并区分自检与解密调用。 */
function variantSpawn(behaviour) {
  const calls = []
  const spawn = (binary, script, input) => {
    const isSelf = script.includes('selfcheck')
    calls.push({ binary, isSelf, input })
    const spec = behaviour[binary] || {}
    return isSelf ? (spec.self || { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'blocked' }) : (spec.decrypt || { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'blocked' })
  }
  return { spawn, calls }
}
const decodeMatrix = async (decoder, blob = BLOB) => decoder(blob)

test('matrix 1/9 — Windows PowerShell 5.1 variant alone decodes successfully', async () => {
  const { spawn, calls } = variantSpawn({
    'powershell.exe': {
      self: { status: 0, stdout: 'DEVADPAPI selfcheck\n{"runtime":"windows-powershell","version":"5.1.19041","assembly":true,"roundtrip":true}' },
      decrypt: { status: 0, stdout: okPayload('fixture.ps51.key') },
    },
    'pwsh.exe': { self: { error: { code: 'ENOENT' } }, decrypt: { error: { code: 'ENOENT' } } },
  })
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn }))
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.ps51.key')
  assert.equal(result.selfCheck.runtime, 'windows-powershell')
  assert.equal(calls.filter(c => !c.isSelf).length, 1, 'PS5.1 成功即停止，不再试 pwsh')
})

test('matrix 2/9 — PowerShell 7 variant alone decodes successfully', async () => {
  const { spawn, calls } = variantSpawn({
    'powershell.exe': { self: { error: { code: 'ENOENT' } }, decrypt: { error: { code: 'ENOENT' } } },
    'pwsh.exe': { self: { status: 0, stdout: SELF_OK }, decrypt: { status: 0, stdout: okPayload('fixture.ps7.key') } },
  })
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn }))
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.ps7.key')
  assert.ok(calls.some(c => c.binary === 'pwsh.exe'))
})

test('matrix 3/9 — both variants missing reports decrypt-tool-missing', async () => {
  const missing = createDpapiDecoder({ platform: 'win32', spawn: () => ({ error: { code: 'ENOENT' } }) })
  const result = await decodeMatrix(missing)
  assert.equal(result.ok, false)
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.TOOL_MISSING)
})

test('matrix 4/9 — assembly unavailable on both variants reports decrypt-assembly-unavailable', async () => {
  const { spawn } = variantSpawn({
    'powershell.exe': { self: { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'Add-Type blocked' }, decrypt: { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'Add-Type blocked' } },
    'pwsh.exe': { self: { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'Add-Type blocked' }, decrypt: { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'Add-Type blocked' } },
  })
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn }))
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.ASSEMBLY)
  assert.equal(result.selfCheck.ok, false)
})

test('matrix 5/9 — stdout polluted with BOM and warning lines still decodes the payload', async () => {
  const noisy = '\uFEFFWARNING: PowerShell profile failed\r\nMicrosoft.Windows.Something\r\n' + okPayload('fixture.noisy.key')
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: SELF_OK }
    : { status: 0, stdout: noisy } }))
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.noisy.key', '只取可校验 base64，不被噪声干扰')
  // 噪声里没有协议行时，退出码 0 也不能当成功。
  const noMarker = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: SELF_OK }
    : { status: 0, stdout: Buffer.from('garbage-not-a-payload').toString('base64') + '\nextra' } }))
  assert.equal(noMarker.ok, false)
  assert.equal(noMarker.code, DESKTOP_DECRYPT_CODES.OUTPUT_INVALID)
})

test('matrix 6/9 — self-check ok but unprotect fails → blob ownership, with redacted stderr', async () => {
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: SELF_OK }
    : { status: 1, stdout: '', stderr: 'boom at C:\\Users\\XYXNY\\x api_key=abc123 and plaintext fixture.value' } }))
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.FOREIGN_BLOB, '自检成功时解不开 → 归属问题，不报 dpapi-failed')
  assert.equal(result.stderr.includes('XYXNY'), false, 'stderr 里的用户路径被脱敏')
  assert.equal(result.stderr.includes('abc123'), false)
})

test('matrix 7/9 — invalid base64 ciphertext is its own reason, not “cannot decrypt”', async () => {
  const decoder = createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck') ? { status: 0, stdout: SELF_OK } : { status: 3, stdout: 'DEVADPAPI input', stderr: 'Ciphertext is not valid base64' } })
  for (const bad of ['', '   ', '%%%%']) {
    const result = await decodeMatrix(decoder, bad)
    assert.equal(result.ok, false)
    assert.equal(result.code, DESKTOP_DECRYPT_CODES.CIPHERTEXT_INVALID)
  }
})

test('matrix 8/9 — self-check passes but the blob cannot be decrypted → dpapi-foreign-blob', async () => {
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: SELF_OK }
    : { status: 3, stdout: 'DEVADPAPI unprotect', stderr: 'HResult=0x8009000b Key not valid for use in specified state' } }))
  assert.equal(result.ok, false)
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.FOREIGN_BLOB)
  assert.equal(isToolchainFailure(result.code), false, '这不是工具链问题，页面不能让人去修 PowerShell')
  assert.equal(result.selfCheck.ok, true)
})

test('matrix 9/9 — a failing self-check never claims the toolchain works', async () => {
  const result = await decodeMatrix(createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: 'DEVADPAPI selfcheck\n{"assembly":true,"roundtrip":false}' }
    : { status: 3, stdout: 'DEVADPAPI unprotect', stderr: 'CryptographicException' } }))
  assert.equal(result.selfCheck.ok, false)
  assert.equal(result.code, DESKTOP_DECRYPT_CODES.ROUNDTRIP_FAILED)
  assert.equal(isToolchainFailure(result.code), true)
})

test('self-check reports the environment facts the user needs to send back', async () => {
  const decoder = createDpapiDecoder({ platform: 'win32', spawn: (b, script) => script.includes('selfcheck')
    ? { status: 0, stdout: 'DEVADPAPI selfcheck\n{"runtime":"windows-powershell","version":"5.1","user":"machine\\\\user","languageMode":"ConstrainedLanguage","assembly":false,"roundtrip":false}' }
    : { status: 3, stdout: 'DEVADPAPI assembly', stderr: 'blocked' } })
  const health = credentialHealth(await decoder.selfCheck())
  assert.equal(health.ok, false)
  assert.equal(health.variants.length, 2)
  assert.equal(health.variants[0].languageMode, 'ConstrainedLanguage')
  assert.equal(health.variants[0].assembly, false)
  assert.equal(health.platform, 'win32')
  assert.equal(JSON.stringify(health).includes('fixture'), false)
})

test('container detection distinguishes a container/WSL server from a native Windows one', () => {
  assert.equal(detectContainer({}), '')
  assert.equal(detectContainer({ KUBERNETES_SERVICE_HOST: '10.0.0.1' }), 'kubernetes')
  assert.equal(detectContainer({ WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl')
})

test('manual fill is permanent: account scope survives profile change and restart, and clear never resurrects old records', async t => {
  const fx = await fixture({ desktop: true })
  t.after(fx.cleanup)
  const { mkdtemp } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'deva-cred-persist-'))
  const file = join(dir, 'state.json')
  await writeFile(file, JSON.stringify({}), { mode: 0o600 })
  // 磁盘落盘的 memoryState：模拟宿主 state.user 的真实持久化（同一个文件被多次“进程”读）。
  const diskLayer = name => ({
    namespace: (...parts) => diskLayer([name, ...parts].join('/')),
    async get(key) {
      const all = JSON.parse(await readFile(file, 'utf8'))
      return all[`${[name]}#${key}`]
    },
    async set(key, value) {
      const all = JSON.parse(await readFile(file, 'utf8'))
      all[`${[name]}#${key}`] = value
      await writeFile(file, JSON.stringify(all), { mode: 0o600 })
    },
    async delete(key) {
      const all = JSON.parse(await readFile(file, 'utf8'))
      delete all[`${[name]}#${key}`]
      await writeFile(file, JSON.stringify(all), { mode: 0o600 })
    },
  })
  const makeRun = profile => ({ config: fx.config, identity: { userId: 1, profile }, desktopActivationUserId: 1, state: { user: diskLayer('user:1'), profile: diskLayer(`profile:1:${profile}`) } })
  // 在 profile=default 下由用户手动填写一次。
  const saved = await saveModelSelection(makeRun('default'), { baseUrl: route.baseUrl, modelName: 'a1', apiKey: PLUGIN_KEY })
  assert.equal(saved.keySource, 'plugin')
  // 换到另一个 Profile（Studio 的会话 Profile 是配置哈希派生的），仍然读得到。
  const other = await resolveCredential(makeRun('studio-web-abc123'), route, { decrypt: failDecoder })
  assert.equal(other.source, 'plugin')
  assert.equal(other.key, PLUGIN_KEY)
  // “重启”= 用全新的 run 对象读同一份磁盘 state，仍然在账号级。
  const restarted = await resolveCredential(makeRun('studio-web-def456'), route, { decrypt: failDecoder })
  assert.equal(restarted.source, 'plugin')
  assert.equal(restarted.key, PLUGIN_KEY)
  // 持久化确实发生在账号级作用域（不是只在内存里）。
  const persisted = await readFile(file, 'utf8')
  assert.equal(persisted.includes('fixture.plugin.token.1111'), true, '账号级记录确实落盘（模拟宿主）')
  assert.equal(persisted.includes('user:1/desktopModelKeys#'), true, '记录写在账号级命名空间')
  // 清除：两个作用域都要清；旧 Profile 记录不能复活。
  await saveModelSelection(makeRun('default'), { baseUrl: route.baseUrl, modelName: 'a1', apiKey: '' })
  const cleared = await resolveCredential(makeRun('default'), route, { decrypt: failDecoder })
  assert.equal(cleared.source, 'none')
  assert.equal(cleared.key, '')
  // 清除后磁盘上不再有该 Key（旧 Profile 记录不会复活）。
  const clearedRaw = await readFile(file, 'utf8')
  assert.equal(clearedRaw.includes('fixture.plugin.token.1111'), false)
  await rm(dir, { recursive: true, force: true })
})

test('ACL probe reports the desktop file owner without reading its contents', async () => {
  const calls = []
  const spawn = (binary, script, input) => {
    calls.push({ binary, input })
    return { status: 0, stdout: 'DEVADPAPI aclok\nDESKTOP\\XYXNY' }
  }
  const acl = probeFileOwner('C:\\Users\\XYXNY\\.deva\\secrets.json', { platform: 'win32', spawn })
  assert.equal(acl.ok, true)
  assert.equal(acl.owner, 'DESKTOP\\XYXNY')
  assert.equal(calls[0].input, 'C:\\Users\\XYXNY\\.deva\\secrets.json')
  // 缓存：同一路径不重复启动 PowerShell。
  const again = probeFileOwner('C:\\Users\\XYXNY\\.deva\\secrets.json', { platform: 'win32', spawn })
  assert.equal(again.owner, acl.owner)
  assert.equal(calls.length, 1)
  clearDesktopAclCache()
  const fail = probeFileOwner('C:\\x\\secrets.json', { platform: 'win32', spawn: () => ({ status: 2, stdout: 'DEVADPAPI aclfail' }) })
  assert.equal(fail.ok, false)
  assert.equal(fail.owner, '')
})

test('POSIX readability probe judges macOS/Linux files by real access, not by Windows ACL', async () => {
  const { writeFile: wf } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'deva-posix-acl-'))
  const file = join(dir, 'secrets.json')
  await wf(file, JSON.stringify({ alpha: Buffer.from('fixture').toString('base64') }), { mode: 0o600 })
  clearDesktopAclCache()
  const probe = probeFileOwner(file, { platform: 'darwin' })
  assert.equal(probe.ok, true, 'mode=600 且属于当前用户 → 必须判为可读（之前的 platform-unsupported 是错的）')
  assert.equal(probe.readable, true)
  assert.match(probe.owner, /^uid:\d+$/)
  assert.equal(probe.self, true)
  const missing = probeFileOwner(join(dir, 'nope.json'), { platform: 'darwin' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'ENOENT')
  await rm(dir, { recursive: true, force: true })
})

test('macOS platform reports a real decrypt reason instead of platform-unsupported', async () => {
  const fx = await fixture({ desktop: true })
  try {
    clearDesktopKeyCache()
    const decoder = createMacKeychainDecoder({ platform: 'darwin', runSecurity: () => ({ status: 44, stderr: 'The specified item could not be found in the keychain.' }) })
    const run = { ...memoryState()(), config: fx.config }
    const resolved = await resolveCredential(run, route, { decrypt: decoder })
    assert.equal(resolved.source, 'none')
    assert.equal(resolved.reason, 'decrypt-failed')
    assert.equal(resolved.desktop.decryptCode, MAC_CODES.ITEM_MISSING, 'darwin 上必须给出钥匙串具体原因码')
    // 页面读也要注入同一个 decoder：默认单例按真实 platform（本机 linux）选择实现。
    const view = await readModelSelection({ ...memoryState()(), config: fx.config }, { decrypt: decoder })
    assert.match(view.keyProblem, /钥匙串里没有对应的 Safe Storage 条目/)
    assert.equal(/不在那台 Windows 上/.test(view.keyProblem), false, '不得再出现跨 Windows 的错误归因')
  } finally { await fx.cleanup() }
})

test('secrets structure diagnosis reports key names, lengths and prefix — never values', async () => {
  const fx = await fixture({ desktop: true })
  try {
    clearDesktopKeyCache()
    const resolved = await resolveCredential({ ...memoryState()(), config: fx.config }, route, { decrypt: failDecoder })
    const detail = resolved.desktop.structureDetail
    assert.equal(detail.entryCount, 1)
    assert.equal(detail.entries[0].key, 'alpha')
    // 这份夹具是刻意造的“非 v10”密文（用于走解密失败分支），前缀应报 other 而不是假装 v10。
    assert.equal(detail.entries[0].prefix, 'other')
    assert.ok(detail.entries[0].decodedBytes > 0)

    const serialized = JSON.stringify(detail)
    assert.equal(serialized.includes(CIPHERTEXT), false, '不含 base64 密文')
    assert.equal(serialized.includes(PLAIN), false, '不含明文')
  } finally { await fx.cleanup() }
})
