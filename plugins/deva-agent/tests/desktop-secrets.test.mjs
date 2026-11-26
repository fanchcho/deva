import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearDesktopKeyCache, createDpapiDecoder, DESKTOP_DECRYPT_CODES,
  desktopSecretsPaths, publicDesktopCredential, readDesktopSecrets, resolveDesktopCredential,
} from '../lib/desktop-secrets.mjs'
import { readCustomModel, readModelSelection, resolveCredential, saveModelSelection } from '../lib/model-selection.mjs'

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
  assert.match(view.keyProblem, /无法解密/)
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
      // 第一次（带 v10 前缀）失败，第二次（去掉前缀）成功 —— 与 Chromium 真机行为一致。
      if (calls.length === 1) return { status: 1, stdout: '', stderr: 'CryptographicException' }
      return { status: 0, stdout: Buffer.from('fixture.decoded.value').toString('base64') }
    },
  })
  const prefixed = Buffer.concat([Buffer.from('v10'), Buffer.from('payload')]).toString('base64')
  const result = await decode(prefixed)
  assert.equal(result.ok, true)
  assert.equal(result.plaintext, 'fixture.decoded.value')
  assert.equal(calls.length, 2)
  assert.equal(String(calls[0].script).includes('payload'), false, '密文不进脚本/命令行参数')
  assert.equal(calls[0].input, Buffer.from('v10payload').toString('base64'), '密文只经 stdin')
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
