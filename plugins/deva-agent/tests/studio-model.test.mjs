import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { customModelEndpoint, requestCustomModel } from '../lib/custom-model-network.mjs'
import { listConfiguredModels, readCustomModel, readModelSelection, resolveRunEffort, saveModelSelection, savePersonaModel } from '../lib/model-selection.mjs'
import { createCustomModel } from '../lib/studio-model.mjs'
import { sharedDevaPath } from '../lib/shared-deva-model.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()

const core = value => ({ baseUrl: value.baseUrl, modelName: value.modelName, hasApiKey: value.hasApiKey, legacyNeedsSetup: value.legacyNeedsSetup })

function scopeFixture() {
  const records = new Map()
  return (userId = 1, profile = 'default') => ({ identity: { userId, profile }, state: { profile: { namespace(...parts) {
    const key = name => JSON.stringify([profile, ...parts, name])
    return {
      async get(name) { return records.get(key(name)) },
      async set(name, value) { records.set(key(name), value) },
      async delete(name) { records.delete(key(name)) },
    }
  } } } })
}

const follow = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false }

test('Desktop shares the route but not credentials across Profiles or users', async t => {
  const { create: scope, configFile } = await sharedFixture(t), active = scope()
  const key = randomBytes(32).toString('hex')
  const baseUrl = 'https://api.example.com/v1', modelName = 'name'
  assert.deepEqual(core(await readModelSelection(active)), follow)
  assert.deepEqual(core(await saveModelSelection(active, { baseUrl, modelName, apiKey: key })), { baseUrl, modelName, hasApiKey: true, legacyNeedsSetup: false })
  assert.ok((await readCustomModel(scope())).apiKey === key)
  assert.equal((await readModelSelection(scope(2))).desktopWriteRequired, true)
  assert.deepEqual(core(await readModelSelection(scope(1, 'other'))), { ...follow, baseUrl, modelName })
  assert.equal((await saveModelSelection(active, { baseUrl, modelName: 'new' })).hasApiKey, true)
  assert.equal((await saveModelSelection(active, { baseUrl, modelName, apiKey: '' })).hasApiKey, false)
  assert.deepEqual(core(await saveModelSelection(active, { baseUrl: '', modelName: '' })), follow)
  assert.equal((await readFile(configFile, 'utf8')).includes(key), false)
  await assert.rejects(saveModelSelection(active, { baseUrl, modelName, userId: 2 }), /unknown property|additional/)
  const rejected = await saveModelSelection(active, { baseUrl, modelName: '' })
  assert.deepEqual({ ...core(rejected), error: rejected.error }, { ...follow, error: { field: 'modelName', code: 'model-name-invalid', message: '请填写有效的模型名' } })
})

