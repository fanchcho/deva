#!/usr/bin/env node
/**
 * Deva 纯 Web 服务：静态托管原 renderer + 登录/多用户 + 每用户后端进程 + 审计。
 *
 * 与 Electron 版的差别只在“壳”：前端代码一行没改，window.deva（preload API）
 * 由 dist/shim.js 提供，底层换成 HTTP + SSE；主进程业务代码原样跑在每用户一个
 * 子进程里（DEVA_HOME / HOME / cwd 均按用户隔离）。
 */
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { AuditLog, SessionStore, UserStore, csrfOk, verifyPassword } from './src/server/auth.mjs'
import { BackendPool } from './src/server/backend-pool.mjs'
import { adminPage, errorPage, loginPage } from './src/server/pages.mjs'
import { createStaticHandler } from './src/server/static.mjs'
import { UpdateChecker } from './src/server/updater.mjs'
import {
  isInside,
  json,
  migrateDir,
  migrateFile,
  parseCookies,
  readJsonBody,
  summarize,
  text
} from './src/server/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'dist', 'manifest.json'), 'utf8'))
const shimSource = fs.readFileSync(path.join(here, 'dist', 'shim.js'), 'utf8')

// 下游（每用户后端子进程）从 app.getVersion() 读到的必须是构建版本，而不是硬编码常量。
// 用环境变量统一注入：worker 继承 process.env，无需改 BackendPool 签名。
if (!process.env.DEVA_VERSION) process.env.DEVA_VERSION = manifest.version

const PORT = Number(process.env.PORT ?? 7080)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_ROOT = path.resolve(process.env.DEVA_WEB_DATA ?? path.join(os.homedir(), '.deva-web'))
const SESSION_TTL_MS = Number(process.env.DEVA_WEB_SESSION_HOURS ?? 24 * 7) * 3600_000
const IDLE_MS = Number(process.env.DEVA_WEB_IDLE_MINUTES ?? 30) * 60_000
const SECURE_COOKIE = process.env.DEVA_WEB_SECURE_COOKIE === '1'
const COOKIE = 'deva_session'

// 浏览器里没有系统目录对话框：Web 版的「打开文件夹」只能在服务端给定的根下列举。
// 默认让 /data/workspaces 作为可挂载区（Docker 里把宿主目录 bind 到这里），
// 每个用户自己的 workspace 永远可选。多个根用 path.delimiter（Linux 下冒号）分隔。
const PICK_ROOTS = String(process.env.DEVA_WEB_ROOTS ?? path.join(DATA_ROOT, 'workspaces'))
  .split(path.delimiter)
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p))

// 文件选择器的浏览上界：默认整个容器文件系统（和桌面版的系统目录对话框一致），
// 只把内部状态目录和其它用户目录藏掉。设 DEVA_WEB_BROWSE_TOP=/projects 可收窄。
const BROWSE_TOP = path.resolve(process.env.DEVA_WEB_BROWSE_TOP ?? '/')
const BROWSE_HIDDEN = ['/proc', '/sys', '/dev', '/run']

// worker → server 的内部回环鉴权：只用来发起目录选择，不暴露给浏览器。
const WORKER_TOKEN = crypto.randomBytes(24).toString('hex')

// 用户目录里会落密钥、会话、审计：默认 umask 收紧到 077
process.umask(0o077)
fs.mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 })
// 旧布局：update-state.json 在 /data 根；新布局统一收进 state/。
migrateFile(
  path.join(DATA_ROOT, 'update-state.json'),
  path.join(DATA_ROOT, 'state', 'update-state.json')
)

const users = new UserStore(DATA_ROOT)
const sessions = new SessionStore(DATA_ROOT, SESSION_TTL_MS)
const audit = new AuditLog(DATA_ROOT)

// ---- 上游更新检查 -----------------------------------------------------------
// 只提示、不自动更新：Docker 镜像里的代码是构建时固化的。
const buildInfo = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'dist', 'build-info.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const UPDATE_MINUTES = Number(process.env.DEVA_UPDATE_CHECK_MINUTES ?? 30)
const updater = new UpdateChecker({
  repo: process.env.DEVA_UPDATE_REPO || 'sqfcyily/deva',
  ref: process.env.DEVA_UPDATE_REF || buildInfo.ref || 'main',
  current: process.env.DEVA_UPDATE_CURRENT || buildInfo.commit || '',
  apiBase: process.env.DEVA_UPDATE_API || 'https://api.github.com',
  token: process.env.DEVA_UPDATE_TOKEN || '',
  webhook: process.env.DEVA_UPDATE_WEBHOOK || '',
  webhookKind: process.env.DEVA_UPDATE_WEBHOOK_KIND || 'json',
  telegramChatId: process.env.DEVA_UPDATE_TELEGRAM_CHAT_ID || '',
  intervalMs: Number.isFinite(UPDATE_MINUTES) ? Math.max(0, UPDATE_MINUTES) * 60_000 : 30 * 60_000,
  stateFile: path.join(DATA_ROOT, 'state', 'update-state.json'),
  onLog: (message) => console.log(message),
  onWarn: (message) => console.warn(message)
})
// 负数 = 完全不检查（离线部署）；0 = 只在管理页手动检查
if (!(UPDATE_MINUTES < 0)) updater.start()

