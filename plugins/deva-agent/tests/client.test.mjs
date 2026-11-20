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
  append(...nodes) { this.children.push(...nodes) }
  appendChild(node) { this.children.push(node) }
}

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

function fakeContext(locale, rpc, { view = 'mcp', navigate } = {}) {
  const notices = []
  const confirmed = []
  return {
    locale,
    notices,
    confirmed,
    view,
    slot: 'agent-settings',
    rpc: { call: rpc },
    ui: {
      notify(message, level) { notices.push([message, level]) },
      async confirm(message) { confirmed.push(message); return true },
      ...(navigate ? { navigate } : {}),
    },
  }
}

const server = (name, extra = {}) => ({ name, transport: 'stdio', managed: false, enabled: true, ...extra })

async function mountPage(ctx) {
  globalThis.document = { createElement: tag => new StubElement(tag) }
  const root = new StubElement('div')
  const { mount } = await import('../client.mjs')
  await mount(root, ctx)
  return root
}

test('identity view renders only the identity picker and saves the choice', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-identities') return { identities: [{ id: 'deva', name: 'Deva' }, { id: 'xiaomajiang', name: '小码酱' }], selected: 'deva' }
    if (name === 'save-selection') return { ok: true, selected: input.identity }
    throw new Error(`unexpected rpc ${name}`)
  }
  const ctx = fakeContext('zh', rpc, { view: 'identity' })
  const root = await mountPage(ctx)

  assert.deepEqual(calls.map(([name]) => name), ['get-identities'])
  assert.equal(findAll(root, node => node.tag === 'select').length, 1)
  assert.equal(findAll(root, node => node.tag === 'input').length, 0, '身份页不渲染 MCP 勾选')

  const select = findAll(root, node => node.tag === 'select')[0]
  assert.deepEqual(select.children.map(option => [option.tag, option.value, option.textContent]), [
    ['option', 'deva', 'Deva'],
    ['option', 'xiaomajiang', '小码酱'],
  ], '选项按 DOM 构造，身份名不当作 HTML')
  select.value = 'xiaomajiang'
  const save = findAll(root, node => node.tag === 'button' && node.textContent === '保存')[0]
  await save.onclick()
  assert.deepEqual(calls.at(-1), ['save-selection', { identity: 'xiaomajiang' }])
  assert.equal(ctx.notices.at(-1)[1], 'success')
})

test('mcp view lists Studio servers, summarizes them, and saves the checked names', async () => {
  const calls = []
  const rpc = async (name, input) => {
    calls.push([name, input])
    if (name === 'get-mcp-servers') {
      return { servers: [server('files'), server('ekko-studio-api', { managed: true }), server('off', { enabled: false })], selected: [] }
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
    ['Studio 管理', '1'],
    ['工具', '0'],
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
  assert.deepEqual(calls.at(-1), ['save-mcp-selection', { servers: ['files', 'ekko-studio-api'] }])
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
