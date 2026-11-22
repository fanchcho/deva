#!/usr/bin/env node
/**
 * 图标回归：确认 favicon 在登录前后都能拿到、MIME 正确、页面里确实有 link 标签。
 *   BASE=http://127.0.0.1:7080 node out/icon-check.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:7080'
const USER = process.env.ADMIN_USER ?? 'admin'
const PASS = process.env.ADMIN_PASSWORD ?? 'smoke-pass'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('PASS', name)
  } else {
    fail++
    console.log('FAIL', name, detail)
  }
}

// 1) 未登录：登录页必须有图标，且图标本身不能被登录墙挡掉（manual 避免 302 被当成 200）
for (const [urlPath, type] of [
  ['/favicon.svg', 'image/svg+xml'],
  ['/favicon.ico', 'image/x-icon']
]) {
  const r = await fetch(BASE + urlPath, { redirect: 'manual' })
  const body = Buffer.from(await r.arrayBuffer())
  check(`未登录可取得 ${urlPath}`, r.status === 200, `HTTP ${r.status}`)
  check(`${urlPath} content-type`, (r.headers.get('content-type') ?? '') === type, r.headers.get('content-type') ?? '')
  check(`${urlPath} 内容非空`, r.status === 200 && body.length > 100, `${body.length}B`)
}
{
  const ico = Buffer.from(await (await fetch(BASE + '/favicon.ico', { redirect: 'manual' })).arrayBuffer())
  check('ICO 文件头 00 00 01 00', ico.subarray(0, 4).toString('hex') === '00000100', ico.subarray(0, 4).toString('hex'))
  const svg = await (await fetch(BASE + '/favicon.svg', { redirect: 'manual' })).text()
  check('SVG 含 svg 根节点', svg.includes('<svg') && svg.includes('</svg>'))
}
{
  const r = await fetch(BASE + '/favicon.ico', { method: 'POST', redirect: 'manual' })
  check('图标路由只接受 GET/HEAD', r.status === 405, `HTTP ${r.status}`)
}

// 2) 登录页 / 应用首页 / 管理页 HTML 里的 link 标签（登录后统一检查）

const res = await fetch(BASE + '/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: USER, password: PASS }),
  redirect: 'manual'
})
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const pages = [
  ['/login', '登录页（已登录时 302，跳过 body 检查）'],
  ['/', '应用首页'],
  ['/admin', '管理页']
]
for (const [urlPath, label] of pages) {
  const r = await fetch(BASE + urlPath, { headers: { cookie }, redirect: 'manual' })
  if (r.status === 302) continue
  const html = await r.text()
  check(`${label} 含 rel="icon"`, html.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'), `HTTP ${r.status}`)
  check(`${label} 含 ico 兜底`, html.includes('rel="alternate icon" href="/favicon.ico"'), '')
}
{
  const html = await (await fetch(BASE + '/login', { redirect: 'manual' })).text()
  if (html.includes('<form')) {
    check('未登录访问 /login 含 rel="icon"', html.includes('<link rel="icon" href="/favicon.svg"'))
  }
}

// 3) 普通用户看到的错误页也要有图标
{
  const name = 'iconprobe' + Date.now().toString(36)
  const login = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: USER, password: PASS }),
    redirect: 'manual'
  })
  const adminCookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const boot = await (await fetch(BASE + '/boot.js', { headers: { cookie: adminCookie } })).text()
  const csrf = /__DEVA_CSRF__="([^"]+)"/.exec(boot)?.[1]
  await fetch(BASE + '/admin/create', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminCookie },
    body: new URLSearchParams({ csrf, username: name, password: 'iconpass123', role: 'user' })
  })
  const userLogin = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: name, password: 'iconpass123' }),
    redirect: 'manual'
  })
  const userCookie = (userLogin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const r = await fetch(BASE + '/admin', { headers: { cookie: userCookie } })
  const html = await r.text()
  check('403 错误页含 rel="icon"', r.status === 403 && html.includes('<link rel="icon" href="/favicon.svg"'), `HTTP ${r.status}`)
}

console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