test('non-public and HTTP bases require exact administrator approval; old user consent cannot bypass it', async t => {
  const { create, configFile } = await sharedFixture(t)
  const run = create()
  const seen = []
  const base = await loopback(t, (req, res) => {
    seen.push(req.url)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: req.url }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  const a = `${base}/a/v1`, b = `${base}/b/v1`
  const input = { system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [] }
  const turn = async () => (await createCustomModel(run, await readCustomModel(run))(input)).text
  for (const baseUrl of [a, 'http://api.example.com/v1', 'https://10.0.0.8/v1', 'https://[::1]/v1']) {
    const view = await saveModelSelection(run, { baseUrl, modelName: 'm', allowNonPublic: true })
    assert.equal(view.baseUrl, baseUrl)
    assert.equal(view.needsNetworkApproval, true)
    await assert.rejects(turn(), /Studio 管理员批准/)
  }
  assert.ok(JSON.parse(await readFile(configFile, 'utf8')).models.activeModelId)
  assert.equal((await saveModelSelection(run, { baseUrl: 'not a url', modelName: 'm' })).error.code, 'base-url-invalid')
  assert.equal((await saveModelSelection(run, { baseUrl: `${a}?k=v`, modelName: 'm' })).error.field, 'baseUrl')
  run.config.modelTrustedBases = [a]
  const saved = await saveModelSelection(run, { baseUrl: `${a}/`, modelName: 'm' })
  assert.equal(saved.allowNonPublic, true)
  assert.equal(await turn(), '/a/v1/chat/completions')
  const denied = await saveModelSelection(run, { baseUrl: b, modelName: 'm' })
  assert.equal(denied.needsNetworkApproval, true)
  assert.equal(denied.baseUrl, b)
  await assert.rejects(turn(), /Studio 管理员批准/)
  await saveModelSelection(run, { baseUrl: a, modelName: 'm' })
  await run.state.profile.namespace('1').set('modelNetworkConsent', { baseUrl: a })
  run.config.modelTrustedBases = []
  // 直连被拦时给出「哪个地址、为什么、到哪里批」，而不是只说“尚未确认放行”。
  await assert.rejects(turn(), error => /Studio 管理员批准/.test(error.message) && error.message.includes(a) && /modelTrustedBases/.test(error.message))
  assert.equal(seen.length, 1)
})

test('Desktop effort is shared, sent as reasoning_effort, and fails without fallback', async t => {
  const { create: scope } = await sharedFixture(t), run = scope()
  const bodies = []
  let status = 200
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    bodies.push(JSON.parse(raw))
    if (status !== 200) { res.writeHead(status).end('{}'); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    run.config.modelTrustedBases = [baseUrl]
    const route = { baseUrl, modelName: 'm' }
    const view = { baseUrl, modelName: 'm', hasApiKey: false, legacyNeedsSetup: false }
    const input = { system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [] }
    const turn = async (target = run, mode = 'scoped', model = {}) => {
      const custom = await readCustomModel(target)
      await createCustomModel(target, { ...custom, reasoningEffort: resolveRunEffort({ mode, model }, custom.reasoningEffort) })(input)
      return bodies.at(-1)
    }

    // 未设置：读回不带字段，请求体不带 reasoning_effort。
    assert.deepEqual(core(await saveModelSelection(run, route)), view)
    assert.equal('reasoning_effort' in await turn(), false)
    // 保存 → 独立重读一致 → 下一轮带上；省略字段保留、换档生效、空串清除。
    assert.equal((await saveModelSelection(run, { ...route, reasoningEffort: 'high' })).reasoningEffort, 'high')
    assert.equal((await readModelSelection(scope())).reasoningEffort, 'high')
    const otherRun = scope()
    otherRun.config.modelTrustedBases = [baseUrl]
    assert.equal((await turn(otherRun)).reasoning_effort, 'high')
    assert.equal((await saveModelSelection(run, route)).reasoningEffort, 'high')
    assert.equal((await saveModelSelection(run, { ...route, reasoningEffort: 'low' })).reasoningEffort, 'low')
    assert.equal((await turn()).reasoning_effort, 'low')
    // 其他账号、其他 Profile 互不影响。
    assert.equal((await readModelSelection(scope(2))).reasoningEffort, 'low')
    assert.equal((await readModelSelection(scope(1, 'other'))).reasoningEffort, 'low')

    // 非法取值：字段级错误、不写入、不降级。
    for (const reasoningEffort of ['ultra', 'HIGH', 'none']) {
      const rejected = await saveModelSelection(run, { ...route, modelName: 'changed', reasoningEffort })
      assert.deepEqual([rejected.error.field, rejected.error.code], ['reasoningEffort', 'reasoning-effort-invalid'])
      assert.deepEqual([rejected.modelName, rejected.reasoningEffort], ['m', 'low'])
    }

    // global 模式：目录只有配置的模型并声明档位；会话显式选择优先，非法值报错且不发请求。
    assert.deepEqual(await listConfiguredModels(run), {
      status: 'ready', source: 'deva-model-settings', scope: 'configured',
      models: [{ id: 'deva-direct', name: 'm', resolvedModel: 'm', isDefault: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }],
    })
    assert.equal(JSON.stringify(await listConfiguredModels(run)).includes(baseUrl), false)
    assert.equal((await turn(run, 'global', { reasoningEffort: 'xhigh' })).reasoning_effort, 'xhigh')
    assert.equal((await turn(run, 'global', {})).reasoning_effort, 'low')
    assert.equal((await turn(run, 'scoped', { reasoningEffort: 'max' })).reasoning_effort, 'low', 'scoped 的会话档位属于 Studio 模型，不用于直连')
    const sent = bodies.length
    await assert.rejects(turn(run, 'global', { reasoningEffort: 'none' }), /会话选择的模型强度 none 不受支持/)
    assert.equal(bodies.length, sent)

    // 上游拒绝：带状态码、点名参数与下一步；不去掉参数重试。
    status = 400
    await assert.rejects(turn(), error => /HTTP 400；未回退/.test(error.message) && /reasoning_effort=low/.test(error.message) && /模型强度/.test(error.message))
    assert.equal(bodies.length, sent + 1)
    status = 200

    // 空串清除；清空地址一并清除。
    assert.deepEqual(core(await saveModelSelection(run, { ...route, reasoningEffort: '' })), view)
    assert.equal('reasoning_effort' in await turn(), false)
    await saveModelSelection(run, { ...route, reasoningEffort: 'medium' })
    assert.deepEqual(core(await saveModelSelection(run, { baseUrl: '', modelName: '' })), follow)
    assert.equal(await run.state.profile.namespace('1').get('modelOptions'), undefined)
    assert.equal((await listConfiguredModels(run)).status, 'empty')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('legacy fixed ID is inert, is not sent to the page, and is removed on save', async t => {
  const { create } = await sharedFixture(t)
  const run = create()
  const store = run.state.profile.namespace('1')
  await store.set('model', { modelId: 'catalog/model' })
  assert.equal(await readCustomModel(run), null)
  assert.deepEqual(core(await readModelSelection(run)), { ...follow, legacyNeedsSetup: true })
  assert.deepEqual(core(await saveModelSelection(run, { baseUrl: '', modelName: '' })), follow)
  assert.equal(await store.get('model'), undefined)
})

async function sharedFixture(t) {
  const tmp = new URL('../.tmp/', import.meta.url)
  await mkdir(tmp, { recursive: true })
  const dir = await mkdtemp(new URL('share-unit-', tmp).pathname)
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = join(dir, '.deva')
  const scope = scopeFixture()
  const create = (...args) => Object.assign(scope(...args), { config: { sharedDevaUserId: 1, sharedDevaHome: root } })
  return { dir, root, configFile: join(root, 'config.json'), create }
}

test('legacy route imports once; same provider is reused and credentials stay out of Desktop JSON', async t => {
  const { create, root, configFile } = await sharedFixture(t)
  const run = create()
  const store = run.state.profile.namespace('1')
  const baseUrl = 'https://api.example.com/v1', modelName = 'old'
  const apiKey = randomBytes(32).toString('hex')
  await store.set('customModel', { baseUrl, modelName, apiKey })
  await mkdir(root, { mode: 0o700 })
  const provider = { id: 'legacy-mirror', apiHost: baseUrl, adapter: 'openai', enabled: true, models: [{ id: modelName, enabled: true }] }
  await writeFile(configFile, JSON.stringify({ models: { providers: [provider], activeModelId: null } }))
  assert.equal((await readModelSelection(run)).modelRef, '')
  assert.ok(await store.get('customModel'), 'read must not migrate')
  await readCustomModel(run)
  const view = await readModelSelection(run)
  assert.equal(view.sharedConfigPath, configFile)
  assert.equal(view.modelRef, 'legacy-mirror:old')
  assert.equal(view.hasApiKey, true)
  assert.equal(await store.get('customModel'), undefined)
  assert.equal((await readCustomModel(run)).apiKey, apiKey)
  assert.equal((await readCustomModel(create(1, 'other'))).apiKey, '')
  assert.equal((await readModelSelection(create(2))).desktopWriteRequired, true)
  const contents = await readFile(configFile, 'utf8')
  assert.equal(contents.includes(apiKey), false)
  assert.equal(JSON.stringify(view).includes(apiKey), false)
  assert.equal(JSON.parse(contents).models.providers.length, 1)
  assert.equal((await stat(configFile)).mode & 0o777, 0o600)
  assert.deepEqual(await readModelSelection(run), view)
  assert.equal(await readFile(configFile, 'utf8'), contents)
  assert.equal(sharedDevaPath({ identity: { userId: 1 }, config: { sharedDevaUserId: 1, sharedDevaHome: '' } }), process.env.DEVA_HOME?.trim() || join(homedir(), '.deva'))
})

test('a conflicting old Profile choice stays selectable without overwriting Desktop default; persona overrides are shared', async t => {
  const { create, root, configFile } = await sharedFixture(t)
  const run = create()
  const store = run.state.profile.namespace('1')
  const baseUrl = 'https://api.example.com/v1'
  await store.set('customModel', { baseUrl, modelName: 'old', apiKey: '' })
  await mkdir(join(root, 'personas'), { recursive: true, mode: 0o700 })
  const persona = join(root, 'personas', 'qa.md')
  const content = '---\r\nname: QA\r\nworkspace: /example\r\n---\r\n\r\nKeep me.\r\n'
  await writeFile(persona, content)
  const provider = { id: 'desk', apiHost: baseUrl, adapter: 'openai', enabled: true, models: [{ id: 'default:model', enabled: true }] }
  await writeFile(configFile, JSON.stringify({ models: { providers: [provider], activeModelId: 'desk:default:model' } }))
  assert.equal((await readModelSelection(run)).desktopModels.length, 1)
  await readCustomModel(run)
  const view = await readModelSelection(run)
  const old = view.desktopModels.find(item => item.modelName === 'old')
  assert.ok(old)
  assert.equal(view.modelRef, 'desk:default:model')
  assert.equal(await store.get('customModel'), undefined)
  const saved = await savePersonaModel(run, { personaId: 'qa', modelRef: old.ref })
  assert.equal(saved.personaModels[0].model, old.ref)
  assert.equal((await readCustomModel(run, 'qa')).modelName, 'old')
  assert.equal((await readCustomModel(run)).modelName, 'default:model')
  assert.equal(await readFile(persona, 'utf8'), content.replace('workspace: /example', `workspace: /example\r\nmodel: "${old.ref}"`))
  await savePersonaModel(run, { personaId: 'qa', modelRef: '' })
  assert.equal(await readFile(persona, 'utf8'), content)
  assert.equal((await readCustomModel(run, 'qa')).modelName, 'default:model')
})

test('shared writes preserve Desktop fields, reject unsafe files, and never retarget a Desktop credential', async t => {
  const { create, dir, root, configFile } = await sharedFixture(t)
  const run = create()
  await mkdir(root, { mode: 0o755 })
  const baseUrl = 'https://api.example.com/v1', modelName = 'model:latest'
  const provider = { id: 'deva-studio-shared', apiHost: baseUrl, adapter: 'openai', enabled: true, models: [{ id: modelName, name: 'label', enabled: true, contextWindow: 4096 }], extra: { future: true } }
  const other = { id: 'other', apiHost: 'https://other.example.com' }
  const original = { theme: 'dark', mcp: { enabled: { foo: true } }, models: { providers: [other, provider], activeModelId: `deva-studio-shared:${modelName}`, future: true } }
  const secrets = join(root, 'secrets.json')
  const ciphertext = JSON.stringify({ 'deva-studio-shared': randomBytes(32).toString('base64') })
  await writeFile(secrets, ciphertext, { mode: 0o600 })
  await writeFile(configFile, JSON.stringify(original))
  await saveModelSelection(run, { baseUrl, modelName })
  const merged = JSON.parse(await readFile(configFile, 'utf8'))
  assert.deepEqual(merged.models.providers[0], other)
  assert.deepEqual(merged.models.providers[1].extra, provider.extra)
  assert.deepEqual(merged.models.providers[1].models[0], provider.models[0])
  assert.equal(merged.models.activeModelId, original.models.activeModelId)
  assert.equal(merged.models.future, true)
  assert.equal(merged.theme, original.theme)
  assert.deepEqual(merged.mcp, original.mcp)
  await assert.rejects(saveModelSelection(run, { baseUrl: 'https://next.example.com/v1', modelName }), /清除该提供方密钥/)
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')), merged)
  assert.ok(await readFile(secrets, 'utf8') === ciphertext)
  await writeFile(configFile, '{invalid')
  await assert.rejects(saveModelSelection(run, { baseUrl, modelName }), /不是合法 JSON|符号链接/)
  assert.equal(await readFile(configFile, 'utf8'), '{invalid')
  await rm(configFile)
  const target = join(dir, 'target.json')
  await writeFile(target, '{}')
  await symlink(target, configFile)
  await assert.rejects(saveModelSelection(run, { baseUrl, modelName }), /不是合法 JSON|符号链接/)
  assert.equal(await readFile(target, 'utf8'), '{}')
})

test('endpoint appends exactly one suffix and requires explicit approval for nonpublic bases', async () => {
  assert.equal(customModelEndpoint('https://api.example.com/custom/v1/').url.href, 'https://api.example.com/custom/v1/chat/completions')
  assert.equal(customModelEndpoint('https://api.example.com/').url.pathname, '/chat/completions')
  for (const base of ['https://api.example.com/v1?x=y', 'https://api.example.com/#hash', 'https://a:b@api.example.com', 'file:///no', 'https://api.example.com/v1/chat/completions/']) {
    assert.throws(() => customModelEndpoint(base), /地址/)
  }
  for (const base of ['http://api.example.com', 'https://127.0.0.1', 'https://10.0.0.1', 'https://[::ffff:7f00:1]', 'https://169.254.169.254', 'https://[fc00::1]']) {
    assert.throws(() => customModelEndpoint(base), error => error.code === 'confirmation-required' && /管理员/.test(error.message))
  }
  const approved = 'http://127.0.0.1:4310/v1'
  assert.equal(customModelEndpoint(approved, [approved]).trusted, true)
  assert.throws(() => customModelEndpoint(`${approved}/other`, [approved]), /尚未确认放行/)
  await assert.rejects(requestCustomModel(customModelEndpoint('https://localhost/v1'), { body: '{}' }), /未解析到公网地址/)
})

function loopback(t, handler) {
  return new Promise(resolve => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise(done => server.close(done)))
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

test('custom transport refuses redirects and blocks a fragmented reflected key', async t => {
  const key = randomBytes(32).toString('hex')
  const seen = []
  const base = await loopback(t, (req, res) => {
    req.resume()
    seen.push(req.url)
    if (req.url.startsWith('/redirect/')) {
      res.writeHead(307, { location: '/must-not-be-called' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const data = (content, finish_reason) => JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })
    res.end(`data: ${data('prefix ' + key.slice(0, 20), null)}\n\ndata: ${data(key.slice(20), 'stop')}\n\ndata: [DONE]\n\n`)
  })
  const redirect = `${base}/redirect`, echo = `${base}/echo`
  const run = { config: { modelTrustedBases: [redirect, echo] } }
  const deltas = []
  const input = { messages: [{ role: 'user', text: 'hello' }], tools: [], onDelta: async text => deltas.push(text) }
  await assert.rejects(createCustomModel(run, { baseUrl: redirect, modelName: 'x', apiKey: key })(input), /HTTP 307/)
  await assert.rejects(createCustomModel(run, { baseUrl: echo, modelName: 'x', apiKey: key })(input), /回显了密钥/)
  assert.deepEqual(seen, ['/redirect/chat/completions', '/echo/chat/completions'])
  assert.ok(!deltas.join('').includes(key.slice(0, 20)))
})