/**
 * 每用户目录：.deva（DEVA_HOME，和桌面版 ~/.deva 同构）+ workspace（默认工作区）。
 * 工作区默认取第一个真实存在的 DEVA_WEB_ROOTS（Docker 里就是 /projects），
 * 这样「挂载工作区」打开的是用户的工程目录，而不是配置卷里的空壳目录。
 */
function userDirs(user) {
  const base = path.join(DATA_ROOT, 'users', user.id)
  const home = path.join(base, '.deva')
  migrateDir(path.join(base, 'home'), home)
  const workspace = PICK_ROOTS.find((p) => fs.existsSync(p)) ?? path.join(base, 'workspace')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  try {
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 })
  } catch {
    /* bind mount 只读也能挂，列表照常 */
  }
  // 旧版本在配置卷里生成的空壳 workspace：只删空目录，有内容的保留。
  const legacyWorkspace = path.join(base, 'workspace')
  if (workspace !== legacyWorkspace) {
    try {
      fs.rmdirSync(legacyWorkspace)
    } catch {
      /* 不存在或非空 */
    }
  }
  return { home, workspace }
}

function withDirs(user) {
  return { ...user, ...userDirs(user) }
}

/** 该用户可选的目录根：自己的 workspace + DEVA_WEB_ROOTS 里实际存在的目录。 */
function pickRoots(user) {
  const out = [user.workspace]
  for (const p of PICK_ROOTS) {
    if (!fs.existsSync(p) || out.includes(p)) continue
    out.push(p)
  }
  return out
}

/** 用户手动选过的额外受信根：落在用户目录里，worker 重启后由 env 重新登记。 */
const extraRoots = new Map()
function extraRootsFile(user) {
  return path.join(DATA_ROOT, 'users', user.id, 'roots.json')
}
function userExtraRoots(user) {
  if (!extraRoots.has(user.id)) {
    let list = []
    try {
      list = JSON.parse(fs.readFileSync(extraRootsFile(user), 'utf8'))
    } catch {
      /* 首次启动 / 文件损坏 */
    }
    extraRoots.set(
      user.id,
      Array.isArray(list) ? list.filter((v) => typeof v === 'string') : []
    )
  }
  return extraRoots.get(user.id)
}
function rememberRoot(user, dir) {
  const list = userExtraRoots(user)
  if (list.includes(dir)) return
  list.push(dir)
  try {
    fs.mkdirSync(path.dirname(extraRootsFile(user)), { recursive: true, mode: 0o700 })
    fs.writeFileSync(extraRootsFile(user), JSON.stringify(list))
  } catch (error) {
    console.warn('[deva-web] 保存可选目录失败:', error?.message ?? error)
  }
}

/**
 * 浏览范围：BROWSE_TOP 以下都能进（默认 /，和桌面版系统目录对话框一致），
 * 但内部状态目录、其它用户目录、伪文件系统不出现也进不去。
 */
function browseHidden(user, real) {
  // 按「目录及其所有子路径」判：/proc/self、/proc/1、/sys/kernel 同样不可浏览。
  if (BROWSE_HIDDEN.some((p) => isInside(p, real))) return true
  const internal = [path.join(DATA_ROOT, 'state'), path.join(DATA_ROOT, 'audit')]
  if (internal.some((p) => isInside(p, real))) return true
  const usersDir = path.join(DATA_ROOT, 'users')
  if (isInside(usersDir, real)) {
    const owner = path.relative(usersDir, real).split(path.sep)[0]
    if (owner && owner !== user.id) return true
  }
  return false
}

async function inBrowseScope(user, real) {
  if (browseHidden(user, real)) return false
  const top = await fsp.realpath(BROWSE_TOP).catch(() => path.resolve(BROWSE_TOP))
  return isInside(top, real)
}

