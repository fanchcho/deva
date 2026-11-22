#!/usr/bin/env node
/**
 * 端到端冒烟测试（对已启动的服务执行）。
 *
 *   BASE=http://127.0.0.1:7080 ADMIN_USER=admin ADMIN_PASSWORD=... node test/smoke.mjs
 *
 * 覆盖：登录 / CSRF / 通道注册数 / 配置读取 / 路径闸门 / 工作区读写 /
 * 用户隔离（可选创建临时用户）/ 终端 PTY 流 / 审计落盘。
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:7080'
const USER = process.env.ADMIN_USER ?? 'admin'
const PASS = process.env.ADMIN_PASSWORD ?? ''
const CREATE_USER = process.env.SMOKE_CREATE_USER === '1'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('PASS', name)
  } else {
    fail++
    console.log('FAIL', name, extra)
  }
}

async function login(username, password) {
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual'
  })
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .join('; ')
  return { status: res.status, cookie }
}

async function boot(cookie) {
  const text = await (await fetch(BASE + '/boot.js', { headers: { cookie } })).text()
  return { csrf: /__DEVA_CSRF__="([^"]+)"/.exec(text)?.[1], text }
}

function client(cookie, csrf) {
  const invoke = async (channel, args = [], extra = {}) => {
    const res = await fetch(BASE + '/api/invoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        ...(csrf ? { 'x-deva-csrf': csrf } : {})
      },
      body: JSON.stringify({ channel, args, ...extra })
    })
    if (res.status === 204) return { ok: true }
    const body = await res.json().catch(() => ({}))
    return { status: res.status, ...body }
  }
  return { invoke }
}

const adminLogin = await login(USER, PASS)
check('登录成功', adminLogin.status === 302 && adminLogin.cookie.includes('deva_session'), String(adminLogin.status))
const adminBoot = await boot(adminLogin.cookie)
check('boot.js 下发 CSRF', Boolean(adminBoot.csrf))
const admin = client(adminLogin.cookie, adminBoot.csrf)

const noCsrf = await client(adminLogin.cookie, '').invoke('config:get')
check('缺少 CSRF 被拒绝', noCsrf.status === 403, JSON.stringify(noCsrf))

const channels = await (await fetch(BASE + '/api/channels', { headers: { cookie: adminLogin.cookie } })).json()
check('后端通道已注册', channels.count > 100, String(channels.count))

const config = await admin.invoke('config:get')
check('config:get', config.ok === true, JSON.stringify(config))

const jail = await admin.invoke('fs:read-dir', ['/etc'])
check('路径闸门拦截 /etc', jail.ok === false && /超出/.test(jail.error ?? ''), JSON.stringify(jail))

const open = await admin.invoke('fs:open-folder')
check('打开工作区', open.ok === true && Boolean(open.value?.path), JSON.stringify(open))
const ws = open.value?.path
const write = await admin.invoke('fs:write-file', [`${ws}/smoke.txt`, 'smoke-ok'])
check('写入工作区', write.ok !== false, JSON.stringify(write))
const read = await admin.invoke('fs:read-file', [`${ws}/smoke.txt`])
check('读回工作区', read.ok === true && String(read.value?.content).includes('smoke-ok'), JSON.stringify(read))

// 终端：SSE 事件 + PTY 回显
const ctrl = new AbortController()
const sse = await fetch(BASE + '/api/events', { headers: { cookie: adminLogin.cookie }, signal: ctrl.signal })
const reader = sse.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
const frames = []
void (async () => {
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            frames.push(JSON.parse(line.slice(6)))
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* aborted */
  }
})()

const term = await admin.invoke('terminal:create', [{ cols: 100, rows: 30, cwd: ws }])
check('创建终端', term.ok === true && Boolean(term.value?.id), JSON.stringify(term))
if (term.value?.id) {
  await admin.invoke('terminal:input', [term.value.id, 'echo SMOKE_PTY_OK\n'], { fireAndForget: true })
  await new Promise((r) => setTimeout(r, 2000))
  const hit = frames.some(
    (f) => f.channel === 'terminal:data' && String(f.payload?.data ?? '').includes('SMOKE_PTY_OK')
  )
  check('终端输出经 SSE 到达', hit)
  await admin.invoke('terminal:dispose', [term.value.id], { fireAndForget: true })
}
ctrl.abort()

if (CREATE_USER) {
  const name = 'smoke' + Date.now().toString(36)
  const form = await fetch(BASE + '/admin/create', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminLogin.cookie },
    body: new URLSearchParams({ csrf: adminBoot.csrf, username: name, password: 'smoke123456', role: 'user' })
  })
  check('创建临时用户', form.status === 200)
  const other = await login(name, 'smoke123456')
  const otherBoot = await boot(other.cookie)
  const oc = client(other.cookie, otherBoot.csrf)
  const otherConfig = await oc.invoke('config:get')
  const isolated = !(otherConfig.value?.models?.providers ?? []).some((p) => p.id === 'mock')
  check('新用户配置隔离', isolated)
  // 断言「被拒」即可：网关闸门报「超出」，后端 fs-guard 报「不在已打开的项目内」——
  // 两道闸门都在，错误文案取决于哪一道先拦（配了 DEVA_WEB_ROOTS 时走后者），不能只认一种措辞。
  const forbidden = await oc.invoke('fs:read-dir', [ws])
  check('跨用户路径被拒绝', forbidden.ok === false && /超出|拒绝访问/.test(forbidden.error ?? ''), JSON.stringify(forbidden))
}

console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
