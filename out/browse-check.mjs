#!/usr/bin/env node
/**
 * 反向回归：修复 browseHidden 后，正常目录仍应可浏览（不能「一刀切」全拦）。
 *   BASE=http://127.0.0.1:7092 node browse-check.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:7092'
const res = await fetch(BASE + '/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: 'admin', password: process.env.ADMIN_PASSWORD ?? 'smoke-pass' }),
  redirect: 'manual'
})
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : detail)
}
for (const p of ['/', '/tmp', '/etc', '/var', '/usr']) {
  const r = await fetch(`${BASE}/api/fs/list?path=${encodeURIComponent(p)}`, { headers: { cookie } })
  check(`正常目录可浏览 ${p}`, r.status === 200, `HTTP ${r.status}`)
}
for (const p of ['/proc', '/proc/self', '/sys/kernel', '/dev/shm']) {
  const r = await fetch(`${BASE}/api/fs/list?path=${encodeURIComponent(p)}`, { headers: { cookie } })
  check(`伪文件系统仍被拦 ${p}`, r.status === 403, `HTTP ${r.status}`)
}
console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