/** 把外部传入的路径归一成真实路径，并确认它在浏览范围内（挡符号链接穿越）。 */
async function resolvePickPath(user, raw) {
  const target = path.resolve(String(raw ?? user.workspace))
  const real = await fsp.realpath(target).catch(() => null)
  if (!real) return null
  return (await inBrowseScope(user, real)) ? real : null
}

/**
 * 用户手输的新目录：允许路径尚不存在，先确认最近的已存在祖先在浏览范围内，
 * 再逐级创建。只给「创建并挂载」用，普通浏览仍然只认已存在的目录。
 */
async function resolveCreatePath(user, raw) {
  const input = String(raw ?? '').trim()
  if (!input) return null
  const target = path.resolve(input)
  if (target === path.parse(target).root) return null
  const exists = await fsp.stat(target).catch(() => null)
  if (exists && !exists.isDirectory()) return null
  if (!exists) {
    let ancestor = target
    const missing = []
    while (true) {
      const parent = path.dirname(ancestor)
      if (parent === ancestor) return null
      missing.unshift(path.basename(ancestor))
      ancestor = parent
      if (await fsp.stat(ancestor).catch(() => null)) break
    }
    const realAncestor = await fsp.realpath(ancestor).catch(() => null)
    if (!realAncestor) return null
    const planned = path.join(realAncestor, ...missing)
    if (!(await inBrowseScope(user, realAncestor))) return null
    if (!(await inBrowseScope(user, planned))) return null
    try {
      await fsp.mkdir(planned, { recursive: true })
    } catch {
      return null
    }
  }
  const real = await fsp.realpath(target).catch(() => null)
  if (!real) return null
  const stat = await fsp.stat(real).catch(() => null)
  if (!stat?.isDirectory()) return null
  return (await inBrowseScope(user, real)) ? real : null
}

if (users.list().length === 0) {
  const password = process.env.DEVA_WEB_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url')
  const admin = await users.create({
    username: process.env.DEVA_WEB_ADMIN_USER || 'admin',
    password,
    role: 'admin'
  })
  console.log('[deva-web] ============================================')
  console.log(`[deva-web] 初始管理员: ${admin.username}`)
  console.log(`[deva-web] 初始密码:   ${password}`)
  console.log('[deva-web] 首次登录后请在 /admin 重置')
  console.log('[deva-web] ============================================')
  audit.auth({ event: 'bootstrap-admin', username: admin.username })
}

const sseClients = new Map() // userId -> Set<res>
const dirPicks = new Map() // pickId -> { userId, title, resolve }

function broadcast(userId, channel, payload) {
  const set = sseClients.get(userId)
  if (!set) return
  const frame = `data: ${JSON.stringify({ channel, payload: payload ?? null })}\n\n`
  for (const res of set) {
    try {
      res.write(frame)
    } catch {
      set.delete(res)
    }
  }
}

const pool = new BackendPool({
  idleMs: IDLE_MS,
  ctlUrl: `http://127.0.0.1:${PORT}`,
  ctlToken: WORKER_TOKEN,
  trustRoots: (user) => userExtraRoots(user),
  onEvent: (userId, channel, payload) => broadcast(userId, channel, payload),
  onLog: (prefix, line) => {
    if (line) console.log(`${prefix} ${line}`)
  }
})

function sessionOf(req) {
  const cookies = parseCookies(req.headers.cookie)
  const session = sessions.get(cookies[COOKIE])
  if (!session) return null
  const user = users.byId(session.userId)
  if (!user || user.disabled) return null
  return { session, user: withDirs(user) }
}

function setCookie(res, value, maxAgeSec) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ]
  if (SECURE_COOKIE) attrs.push('Secure')
  res.setHeader('set-cookie', attrs.join('; '))
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' })
  res.end()
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

function readConfig(home) {
  try {
    return fs.readFileSync(path.join(home, 'config.json'), 'utf8')
  } catch {
    return '{}'
  }
}

function bootScript(user, session) {
  return (
    `window.__DEVA_CSRF__=${JSON.stringify(session.csrf)};` +
    `window.__DEVA_USERNAME__=${JSON.stringify(user.username)};` +
    `window.__DEVA_CONFIG__=${readConfig(user.home)};`
  )
}

