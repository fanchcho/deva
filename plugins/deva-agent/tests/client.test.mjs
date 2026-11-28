import { test } from 'node:test'
import assert from 'node:assert/strict'

/** 最小 DOM 桩：只实现 client.mjs 用到的那几个属性和方法，够验证页面与 RPC 的接线。 */
class StubElement {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.style = {}
    this.textContent = ''
    this._html = ''
    this.disabled = false
    this.checked = false
    this.value = ''
    this.type = ''
  }
  setAttribute(name, value) { this[name] = String(value) }
  set innerHTML(value) {
    this._html = String(value)
    if (this._html === '') this.children = []
  }
  get innerHTML() { return this._html }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node) } }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this) }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  scrollIntoView() {}
  appendChild(node) { this.children.push(node) }
}

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

function fakeContext(locale, rpc, { view = 'mcp', navigate, identity } = {}) {
  const notices = []
  const confirmed = []
  return {
    locale,
    notices,
    confirmed,
    view,
    ...(identity ? { identity } : {}),
    slot: 'agent-settings',
    rpc: { call: rpc },
    ui: {
      notify(message, level) { notices.push([message, level]) },
      async confirm(message) { confirmed.push(message); return true },
      ...(navigate ? { navigate } : {}),
    },
  }
}

test('new provider failed save retains selected model and key; inconsistent readback never reports success', async () => {
  let fail = true
  const root = await mountPage(fakeContext('zh', async name => {
    if (name === 'save-model-selection') {
      if (fail) throw new Error('sharedDevaUserId mismatch')
      return { modelRef: 'new:selected', modelName: 'selected' }
    }
    return { baseUrl: '', modelName: '', modelRef: '', hasApiKey: false, desktopModels: [] }
  }, { view: 'model' }))
  const choose = findAll(root, n => n.tag === 'select')[0]
  choose.value = '__deva_new_provider__'; choose.onchange()
  const address = findAll(root, n => n.type === 'url')[0]
  const model = findAll(root, n => n.type === 'text')[0]
  const key = findAll(root, n => n.type === 'password')[0]
  address.value = 'https://example.com/v1'; model.value = 'selected'; key.value = 'fixture-only'
  const save = findAll(root, n => n.tag === 'button' && n.textContent === '保存')[0]
  await save.onclick()
  assert.equal(key.value, 'fixture-only')
  assert.equal(model.value, 'selected')
  fail = false
  await save.onclick()
  assert.equal(key.value, 'fixture-only')
  assert.ok(findAll(root, n => n.textContent.includes('尚未确认持久化')).length)
})

test('model discovery selects explicit limits, retains manual input, and shows empty/failure/loading states', async () => {
  const saved = [], calls = []
  let response = { models: [{ id: 'with-length', contextWindow: 128000, maxOutput: 4096 }, { id: 'unknown-length' }] }
  const current = { baseUrl: 'https://example.com/v1', modelName: 'manual', modelRef: 'p:manual', hasApiKey: true, legacyNeedsSetup: false }
  const root = await mountPage(fakeContext('zh', async (name, input) => {
    calls.push([name, input])
    if (name === 'get-model-selection') return current
    if (name === 'save-model-selection') { saved.push(input); return { ...current, ...input } }
    if (response instanceof Error) throw response
    return response
  }, { view: 'model' }))
  const fetch = findAll(root, n => n.tag === 'button' && n.textContent === '刷新远端模型列表')[0]
  const select = findAll(root, n => n.tag === 'select' && n.size === 5)[0]
  const model = findAll(root, n => n.tag === 'input' && n.type === 'text')[0]
  const key = findAll(root, n => n.type === 'password')[0]
  const save = findAll(root, n => n.tag === 'button' && n.textContent === '保存')[0]
  const fetchPromise = fetch.onclick()
  assert.equal(fetch.disabled, true)
  assert.ok(findAll(root, n => /正在获取/.test(n.textContent)).length)
  await fetchPromise
  assert.equal(calls.at(-1)[1].apiKey, undefined, 'saved key stays on the server')
  assert.equal(key.value, '')
  select.value = 'with-length'; select.onchange()
  await save.onclick()
  assert.equal(saved[0].contextWindow, 128000)
  assert.equal(saved[0].maxInput, 0)
  await fetch.onclick()
  select.value = 'unknown-length'; select.onchange()
  assert.ok(findAll(root, n => n.textContent.includes('未提供')).length)
  await save.onclick()
  assert.equal(saved[1].contextWindow, 0)
  model.value = 'manually-entered'; model.oninput()
  await save.onclick()
  assert.equal(saved[2].modelName, 'manually-entered')
  response = { models: [] }; await fetch.onclick()
  assert.ok(findAll(root, n => /空模型列表/.test(n.textContent)).length)
  response = new Error('HTTP 401'); await fetch.onclick()
  assert.ok(findAll(root, n => /获取失败.*401/.test(n.textContent)).length)
  assert.equal(select.hidden, true)
  assert.equal(save.disabled, false)
})

const server = (name, extra = {}) => ({ name, transport: 'stdio', managed: false, enabled: true, ...extra })

async function mountPage(ctx) {
  globalThis.document = { createElement: tag => new StubElement(tag) }
  const root = new StubElement('div')
  const { mount } = await import('../client.mjs')
  await mount(root, ctx)
  return root
}

test('identity view shows shared paths and saves the default identity', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-identities') return { identities: [{ id: 'deva', name: 'Deva' }, { id: 'xiaomajiang', name: '小码酱' }], selected: 'deva', filePath: '/qa/.deva/config.json', personasDir: '/qa/.deva/personas', created: true, migrated: true, permissionRepaired: true }
    if (name === 'save-selection') return { ok: true, selected: input.identity, filePath: '/qa/.deva/config.json' }
    throw new Error(`unexpected rpc ${name}`)
  }
  const ctx = fakeContext('zh', rpc, { view: 'identity' })
  const root = await mountPage(ctx)

  assert.deepEqual(calls.map(([name]) => name), ['get-identities'])
  assert.equal(findAll(root, node => node.tag === 'select').length, 1)
  assert.equal(findAll(root, node => node.tag === 'input').length, 0, '身份页不渲染 MCP 勾选')

  const pathNote = findAll(root, node => node.textContent.includes('/qa/.deva/config.json'))[0]
  assert.match(pathNote.textContent, /已按当前身份创建.*0600\/0700/)
  assert.ok(findAll(root, node => /已从旧版身份文件迁移.*\/qa\/\.deva\/personas/.test(node.textContent)).length)
  assert.ok(findAll(root, node => node.textContent.includes('保存后下一轮生效')).length)
  const select = findAll(root, node => node.tag === 'select')[0]
  assert.deepEqual(select.children.map(option => [option.tag, option.value, option.textContent]), [
    ['option', 'deva', 'Deva'],
    ['option', 'xiaomajiang', '小码酱'],
  ], '选项按 DOM 构造，身份名不当作 HTML')
  select.value = 'xiaomajiang'
  const save = findAll(root, node => node.tag === 'button' && node.textContent === '设为默认')[0]
  await save.onclick()
  assert.deepEqual(calls.at(-1), ['save-selection', { identity: 'xiaomajiang' }])
  assert.equal(ctx.notices.at(-1)[1], 'success')
  assert.equal(pathNote.textContent, '身份选择文件：/qa/.deva/config.json')
})

test('身份页展示自定义头像 data URI，无图回退首字母', async () => {
  const rpc = async name => {
    if (name === 'get-identities') return {
      identities: [
        { id: 'general', name: 'Deva', description: '', avatarImage: 'data:image/png;base64,AAAA' },
        { id: 'xiaomajiang', name: '小码酱', description: '', avatarImage: '', avatarError: 'QA avatar read failure', model: 'qa:model', workspace: '/qa' },
      ],
      selected: 'general', filePath: '/qa/.deva/config.json', personasDir: '/qa/.deva/personas', created: false, migrated: false, permissionRepaired: false,
    }
    if (name === 'save-selection') return { ok: true, selected: 'general', filePath: '/x' }
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('zh', rpc, { view: 'identity' }))
  const images = findAll(root, node => node.tag === 'img')
  assert.equal(images.length, 1)
  assert.equal(images[0].src, 'data:image/png;base64,AAAA')
  assert.equal(images[0].hidden, false)
  const select = findAll(root, node => node.tag === 'select')[0]
  select.value = 'xiaomajiang'
  await select.onchange()
  const avatar = findAll(root, node => node.className === 'deva-avatar')[0]
  assert.equal(avatar.children[0].textContent, '小')
  assert.equal(images[0].hidden, true)
  assert.equal(avatar.title, '小码酱 · QA avatar read failure')
  assert.equal(select.children[1].title, 'model: qa:model workspace: /qa')
})

