import { escapeHtml } from './util.mjs'

// 登录页 / 管理页 / 错误页不是 renderer 产物，图标链接在这里内联（路径由 server.mjs 提供）。
const ICON_LINKS =
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
  '<link rel="alternate icon" href="/favicon.ico" sizes="any">'

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:#0f1113;color:#e8e8e8}
.card{width:360px;padding:32px 28px;background:#17191c;border:1px solid #26292d;border-radius:14px;
  box-shadow:0 20px 60px rgba(0,0,0,.45)}
h1{margin:0 0 4px;font-size:20px;font-weight:600}
p.sub{margin:0 0 24px;color:#8b9199;font-size:13px}
label{display:block;margin:0 0 6px;color:#a8aeb6;font-size:12px}
input{width:100%;padding:10px 12px;margin-bottom:16px;background:#0f1113;color:#e8e8e8;
  border:1px solid #2d3136;border-radius:8px;font-size:14px;outline:none}
input:focus{border-color:#4c8dff}
button{width:100%;padding:10px 12px;border:0;border-radius:8px;background:#2f6fed;color:#fff;
  font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#3b7bf5}
button.ghost{background:transparent;color:#9aa1a9;border:1px solid #2d3136;font-weight:500}
.err{margin:0 0 16px;padding:8px 10px;border-radius:8px;background:#3a1d1f;color:#ff9a9a;font-size:13px}
.foot{margin-top:22px;color:#6d747c;font-size:12px;text-align:center}
body.wide{align-items:flex-start;padding:40px 24px}
.panel{width:min(980px,100%)}
.panel .card{width:100%}
table{width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #24282d}
th{color:#8b9199;font-weight:500}
form.inline{display:flex;gap:8px;align-items:center;margin:0}
form.inline input{margin:0;padding:7px 9px;font-size:13px}
form.inline button{width:auto;padding:7px 12px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px}
.row label{margin-bottom:4px}
.row input{margin:0}
.row button{width:auto;padding:9px 14px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;background:#21262c;color:#9aa1a9;font-size:12px}
.pill.admin{background:#1e2f4d;color:#7fb2ff}
a{color:#6ba1ff;text-decoration:none}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
pre{background:#0f1113;border:1px solid #24282d;border-radius:8px;padding:12px;overflow:auto;font-size:12px;
  max-height:420px;color:#b9c0c8}
code{background:#0f1113;border:1px solid #24282d;border-radius:4px;padding:1px 5px;font-size:12px;color:#b9c0c8}
.pill.warn{background:#33240d;color:#ffc46b}
.pill.ok{background:#12291b;color:#7fd18b}
.pill.bad{background:#3a1d1f;color:#ff9a9a}
`

export function loginPage({ error = '', next = '/' } = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${ICON_LINKS}
<title>Deva Web 登录</title><style>${STYLE}</style></head>
<body><div class="card">
  <h1>Deva Web</h1>
  <p class="sub">登录后进入你的独立工作区</p>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="u">用户名</label>
    <input id="u" name="username" autocomplete="username" autofocus required>
    <label for="p">密码</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">登录</button>
  </form>
  <p class="foot">Deva · 纯 Web 版</p>
</div></body></html>`
}

export function adminPage({ user, users, audit = [], error = '', notice = '', csrf, update = null }) {
  const rows = users
    .map(
      (u) => `<tr>
  <td>${escapeHtml(u.username)}</td>
  <td><span class="pill${u.role === 'admin' ? ' admin' : ''}">${u.role === 'admin' ? '管理员' : '用户'}</span></td>
  <td>${escapeHtml(u.createdAt?.slice(0, 19).replace('T', ' ') ?? '')}</td>
  <td>
    <form class="inline" method="post" action="/admin/password">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <input type="hidden" name="id" value="${escapeHtml(u.id)}">
      <input name="password" type="password" placeholder="新密码" minlength="6" required>
      <button type="submit">重置</button>
    </form>
  </td>
  <td>
    <form class="inline" method="post" action="/admin/delete" onsubmit="return confirm('删除用户及其数据？')">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <input type="hidden" name="id" value="${escapeHtml(u.id)}">
      <button class="ghost" type="submit"${u.id === user.id ? ' disabled' : ''}>删除</button>
    </form>
  </td>
</tr>`
    )
    .join('')

  const auditText = audit.length
    ? audit
        .map((line) => {
          try {
            const e = JSON.parse(line)
            const extra = e.channel ? `${e.channel} ${JSON.stringify(e.args ?? '')}` : e.event ?? ''
            return `${String(e.ts).slice(0, 19).replace('T', ' ')}  ${e.ok === false ? 'FAIL ' : ''}${extra}`.slice(0, 300)
          } catch {
            return line.slice(0, 300)
          }
        })
        .join('\n')
    : '暂无记录'

  const up = update ?? {}
  const checkedText = up.checkedAt ? `${up.checkedAt.slice(0, 19).replace('T', ' ')} UTC` : '尚未检查'
  const updateTone = up.error
    ? { cls: 'bad', label: '检查失败' }
    : up.updateAvailable
      ? { cls: 'warn', label: up.relation === 'diverged' ? '与上游分叉' : '发现新提交' }
      : up.checkedAt
        ? { cls: 'ok', label: '已是最新' }
        : { cls: '', label: '尚未检查' }
  const aheadText = up.aheadBy ? ` · 落后 ${up.aheadBy} 个提交` : ''
  const commitText = up.currentShort || up.current || 'unknown'
  const latestText = up.latestShort || up.latest || 'unknown'
  const updateCommand = `DEVA_REF=${up.latest || '<new-sha>'} docker compose build && docker compose up -d`

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${ICON_LINKS}
<title>Deva Web 管理</title><style>${STYLE}</style></head>
<body class="wide"><div class="panel">
  <div class="top">
    <div><h1>用户管理</h1><p class="sub">当前登录：${escapeHtml(user.username)}（管理员）</p></div>
    <div><a href="/">返回应用</a> · <form class="inline" method="post" action="/logout"><button class="ghost" type="submit">退出</button></form></div>
  </div>
  <div class="card">
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
    ${notice ? `<p class="sub" style="color:#7fd18b">${escapeHtml(notice)}</p>` : ''}
    <div class="top" style="margin-bottom:6px">
      <div>
        <h1 style="font-size:15px">版本更新</h1>
        <p class="sub" style="margin:2px 0 0">${escapeHtml(up.repo ?? '')} · ${escapeHtml(up.ref ?? '')} · ${
          up.webhookEnabled ? 'webhook 已启用' : 'webhook 未配置'
        }</p>
      </div>
      <span class="pill${updateTone.cls ? ` ${updateTone.cls}` : ''}">${escapeHtml(updateTone.label)}</span>
    </div>
    <p class="sub" style="margin:0 0 8px">
      当前提交 <code>${escapeHtml(commitText)}</code> · 远端提交 <code>${escapeHtml(latestText)}</code>${escapeHtml(aheadText)}
      <br>最近检查：${escapeHtml(checkedText)}${up.intervalMinutes ? ` · 每 ${escapeHtml(String(up.intervalMinutes))} 分钟自动检查` : ' · 仅手动检查'}
      ${up.latestMessage ? `<br>最新提交：${escapeHtml(up.latestMessage)}` : ''}
    </p>
    ${up.error ? `<p class="err">${escapeHtml(up.error)}</p>` : ''}
    ${
      up.updateAvailable
        ? `<pre>${escapeHtml(updateCommand)}</pre>
    <p class="sub" style="margin-top:-8px">Docker 镜像里的代码是构建时固化的，更新需要重新 build（不会动 <code>deva-data</code> 卷）。<a href="${escapeHtml(
      up.compareUrl
    )}" target="_blank" rel="noreferrer">查看提交对比</a></p>`
        : ''
    }
    <form class="inline" method="post" action="/admin/update-check" style="margin-bottom:22px">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <button type="submit">立即检查</button>
    </form>
    <table>
      <thead><tr><th>用户名</th><th>角色</th><th>创建时间</th><th>重置密码</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <form class="row" method="post" action="/admin/create">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <div><label>新用户名</label><input name="username" required></div>
      <div><label>初始密码</label><input name="password" type="password" minlength="6" required></div>
      <div><label>角色</label>
        <select name="role" style="padding:9px;background:#0f1113;color:#e8e8e8;border:1px solid #2d3136;border-radius:8px">
          <option value="user">用户</option><option value="admin">管理员</option>
        </select></div>
      <button type="submit">创建用户</button>
    </form>
    <h1 style="font-size:15px;margin:8px 0 6px">最近审计</h1>
    <pre>${escapeHtml(auditText)}</pre>
  </div>
</div></body></html>`
}

export function errorPage(status, message) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
${ICON_LINKS}
<title>${status}</title><style>${STYLE}</style></head>
<body><div class="card"><h1>${status}</h1><p class="sub">${escapeHtml(message)}</p>
<a href="/">返回首页</a></div></body></html>`
}