function injectIndex(source) {
  // 原页面 CSP 是 script-src 'self'，内联脚本会被拦，必须走独立文件
  const boot =
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<link rel="alternate icon" href="/favicon.ico" sizes="any">` +
    `<link rel="stylesheet" href="/mobile.css">` +
    `<link rel="stylesheet" href="/picker.css">` +
    `<script src="/boot.js"></script><script src="/shim.js"></script>` +
    `<script src="/shell.js"></script><script src="/picker.js"></script>`
  return source.replace('</head>', `${boot}</head>`)
}

function shellScript(username, role) {
  // 管理员才查更新：普通用户看到版本号也没意义，还多一次请求。
  const badge =
    role === 'admin'
      ? `
  var b=document.createElement('a');b.href='/admin';b.className='deva-update-badge';
  b.style.cssText='position:fixed;left:12px;bottom:36px;z-index:2147483647;font:12px/1.4 sans-serif;color:#ffc46b;background:#241a0b;border:1px solid #5a3f14;border-radius:99px;padding:2px 10px;text-decoration:none;display:none';
  document.body.appendChild(b);
  var refresh=function(){fetch('/api/update',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){
    if(!d||!d.updateAvailable){b.style.display='none';return}
    b.textContent='有新版本 · '+(d.latestShort||d.latest||'').slice(0,7);
    b.title=(d.latestMessage||'')+(d.compareUrl?'\\n'+d.compareUrl:'');
    b.style.display='inline-block';
  }).catch(function(){})};
  refresh();setInterval(refresh,300000);`
      : ''
  return `addEventListener('DOMContentLoaded',function(){
  var a=document.createElement('a');a.href='/logout';a.className='deva-logout';a.textContent=${JSON.stringify(`退出 · ${username}`)};
  a.style.cssText='position:fixed;right:12px;bottom:8px;z-index:2147483647;font:12px/1.4 sans-serif;color:#9aa1a9;opacity:.55;text-decoration:none';
  a.onmouseenter=function(){a.style.opacity=1};a.onmouseleave=function(){a.style.opacity=.55};
  document.body.appendChild(a);${badge}
  // ---- 手机端抽屉：桌面版没有响应式断点，窄屏时把左列表改成浮层抽屉 ----
  ;(function(){
    var mq=window.matchMedia('(max-width:760px)');
    function bodyEl(){return document.querySelector('.cf-body')}
    function open(){var b=bodyEl();if(b)b.classList.add('deva-drawer-open')}
    function close(){var b=bodyEl();if(b)b.classList.remove('deva-drawer-open')}
    function isOpen(){var b=bodyEl();return !!b&&b.classList.contains('deva-drawer-open')}
    document.addEventListener('click',function(e){
      if(!mq.matches)return;
      var t=e.target;
      if(!t||!t.closest)return;
      var nav=t.closest('.cf-iconrail .cf-navbtn');
      if(nav){
        var btns=[].slice.call(document.querySelectorAll('.cf-iconrail .cf-navbtn'));
        var i=btns.indexOf(nav);
        var chats=document.querySelector('.cf-iconrail .cf-navbtn[aria-expanded]');
        if(nav===chats){
          // 对话图标：纯粹开关抽屉，不交给 React 的「收起列表」状态，避免两套开关互相打架
          e.preventDefault();
          e.stopPropagation();
          if(e.stopImmediatePropagation)e.stopImmediatePropagation();
          if(isOpen())close();else open();
          return;
        }
        if(i===1||i===2)open(); // 角色 / 定时任务
        return;
      }
      if(!isOpen())return;
      // 点抽屉外面任何地方都收起；点对话区时顺手吃掉这次点击，避免误触到下面的消息
      if(!t.closest('.cf-rail')){
        close();
        if(t.closest('.cf-conv')){
          e.preventDefault();
          e.stopPropagation();
          if(e.stopImmediatePropagation)e.stopImmediatePropagation();
        }
        return;
      }
      // 选中列表项后自动收起；顶部搜索/筛选区不收起
      if(!t.closest('.cf-rail__top'))setTimeout(close,0);
    },true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
    if(mq.addEventListener)mq.addEventListener('change',function(){if(!mq.matches)close()});
  })()
})` 
}

// 静态资源（renderer 产物 + src/web 自有文件）：ETag/304 + 流式读取，见 src/server/static.mjs。
const serveStatic = createStaticHandler({
  rendererDir: manifest.rendererDir,
  assetsDir: path.join(here, 'src', 'web'),
  injectIndex
})

/**
 * 路径闸门：渲染层发起的 fs / git 通道与终端 cwd 只能落在
 * 「本用户工作区 / 本用户 home」内。Agent 的读写工具不经过这里，强隔离靠
 * 一用户一容器（见 README「安全边界」）。
 *
 * 每个通道里「路径参数」的位置：只校验这些参数。
 * 旧实现扫描所有字符串参数，会把文件内容、提交信息、分支名里以 `/` 开头的文本
 * 当成越界路径拒绝（`fs:write-file(path, '/slash-start')` 就写不进去）。
 */
const JAILED = /^fs:|^git:/
const CHANNEL_PATHS = {
  'fs:open-folder': [],
  'fs:pick-attachments': [],
  'fs:paste-attachment': [],
  'fs:read-dir': ['one'],
  'fs:read-file': ['one'],
  'fs:write-file': ['one'],
  'fs:reveal-folder': ['one'],
  'fs:attachment-image': ['one'],
  'fs:dropped-entries': ['many'],
  'git:available': [],
  'git:cancel-commit-message': [],
  'git:status': ['one'],
  'git:diff': ['one', 'one'],
  'git:stage': ['one', 'many'],
  'git:unstage': ['one', 'many'],
  'git:discard': ['one', 'many', 'many'],
  'git:commit': ['one'],
  'git:set-config': ['one'],
  'git:branches': ['one'],
  'git:checkout': ['one'],
  'git:create-branch': ['one'],
  'git:checkout-remote': ['one'],
  'git:merge': ['one'],
  'git:merge-abort': ['one'],
  'git:delete-branch': ['one'],
  'git:rename-branch': ['one'],
  'git:delete-remote-branch': ['one'],
  'git:log': ['one'],
  'git:init': ['one'],
  'git:fetch': ['one'],
  'git:pull': ['one'],
  'git:push': ['one'],
  'git:generate-commit-message': ['one']
}

function isAbsolutePath(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** 单个路径参数必须落在受信根内；空值与非绝对路径（由 worker 按自身 cwd 解析）放行。 */
function assertPathInside(roots, value) {
  if (value === null || value === undefined || value === '') return
  if (typeof value !== 'string') throw new Error('路径参数类型错误')
  if (!isAbsolutePath(value)) return
  const candidate = value.split('\0')[0]
  if (!roots.some((root) => isInside(root, candidate))) {
    throw new Error(`路径超出本用户工作区: ${candidate}`)
  }
}

/**
 * 终端 cwd：worker 里的 terminal:create 直接把 cwd 交给 PTY，没有 fs 通道那层
 * fs-guard，所以相对路径（`../../etc`）和指向根外的符号链接必须在这里按真实路径拦。
 * cwd 的相对形式按 worker 的 cwd（即用户工作区）解析，与 spawn 行为一致。
 */
async function assertTerminalCwdInside(user, roots, cwd) {
  if (cwd === null || cwd === undefined || cwd === '') return
  if (typeof cwd !== 'string') throw new Error('路径参数类型错误')
  const target = path.resolve(user.workspace, cwd.split('\0')[0])
  const real = await fsp.realpath(target).catch(() => target)
  const realRoots = await Promise.all(
    roots.map(async (root) => (await fsp.realpath(root).catch(() => null)) ?? root)
  )
  if (!realRoots.some((root) => isInside(root, real))) {
    throw new Error(`路径超出本用户工作区: ${cwd}`)
  }
}

async function jailCheck(user, channel, args) {
  // pickRoots 里的所有快捷根都算受信：选择器允许跨根，选中的目录不一定落在 user.workspace 下。
  const roots = [user.workspace, user.home, ...pickRoots(user), ...userExtraRoots(user)]
  if (channel === 'terminal:create') {
    const opts = args[0]
    if (opts && typeof opts === 'object') await assertTerminalCwdInside(user, roots, opts.cwd)
    return
  }
  const specs = CHANNEL_PATHS[channel]
  if (!specs) {
    if (!JAILED.test(channel)) return
    // 尚未登记的新 fs/git 通道：没有可信的参数位置信息，宁可从严逐项校验。
    const visit = (value) => {
      if (typeof value === 'string') return assertPathInside(roots, value)
      if (Array.isArray(value)) return value.forEach(visit)
      if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    visit(args)
    return
  }
  specs.forEach((kind, index) => {
    const value = args[index]
    if (kind === 'many') {
      if (Array.isArray(value)) value.forEach((v) => assertPathInside(roots, v))
      return
    }
    assertPathInside(roots, value)
  })
}

/**
 * worker 发起一次目录选择：挂住 HTTP 请求，等浏览器里的 picker 回传后再返回。
 * 5 分钟没人响应按「取消」处理，避免 worker 永久占着 IPC。
 */
async function handleWorkerPick(req, res) {
  if (req.headers['x-deva-worker-token'] !== WORKER_TOKEN) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const body = await readJsonBody(req).catch(() => ({}))
  const raw = users.byId(String(body.userId ?? ''))
  if (!raw || raw.disabled) {
    json(res, 400, { ok: false, error: 'unknown user' })
    return
  }
  const user = withDirs(raw)
  // 没有浏览器连着（脚本调用 / 无 UI 场景）就退回默认工作区，
  // 否则 worker 会一直等到超时。
  if (!sseClients.get(user.id)?.size) {
    json(res, 200, { ok: true, value: { canceled: false, path: user.workspace } })
    return
  }
  const id = crypto.randomBytes(9).toString('base64url')
  const entry = { userId: user.id, title: '', resolve: null }
  const picked = new Promise((resolve) => {
    entry.resolve = resolve
  })
  entry.title = String(body.title ?? '选择文件夹').slice(0, 80)
  dirPicks.set(id, entry)
  broadcast(user.id, 'deva:dir-pick', { id, title: entry.title, roots: pickRoots(user) })
  const timer = setTimeout(() => {
    if (dirPicks.get(id) !== entry) return
    dirPicks.delete(id)
    entry.resolve({ canceled: true })
  }, 5 * 60_000)
  timer.unref?.()
  const value = await picked
  clearTimeout(timer)
  json(res, 200, { ok: true, value })
}

/** 浏览器端目录浏览：只列可选根内、真实路径也在根内的子目录。 */
async function handleFsList(req, res, user, url) {
  const dir = await resolvePickPath(user, url.searchParams.get('path') || user.workspace)
  if (!dir) {
    json(res, 403, { ok: false, error: '目录不在可选范围内' })
    return
  }
  const stat = await fsp.stat(dir).catch(() => null)
  if (!stat?.isDirectory()) {
    json(res, 404, { ok: false, error: '目录不存在' })
    return
  }
  const roots = pickRoots(user)
  const entries = []
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(dir, d.name)
    const real = await fsp.realpath(abs).catch(() => null)
    if (!real || !(await inBrowseScope(user, real))) continue
    const child = await fsp.stat(real).catch(() => null)
    if (child?.isDirectory()) entries.push({ name: d.name, path: abs })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const top = await fsp.realpath(BROWSE_TOP).catch(() => path.resolve(BROWSE_TOP))
  const parent = dir === top ? null : path.dirname(dir)
  json(res, 200, { ok: true, path: dir, parent, roots, entries })
}

/** 浏览器回传：取消或选中某个目录；选中的目录登记为额外受信根。 */
async function handlePickResolve(req, res, user, session, id) {
  if (!csrfOk(session, req.headers['x-deva-csrf'])) {
    json(res, 403, { ok: false, error: 'csrf token invalid' })
    return
  }
  const entry = dirPicks.get(id)
  if (!entry || entry.userId !== user.id) {
    json(res, 404, { ok: false, error: '选择请求已过期' })
    return
  }
  const body = await readJsonBody(req).catch(() => ({}))
  if (body.canceled) {
    dirPicks.delete(id)
    entry.resolve({ canceled: true })
    json(res, 200, { ok: true })
    return
  }
  const create = body.create === true
  const dir = create ? await resolveCreatePath(user, body.path) : await resolvePickPath(user, body.path)
  if (!dir) {
    json(res, 400, {
      ok: false,
      error: create ? '无法创建该文件夹：路径不在可选范围内或已被文件占用' : '目录不在可选范围内'
    })
    return
  }
  dirPicks.delete(id)
  if (!pickRoots(user).some((root) => isInside(root, dir))) rememberRoot(user, dir)
  entry.resolve({ canceled: false, path: dir })
  json(res, 200, { ok: true })
}

/**
 * 登录后的跳转目标只接受站内路径：`//evil.example`、`/\evil.example` 会被浏览器
 * 当成协议相对 URL 跳到外站（开放重定向）。要求单个前导斜杠，且不含反斜杠与空白。
 */
function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.includes('\\') || /[\s\0]/.test(raw)) return '/'
  return raw
}