test('身份页在有会话上下文时提供「应用到当前会话」并显示当前身份', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-identities') return { identities: [{ id: 'general', name: 'Deva' }, { id: 'xiaomajiang', name: '小码酱' }], selected: 'general', filePath: '/x', personasDir: '/p', created: false, migrated: false, permissionRepaired: false }
    if (name === 'get-session-identity') return { sessionId: 's1', identity: 'general', source: 'default' }
    if (name === 'save-session-identity') return { ok: true, sessionId: 's1', identity: input.identity }
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('zh', rpc, { view: 'identity', identity: { userId: 1, profile: 'default', sessionId: 's1' } }))
  assert.ok(calls.some(([name]) => name === 'get-session-identity'))
  const note = findAll(root, node => typeof node.textContent === 'string' && node.textContent.includes('当前会话身份'))[0]
  assert.ok(note, '显示当前会话身份')
  assert.match(note.textContent, /@deva:<id>.*新建会话/)
  const apply = findAll(root, node => node.tag === 'button' && node.textContent === '应用到当前会话')[0]
  assert.ok(apply)
  apply.onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(calls.some(([name, input]) => name === 'save-session-identity' && input.identity === 'general'))
})

test('the identity editor and original path hints are wired in every Studio locale', async () => {
  for (const locale of ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']) {
    const calls = []
    const identities = [{ id: 'general', name: 'Deva', description: 'Description', enabled: false, hasPrompt: true }]
    const current = { id: 'general', name: 'Deva', description: 'Description', prompt: 'Old prompt', revision: 'a'.repeat(64) }
    const ctx = fakeContext(locale, async (name, input) => {
      calls.push([name, input])
      if (name === 'get-identities') return { identities, selected: 'general', canEdit: true, filePath: '/qa/config.json', personasDir: '/qa/personas' }
      if (name === 'get-persona-editor') return current
      if (name === 'create-persona') {
        identities.push({ ...input, id: 'next', enabled: true })
        return { id: 'next' }
      }
      if (name === 'update-persona') return { id: input.id }
      throw new Error(name)
    }, { view: 'identity' })
    const root = await mountPage(ctx)
    assert.ok(findAll(root, node => node.textContent.includes('/qa/config.json') && node.textContent !== '/qa/config.json').length)
    assert.ok(findAll(root, node => node.textContent.includes('/qa/personas') && node.textContent !== '/qa/personas').length)
    const [saveDefault, add, edit] = findAll(root, node => node.className === 'deva-actions')[0].children
    assert.equal(add.hidden, false)
    assert.equal(edit.hidden, false)
    assert.ok(add.textContent && edit.textContent && saveDefault.textContent)
    if (locale === 'zh-TW') assert.equal(add.textContent, '新增身分')
    assert.ok(findAll(root, node => node.textContent === 'Description').length)
    assert.match(findAll(root, node => node.tag === 'option')[0].textContent, /^Deva \(/)
    await edit.onclick()
    let form = findAll(root, node => node.tag === 'form')[0]
    const inputs = () => findAll(form, node => node.tag === 'input' || node.tag === 'textarea')
    assert.deepEqual(inputs().map(node => [node.name, node.value]), [['name', 'Deva'], ['description', 'Description'], ['prompt', 'Old prompt']])
    inputs()[2].value = 'Changed prompt'
    await form.onsubmit({ preventDefault() {} })
    assert.deepEqual(calls.find(([key]) => key === 'update-persona'), ['update-persona', { ...current, prompt: 'Changed prompt' }])
    await add.onclick()
    form = findAll(root, node => node.tag === 'form')[0]
    for (const [index, value] of ['Next', 'Shared', 'New prompt'].entries()) inputs()[index].value = value
    await form.onsubmit({ preventDefault() {} })
    assert.deepEqual(calls.find(([key]) => key === 'create-persona'), ['create-persona', { name: 'Next', description: 'Shared', prompt: 'New prompt' }])
    assert.equal(findAll(root, node => node.tag === 'select')[0].value, 'next')
    assert.ok(!calls.some(([key]) => key === 'save-selection' || key.includes('delete')))
  }
})

test('model view reads custom settings, keeps the key field empty and saves via RPC', async () => {
  const calls = []
  let persisted = { baseUrl: 'https://old.example/v1', modelName: 'old', modelRef: 'provider:old', hasApiKey: true, legacyNeedsSetup: false }
  const ctx = fakeContext('zh', async (name, input) => {
    if (name === 'get-model-selection') return persisted
    if (name !== 'save-model-selection') throw new Error(`unexpected rpc ${name}`)
    calls.push([name, input.baseUrl, input.modelName, input.apiKey === '' ? 'clear' : 'keep'])
    return persisted = { baseUrl: input.baseUrl, modelName: input.modelName, hasApiKey: false, legacyNeedsSetup: false }
  }, { view: 'model' })
  const root = await mountPage(ctx)
  const selects = findAll(root, node => node.tag === 'select' && node.size !== 5)
  assert.equal(selects.length, 2, '模型设置包含桌面默认模型和强度下拉')
  assert.deepEqual(selects[1].children.map(option => option.value), ['', 'low', 'medium', 'high', 'xhigh', 'max'])
  const [address, model, password, clear] = findAll(root, node => node.tag === 'input' && !node.readOnly && !['search', 'number'].includes(node.type))
  assert.deepEqual([address.type, model.type, password.type, clear.type], ['url', 'text', 'password', 'checkbox'])
  assert.equal(password.autocomplete, 'new-password')
  assert.equal(password.value, '')
  assert.match(password.placeholder, /已设置/)
  const [save] = findAll(root, node => node.tag === 'button' && !node.className?.includes('deva-model-discover'))
  address.value = 'https://replacement.example/v1'
  model.value = 'new'
  await save.onclick()
  clear.checked = true
  await save.onclick()
  address.value = ''
  model.value = ''
  await save.onclick()
  assert.deepEqual(calls, [
    ['save-model-selection', 'https://replacement.example/v1', 'new', 'keep'],
    ['save-model-selection', 'https://replacement.example/v1', 'new', 'clear'],
    ['save-model-selection', '', '', 'keep'],
  ])
  assert.equal(password.value, '')
})

test('model view displays the admin network gate without a self-approval checkbox', async () => {
  for (const locale of ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']) {
    const calls = []
    const settings = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false }
    const ctx = fakeContext(locale, async (name, input) => {
      if (name === 'get-model-selection') return settings
      calls.push(input)
      return { ...settings, error: { field: 'allowNonPublic', code: 'confirmation-required', message: 'server zh' } }
    }, { view: 'model' })
    const root = await mountPage(ctx)
    const [address, model, , clear, allow] = findAll(root, node => node.tag === 'input' && !node.readOnly && !['search', 'number'].includes(node.type))
    assert.equal(clear.type, 'checkbox')
    assert.equal(allow, undefined)
    const [save] = findAll(root, node => node.tag === 'button' && !node.className?.includes('deva-model-discover'))
    address.value = 'http://127.0.0.1:9/v1'
    model.value = 'local'
    await save.onclick()
    const [shown] = findAll(root, node => node.className === 'deva-field-error' && !node.hidden)
    assert.equal(address.value, 'http://127.0.0.1:9/v1')
    assert.equal(address.ariaInvalid, 'true')
    assert.notEqual(shown.textContent, 'server zh')
    if (locale === 'zh') assert.match(shown.textContent, /Studio 管理员批准/)
    assert.deepEqual(ctx.notices.at(-1), [shown.textContent, 'error'])
    assert.equal(calls.at(-1).allowNonPublic, undefined)
  }
})

