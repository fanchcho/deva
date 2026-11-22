#!/usr/bin/env node
/** git 通道在修复后的端到端回归：真实建仓 / 暂存 / 提交 / 分支 / 日志。 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:7083'
const USER = process.env.ADMIN_USER ?? 'admin'
const PASS = process.env.ADMIN_PASSWORD ?? 'smoke-pass'
let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, d)) }
const lr = await fetch(BASE + '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: USER, password: PASS }), redirect: 'manual' })
const cookie = (lr.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
const csrf = /__DEVA_CSRF__="([^"]+)"/.exec(await (await fetch(BASE + '/boot.js', { headers: { cookie } })).text())?.[1]
const inv = async (channel, args = []) => {
  const r = await fetch(BASE + '/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-deva-csrf': csrf }, body: JSON.stringify({ channel, args }) })
  return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const open = await inv('fs:open-folder')
const ws = open.value.path
// 工作区里单独开一个目录：fs:write-file 不建父目录，用终端 mkdir（顺带验证 terminal:create）。
const dir = `${ws}/git-e2e-${Date.now()}`
const term = await inv('terminal:create', [{ cols: 100, rows: 30, cwd: ws }])
check('terminal:create 工作区 cwd', term.ok === true && Boolean(term.value?.id), JSON.stringify(term))
await fetch(BASE + '/api/invoke', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, 'x-deva-csrf': csrf },
  body: JSON.stringify({ channel: 'terminal:input', args: [term.value.id, `mkdir -p ${dir}\n`], fireAndForget: true })
})
await new Promise((r) => setTimeout(r, 800))
const init = await inv('git:init', [dir])
check('git:init', init.ok === true && init.value?.ok === true, JSON.stringify(init))
const mk = await inv('fs:write-file', [`${dir}/a.txt`, '/starts-with-slash'])
check('创建文件内容以 / 开头', mk.ok === true, JSON.stringify(mk))
await inv('git:set-config', [dir, 'Deva Probe', 'probe@example.invalid', false])
const st = await inv('git:status', [dir])
check('git:status 识别未跟踪文件', st.ok === true && (st.value?.unstaged ?? []).some(f => f.name === 'a.txt'), JSON.stringify(st).slice(0, 200))
const stage = await inv('git:stage', [dir, [`${dir}/a.txt`]])
check('git:stage', stage.ok === true && stage.value?.ok === true, JSON.stringify(stage))
const commit = await inv('git:commit', [dir, '/slash-start subject\n\nbody with // comment'])
check('git:commit 消息含 / 开头文本', commit.ok === true && commit.value?.ok === true, JSON.stringify(commit))
const log = await inv('git:log', [dir, 5])
check('git:log 返回提交', log.ok === true && log.value?.length === 1, JSON.stringify(log).slice(0, 200))
const branch = await inv('git:create-branch', [dir, 'feature/x', true])
check('git:create-branch 名字含 /', branch.ok === true && branch.value?.ok === true, JSON.stringify(branch))
const branches = await inv('git:branches', [dir])
check('git:branches 含新分支', branches.ok === true && (branches.value ?? []).some(b => String(b.name ?? '').includes('feature/x')), JSON.stringify(branches).slice(0, 200))
const bad = await inv('git:stage', [dir, ['/etc/passwd']])
check('git:stage 越界路径仍拒绝', bad.ok === false && /超出/.test(bad.error ?? ''), JSON.stringify(bad).slice(0, 160))
console.log(`\nRESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