async function handleLogin(req, res) {
  const contentType = String(req.headers['content-type'] ?? '')
  const body = contentType.includes('application/json')
    ? await readJsonBody(req).catch(() => null)
    : Object.fromEntries(await readForm(req).catch(() => new URLSearchParams()))
  if (!body) {
    html(res, 400, loginPage({ error: '请求格式错误' }))
    return
  }
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const next = safeNext(body.next)
  const user = users.find(username)
  const ok = Boolean(user && !user.disabled && verifyPassword(password, user.passwordHash))
  const ip = req.socket.remoteAddress ?? ''
  if (!ok) {
    audit.auth({ event: 'login-failed', username, ip })
    html(res, 401, loginPage({ error: '用户名或密码错误', next }))
    return
  }
  const session = sessions.create(user)
  setCookie(res, session.id, Math.floor(SESSION_TTL_MS / 1000))
  audit.auth({ event: 'login', username: user.username, ip })
  redirect(res, next)
}

async function handleInvoke(req, res, user, session) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (!csrfOk(session, req.headers['x-deva-csrf'])) {
    json(res, 403, { ok: false, error: 'csrf token invalid' })
    return
  }
  const started = Date.now()
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    json(res, 400, { ok: false, error: 'bad json' })
    return
  }
  const channel = String(body.channel ?? '')
  const args = Array.isArray(body.args) ? body.args : []
  if (!channel) {
    json(res, 400, { ok: false, error: 'channel required' })
    return
  }

  try {
    await jailCheck(user, channel, args)
    if (body.fireAndForget) {
      await pool.send(user, channel, args)
      audit.append(user.id, { channel, args: summarize(args), ok: true, ms: Date.now() - started })
      res.writeHead(204).end()
      return
    }
    const value = await pool.invoke(user, channel, args)
    audit.append(user.id, {
      channel,
      args: summarize(args),
      ok: true,
      ms: Date.now() - started
    })
    json(res, 200, { ok: true, value: value ?? null })
  } catch (error) {
    const message = String(error?.message ?? error)
    audit.append(user.id, {
      channel,
      args: summarize(args),
      ok: false,
      error: message,
      ms: Date.now() - started
    })
    json(res, 200, { ok: false, error: message })
  }
}