test('model view selects an existing Desktop ref and updates the persona binding separately', async () => {
  const calls = []
  const original = {
    baseUrl: 'https://alpha.example/v1', modelName: 'a', modelRef: 'alpha:a', hasApiKey: false, legacyNeedsSetup: false,
    desktopModels: [{ ref: 'alpha:a', adapter: 'openai', baseUrl: 'https://alpha.example/v1', modelName: 'a' },
      { ref: 'beta:b', adapter: 'openai', baseUrl: 'https://beta.example/v1', modelName: 'b' }],
    personaModels: [{ id: 'qa', name: 'QA', model: 'beta:b' }],
  }
  const root = await mountPage(fakeContext('zh', async (name, input) => {
    calls.push([name, input])
    if (name === 'save-persona-model') return { ...original, personaModels: [{ id: 'qa', name: 'QA', model: input.modelRef }] }
    return original
  }, { view: 'model' }))
  let [choice, , binding] = findAll(root, node => node.tag === 'select' && node.size !== 5)
  assert.equal(choice.value, 'alpha:a')
  assert.equal(binding.value, 'beta:b')
  choice.value = 'beta:b'
  choice.onchange()
  const [save] = findAll(root, node => node.tag === 'button' && !node.className?.includes('deva-model-discover'))
  await save.onclick()
  assert.deepEqual(calls.findLast(([name]) => name === 'save-model-selection'), ['save-model-selection', { modelRef: 'beta:b', baseUrl: 'https://beta.example/v1', modelName: 'b', reasoningEffort: '' }])
  binding = findAll(root, node => node.tag === 'select' && node.size !== 5)[2]
  binding.value = ''
  await binding.onchange()
  assert.deepEqual(calls.at(-1), ['save-persona-model', { personaId: 'qa', modelRef: '' }])
})

test('model view loads, saves and reports the reasoning effort in each locale', async () => {
  for (const locale of ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']) {
    const calls = []
    const base = { baseUrl: 'https://api.example.com/v1', modelName: 'm', hasApiKey: false, legacyNeedsSetup: false }
    let persisted = { ...base, reasoningEffort: 'high' }
    const ctx = fakeContext(locale, async (name, input) => {
      if (name === 'get-model-selection') return persisted
      calls.push(input.reasoningEffort)
      if (input.reasoningEffort === 'low') return { ...base, reasoningEffort: 'high', error: { field: 'reasoningEffort', code: 'reasoning-effort-invalid', message: '模型强度不受支持' } }
      return persisted = { ...base, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) }
    }, { view: 'model' })
    const root = await mountPage(ctx)
    const [, effort] = findAll(root, node => node.tag === 'select' && node.size !== 5)
    const [save] = findAll(root, node => node.tag === 'button' && !node.className?.includes('deva-model-discover'))
    const texts = findAll(root, node => node.textContent).map(node => node.textContent)
    assert.ok(!texts.join(' ').includes('undefined'))
    assert.ok(effort.children[0].textContent, '默认项有本地化文案')
    if (locale === 'zh') assert.ok(texts.some(text => text === '模型强度') && effort.children[0].textContent === '默认（不发送）')
    assert.equal(effort.value, 'high')
    effort.value = 'medium'
    await save.onclick()
    assert.equal(effort.value, 'medium')
    effort.value = ''
    await save.onclick()
    assert.equal(effort.value, '')
    effort.value = 'low'
    await save.onclick()
    assert.equal(effort.ariaInvalid, 'true')
    assert.equal(effort.value, 'low', '被拒时保留用户正在编辑的值')
    assert.deepEqual(findAll(root, node => node.className === 'deva-field-error' && !node.hidden).map(node => node.textContent), ['模型强度不受支持'])
    assert.deepEqual(calls, ['medium', '', 'low'])
  }
})

test('model view shows an old catalog selection as inactive without populating the form', async () => {
  const ctx = fakeContext('zh', async name => {
    assert.equal(name, 'get-model-selection')
    return { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: true }
  }, { view: 'model' })
  const root = await mountPage(ctx)
  assert.ok(findAll(root, node => node.className === 'deva-status' && /旧版 Studio 目录模型已停用/.test(node.textContent)).length)
  assert.ok(findAll(root, node => node.tag === 'input' && !node.readOnly && !['search', 'number'].includes(node.type)).every(input => !input.value))
})

test('model settings show the shared file and per-app credential warning in each locale', async () => {
  for (const locale of ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']) {
    const get = async name => {
      assert.equal(name, 'get-model-selection')
      return { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false, desktopConfigPath: '/fixture/.deva/config.json', desktopConfigExists: true }
    }
    const root = await mountPage(fakeContext(locale, get, { view: 'model' }))
    const texts = findAll(root, node => node.textContent).map(node => node.textContent).join(' ')
    assert.match(texts, /\/fixture\/\.deva\/config\.json/)
    assert.ok(!texts.includes('undefined'))
    if (locale === 'en') assert.match(texts, /Desktop key read-only/)
  }
})

test('MCP parity: one catalog, real chips, fractions, switches and no selection controls', async () => {
  const names = [['ekko_studio_api_openapi_get', 'ekko_studio_api_request'], ['ekko_studio_browser_toolset'], ['ekko_studio_use_toolset'], []]
  const calls = []
  const root = await mountPage(fakeContext('zh', async (name, input) => {
    calls.push([name, input])
    if (name === 'set-mcp-server-enabled') return { ok: true }
    return { servers: names.map((tools, i) => server(`service-${i}`, { managed: true, tools: tools.map(name => ({ name, description: '' })), toolCount: tools.length })), selected: [] }
  }))
  assert.deepEqual(calls.map(x => x[0]), ['get-mcp-servers'])
  assert.equal(findAll(root, n => n.className === 'deva-grid').length, 1)
  assert.deepEqual(findAll(root, n => n.className === 'deva-summary')[0].children.map(n => n.children[1].textContent), ['4','4','4','4'])
  assert.deepEqual(findAll(root, n => n.className === 'deva-info-value').map(n => n.textContent), ['2/2 个工具','1/1 个工具','1/1 个工具','0/0 个工具'])
  assert.deepEqual(findAll(root, n => n.className === 'deva-tool').map(n => n.textContent), names.flat())
  assert.equal(findAll(root, n => /保存勾选|本 Agent 使用|已勾选|在 Studio 中打开/.test(n.textContent)).length, 0)
  assert.equal(findAll(root, n => n.textContent === 'Studio 管理').length, 5)
  assert.ok(findAll(root, n => n.textContent === '0 个工具').length)
  const switches = findAll(root, n => n.role === 'switch')
  assert.equal(switches.length, 4)
  assert.equal(switches[0]['aria-checked'], 'true')
  await switches[0].onclick()
  assert.deepEqual(calls[1], ['set-mcp-server-enabled', { name: 'service-0', enabled: false }])
  if (process.env.MCP_SNAPSHOT) {
    const { writeFileSync, readFileSync } = await import('node:fs')
    const escape = value => String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
    const html = n => `<${n.tag}${n.className ? ` class="${escape(n.className)}"` : ''}${n.role ? ` role="${n.role}"` : ''}${n.placeholder ? ` placeholder="${escape(n.placeholder)}"` : ''}${n.style.display ? ` style="display:${n.style.display}"` : ''}${n['aria-checked'] ? ` aria-checked="${n['aria-checked']}"` : ''}>${escape(n.textContent)}${n._html || ''}${n.children.map(html).join('')}</${n.tag}>`
    const source = readFileSync(new URL('../client.mjs', import.meta.url), 'utf8')
    const css = source.match(/const STYLES = `([\s\S]*?)`/)[1]
    writeFileSync(process.env.MCP_SNAPSHOT, '<!doctype html><meta charset="utf-8"><title>MCP parity fixture</title><style>:root{--bg-card:#282828;--bg-input:#282828;--text-primary:#ddd;--text-secondary:#aaa;--text-muted:#888;--border-color:#3c3c3c;--accent-primary:#ddd;--accent-primary-rgb:220,220,220;--success:#61bd65;--error:#ed7777}body{background:#191919;color:#ddd}</style><style>'+css+'</style>'+html(root))
  }
})

test('mcp view surfaces a failing host request as an error, not as "no servers"', async () => {
  const rpc = async (name) => {
    if (name === 'get-mcp-servers') throw new Error('Missing api.read permission')
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('en', rpc))
  const statuses = findAll(root, node => node.tag === 'div' && /Missing api\.read permission/.test(node.textContent))
  assert.equal(statuses.length, 1)
  const boxes = findAll(root, node => node.tag === 'input' && node.style.marginTop === '3px')
  assert.equal(boxes.length, 0, '失败时不能给出空白的服务勾选')
})

