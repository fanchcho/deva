import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverModels } from '../lib/model-discovery.mjs'
import { readCustomModel } from '../lib/model-selection.mjs'
import { createCustomModel } from '../lib/studio-model.mjs'
import { DESKTOP_DECRYPT_CODES } from '../lib/desktop-secrets.mjs'

/**
 * 复现用户实测症状：**「模型页拉取模型没问题，对话 401」**。
 *
 * 真实差异只有两条，这个测试把它们钉住：
 *  ① `GET {base}/models` 在不带 Authorization 时也可能返回 200 —— 那只是该地址允许匿名列清单，
 *     **不能**证明凭据可用（所以页面文案不许写「/models 不需要 Key」这种通用结论）；
 *  ② `POST {base}/chat/completions` 才是消费凭据的端点；没有 Key 时不发 Authorization，必然 401。
 * 注入解密器拿到桌面 Key 之后，同一个 POST 必须变成 200 SSE —— 证明修的是凭据链路，不是文案。
 */

const KEY = 'fixture.chat.key.0001'
const CIPHER = Buffer.from('fixture-dpapi-blob').toString('base64')

async function fixture(t, { withDesktopSecret = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'deva-models-vs-chat-'))
  const home = join(root, '.deva')
  await mkdir(home, { mode: 0o700 })
  const seen = []
  const server = createServer((req, res) => {
    const authorized = req.headers.authorization === `Bearer ${KEY}`
    seen.push({ method: req.method, url: req.url, authorized: Boolean(req.headers.authorization), valid: authorized })
    req.resume()
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'a1' }] }))
      return
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (!authorized) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'missing api key' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  await writeFile(join(home, 'config.json'), JSON.stringify({
    models: {
      activeModelId: 'alpha:a1',
      providers: [{ id: 'alpha', name: 'Alpha', kind: 'custom', adapter: 'openai', apiHost: baseUrl, enabled: true, models: [{ id: 'a1', name: 'A1', enabled: true }] }],
    },
  }, null, 2), { mode: 0o600 })
  if (withDesktopSecret) await writeFile(join(home, 'secrets.json'), JSON.stringify({ alpha: CIPHER }), { mode: 0o600 })
  const records = new Map()
  const layer = name => ({
    namespace: (...parts) => layer([name, ...parts].join('/')),
    async get(key) { return records.get(`${[name]}#${key}`) },
    async set(key, value) { records.set(`${[name]}#${key}`, value) },
    async delete(key) { records.delete(`${[name]}#${key}`) },
  })
  const run = {
    config: { sharedDevaHome: home, sharedDevaUserId: 1, modelTrustedBases: [baseUrl] },
    identity: { userId: 1, profile: 'default' },
    desktopActivationUserId: 1,
    state: { user: layer('user:1'), profile: layer('profile:1:default') },
  }
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  return { run, baseUrl, seen }
}

const chatInput = () => ({ messages: [{ role: 'user', text: 'hi' }], tools: [], onDelta: async () => {} })

test('symptom: no key → GET /models 200 without Authorization, POST /chat/completions 401', async t => {
  const { run, baseUrl, seen } = await fixture(t)
  // 拉模型：确实成功，但请求里没有 Authorization —— 200 不代表凭据可用。
  const discovery = await discoverModels(run, { baseUrl })
  assert.deepEqual(discovery.models, [{ id: 'a1' }])
  assert.equal(discovery.authProbe.sentAuthorization, false)
  assert.equal(discovery.authProbe.chatAuthorized, 'absent')
  assert.match(discovery.authProbe.reason, /不能证明对话可用/)
  const listCall = seen.find(item => item.method === 'GET' && item.url === '/v1/models')
  assert.equal(listCall.authorized, false, '/models 请求没带 Authorization')
  // 对话：没有 Key → 不发 Authorization → 上游 401，且报错说清「没有可用 Key」而非笼统失败。
  const custom = await readCustomModel(run, null)
  assert.equal(custom.apiKey, '')
  await assert.rejects(
    createCustomModel(run, custom)(chatInput()),
    error => /HTTP 401；未回退/.test(error.message) && /都没有该提供方的密钥/.test(error.message),
  )
  const chatCall = seen.find(item => item.method === 'POST' && item.url === '/v1/chat/completions')
  assert.equal(chatCall.authorized, false, '对话请求同样没带 Authorization')
})

test('symptom: desktop has a ciphertext but the DPAPI toolchain is broken → 401 explains the toolchain, not “Key invalid”', async t => {
  const { run, baseUrl, seen } = await fixture(t, { withDesktopSecret: true })
  const discovery = await discoverModels(run, { baseUrl })
  assert.equal(discovery.authProbe.chatAuthorized, 'absent', '工具链坏 = 没有可用 Key，不能报「已授权」')
  const decrypt = async () => ({ ok: false, code: DESKTOP_DECRYPT_CODES.ASSEMBLY, selfCheck: { platform: 'win32', ok: false, code: DESKTOP_DECRYPT_CODES.ASSEMBLY, variants: [{ binary: 'powershell.exe', ok: false, code: DESKTOP_DECRYPT_CODES.ASSEMBLY, assembly: false, roundtrip: false }] } })
  const custom = await readCustomModel(run, null, { decrypt })
  assert.equal(custom.apiKey, '')
  await assert.rejects(
    createCustomModel(run, custom)(chatInput()),
    error => /HTTP 401；未回退/.test(error.message) && /没有可用的解密工具链（decrypt-assembly-unavailable）/.test(error.message),
  )
  assert.ok(seen.some(item => item.method === 'POST' && item.url === '/v1/chat/completions' && !item.authorized))
})

test('symptom: desktop key resolved (injected decoder) → same POST /chat/completions becomes 200 SSE', async t => {
  const { run, baseUrl, seen } = await fixture(t, { withDesktopSecret: true })
  const decrypt = async () => ({ ok: true, plaintext: KEY, selfCheck: { platform: 'win32', ok: true, code: 'ok', runtime: 'pwsh', variants: [{ binary: 'pwsh.exe', ok: true, runtime: 'pwsh', assembly: true, roundtrip: true }] } })
  const custom = await readCustomModel(run, null, { decrypt })
  assert.equal(custom.apiKey, KEY)
  assert.equal(custom.credentialSource, 'desktop')
  const deltas = []
  const result = await createCustomModel(run, custom)({ ...chatInput(), onDelta: async text => deltas.push(text) })
  assert.equal(result.text, 'ok')
  assert.deepEqual(deltas, ['ok'])
  const chatCall = seen.find(item => item.method === 'POST' && item.url === '/v1/chat/completions')
  assert.equal(chatCall.authorized, true, '注入解密器后对话请求带上了桌面 Key')
  // 拉模型也应带上同一把 Key。
  const discovery = await discoverModels(run, { baseUrl })
  assert.equal(discovery.authProbe.chatAuthorized, 'authorized')
  assert.ok(seen.filter(item => item.url === '/v1/models').every(item => item.authorized))
})

test('the page never claims “GET /models needs no Key” as a general rule', async t => {
  const { run, baseUrl } = await fixture(t)
  const discovery = await discoverModels(run, { baseUrl })
  const text = JSON.stringify(discovery.authProbe)
  assert.match(text, /不能证明对话可用/)
  assert.equal(/无需鉴权|不需要\s*Key|无需\s*Key/.test(text), false)
})