function handleEvents(req, res, user) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  res.write(': connected\n\n')
  if (!sseClients.has(user.id)) sseClients.set(user.id, new Set())
  const set = sseClients.get(user.id)
  set.add(res)
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* ignore */
    }
  }, 15_000)
  timer.unref?.()
  req.on('close', () => {
    clearInterval(timer)
    set.delete(res)
    if (set.size === 0) sseClients.delete(user.id)
  })
}

/** 表单 POST 解析（application/x-www-form-urlencoded）。 */
async function readForm(req) {
  const raw = await new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 64 * 1024) reject(new Error('form too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
  return new URLSearchParams(raw)
}

async function handleAdminPost(req, res, session, user, pathname) {
  const form = await readForm(req)
  if (form.get('csrf') !== session.csrf) {
    html(res, 403, errorPage(403, 'CSRF 校验失败'))
    return
  }
  const back = (error = '', notice = '') =>
    html(
      res,
      error ? 400 : 200,
      adminPage({
        user,
        users: users.list(),
        audit: audit.read(user.id, 120),
        update: updater.snapshot(),
        error,
        notice,
        csrf: session.csrf
      })
    )

  try {
    if (pathname === '/admin/create') {
      const created = await users.create({
        username: form.get('username') ?? '',
        password: form.get('password') ?? '',
        role: form.get('role') === 'admin' ? 'admin' : 'user'
      })
      audit.auth({ event: 'user-created', by: user.username, username: created.username })
      back('', `已创建用户 ${created.username}`)
      return
    }
    if (pathname === '/admin/password') {
      const id = String(form.get('id') ?? '')
      await users.setPassword(id, form.get('password') ?? '')
      sessions.destroyUser(id)
      audit.auth({ event: 'password-reset', by: user.username, userId: id })
      back('', '密码已重置，该用户需重新登录')
      return
    }
    if (pathname === '/admin/delete') {
      const id = String(form.get('id') ?? '')
      if (id === user.id) throw new Error('不能删除自己')
      const target = users.byId(id)
      await users.remove(id)
      sessions.destroyUser(id)
      pool.stop(id, 'user-deleted')
      audit.auth({ event: 'user-deleted', by: user.username, username: target?.username })
      back('', `已删除用户 ${target?.username ?? id}`)
      return
    }
    if (pathname === '/admin/update-check') {
      const before = updater.snapshot()
      await updater.check()
      const now = updater.snapshot()
      audit.auth({
        event: 'update-check',
        by: user.username,
        from: before.latestShort,
        latest: now.latestShort,
        updateAvailable: now.updateAvailable
      })
      if (now.error) {
        back(`检查失败：${now.error}`)
      } else if (now.updateAvailable) {
        back('', `发现新提交 ${now.latestShort}`)
      } else {
        back('', `已是最新（${now.latestShort || 'unknown'}）`)
      }
      return
    }
    html(res, 404, errorPage(404, '未知的管理操作'))
  } catch (error) {
    back(String(error?.message ?? error))
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const pathname = url.pathname

  try {
    if (pathname === '/healthz') {
      json(res, 200, { ok: true, users: users.list().length })
      return
    }

    // 图标必须在鉴权之前：浏览器请求 favicon 时不带/不该依赖会话，登录页也要有图标。
    if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        text(res, 405, 'method not allowed')
        return
      }
      await serveStatic(req, res, pathname)
      return
    }

    // worker 内部回环：不带会话 Cookie，用一次性 token 鉴权。
    if (pathname === '/api/dir-pick' && req.method === 'POST') {
      await handleWorkerPick(req, res)
      return
    }

    if (pathname === '/login') {
      if (sessionOf(req)) {
        redirect(res, '/')
        return
      }
      if (req.method === 'POST') {
        await handleLogin(req, res)
        return
      }
      html(res, 200, loginPage({ next: safeNext(url.searchParams.get('next') ?? '/') }))
      return
    }

    if (pathname === '/logout') {
      const cookies = parseCookies(req.headers.cookie)
      const session = sessions.get(cookies[COOKIE])
      if (session) {
        sessions.destroy(session.id)
        audit.auth({ event: 'logout', username: session.username, ip: req.socket.remoteAddress ?? '' })
      }
      setCookie(res, '', 0)
      redirect(res, '/login')
      return
    }

    const ctx = sessionOf(req)
    if (!ctx) {
      if (pathname.startsWith('/api/')) {
        json(res, 401, { ok: false, error: 'unauthorized' })
        return
      }
      redirect(res, `/login?next=${encodeURIComponent(pathname + url.search)}`)
      return
    }
    const { session, user } = ctx

    if (pathname === '/api/me') {
      json(res, 200, { ok: true, user: { id: user.id, username: user.username, role: user.role } })
      return
    }

    if (pathname === '/api/fs/list') {
      await handleFsList(req, res, user, url)
      return
    }

    if (pathname === '/api/dir-pick/pending') {
      const picks = []
      for (const [id, entry] of dirPicks) {
        if (entry.userId === user.id) picks.push({ id, title: entry.title, roots: pickRoots(user) })
      }
      json(res, 200, { ok: true, picks })
      return
    }

    if (pathname.startsWith('/api/dir-pick/') && req.method === 'POST') {
      await handlePickResolve(req, res, user, session, pathname.slice('/api/dir-pick/'.length))
      return
    }

    if (pathname === '/api/update') {
      if (user.role !== 'admin') {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      json(res, 200, { ok: true, ...updater.snapshot() })
      return
    }

    if (pathname === '/api/channels') {
      const channels = await pool.channels(user)
      json(res, 200, { ok: true, count: channels.length, channels })
      return
    }

    if (pathname === '/api/events') {
      handleEvents(req, res, user)
      return
    }

    if (pathname === '/api/invoke') {
      await handleInvoke(req, res, user, session)
      return
    }

    if (pathname === '/boot.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(bootScript(user, session))
      return
    }

    if (pathname === '/shim.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(shimSource)
      return
    }

    if (pathname === '/shell.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(shellScript(user.username, user.role))
      return
    }

    if (pathname === '/admin') {
      if (user.role !== 'admin') {
        html(res, 403, errorPage(403, '需要管理员权限'))
        return
      }
      html(
        res,
        200,
        adminPage({
          user,
          users: users.list(),
          audit: audit.read(user.id, 120),
          update: updater.snapshot(),
          csrf: session.csrf
        })
      )
      return
    }

    if (pathname.startsWith('/admin/')) {
      if (user.role !== 'admin') {
        html(res, 403, errorPage(403, '需要管理员权限'))
        return
      }
      if (req.method !== 'POST') {
        redirect(res, '/admin')
        return
      }
      await handleAdminPost(req, res, session, user, pathname)
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      text(res, 405, 'method not allowed')
      return
    }

    await serveStatic(req, res, pathname)
  } catch (error) {
    console.error('[deva-web] request failed:', error)
    if (!res.headersSent) json(res, 500, { ok: false, error: String(error?.message ?? error) })
    else res.end()
  }
})

const shutdown = (signal) => {
  console.log(`[deva-web] ${signal}, shutting down`)
  updater.stop()
  pool.stopAll(signal)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

server.listen(PORT, HOST, () => {
  console.log(`[deva-web] http://${HOST}:${PORT}`)
  console.log(`[deva-web] data=${DATA_ROOT} renderer=${manifest.rendererDir}`)
  console.log('[deva-web] 登录页 /login，管理页 /admin；每用户独立后端进程')
  if (UPDATE_MINUTES < 0) {
    console.log('[deva-web] 更新检查已关闭（DEVA_UPDATE_CHECK_MINUTES<0）')
  } else {
    console.log(
      `[deva-web] 更新检查 ${updater.ref} @ ${updater.current.slice(0, 7) || 'unknown'}，每 ${UPDATE_MINUTES} 分钟`
    )
  }
})