test('mcp view creates servers from the JSON config dialog and validates before calling Studio', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-mcp-servers') return { servers: [], selected: [] }
    if (name === 'create-mcp-server') return { ok: true, server: server(input.name) }
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('en', rpc))

  const add = findAll(root, node => node.tag === 'button' && node.textContent === 'Add Server')[0]
  add.onclick()
  // 新表单打开时不立刻读配置
  assert.equal(calls.filter(([name]) => name === 'get-mcp-server').length, 0)

  const areas = findAll(root, node => node.tag === 'textarea')
  assert.equal(areas.length, 1, '弹窗里只有一个 JSON/YAML 配置框')
  assert.equal(areas[0].rows, 16)

  // 非法 JSON：本地拦下，不发请求
  areas[0].value = '{ not json'
  let save = findAll(root, node => node.tag === 'button' && node.textContent === 'Save')[0]
  await save.onclick()
  assert.equal(calls.filter(([name]) => name === 'create-mcp-server').length, 0)
  assert.equal(findAll(root, node => node.textContent === 'Invalid JSON').length, 1)

  // 缺 command 与 url：也要拦下
  areas[0].value = JSON.stringify({ 'my.tools': { enabled: true } })
  save = findAll(root, node => node.tag === 'button' && node.textContent === 'Save')[0]
  await save.onclick()
  assert.equal(calls.filter(([name]) => name === 'create-mcp-server').length, 0)
  assert.equal(findAll(root, node => /Needs a non-empty command or url/.test(node.textContent)).length, 1)

  // 合法配置：原样提交 Studio 校验，保存后关弹窗并刷新清单
  areas[0].value = JSON.stringify({
    'my.tools': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'], env: { TOKEN: 'abc' }, enabled: true },
  })
  save = findAll(root, node => node.tag === 'button' && node.textContent === 'Save')[0]
  await save.onclick()

  assert.deepEqual(calls.find(([name]) => name === 'create-mcp-server'), ['create-mcp-server', {
    name: 'my.tools',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
      env: { TOKEN: 'abc' },
      enabled: true,
    },
  }])
  assert.equal(findAll(root, node => node.tag === 'textarea').length, 0, '保存成功后关闭弹窗')
  assert.equal(calls.at(-1)[0], 'get-mcp-servers', '保存后刷新清单')
})

test('mcp view edits an existing server through a JSON dialog that round-trips Studio config', async () => {
  const calls = []
  const config = { type: 'streamable_http', url: 'https://example.com/mcp', headers: { authorization: 'Bearer tk' }, enabled: true }
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-mcp-servers') return { servers: [server('remote', { transport: 'http' })], selected: [] }
    if (name === 'get-mcp-server') return { server: server('remote', { transport: 'http' }), config }
    if (name === 'update-mcp-server') return { ok: true, server: input.name }
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('en', rpc))

  const edit = findAll(root, node => node.tag === 'button' && node.textContent === 'Edit')[0]
  await edit.onclick()
  assert.deepEqual(calls.at(-1), ['get-mcp-server', { name: 'remote' }])

  const area = findAll(root, node => node.tag === 'textarea')[0]
  assert.deepEqual(JSON.parse(area.value), { remote: config }, '回填的是 Studio 规范化后的完整配置')

  // 改一下就提交：名字取弹窗里的键，编辑时以服务名对齐
  area.value = JSON.stringify({ remote: { ...config, url: 'https://example.com/mcp2' } })
  const save = findAll(root, node => node.tag === 'button' && node.textContent === 'Save')[0]
  await save.onclick()
  assert.deepEqual(calls.find(([name]) => name === 'update-mcp-server'), ['update-mcp-server', {
    name: 'remote',
    config: { ...config, url: 'https://example.com/mcp2' },
  }])
  assert.equal(calls.at(-1)[0], 'get-mcp-servers', '保存后刷新清单')
})

test('mcp view toggles, tests and deletes servers through Studio', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-mcp-servers') return { servers: [server('files')], selected: [] }
    if (name === 'set-mcp-server-enabled') return { ok: true, server: server('files', { enabled: input.enabled }) }
    if (name === 'test-mcp-server') return { ok: true, tools: [{ name: 'files__read', description: '' }] }
    if (name === 'delete-mcp-server') return { ok: true, name: input.name }
    throw new Error(`unexpected rpc ${name}`)
  }
  const ctx = fakeContext('en', rpc)
  const root = await mountPage(ctx)

  const test = findAll(root, node => node.tag === 'button' && node.textContent === 'Test')[0]
  await test.onclick()
  assert.deepEqual(calls.at(-1), ['test-mcp-server', { name: 'files' }])
  assert.match(ctx.notices.at(-1)[0], /Test succeeded — 1 tools available/)
  assert.equal(findAll(root, node => node.className === 'deva-tool' && node.textContent === 'files__read').length, 1, '测试拿到的工具渲染成标签')

  const disable = findAll(root, node => node.tag === 'button' && node.role === 'switch')[0]
  await disable.onclick()
  assert.ok(calls.some(([name, input]) => name === 'set-mcp-server-enabled' && input.enabled === false))
  assert.equal(calls.at(-1)[0], 'get-mcp-servers', '启停后刷新清单')

  const remove = findAll(root, node => node.tag === 'button' && node.textContent === 'Remove')[0]
  await remove.onclick()
  assert.match(ctx.confirmed.at(-1), /Delete MCP server “files” from Studio\?/)
  assert.ok(calls.some(([name, input]) => name === 'delete-mcp-server' && input.name === 'files'))
})

test('mcp view surfaces a failed test on the card and keeps it out of the tool list', async () => {
  const rpc = async (name) => {
    if (name === 'get-mcp-servers') return { servers: [server('broken')], selected: [] }
    if (name === 'test-mcp-server') throw new Error('spawn ENOENT')
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('en', rpc))
  const test = findAll(root, node => node.tag === 'button' && node.textContent === 'Test')[0]
  await test.onclick()

  assert.equal(findAll(root, node => node.className === 'deva-badge bad' && node.textContent === 'Disconnected').length, 1, '状态翻成未连接')
  assert.equal(findAll(root, node => node.className === 'deva-card-error' && /spawn ENOENT/.test(node.textContent)).length, 1, '失败原因显示在卡片里')
})

test('client styles use the host theme variables and keep a fallback', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../client.mjs', import.meta.url), 'utf8')
  // 宿主主题桥（app 的 Sh()）实际下发的名字；写错不会报错，只会静默走 fallback（深色主题下配色错乱）
  const hostVars = new Set([
    // Sh() 下发的固定清单
    '--text-primary', '--text-secondary', '--text-muted', '--bg-card', '--bg-secondary', '--bg-input',
    '--border-color', '--border-light', '--accent-primary', '--accent-primary-rgb',
    '--success', '--error', '--warning', '--radius-component', '--font-size-base',
    '--spacing-scale', '--line-height', '--letter-spacing', '--border-width', '--control-height',
    // Sh() 单独补的两项
    '--font-family', '--studio-color-scheme',
    // Sh() 按 card/input/overlay × bg/border/radius/shadow/filter 下发的主题项
    '--theme-card-bg', '--theme-card-border', '--theme-card-radius', '--theme-card-shadow', '--theme-card-filter',
    '--theme-input-bg', '--theme-input-border', '--theme-input-radius', '--theme-input-shadow', '--theme-input-filter',
    '--theme-overlay-bg', '--theme-overlay-border', '--theme-overlay-radius', '--theme-overlay-shadow', '--theme-overlay-filter',
  ])
  const used = [...source.matchAll(/var\((--[a-z0-9-]+)\s*,/g)].map(match => match[1])
  assert.ok(used.length > 0, '样式里确实用了主题变量')
  assert.deepEqual([...new Set(used)].filter(name => !hostVars.has(name)), [], '不存在宿主未提供的变量名')
})

test('mcp view offers a jump to Studio’s own MCP page only when navigation exists', async () => {
  const rpc = async (name) => {
    if (name === 'get-mcp-servers') return { servers: [], selected: [] }
    throw new Error(`unexpected rpc ${name}`)
  }
  const visited = []
  const withNav = await mountPage(fakeContext('en', rpc, { navigate: path => visited.push(path) }))
  const open = findAll(withNav, node => node.tag === 'button' && node.textContent === 'Open in Studio')[0]
  assert.equal(open, undefined, '原版页头没有额外跳转按钮')
  assert.deepEqual(visited, [])

  const withoutNav = await mountPage(fakeContext('en', rpc))
  assert.equal(findAll(withoutNav, node => node.tag === 'button' && /Open Studio/.test(node.textContent)).length, 0)
})

