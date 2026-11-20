import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeBrowser, BROWSER_TOOL } from '../lib/browser.mjs'

/**
 * 假桌面浏览器：实现 host.browser 的 tabs/cdp 形状，cdp.send 按方法名回放结果。
 * 页面脚本（SNAPSHOT_FN / ACT_FN 等）不真正执行，由 handler 按 expression 里的关键字模拟。
 */
function fakeHost({ tabs = [{ id: 'p1', title: '示例', url: 'https://example.test', loading: false }], activeTabId = 'p1', tabsError = null } = {}) {
  const calls = []
  const host = {
    browser: {
      tabs: {
        list: async () => {
          if (tabsError) throw new Error(tabsError)
          return { activeTabId, maxTabs: 5, tabs: tabs.map(tab => ({ ...tab })) }
        },
        create: async url => {
          const tab = { id: `p${tabs.length + 1}`, title: url, url, loading: false }
          tabs.push(tab)
          calls.push(['tabs.create', url])
          return { ...tab }
        },
        close: async id => {
          const index = tabs.findIndex(tab => tab.id === id)
          if (index >= 0) tabs.splice(index, 1)
          calls.push(['tabs.close', id])
          return { activeTabId: tabs[0]?.id ?? null, maxTabs: 5, tabs: tabs.map(tab => ({ ...tab })) }
        },
      },
      cdp: {
        attach: async id => { calls.push(['attach', id]); return { cursor: 0, sessions: [] } },
        release: async id => { calls.push(['release', id]); return { ok: true } },
        events: async () => ({ cursor: 0, oldestCursor: 0, dropped: false, events: [] }),
        send: async (id, method, params) => {
          calls.push([method, params])
          if (method === 'Runtime.evaluate') {
            const expression = String(params.expression)
            if (expression.includes('(payload)')) {
              if (expression.includes('"action":"select"')) return { result: { value: { ok: false, reason: 'missing' } } }
              return { result: { value: { ok: true } } }
            }
            if (expression.includes('__devaRefs')) return { result: { value: { url: 'https://example.test', title: '示例', text: '[e1] button "提交"\n[e2] input "邮箱"' } } }
            if (expression.includes('body.includes(text)')) return { result: { value: { ready: true, text: '' } } }
            if (expression.includes('location.href')) return { result: { value: 'https://example.test/ok' } }
            if (expression.includes('history.')) return { result: { value: true } }
            if (expression.includes('window.scrollBy')) return { result: { value: true } }
            return { result: { value: { echo: expression.slice(0, 40) } } }
          }
          if (method === 'Page.navigate') return { frameId: 'f1' }
          if (method === 'Page.reload') return {}
          if (method === 'Page.captureScreenshot') return { data: Buffer.from('png').toString('base64') }
          if (method === 'Input.dispatchKeyEvent') return {}
          throw new Error(`unexpected ${method}`)
        },
      },
    },
  }
  return { host, calls }
}

test('browser fails loudly when the host has no desktop browser channel', async () => {
  await assert.rejects(executeBrowser({ action: 'snapshot' }, {}), /没有可用的桌面浏览器通道/)
  await assert.rejects(executeBrowser({ action: 'snapshot' }, { host: { browser: null } }), /没有可用的桌面浏览器通道/)
})

test('browser opens a url, takes a snapshot, and releases the tab lease', async () => {
  const { host, calls } = fakeHost()
  const opened = await executeBrowser({ action: 'open', url: 'example.test' }, { host })
  assert.match(opened, /已在标签 p1 打开 https:\/\/example\.test/)
  assert.match(opened, /\[e1\] button "提交"/)
  assert.deepEqual(calls[0], ['attach', 'p1'])
  assert.ok(calls.some(([method]) => method === 'Page.navigate'))
  assert.deepEqual(calls.at(-1), ['release', 'p1'])

  const snapshot = await executeBrowser({ action: 'snapshot' }, { host })
  assert.match(snapshot, /^URL: https:\/\/example\.test/)
  assert.match(snapshot, /标题: 示例/)
})

test('browser clicks, types, presses known keys, and reports expired refs', async () => {
  const { host } = fakeHost()
  assert.match(await executeBrowser({ action: 'click', ref: 'e1' }, { host }), /已点击 e1/)
  assert.match(await executeBrowser({ action: 'type', ref: 'e2', text: 'a@b.c', submit: true }, { host }), /已在 e2 输入并提交/)
  assert.match(await executeBrowser({ action: 'press', key: 'Enter' }, { host }), /已按键 Enter/)
  await assert.rejects(executeBrowser({ action: 'press', key: 'F13' }, { host }), /不支持的按键/)
  await assert.rejects(executeBrowser({ action: 'select', ref: 'e9', values: ['x'] }, { host }), /已失效/)
  await assert.rejects(executeBrowser({ action: 'evaluate' }, { host }), /script 不能为空/)
})

test('browser manages tabs and screenshots into the runtime directory', async () => {
  const { host, calls } = fakeHost({ tabs: [] })
  let created = null
  assert.match(await executeBrowser({ action: 'tabs' }, { host }), /当前没有打开的标签页/)
  // 没有标签时 open 会新建一个
  const { mkdtemp, rm, stat } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'deva-browser-'))
  try {
    await executeBrowser({ action: 'open', url: 'https://example.test' }, { host, runtimeDir: dir })
    const result = await executeBrowser({ action: 'screenshot', full_page: true }, { host, runtimeDir: dir })
    const path = result.split('：').at(-1)
    assert.match(path, /browser-\d+\.png$/)
    assert.ok((await stat(path)).size > 0)
    assert.ok(calls.some(([method]) => method === 'tabs.create'))
    created = path
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  assert.ok(created)
  await executeBrowser({ action: 'close_tab', tab: 'p1' }, { host })
  await assert.rejects(executeBrowser({ action: 'click', ref: 'e1', tab: 'p9' }, { host }), /没有这个标签/)
  await assert.rejects(executeBrowser({ action: 'switch_tab', tab: 'p1' }, { host }), /不支持的动作/)
})

test('browser surfaces host failures instead of pretending success', async () => {
  const { host } = fakeHost({ tabsError: '桌面浏览器未授权' })
  await assert.rejects(executeBrowser({ action: 'tabs' }, { host }), /桌面浏览器未授权/)
  assert.equal(BROWSER_TOOL.name, 'browser')
  assert.ok(BROWSER_TOOL.inputSchema.properties.action.enum.includes('screenshot'))
})
