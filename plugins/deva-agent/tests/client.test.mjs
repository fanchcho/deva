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
  set innerHTML(value) {
    this._html = String(value)
    if (this._html === '') this.children = []
  }
  get innerHTML() { return this._html }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node) } }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this) }
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
  const fetch = findAll(root, n => n.tag === 'button' && n.textContent === '获取模型列表')[0]
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
  const [address, model, password, clear] = findAll(root, node => node.tag === 'input' && !['search', 'number'].includes(node.type))
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
    const [address, model, , clear, allow] = findAll(root, node => node.tag === 'input' && !['search', 'number'].includes(node.type))
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
  assert.ok(findAll(root, node => node.tag === 'input' && !['search', 'number'].includes(node.type)).every(input => !input.value))
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
    if (locale === 'en') assert.match(texts, /Set API keys separately in each app/)
  }
})

test('mcp view lists Studio servers, summarizes them, and saves the checked names', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-mcp-servers') {
      return { servers: [server('files', { toolCount: 2 }), server('ekko-studio-api', { managed: true, toolCount: 3 }), server('off', { enabled: false, toolCount: 0 })], selected: calls.findLast(([method]) => method === 'save-mcp-selection')?.[1].servers || [] }
    }
    if (name === 'save-mcp-selection') return { ok: true, selected: input.servers }
    throw new Error(`unexpected rpc ${name}`)
  }
  const ctx = fakeContext('zh', rpc)
  const root = await mountPage(ctx)

  assert.deepEqual(calls.map(([name]) => name), ['get-mcp-servers'], 'MCP 页不读身份目录')

  // 顶部四张汇总卡：总计 / 已启用 / Studio 管理 / 工具
  const summary = findAll(root, node => node.className === 'deva-summary')[0]
  assert.deepEqual(summary.children.map(card => [card.children[0].textContent, card.children[1].textContent]), [
    ['总计', '3'],
    ['已启用', '2'],
    ['已禁用', '1'],
    ['工具', '5'],
  ], '汇总卡与 Studio 原生页一致，固定四张')

  const boxes = findAll(root, node => node.tag === 'input' && node.type === 'checkbox')
  assert.equal(boxes.length, 3, '每张服务卡片一个「本 Agent 使用」勾选')
  assert.deepEqual(boxes.map(box => box.checked), [false, false, false])

  boxes[0].checked = true
  boxes[0].onchange()
  boxes[1].checked = true
  boxes[1].onchange()
  const counter = findAll(root, node => node.className === 'deva-muted' && /已勾选/.test(node.textContent))[0]
  assert.equal(counter.textContent, '已勾选 2 个服务', '勾选计数在工具栏里立刻更新')

  const save = findAll(root, node => node.tag === 'button' && node.textContent === '保存勾选')[0]
  assert.ok(save, 'MCP 页必须有保存勾选按钮')
  await save.onclick()
  assert.deepEqual(calls.at(-2), ['save-mcp-selection', { servers: ['files', 'ekko-studio-api'] }])
  assert.equal(calls.at(-1)[0], 'get-mcp-servers')
  assert.match(ctx.notices.at(-1)[0], /已勾选 2 个 MCP 服务/)
  assert.equal(ctx.notices.at(-1)[1], 'success')
})

test('mcp view shows Studio servers that disappeared from the selection instead of hiding them', async () => {
  const rpc = async (name) => {
    if (name === 'get-mcp-servers') return { servers: [server('files')], selected: ['files', 'gone'] }
    throw new Error(`unexpected rpc ${name}`)
  }
  const root = await mountPage(fakeContext('en', rpc))
  const statuses = findAll(root, node => node.tag === 'div' && /Missing from Studio/.test(node.textContent))
  assert.equal(statuses.length, 1)
  assert.match(statuses[0].textContent, /gone/)
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

  const add = findAll(root, node => node.tag === 'button' && node.textContent === '+ Add Server')[0]
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

  const disable = findAll(root, node => node.tag === 'button' && node.textContent === 'Disable')[0]
  await disable.onclick()
  assert.ok(calls.some(([name, input]) => name === 'set-mcp-server-enabled' && input.enabled === false))
  assert.equal(calls.at(-1)[0], 'get-mcp-servers', '启停后刷新清单')

  const remove = findAll(root, node => node.tag === 'button' && node.textContent === 'Delete')[0]
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
  assert.ok(open, '有 navigate 时给出原生页面入口')
  open.onclick()
  assert.deepEqual(visited, ['/ekko/mcp'])

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
    const [address, model] = findAll(root, node => node.tag === 'input')
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
  const [save] = findAll(root, node => node.tag === 'button')
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