// 回归：用户 2026-11-25 的第二台设备上，桌面明明选了 cpa / cn:deepseek-v4.1-flash，
// 页面却显示「桌面端未选择默认模型 / 请联系 Studio 管理员授权访问桌面模型配置」，表单全空。
test('model view renders the real desktop custom provider instead of "no default selected"', async () => {
  for (const locale of ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']) {
    const settings = {
      baseUrl: 'http://127.0.0.1:7863/v1',
      modelName: 'cn:deepseek-v4.1-flash',
      modelRef: 'custom-1794383812625:cn:deepseek-v4.1-flash',
      providerId: 'custom-1794383812625',
      providerName: 'cpa',
      adapter: 'openai',
      hasApiKey: false,
      legacyNeedsSetup: false,
      desktopConfigPath: '/windows/.deva/config.json',
      desktopConfigExists: true,
      needsNetworkApproval: true,
      desktopModels: [{ ref: 'custom-1794383812625:cn:deepseek-v4.1-flash', adapter: 'openai', baseUrl: 'http://127.0.0.1:7863/v1', modelName: 'cn:deepseek-v4.1-flash', providerId: 'custom-1794383812625', providerName: 'cpa' }],
    }
    const root = await mountPage(fakeContext(locale, async name => {
      assert.equal(name, 'get-model-selection')
      return settings
    }, { view: 'model' }))

    const [choice] = findAll(root, node => node.tag === 'select')
    assert.equal(choice.value, 'custom-1794383812625:cn:deepseek-v4.1-flash', `${locale}: 下拉必须停在桌面真实选择上`)
    const [address] = findAll(root, node => node.tag === 'input' && node.type === 'url')
    const [model] = findAll(root, node => node.tag === 'input' && node.type === 'text' && !node.readOnly)
    assert.equal(address.value, 'http://127.0.0.1:7863/v1', `${locale}: 地址要回填`)
    assert.equal(model.value, 'cn:deepseek-v4.1-flash', `${locale}: 模型名要回填`)
    // 关键反向断言：状态行不能再出现“未选择默认模型”；空态占位项本身留在下拉里是正常的，
    // 但它必须没被选中。判定看「选中的值 + 状态行」，不看整棵树的文本。
    const [status] = findAll(root, node => node.className === 'deva-status' && node.textContent)
    assert.equal(status.textContent.includes('No Desktop default selected'), false, `${locale}: 状态行误报未选择`)
    assert.equal(status.textContent.includes('Desktop has no default model'), false, `${locale}: 状态行误报桌面无模型`)
    const texts = findAll(root, node => node.textContent).map(node => node.textContent).join(' ')
    assert.equal(texts.includes('{baseUrl}'), false, `${locale}: 占位符必须被填好`)
    assert.ok(texts.includes('http://127.0.0.1:7863/v1'), `${locale}: 批准提示要写清是哪个地址`)
    assert.ok(!texts.includes('undefined'), `${locale}: 标签漏配`)
  }
})

test('model view explains exactly what an unauthorized account must configure', async () => {
  const settings = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false, desktopAccessRequired: true, desktopOwnerUserId: 1, desktopConfigPath: '/srv/.deva/config.json' }
  const root = await mountPage(fakeContext('zh', async () => settings, { view: 'model' }))
  const texts = findAll(root, node => node.textContent).map(node => node.textContent).join(' ')
  assert.match(texts, /sharedDevaUserId/)
  assert.match(texts, /\/srv\/\.deva\/config\.json/)
  assert.equal(/请联系 Studio 管理员授权访问桌面模型配置/.test(texts), false, '模糊的“求授权”文案不能再出现')
  const [save] = findAll(root, node => node.tag === 'button' && node.textContent === '保存')
  assert.equal(save.disabled, true, '未授权时写入必须禁用（服务端也会拒绝）')
})

test('model view separates "desktop has no model" from "reference is broken"', async () => {
  const base = { baseUrl: '', modelName: '', hasApiKey: false, legacyNeedsSetup: false, desktopConfigPath: '/srv/.deva/config.json' }
  const emptyRoot = await mountPage(fakeContext('zh', async () => ({ ...base, desktopModels: [] }), { view: 'model' }))
  const emptyText = findAll(emptyRoot, node => node.textContent).map(node => node.textContent).join(' ')
  assert.match(emptyText, /桌面端还没有默认模型/)

  const brokenRoot = await mountPage(fakeContext('zh', async () => ({ ...base, desktopModels: [], unresolvedModelRef: 'ghost:g1' }), { view: 'model' }))
  const brokenText = findAll(brokenRoot, node => node.textContent).map(node => node.textContent).join(' ')
  assert.match(brokenText, /ghost:g1/)
  assert.equal(findAll(brokenRoot, node => node.tag === 'select')[0].value, 'ghost:g1')
  assert.equal(/桌面端还没有默认模型/.test(brokenText), false, '引用失效不能说成“没有选择”')
})

 test('read-only model mirror displays route while disabling writes', async () => {
  const root = await mountPage(fakeContext('zh', async () => ({ baseUrl: 'http://127.0.0.1:7863/v1', modelName: 'cn:m', modelRef: 'custom:cn:m', providerName: 'cpa', desktopWriteRequired: true, desktopWriteMessage: '只读模式 userId=2 sharedDevaUserId=1；修改后重新打开模型页', hasApiKey: false, legacyNeedsSetup: false }), { view: 'model' }))
  assert.equal(findAll(root, node => node.tag === 'select')[0].value, 'custom:cn:m')
  assert.equal(findAll(root, node => node.tag === 'button' && node.textContent === '保存')[0].disabled, true)
  assert.match(findAll(root, node => node.textContent).map(node => node.textContent).join(' '), /只读模式/)
})

test('authorized desktop model remains saveable while network approval is pending', async () => {
  const root = await mountPage(fakeContext('zh', async () => ({ baseUrl: 'http://127.0.0.1:7863/v1', modelName: 'cn:m', modelRef: 'custom:cn:m', providerName: 'cpa', desktopWriteRequired: false, needsNetworkApproval: true, hasApiKey: false, legacyNeedsSetup: false }), { view: 'model' }))
  assert.equal(findAll(root, node => node.tag === 'button' && node.textContent === '保存')[0].disabled, false)
  assert.match(findAll(root, node => node.textContent).map(node => node.textContent).join(' '), /modelTrustedBases/)
})

test('new provider cancel restores the desktop route without saving or exposing a key', async () => {
  let saves = 0
  const current = { baseUrl: 'https://example.com/v1', modelName: 'model', modelRef: 'p:model', hasApiKey: true, legacyNeedsSetup: false, desktopModels: [{ ref: 'p:model', baseUrl: 'https://example.com/v1', modelName: 'model' }] }
  const root = await mountPage(fakeContext('zh', async name => { if (name !== 'get-model-selection') saves++; return current }, { view: 'model' }))
  const choose = findAll(root, node => node.tag === 'select')[0]
  choose.value = '__deva_new_provider__'
  choose.onchange()
  const cancel = findAll(root, node => node.tag === 'button' && node.textContent === '取消')[0]
  assert.equal(cancel.hidden, false)
  assert.equal(findAll(root, node => node.type === 'password')[0].value, '')
  cancel.onclick()
  assert.equal(choose.value, 'p:model')
  assert.equal(cancel.hidden, true)
  assert.equal(saves, 0)
})

