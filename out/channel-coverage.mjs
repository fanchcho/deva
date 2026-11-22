#!/usr/bin/env node
/**
 * 覆盖核对：已注册的 fs:/git: 通道是否都在 server.mjs 的 CHANNEL_PATHS 里登记了
 * 「哪个参数是路径」。有遗漏就说明闸门在该通道上退回了全文扫描（会误伤内容）。
 *   BASE=http://127.0.0.1:7092 node channel-coverage.mjs
 */
import { readFile } from 'node:fs/promises'

const BASE = process.env.BASE ?? 'http://127.0.0.1:7092'
const source = await readFile(new URL('../apps/web/server.mjs', import.meta.url), 'utf8')

const table = source.match(/const CHANNEL_PATHS = \{([\s\S]*?)\n\}/)
if (!table) {
  console.log('FAIL 未找到 CHANNEL_PATHS')
  process.exit(1)
}
const declared = new Map(
  [...table[1].matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)].map((m) => [
    m[1],
    [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
  ])
)

const res = await fetch(BASE + '/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: 'admin', password: process.env.ADMIN_PASSWORD ?? 'smoke-pass' }),
  redirect: 'manual'
})
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const channels = await (await fetch(BASE + '/api/channels', { headers: { cookie } })).json()
const registered = (channels.channels ?? channels).map((c) => (typeof c === 'string' ? c : c.name))
const jailed = registered.filter((c) => /^(fs|git):/.test(c))

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : detail)
}

const missing = jailed.filter((c) => !declared.has(c))
check(`已注册 ${jailed.length} 个 fs/git 通道全部登记路径参数位置`, missing.length === 0, missing.join(', '))
const stale = [...declared.keys()].filter((c) => !registered.includes(c))
check('CHANNEL_PATHS 无过期条目', stale.length === 0, stale.join(', '))
const badKind = [...declared].flatMap(([c, kinds]) => kinds.filter((k) => k !== 'one' && k !== 'many').map((k) => `${c}:${k}`))
check('路径参数类型只含 one/many', badKind.length === 0, badKind.join(', '))
check('terminal:create 单独处理', /channel === 'terminal:create'/.test(source))

console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
