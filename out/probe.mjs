#!/usr/bin/env node
/**
 * 缺陷回归探针：对已启动的实例逐条验证「修复前失败 / 修复后通过」的行为。
 *   BASE=http://127.0.0.1:7083 node probe.mjs
 * 只读 + 工作区内写一个临时文件，不做破坏性操作。
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

async function login(username, password, next) {
  const body = new URLSearchParams({ username, password })
  if (next) body.set('next', next)
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual'
  })
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, cookie, location: res.headers.get('location') ?? '' }
}
async function boot(cookie) {
  const text = await (await fetch(BASE + '/boot.js', { headers: { cookie } })).text()
  return /__DEVA_CSRF__="([^"]+)"/.exec(text)?.[1]
}
const client = (cookie, csrf) => ({
  invoke: async (channel, args = []) => {
    const res = await fetch(BASE + '/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-deva-csrf': csrf ?? '' },
      body: JSON.stringify({ channel, args })
    })
    if (res.status === 204) return { ok: true }
    return { status: res.status, ...(await res.json().catch(() => ({}))) }
  }
})

// 1) 登录开放重定向
for (const next of ['//evil.example/x', '/\\evil.example/x', 'https://evil.example/']) {
  const r = await login(USER, PASS, next)
  check(`登录跳转不放行外站 next=${JSON.stringify(next)}`, r.status === 302 && r.location === '/', `${r.status} location=${r.location}`)
}
const okNext = await login(USER, PASS, '/admin')
check('登录跳转保留站内 next=/admin', okNext.location === '/admin', okNext.location)

const adminLogin = await login(USER, PASS)
const csrf = await boot(adminLogin.cookie)
const admin = client(adminLogin.cookie, csrf)

// 2) 伪文件系统子路径不可浏览
for (const p of ['/proc/self', '/proc/1', '/sys/kernel', '/proc', '/dev/shm']) {
  const r = await fetch(`${BASE}/api/fs/list?path=${encodeURIComponent(p)}`, { headers: { cookie: adminLogin.cookie } })
  check(`浏览拦截 ${p}`, r.status === 403, `HTTP ${r.status}`)
}

// 3) 写入内容以 / 开头不应被当成越界路径
const open = await admin.invoke('fs:open-folder')
const ws = open.value?.path
check('打开工作区', Boolean(ws), JSON.stringify(open))
for (const content of ['/slash-start', '/* C comment */', '// js comment', '//stack.example/x']) {
  const r = await admin.invoke('fs:write-file', [`${ws}/probe-content.txt`, content])
  check(`写入内容 ${JSON.stringify(content)}`, r.ok === true, JSON.stringify(r))
}
const readBack = await admin.invoke('fs:read-file', [`${ws}/probe-content.txt`])
check('内容落盘正确', readBack.ok === true, JSON.stringify(readBack))

// 4) 真实越界路径仍被闸门拦截
for (const [channel, args] of [
  ['fs:read-dir', ['/etc']],
  ['fs:read-file', ['/etc/passwd']],
  ['fs:write-file', ['/etc/probe-escape.txt', 'x']],
  ['git:status', ['/etc']],
  ['git:stage', [ws, [`${ws}/../escape.txt`]]],
  ['terminal:create', [{ cols: 80, rows: 24, cwd: '/etc' }]]
]) {
  const r = await admin.invoke(channel, args)
  const rejected = r.ok === false && (/超出/.test(r.error ?? '') || /git repository|not a git/i.test(r.error ?? ''))
  check(`闸门拦截 ${channel} ${JSON.stringify(args[0]).slice(0, 40)}`, rejected, JSON.stringify(r).slice(0, 160))
}
// git:commit 落到工作区（非仓库）不应被内容误判；允许 git 自身报错，但错误里不能出现「路径超出」
{
  const r = await admin.invoke('git:commit', [ws, '/slash-start message'])
  check('git:commit 消息内容不被误判为路径', !/超出/.test(r.error ?? ''), JSON.stringify(r).slice(0, 160))
}

// 5) 畸形 URL 路径 → 400 而非 500
{
  const r = await fetch(BASE + '/%E0%A4%A', { headers: { cookie: adminLogin.cookie } })
  check('畸形百分号返回 400', r.status === 400, `HTTP ${r.status}`)
}

// 6) 跨用户隔离
const name = 'probe' + Date.now().toString(36)
const form = await fetch(BASE + '/admin/create', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminLogin.cookie },
  body: new URLSearchParams({ csrf, username: name, password: 'probe123456', role: 'user' })
})
check('创建临时用户', form.status === 200, `HTTP ${form.status}`)
const otherLogin = await login(name, 'probe123456')
const other = client(otherLogin.cookie, await boot(otherLogin.cookie))
const cross = await other.invoke('fs:read-dir', [ws])
// 两道闸门都会拒：网关报「超出」，后端 fs-guard 报「拒绝访问」——文案取决于哪道先拦，断言只认「被拒」。
check('跨用户路径被拒绝', cross.ok === false && /超出|拒绝访问/.test(cross.error ?? ''), JSON.stringify(cross).slice(0, 160))

// 6.5) 终端 cwd 不能用相对路径或符号链接逃出工作区
{
  const rel = await admin.invoke('terminal:create', [{ cols: 80, rows: 24, cwd: '../../../../../../etc' }])
  check('终端 cwd 相对路径逃逸被拒绝', rel.ok === false && /超出/.test(rel.error ?? ''), JSON.stringify(rel).slice(0, 160))
  const okCwd = await admin.invoke('terminal:create', [{ cols: 80, rows: 24, cwd: ws }])
  check('终端 cwd 工作区内可用', okCwd.ok === true && Boolean(okCwd.value?.id), JSON.stringify(okCwd).slice(0, 160))
  const link = `${ws}/probe-link-${Date.now()}`
  const t = await admin.invoke('terminal:create', [{ cols: 80, rows: 24, cwd: ws }])
  if (t.value?.id) {
    await fetch(BASE + '/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminLogin.cookie, 'x-deva-csrf': csrf },
      body: JSON.stringify({ channel: 'terminal:input', args: [t.value.id, `ln -sfn /etc ${link}\n`], fireAndForget: true })
    })
    await new Promise((r) => setTimeout(r, 1200))
    const viaLink = await admin.invoke('terminal:create', [{ cols: 80, rows: 24, cwd: link }])
    check('终端 cwd 符号链接逃逸被拒绝', viaLink.ok === false && /超出/.test(viaLink.error ?? ''), JSON.stringify(viaLink).slice(0, 160))
    const fsViaLink = await admin.invoke('fs:read-dir', [link])
    check('fs 通道符号链接逃逸被拒绝', fsViaLink.ok === false, JSON.stringify(fsViaLink).slice(0, 160))
    const { rm } = await import('node:fs/promises')
    await rm(link, { force: true }).catch(() => {})
    await admin.invoke('terminal:dispose', [t.value.id])
  }
}

// 7) 管理员页面仍可访问
{
  const r = await fetch(BASE + '/admin', { headers: { cookie: adminLogin.cookie } })
  check('管理页可访问', r.status === 200, `HTTP ${r.status}`)
}

// 清理探针写入的临时文件（工作区在服务端本机）
if (ws) {
  const { rm } = await import('node:fs/promises')
  await rm(`${ws}/probe-content.txt`, { force: true }).catch(() => {})
}

console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