test('desktop discovery works without credentials and retains local choices on remote failure', async () => {
  const calls = []
  const settings = { baseUrl: 'https://example.com/v1', modelName: 'local', modelRef: 'p:local', hasApiKey: false,
    desktopDiagnostics: 'config.json: providers=1 models=1', desktopModels: [{ ref: 'p:local', modelName: 'local', baseUrl: 'https://example.com/v1' }] }
  const root = await mountPage(fakeContext('zh', async name => { calls.push(name); if (name === 'get-model-selection') return settings; throw Error('HTTP 401') }, { view: 'model' }))
  const fetch = findAll(root, n => n.tag === 'button' && n.textContent === '获取模型列表')[0]
  const remote = findAll(root, n => n.tag === 'button' && n.textContent === '刷新远端模型列表')[0]
  const select = findAll(root, n => n.tag === 'select' && n.size === 5)[0]
  assert.equal(fetch.disabled, false)
  await fetch.onclick()
  assert.equal(select.hidden, false)
  assert.equal(select.children[0].value, 'p:local')
  assert.ok(calls.includes('get-model-selection')); assert.ok(calls.includes('list-provider-models'))
  const card = findAll(root, n => n.tag === 'button' && n.textContent === 'local')[0]
  assert.ok(card, 'local model remains a visible ordinary button after remote failure')
  assert.equal(card.disabled, false)
  assert.equal(remote.disabled, true)
  const key = findAll(root, n => n.type === 'password')[0]
  key.value = 'fixture'; key.oninput()
  await fetch.onclick()
  key.value = 'fixture'; key.oninput()
  await remote.onclick()
  assert.equal(select.hidden, false)
  assert.equal(select.children[0].value, 'p:local')
  assert.ok(findAll(root, n => /获取失败.*401/.test(n.textContent)).length)
})

test('desktop fetch refreshes default dropdown after the desktop file changes', async () => {
  let id = 'old'
  const root = await mountPage(fakeContext('zh', async () => ({ baseUrl: 'https://example.com/v1', modelRef: `p:${id}`, modelName: id, hasApiKey: false,
    desktopModels: [{ ref: `p:${id}`, baseUrl: 'https://example.com/v1', modelName: id }] }), { view: 'model' }))
  id = 'new'
  await findAll(root, n => n.tag === 'button' && n.textContent === '获取模型列表')[0].onclick()
  assert.equal(findAll(root, n => n.tag === 'select')[0].value, 'p:new')
  assert.equal(findAll(root, n => n.tag === 'select' && n.size === 5)[0].children[0].value, 'p:new')
})

test('initial RPC failure leaves desktop fetch retry enabled with copyable redacted diagnostic', async () => {
  let fail = true
  const root = await mountPage(fakeContext('zh', async () => {
    if (fail) throw Object.assign(new Error('HTTP 403 permission denied token=private-value'), { status: 403, code: 'DENIED' })
    return { baseUrl: '', modelName: '', hasApiKey: false, desktopModels: [], desktopDiagnostics: JSON.stringify({ path: '/fixture/config.json', providerCount: 0, modelCount: 0 }) }
  }, { view: 'model' }))
  const fetch = findAll(root, n => n.tag === 'button' && n.textContent === '获取模型列表')[0]
  const diagnostic = findAll(root, n => n.readOnly === true)[0]
  assert.equal(fetch.disabled, false)
  assert.match(diagnostic.value, /403/)
  assert.ok(!diagnostic.value.includes('private-value'))
  fail = false
  await fetch.onclick()
  assert.equal(JSON.parse(diagnostic.value).phase, 'resolved')
  assert.equal(JSON.parse(diagnostic.value).providers, 0)
})

test('RPC timeout settles with visible code and unavailable HTTP status, without leaking a draft key', async () => {
  const { modelRpcDiagnostics } = await import('../client.mjs')
  const output = {}
  const call = modelRpcDiagnostics({ rpc: { call: () => new Promise(() => {}) } }, output, () => 'fixture-key', 10)
  await assert.rejects(call('get-model-selection'), /HTTP 未知.*RPC_TIMEOUT/)
  assert.equal(JSON.parse(output.value).phase, 'failed')
  const reject = modelRpcDiagnostics({ rpc: { call: () => { throw Error('HTTP 401 fixture-key') } } }, output, () => 'fixture-key')
  await assert.rejects(reject('get-model-selection'), /HTTP 401/)
  assert.ok(!output.value.includes('fixture-key'))
})

test('local candidates include other providers and disambiguate identical model ids', async () => {
  const rows = ['p', 'q'].map(id => ({ ref: `${id}:same`, providerName: id, modelName: 'same', baseUrl: `https://${id}.example/v1` }))
  const root = await mountPage(fakeContext('zh', async () => ({ baseUrl: rows[0].baseUrl, modelName: 'same', modelRef: rows[0].ref, hasApiKey: false, desktopModels: rows }), { view: 'model' }))
  const list = findAll(root, n => n.tag === 'select' && n.size === 5)[0]
  assert.deepEqual(list.children.map(n => n.value), ['p:same', 'q:same'])
  list.value = 'q:same'; list.onchange()
  assert.equal(findAll(root, n => n.tag === 'select')[0].value, 'q:same')
  assert.equal(findAll(root, n => n.type === 'url')[0].value, rows[1].baseUrl)
})

 test('host API Error status survives the RPC bridge', async () => {
  const { modelRpcDiagnostics } = await import('../client.mjs')
  const output = { value: '' }
  const call = modelRpcDiagnostics({ rpc: { call: async () => { throw Error('API Error 500: config read failed') } } }, output)
  await assert.rejects(call('get-model-selection'), /HTTP 500.*config read failed/)
  assert.match(output.value, /500/)
})

test('local candidates precede form fields and expanded JSON never pushes them down', async () => {
  const settings = { modelRef: 'p:m', baseUrl: 'https://example.com/v1', modelName: 'm', desktopModels: [{ ref: 'p:m', modelName: 'm', baseUrl: 'https://example.com/v1' }], desktopDiagnostics: JSON.stringify({ path: '/desktop/config.json', providerCount: 1, modelCount: 1 }), desktopProviders: [{ id: 'p', models: ['m'] }] }
  const root = await mountPage(fakeContext('zh', async () => settings, { view: 'model' }))
  const nodes = findAll(root, () => true)
  const choices = nodes.find(n => n.tag === 'select' && n.size === 5)
  assert.equal(choices.children.length, 1)
  assert.ok(nodes.indexOf(choices) < nodes.findIndex(n => n.type === 'url'))
  const details = nodes.find(n => n.tag === 'details' && findAll(n, child => child.tag === 'pre' && child.textContent.includes('"providers"')).length)
  assert.ok(details && !details.open)
  assert.ok(findAll(details, n => n.tag === 'pre')[0].textContent.includes('"providers"'))
  assert.ok(!nodes.find(n => n.role === 'status').textContent.includes('providerCount'))
})

test('model form has one label per field and failed reads offer retry in the existing form', async () => {
  let failed = true
  const ctx = fakeContext('zh', async () => {
    if (failed) throw new Error('HTTP 503 模拟读取失败')
    return { desktopModels: [{ ref: 'p:m', modelName: 'm' }], modelRef: 'p:m', modelName: 'm' }
  }, { view: 'model' })
  const root = await mountPage(ctx)
  for (const label of ['API 地址（Base URL）', '模型名', 'API Key']) {
    assert.equal(findAll(root, n => n.textContent === label && ['label', 'h3'].includes(n.tag)).length, 1)
  }
  assert.ok(findAll(root, n => n.textContent.includes('503')).length)
  const retry = findAll(root, n => n.tag === 'button' && n.textContent === '重试读取')[0]
  assert.ok(retry)
  failed = false
  await retry.onclick()
  assert.equal(findAll(root, n => n.tag === 'select' && n.size === 5).length, 1)
  assert.equal(findAll(root, n => n.tag === 'select' && n.size === 5)[0].children.length, 1)
})


test('skills page renders sources, missing path, content and visible errors with retry', async () => {
  let fail = false
  const root = await mountPage(fakeContext('zh', async (name) => {
    if (name === 'get-skills') { if (fail) throw new Error('HTTP 401 unauthorized'); return { skills: [{ name: 'demo', source: 'builtin', enabled: true, description: 'Demo' }], warnings: [] } }
    if (name === 'get-skill') return { name: 'demo', content: 'Skill body' }
    if (name === 'get-skill-directories') return { directories: [], devaDirectory: '/configured/skills' }
    throw new Error(name)
  }, { view: 'skills' }))
  assert.ok(findAll(root, n => n.textContent.includes('未提供路径')).length)
  assert.ok(findAll(root, n => n.textContent === '内置').length)
  await findAll(root, n => n.textContent === '查看正文')[0].onclick()
  assert.ok(findAll(root, n => n.textContent === 'Skill body').length)
  fail = true
  await findAll(root, n => n.textContent === '刷新 / 重试')[0].onclick()
  assert.ok(findAll(root, n => n.textContent.includes('HTTP 401')).length)
})

test('all twelve Skill locales have every key and render without English fallback', async () => {
  const { skillLabels } = await import('../client.mjs')
  const locales = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar', 'tr']
  const keys = Object.keys(skillLabels.en).sort()
  assert.equal(Object.keys(skillLabels).length, 12)
  for (const locale of locales) {
    const copy = skillLabels[locale.toLowerCase()]
    assert.deepEqual(Object.keys(copy).sort(), keys, locale)
    for (const key of keys) {
      assert.equal(typeof copy[key], 'string', `${locale}.${key}`)
      assert.ok(copy[key].trim(), `${locale}.${key}`)
      if (locale !== 'en') assert.notEqual(copy[key], skillLabels.en[key], `${locale}.${key} must be translated`)
    }
    const root = await mountPage(fakeContext(locale, async name => name === 'get-skills' ? { skills: [], warnings: [] } : { directories: [], warnings: [], devaDirectory: '/test/skills' }, { view: 'skills' }))
    assert.ok(findAll(root, n => n.textContent === copy.title).length, locale)
    assert.ok(findAll(root, n => n.textContent === copy.empty).length, locale)
    assert.ok(findAll(root, n => n.textContent === copy.retry).length, locale)
  }
})

test('Skill page displays real external sourcePath and actual warnings', async () => {
  const root = await mountPage(fakeContext('zh', async name => name === 'get-skills'
    ? { skills: [{ name: 'proof', source: 'external', sourcePath: '/workspace/proof', warnings: ['actual warning'], enabled: false }], warnings: [] }
    : { directories: ['/missing'], warnings: ['/missing: exists=false, isDir=false'], devaDirectory: '/missing' }, { view: 'skills' }))
  assert.ok(findAll(root, n => n.textContent === '外部目录 · /workspace/proof').length)
  assert.ok(findAll(root, n => n.textContent === '警告: actual warning').length)
  assert.ok(findAll(root, n => n.textContent.includes('exists=false, isDir=false')).length)
})

test('model page shows the key source status only, never a value, and separates the three failure kinds', async () => {
  const base = {
    baseUrl: 'https://example.com/v1', modelName: 'm', modelRef: 'p:m', providerName: 'p', legacyNeedsSetup: false,
    desktopModels: [{ ref: 'p:m', baseUrl: 'https://example.com/v1', modelName: 'm', providerId: 'p' }],
    desktopConfigPath: '/fixture/.deva/config.json', desktopConfigExists: true,
  }
  // ① 桌面来源：显示「已设置（桌面端 Secrets，只读）」，且正文里不出现任何密钥值。
  const desktopKey = 'desktop-secret-value-should-never-render'
  const root = await mountPage(fakeContext('zh', async () => ({ ...base, hasApiKey: true, keySource: 'desktop', keySourceReadOnly: true }), { view: 'model' }))
  const key = findAll(root, node => node.type === 'password')[0]
  // 输入框占位只给短状态；完整来源在状态行（两处都不含值）。
  assert.equal(key.placeholder, '已设置')
  assert.match(findAll(root, node => node.className === 'deva-status')[0].textContent, /已设置（桌面端 Secrets，只读）/)
  const texts = findAll(root, node => node.textContent).map(node => node.textContent).join(' ')
  assert.equal(texts.includes(desktopKey), false)
  // ② 插件来源：文案不同。
  const pluginRoot = await mountPage(fakeContext('zh', async () => ({ ...base, hasApiKey: true, keySource: 'plugin' }), { view: 'model' }))
  assert.match(findAll(pluginRoot, node => node.className === 'deva-status')[0].textContent, /已设置（插件）/)
  // ③ 三种「没有 Key」的原因各说一件不同的事，不是同一句「未设置」。
  const kinds = [
    [{ hasApiKey: false, keyProblem: '插件侧和桌面端都没有 providerId=p 的密钥；桌面 secrets.json 已读取但没有这一条（C:\\Users\\x\\.deva\\secrets.json，条目=2）。' }, /都没有 providerId=p 的密钥/],
    [{ hasApiKey: false, keyProblem: '插件侧保存的凭据记录已损坏（Profile studio-web-1）；请在下方重新填写一次 API Key 覆盖。' }, /凭据记录已损坏/],
    [{ hasApiKey: false, keyProblem: '桌面端已保存 providerId=p 的密钥，但本次无法解密（dpapi-failed）。' }, /无法解密/],
  ]
  for (const [extra, pattern] of kinds) {
    const page = await mountPage(fakeContext('zh', async () => ({ ...base, legacyNeedsSetup: false, ...extra }), { view: 'model' }))
    const body = findAll(page, node => node.textContent).map(node => node.textContent).join(' ')
    assert.match(body, pattern)
  }
})

test('model page warns that a successful /models fetch does not prove chat works', async () => {
  const current = { baseUrl: 'https://example.com/v1', modelName: 'manual', modelRef: 'p:manual', hasApiKey: false, legacyNeedsSetup: false }
  const page = await mountPage(fakeContext('zh', async name => {
    if (name === 'get-model-selection') return current
    return { models: [{ id: 'm1' }], authProbe: { sentAuthorization: false, chatAuthorized: 'absent', reason: '无 Key' } }
  }, { view: 'model' }))
  const fetch = findAll(page, node => node.tag === 'button' && node.textContent === '刷新远端模型列表')[0]
  await fetch.onclick()
  const texts = findAll(page, node => node.textContent).map(node => node.textContent).join('\n')
  assert.match(texts, /列表成功只说明该地址允许匿名读取模型清单，不能证明对话可用/)
  assert.equal(/不需要\s*Key|无需鉴权/.test(texts), false)
  const rejected = await mountPage(fakeContext('zh', async name => {
    if (name === 'get-model-selection') return current
    return { models: [{ id: 'm1' }], authProbe: { sentAuthorization: true, chatAuthorized: 'unauthorized', chatHttp: 401, reason: '拒绝' } }
  }, { view: 'model' }))
  const fetch2 = findAll(rejected, node => node.tag === 'button' && node.textContent === '刷新远端模型列表')[0]
  await fetch2.onclick()
  assert.match(findAll(rejected, node => node.textContent).map(node => node.textContent).join('\n'), /同一凭据在对话端点被上游拒绝/)
})

test('model page no longer exposes the temporary keychain diagnostics entry', async () => {
  const ctx = fakeContext('zh', async () => ({ baseUrl: 'https://example.com/v1', modelName: 'm', hasApiKey: true, keySource: 'desktop', keySourceReadOnly: true }), { view: 'model' })
  const root = await mountPage(ctx)
  assert.equal(findAll(root, node => node.textContent === '钥匙串诊断').length, 0)
  assert.equal(findAll(root, node => node.textContent === 'Keychain diagnostics').length, 0)
})

test('memory page shows empty state and preserves draft on failed save', async () => {
  const root = await mountPage(fakeContext('zh', async (name, input) => {
    assert.equal(name, 'memory-page')
    if (input.action === 'save') throw new Error('MEMORY_CORRUPT')
    return { entries: [], legacyNotice: 'retained' }
  }, { view: 'memory' }))
  assert.ok(findAll(root, n => n.textContent === '暂无记忆').length)
  findAll(root, n => n.textContent === '新增')[0].onclick()
  const title = findAll(root, n => n.tag === 'input')[0]; title.value = 'draft'
  await findAll(root, n => n.textContent === '保存')[0].onclick()
  assert.equal(title.value, 'draft')
  assert.ok(findAll(root, n => n.textContent === 'MEMORY_CORRUPT').length)
})

test('memory page lists three scopes together with one RPC and keeps scope in the editor', async () => {
  const entries = ['global', 'role', 'project'].map((scope, index) => ({ id: `entry-${index}`, scope, scopeLabel: ['全局', '角色:deva', '项目:/workspace'][index], title: scope, body: 'content', type: 'user' }))
  const calls = []
  const root = await mountPage(fakeContext('zh', async (name, input) => {
    calls.push([name, input])
    return { entries, scopes: entries.map(e => ({ scope: e.scope, label: e.scopeLabel })) }
  }, { view: 'memory' }))
  assert.deepEqual(calls, [['memory-page', { action: 'list' }]])
  const lists = findAll(root, n => n.role === 'list')
  assert.equal(lists.length, 1)
  assert.equal(findAll(lists[0], n => n.role === 'listitem').length, 3)
  assert.deepEqual(findAll(root, n => n.className === 'deva-memory-scope').map(n => n.textContent), entries.map(e => e.scopeLabel))
  assert.equal(findAll(root, n => n.role === 'tab' || n.className === 'deva-toolbar').length, 0)
  const scope = findAll(root, n => n['aria-label'] === '作用域')[0]
  assert.equal(scope.parent.parent.className, 'deva-memory-form')
  findAll(root, n => n.textContent === '编辑')[1].onclick()
  assert.equal(scope.value, 'role'); assert.equal(scope.disabled, true)
  await findAll(root, n => n.textContent === '保存')[0].onclick()
  assert.equal(calls[1][1].scope, 'role'); assert.equal(calls[1][1].id, 'entry-1')
  assert.deepEqual(calls[2], ['memory-page', { action: 'list' }])
  assert.equal(findAll(root, n => n.role === 'listitem').length, 3, 'refresh replaces rows rather than duplicating them')
})

test('memory editor retains scope and draft on failure; delete confirmation preserves original routing', async () => {
  const calls = [], entry = { id: 'p_same', scope: 'project', scopeLabel: '项目:/work', title: 'project', body: 'body' }
  const ctx = fakeContext('zh', async (name, input) => {
    calls.push(input)
    if (input.action === 'save') throw new Error('MEMORY_CORRUPT')
    return { entries: [entry] }
  }, { view: 'memory' })
  const root = await mountPage(ctx)
  findAll(root, n => n.textContent === '编辑')[0].onclick()
  const title = findAll(root, n => n.tag === 'input')[0]
  title.value = 'unsaved draft'
  await findAll(root, n => n.textContent === '保存')[0].onclick()
  assert.equal(title.value, 'unsaved draft')
  const scope = findAll(root, n => n['aria-label'] === '作用域')[0]
  assert.equal(scope.value, 'project'); assert.equal(scope.disabled, true)
  assert.equal(findAll(root, n => n.className === 'deva-memory-form')[0].hidden, false)
  const remove = findAll(root, n => n.textContent === '删除')[0]
  ctx.ui.confirm = async () => false
  await remove.onclick()
  assert.equal(calls.filter(c => c.action === 'delete').length, 0)
  ctx.ui.confirm = async () => true
  await remove.onclick()
  assert.deepEqual(calls.find(c => c.action === 'delete'), { action: 'delete', scope: 'project', id: entry.id })
})

test('memory load errors are visible, loading is observable and styles inherit both host themes', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  globalThis.document = { createElement: tag => new StubElement(tag) }
  const root = new StubElement('div')
  const { mount } = await import('../client.mjs')
  const mounting = mount(root, fakeContext('zh', async () => { await pending; throw new Error('MEMORY_CORRUPT') }, { view: 'memory' }))
  assert.ok(findAll(root, n => n.textContent === '加载中…').length)
  release(); await mounting
  assert.ok(findAll(root, n => n.role === 'alert' && n.textContent === 'MEMORY_CORRUPT').length)
  assert.equal(findAll(root, n => n.role === 'listitem').length, 0)
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../client.mjs', import.meta.url), 'utf8')
  const css = source.match(/\.deva-memory-page[^]*?(?=\n@media)/)[0]
  for (const token of ['--text-primary', '--text-secondary', '--text-muted', '--border-color', '--border-light']) assert.ok(css.includes(`var(${token}`), token)
  assert.match(css, /gap:0/)
  assert.match(css, /font-size:14px/)
  assert.match(css, /padding:14px 0/)
  assert.doesNotMatch(css, /box-shadow|#[0-9a-f]{6}(?!\))/i)
})

test('MCP page requests once and renders one merged editable catalog', async () => {
  const calls = []
  const root = await mountPage(fakeContext('zh', async name => {
    calls.push(name)
    return { servers: [server('same'), server('desktop-only')], selected: [] }
  }, { view: 'mcp' }))
  assert.deepEqual(calls, ['get-mcp-servers'])
  assert.equal(findAll(root, n => n.tag === 'h3' && n.textContent === 'same').length, 1)
  assert.equal(findAll(root, n => String(n.textContent).includes('由桌面端管理')).length, 0)
  assert.equal(findAll(root, n => n.className === 'deva-grid').length, 1)
  assert.equal(findAll(root, n => n.tag === 'h3' && n.textContent === 'desktop-only').length, 1)
  assert.equal(findAll(root, n => String(n.textContent).includes('Studio 同名优先')).length, 0)
})

test('all declared settings pages keep headings and render theme/state evidence', async () => {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(manifest.views.map(v => v.id), ['identity','mcp','skills','model','memory'])
  const css = readFileSync(new URL('../client.mjs', import.meta.url), 'utf8').match(/const STYLES = `([^]*?)`/)[1]
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
  const html = n => `<${n.tag}${n.className ? ` class="${escape(n.className)}"` : ''}${n.hidden ? ' hidden' : ''}${n.disabled ? ' disabled' : ''}${n.role ? ` role="${n.role}"` : ''}${n['aria-checked'] ? ` aria-checked="${n['aria-checked']}"` : ''}${n.style.display ? ` style="display:${n.style.display}"` : ''}>${escape(n.textContent)}${n._html || ''}${n.children.map(html).join('')}</${n.tag}>`
  const evidence = []
  for (const { id: view } of manifest.views) for (const state of ['populated','empty','error']) {
    const populated = state === 'populated'
    const calls=[]
    const root = await mountPage(fakeContext('zh', async (name) => {
      calls.push(name)
      if (state === 'error') throw new Error('FIXTURE_READ_FAILED')
      if (name === 'get-identities') return {identities:populated?[{id:'deva',name:'Deva',description:'身份说明'}]:[],selected:populated?'deva':'',filePath:'/fixture/config.json',personasDir:'/fixture/personas'}
      if (name === 'get-mcp-servers') return {servers:populated?[server('example',{tools:[{name:'example_tool',description:''}],toolCount:1})]:[],selected:[]}
      if (name === 'get-skills') return {skills:populated?[{name:'demo',source:'builtin',description:'示例技能',enabled:true,readOnly:true}]:[],warnings:[]}
      if (name === 'get-skill-directories') return {directories:[],devaDirectory:'/fixture/skills'}
      if (name === 'get-model-selection') return {baseUrl:populated?'https://example.com/v1':'',modelName:populated?'example':'',hasApiKey:false,desktopModels:[]}
      if (name === 'memory-page') return {entries:populated?[{id:'one',title:'示例记忆',body:'正文',type:'user'}]:[]}
      throw new Error(`Unexpected ${name}`)
    }, {view}))
    assert.ok(findAll(root,n=>n.tag==='h2' && n.textContent).length, `${view}/${state} has heading`)
    if(view==='skills' && populated){const toggle=findAll(root,n=>n.role==='switch')[0];assert.equal(toggle.disabled,true,'readonly permission remains')}
    if (process.env.SETTINGS_SNAPSHOTS) {
      mkdirSync(process.env.SETTINGS_SNAPSHOTS,{recursive:true})
      for(const theme of ['light','dark']){
        const palette=theme==='dark'?'--bg-card:#282828;--bg-input:#282828;--text-primary:#ddd;--text-secondary:#aaa;--text-muted:#999;--border-color:#444;--accent-primary:#ddd;--accent-primary-rgb:220,220,220;--success:#61bd65;--error:#ef7777;background:#191919;color:#ddd':'--bg-card:#fff;--bg-input:#fff;--text-primary:#222;--text-secondary:#555;--text-muted:#777;--border-color:#ddd;--accent-primary:#333;--accent-primary-rgb:51,51,51;--success:#2e7d32;--error:#c62828;background:#fafafa;color:#222'
        writeFileSync(join(process.env.SETTINGS_SNAPSHOTS,`${view}-${state}-${theme}.html`),'<!doctype html><meta charset="utf-8"><style>:root{'+palette+'}body{margin:0}</style><style>'+css+'</style>'+html(root))
      }
    }
    evidence.push({view,state,calls,headings:findAll(root,n=>n.tag==='h2').map(n=>n.textContent)})
  }
  if(process.env.SETTINGS_SNAPSHOTS)writeFileSync(join(process.env.SETTINGS_SNAPSHOTS,'render-evidence.json'),JSON.stringify(evidence,null,2))
})
