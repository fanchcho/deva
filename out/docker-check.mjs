#!/usr/bin/env node
/**
 * Docker 资产静态校验（本机无 docker daemon / buildx / compose 插件，无法真正构建）。
 *
 * 这里只回答「配置对不对」这类能在本地断言的问题：
 *   · Dockerfile 结构：阶段声明、--from 指向、COPY 来源、ENTRYPOINT/CMD/EXPOSE/HEALTHCHECK；
 *   · 构建上下文里的 COPY 源：存在、被 git 跟踪（CI 的 checkout 里只有跟踪文件）、未被 .dockerignore 排除；
 *   · 从 builder 阶段 COPY 出来的产物：与本地 `pnpm build` + `pnpm --filter @deva/web build` 的实际路径一致；
 *   · docker-compose.yml：能被 YAML 解析、默认跑远程镜像、端口与 EXPOSE 对得上、数据卷语义不变；
 *   · 本地构建覆盖层 docker-compose.build.yaml：build.context/dockerfile 能解析到真实文件；
 *   · watchtower：固定 tag、scope 隔离、label 白名单、只读 socket、cleanup；
 *   · 镜像发布 workflow（.github/workflows/image.yml）：触发条件、packages: write、登录、tag 集、缓存；
 *   · ci.yml 里不再残留第二套镜像构建（否则两处会各自漂移）。
 *
 * 真正跑 `docker build` / 真正 pull+push 的只有 GitHub runner（image.yml 的 publish job）。
 * 用法：node out/docker-check.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import ignore from 'ignore'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCKERFILE = 'apps/web/Dockerfile'
const COMPOSE = 'apps/web/docker-compose.yml'
const COMPOSE_BUILD = 'apps/web/docker-compose.build.yaml'
const CI = '.github/workflows/ci.yml'
const IMAGE_WF = '.github/workflows/image.yml'

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

const abs = (rel) => path.join(ROOT, rel)
const read = (rel) => fs.readFileSync(abs(rel), 'utf8')

/** git 跟踪文件集合（CI 的 build context 只有这些）。 */
const tracked = new Set(
  execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
)

/** .dockerignore 判定：Docker 语义是「最后一条匹配的规则生效」，ignore 包正好如此。 */
const dockerignoreRules = (() => {
  const file = abs('.dockerignore')
  if (!fs.existsSync(file)) return null
  return ignore().add(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')))
})()

/** 某个上下文路径是否会被打进构建上下文。 */
function inContext(relPath) {
  const clean = relPath.replace(/^\.\//, '').replace(/\/$/, '')
  // `COPY . .` 指的是整个上下文；ignore 包不接受空路径，根目录本身也不可能被忽略。
  if (clean === '' || clean === '.') return { exists: true, ignored: false, tracked: true, wholeContext: true }
  const exists = fs.existsSync(abs(clean))
  const ignored = dockerignoreRules ? dockerignoreRules.ignores(clean) : false
  // 目录被忽略但文件未被忽略的情况交给下面逐文件检查
  return { exists, ignored, tracked: tracked.has(clean) }
}

// ── 1) 解析 Dockerfile ────────────────────────────────────────────────────────
const rawLines = read(DOCKERFILE).split('\n')
/** 把行尾反斜杠续行合并成一条逻辑指令。 */
const instructions = []
for (let i = 0; i < rawLines.length; i++) {
  let line = rawLines[i]
  if (!line.trim() || line.trim().startsWith('#')) continue
  while (line.trimEnd().endsWith('\\') && i + 1 < rawLines.length) {
    line = line.trimEnd().slice(0, -1) + ' ' + rawLines[++i].trim()
  }
  const m = /^([A-Za-z]+)\s+(.*)$/.exec(line.trim())
  if (m) instructions.push({ cmd: m[1].toUpperCase(), args: m[2].trim(), line: i + 1 })
}

const stages = []
for (const ins of instructions) {
  if (ins.cmd !== 'FROM') continue
  const m = /^(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i.exec(ins.args)
  stages.push({ image: m?.[1], name: m?.[2] ?? null, line: ins.line })
}
const stageNames = stages.map((s) => s.name).filter(Boolean)

check('Dockerfile 至少两个阶段（builder + runtime）', stages.length >= 2, `阶段数=${stages.length}`)
check('builder 阶段有名字', stageNames.includes('builder'), stageNames.join(','))
check('runtime 阶段（最后一个）有名字', stageNames.includes('runtime'), stageNames.join(','))
check(
  '每个 --from 都指向已声明的阶段或镜像',
  instructions
    .filter((i) => i.cmd === 'COPY' && i.args.includes('--from='))
    .every((i) => {
      const from = /--from=(\S+)/.exec(i.args)[1]
      return stageNames.includes(from) || stages.some((s) => s.image === from)
    }),
  '存在指向未声明阶段的 COPY'
)
check('第一阶段不依赖本地产物（FROM 是公开镜像）', stages[0]?.image?.startsWith('node:'), stages[0]?.image)

// ── 2) 构建上下文里的 COPY 源 ────────────────────────────────────────────────
const contextCopies = instructions
  .filter((i) => i.cmd === 'COPY' && !i.args.includes('--from='))
  .flatMap((i) => {
    const parts = i.args.split(/\s+/).filter((p) => !p.startsWith('--'))
    return parts.slice(0, -1).map((src) => ({ src: src.replace(/^\.\//, ''), line: i.line }))
  })

check('Dockerfile 有构建上下文 COPY', contextCopies.length > 0, `共 ${contextCopies.length} 条`)
for (const { src, line } of contextCopies) {
  const info = inContext(src)
  check(`COPY 源存在: ${src}`, info.exists, `第 ${line} 行`)
  check(`COPY 源被 git 跟踪（CI checkout 里存在）: ${src}`, info.tracked, `第 ${line} 行`)
  check(`COPY 源未被 .dockerignore 排除: ${src}`, !info.ignored, `第 ${line} 行`)
}

// ── 3) 从 builder 阶段 COPY 的产物：与本地构建产物路径一致 ──────────────────
const fromBuilder = instructions
  .filter((i) => i.cmd === 'COPY' && /--from=builder/.test(i.args))
  .map((i) => i.args.split(/\s+/).filter((p) => !p.startsWith('--')).slice(0, -1))
  .flat()

const producedByBuild = {
  'apps/desktop/out/renderer': 'pnpm build（electron-vite renderer 产物）',
  'apps/web/dist': 'pnpm --filter @deva/web build（build.mjs 的 dist）',
  'apps/web/server.mjs': '源码（被原样送进镜像）',
  'apps/web/package.json': '源码',
  'apps/web/src': '源码（server.mjs 运行时 import 的 .mjs）'
}
for (const src of fromBuilder) {
  // /runtime/... 是 Dockerfile 在 builder 阶段自己造出来的（cp -rL 解引用 node-pty），不在源码树里；
  // 其余 /src/... 都必须能在本地构建产物里找到同名路径。
  const selfMade = src.startsWith('/runtime/')
  const local = src.replace(/^\/(src|runtime)\//, '')
  check(
    `builder 产物路径与本地构建一致: ${src}`,
    selfMade || fs.existsSync(abs(local)),
    selfMade ? '（Dockerfile 内自建）' : `本地缺 ${local}，请先跑 ${producedByBuild[local] ?? '构建'}`
  )
}

/** 所有会被送进镜像的文件（上下文 COPY + builder 阶段 COPY），用于核对 ENTRYPOINT 等运行期路径。 */


// ── 4) 启动契约 ──────────────────────────────────────────────────────────────
const entrypoint = instructions.find((i) => i.cmd === 'ENTRYPOINT')
const cmd = instructions.find((i) => i.cmd === 'CMD')
const healthcheck = instructions.find((i) => i.cmd === 'HEALTHCHECK')
const expose = instructions.find((i) => i.cmd === 'EXPOSE')

check('有 ENTRYPOINT（降权入口）', Boolean(entrypoint), entrypoint?.args)
check('有 CMD（默认启动 node server.mjs）', Boolean(cmd) && /server\.mjs/.test(cmd.args), cmd?.args)
check('有 HEALTHCHECK（/healthz）', Boolean(healthcheck) && /healthz/.test(healthcheck.args))
check('有 EXPOSE', Boolean(expose), expose?.args)

const entryPath = /"(\/[^"]+)"/.exec(entrypoint?.args ?? '')?.[1]
check('ENTRYPOINT 指向脚本路径', Boolean(entryPath), entrypoint?.args)

/** COPY 指令的 (源, 目标) —— 用来把运行期绝对路径映射回仓库里的文件。 */
const copies = instructions
  .filter((i) => i.cmd === 'COPY')
  .map((i) => {
    const parts = i.args.split(/\s+/).filter((p) => !p.startsWith('--'))
    const dest = parts.at(-1)
    const sources = parts.slice(0, -1).map((s) => {
      const from = /--from=(\S+)/.exec(i.args)?.[1]
      // 来自构建阶段（builder）的路径保留 /src/ 前缀，去掉后就是仓库相对路径
      if (from) return s.replace(/^\/src\//, '')
      return s.replace(/^\.\//, '')
    })
    return { sources, dest: dest.replace(/\/$/, '') }
  })

if (entryPath) {
  // 目标可能是脚本本身的路径，也可能是目录（此时源文件名不变）
  const hit = copies.find(
    (c) => c.dest === entryPath || (c.sources.length > 0 && entryPath === `${c.dest}/${path.basename(c.sources[0])}`)
  )
  const script = hit?.sources[0]
  check('ENTRYPOINT 脚本由 COPY 送进镜像', Boolean(script), `目标=${entryPath}`)
  if (script) {
    check('entrypoint 源文件存在', fs.existsSync(abs(script)), script)
    check('entrypoint 有 shebang', fs.existsSync(abs(script)) && read(script).startsWith('#!'), script)
    check('entrypoint 有可执行位', fs.existsSync(abs(script)) && (fs.statSync(abs(script)).mode & 0o111) !== 0, script)
    check(
      'Dockerfile 里对 entrypoint 做了 chmod +x（checkout 会丢权限位）',
      instructions.some((i) => i.cmd === 'RUN' && /chmod \+x/.test(i.args) && i.args.includes(entryPath))
    )
    check('entrypoint 会 drop 到非 root（setpriv 或 su）', /setpriv|su -s/.test(read(script)))
    check('entrypoint 用 exec 交付进程（信号可透传）', /exec /.test(read(script)))
  }
}

// ── 5) docker-compose.yml（默认形态：跑远程镜像，不本地构建）────────────────
/** 从 git remote 的 origin 推导 owner/repo，避免把 ghcr 路径写死成猜的。 */
function ghcrRepo() {
  const url = execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : ''
}
const REPO = ghcrRepo()
check('能从 origin 解析出 owner/repo', /^[\w.-]+\/[\w.-]+$/.test(REPO), REPO || '解析失败')

let compose = null
try {
  compose = yaml.load(read(COMPOSE))
  check('compose 能被 YAML 解析', true)
} catch (error) {
  check('compose 能被 YAML 解析', false, error.message)
}

const EXPECTED_ENV = [
  'DEVA_WEB_ADMIN_USER',
  'DEVA_WEB_ADMIN_PASSWORD',
  'DEVA_WEB_SESSION_HOURS',
  'DEVA_WEB_IDLE_MINUTES',
  'DEVA_WEB_SECURE_COOKIE',
  'DEVA_WEB_ROOTS',
  'LANG',
  'LC_ALL',
  'DEVA_UPDATE_CHECK_MINUTES',
  'DEVA_UPDATE_TOKEN',
  'DEVA_UPDATE_WEBHOOK',
  'DEVA_UPDATE_WEBHOOK_KIND',
  'DEVA_UPDATE_TELEGRAM_CHAT_ID',
  'TZ'
]

if (compose) {
  const svc = compose.services?.['deva-web']
  check('compose 有 deva-web 服务', Boolean(svc))
  // 默认 up 不能触发本地 build：build 段只允许出现在 docker-compose.build.yaml 覆盖层里。
  check('默认 compose 不含 build（up 不会本地编译）', !svc?.build, JSON.stringify(svc?.build ?? null))
  const image = String(svc?.image ?? '')
  check(
    'deva-web 引用 ghcr.io/<owner>/<repo> 镜像',
    image.includes(`ghcr.io/${REPO}`),
    image
  )
  check('镜像名可用 DEVA_WEB_IMAGE 覆盖', image.includes('${DEVA_WEB_IMAGE:-'), image)
  check('默认 tag 为 latest', /\$\{DEVA_WEB_IMAGE:-[^}]*:latest\}/.test(image), image)
  check('deva-web pull_policy 为 always（每次核对远端 digest）', svc?.pull_policy === 'always', String(svc?.pull_policy))

  const exposePort = Number(expose?.args)
  const portMaps = (svc?.ports ?? []).map(String)
  check(
    'compose 端口映射的容器侧端口与 EXPOSE 一致',
    portMaps.every((p) => p.split(':').pop() === String(exposePort)),
    `EXPOSE=${exposePort} ports=${portMaps.join(',')}`
  )
  check('compose 开了 no-new-privileges', (svc?.security_opt ?? []).some((o) => String(o).startsWith('no-new-privileges')))
  check('compose 给 /dev/shm 调大了（Chromium 需要）', Boolean(svc?.shm_size), String(svc?.shm_size))
  check('compose 挂载了命名卷到 /data', (svc?.volumes ?? []).some((v) => /^deva-data:\/data$/.test(String(v))))
  check('compose 未设置与 Dockerfile 冲突的 USER', !Object.hasOwn(svc ?? {}, 'user'))

  // 换镜像不改语义：env / 端口 / 卷必须一项不少。
  const envKeys = Object.keys(svc?.environment ?? {})
  const missingEnv = EXPECTED_ENV.filter((k) => !envKeys.includes(k))
  check('env 项一个不少（换镜像后语义不变）', missingEnv.length === 0, `缺: ${missingEnv.join(',')}`)
  check(
    '数据卷仍是 deva-data（换镜像不丢用户/会话）',
    (svc?.volumes ?? []).some((v) => String(v) === 'deva-data:/data') &&
      compose.volumes !== null && Object.hasOwn(compose.volumes ?? {}, 'deva-data')
  )
  // project name 取目录名，卷名随之变成 web_deva-data；显式覆盖 name 会让旧卷「消失」。
  check('compose 没有覆盖顶层 name（否则卷名变化，旧数据看起来丢失）', !Object.hasOwn(compose, 'name'))

  const labels = svc?.labels ?? {}
  check('deva-web 带 watchtower scope label', labels['com.centurylinklabs.watchtower.scope'] === 'deva', JSON.stringify(labels))
  check('deva-web 带 watchtower enable=true', labels['com.centurylinklabs.watchtower.enable'] === 'true', String(labels['com.centurylinklabs.watchtower.enable']))

  // build.mjs 要读 git HEAD 写进 build-info.json，构建上下文不能把 .git 排除掉
  const ignoreLines = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  check('.dockerignore 没有排除 .git（build.mjs 要读 HEAD）', !ignoreLines.some((l) => /^!?\.git\/?$/.test(l)))

  // ── 5b) watchtower ────────────────────────────────────────────────────────
  const wt = compose.services?.watchtower
  check('compose 有 watchtower 服务', Boolean(wt))
  if (wt) {
    const wtImage = String(wt.image ?? '')
    check('watchtower 用固定 tag（不是 :latest）', /^containrrr\/watchtower:\d+\.\d+\.\d+$/.test(wtImage), wtImage)
    const binds = (wt.volumes ?? []).map(String)
    check(
      'watchtower 只读挂载 docker.sock',
      binds.some((v) => v === '/var/run/docker.sock:/var/run/docker.sock:ro'),
      binds.join(',')
    )
    const wenv = wt.environment ?? {}
    check('watchtower 开了 WATCHTOWER_CLEANUP', wenv.WATCHTOWER_CLEANUP === 'true', String(wenv.WATCHTOWER_CLEANUP))
    check('watchtower 开了 label 白名单', wenv.WATCHTOWER_LABEL_ENABLE === 'true', String(wenv.WATCHTOWER_LABEL_ENABLE))
    check('watchtower 的 scope 与 deva-web 一致', wenv.WATCHTOWER_SCOPE === 'deva', String(wenv.WATCHTOWER_SCOPE))
    // 允许 ${VAR:-900} 形态：取默认值做断言，避免把「可覆盖」误判成「没设」。
    const poll = /^\$\{[^:}]+:-?(\d+)\}$/.exec(String(wenv.WATCHTOWER_POLL_INTERVAL ?? ''))?.[1] ?? String(wenv.WATCHTOWER_POLL_INTERVAL ?? '')
    check('watchtower 轮询间隔是正整数秒（≥60）', /^\d+$/.test(poll) && Number(poll) >= 60, String(wenv.WATCHTOWER_POLL_INTERVAL))
    const wlabels = wt.labels ?? {}
    check(
      'watchtower 自身也带 scope label（不被别的 scope 实例当成无 scope 容器）',
      wlabels['com.centurylinklabs.watchtower.scope'] === 'deva'
    )
    check(
      'watchtower 自身不在 enable 白名单里（不自我升级）',
      wlabels['com.centurylinklabs.watchtower.enable'] !== 'true'
    )
    check('watchtower 不暴露端口', !wt.ports, JSON.stringify(wt.ports ?? null))
    check('watchtower 不声明 depends_on（避免误导级联重启）', !wt.depends_on)
  }
}

// ── 5c) 本地构建覆盖层 docker-compose.build.yaml ────────────────────────────
let overlay = null
try {
  overlay = yaml.load(read(COMPOSE_BUILD))
  check('build 覆盖层能被 YAML 解析', true)
} catch (error) {
  check('build 覆盖层能被 YAML 解析', false, error.message)
}
if (overlay) {
  const svc = overlay.services?.['deva-web']
  const ctx = svc?.build?.context
  const df = svc?.build?.dockerfile
  check('覆盖层声明了 build.context', Boolean(ctx), String(ctx))
  check('覆盖层声明了 build.dockerfile', Boolean(df), String(df))
  if (ctx && df) {
    const ctxAbs = path.resolve(path.dirname(abs(COMPOSE_BUILD)), ctx)
    check('覆盖层 build.context 解析到仓库根', ctxAbs === ROOT, `${ctxAbs} vs ${ROOT}`)
    check('覆盖层 build.dockerfile 文件存在', fs.existsSync(path.join(ctxAbs, df)), path.join(ctxAbs, df))
    check('覆盖层的 dockerfile 与静态校验的是同一份', path.resolve(path.join(ctxAbs, df)) === abs(DOCKERFILE))
  }
  check('覆盖层 pull_policy 改成 build（否则会先拉远程镜像再丢掉本地构建）', svc?.pull_policy === 'build', String(svc?.pull_policy))
  check('覆盖层的本地镜像 tag 与远程 latest 区分开', !String(svc?.image ?? '').includes('ghcr.io'), String(svc?.image))
  check('覆盖层不重复定义 watchtower', !overlay.services?.watchtower)
}

// ── 6) 镜像发布 workflow（image.yml）───────────────────────────────────────
let imageWf = null
try {
  imageWf = yaml.load(read(IMAGE_WF))
  check('image.yml 能被 YAML 解析', true)
} catch (error) {
  check('image.yml 能被 YAML 解析', false, error.message)
}
if (imageWf) {
  check('image.yml 有 packages: write 权限', imageWf.permissions?.packages === 'write', JSON.stringify(imageWf.permissions))
  check('image.yml 的 contents 只读', imageWf.permissions?.contents === 'read')
  const on = imageWf.on ?? {}
  check('image.yml 在 pull_request 上触发（构建但不推）', Object.hasOwn(on, 'pull_request'))
  check('image.yml 支持 workflow_dispatch', Object.hasOwn(on, 'workflow_dispatch'))
  const pushCfg = on.push ?? {}
  check('image.yml 推 main 时发布', (pushCfg.branches ?? []).includes('main'), JSON.stringify(pushCfg.branches))
  check(
    'image.yml 推当前集成分支时发布',
    (pushCfg.branches ?? []).includes('feat/plugin-deva-agent'),
    JSON.stringify(pushCfg.branches)
  )
  check('image.yml 支持 v* tag', (pushCfg.tags ?? []).includes('v*'), JSON.stringify(pushCfg.tags))

  const steps = imageWf.jobs?.publish?.steps ?? []
  const uses = steps.map((s) => String(s.uses ?? ''))
  const byPrefix = (p) => steps.find((s) => String(s.uses ?? '').startsWith(p))

  const versionStep = steps.find((s) => /check-versions/.test(String(s.run ?? '')))
  check('image.yml 发布前跑 check:versions', Boolean(versionStep))
  check(
    'image.yml 的版本号取自 apps/desktop/package.json（单一事实源）',
    /apps\/desktop\/package\.json/.test(String(versionStep?.run ?? ''))
  )

  const login = byPrefix('docker/login-action')
  check('image.yml 用 GITHUB_TOKEN 登录 ghcr.io', Boolean(login) && login.with?.registry === 'ghcr.io' && String(login.with?.password).includes('GITHUB_TOKEN'))
  check('image.yml 在 PR 上不登录（fork 无 packages:write）', String(login?.if ?? '').includes('pull_request'))

  const meta = byPrefix('docker/metadata-action')
  check('image.yml 用 github.repository 生成镜像名（不写死 owner）', String(meta?.with?.images ?? '').includes('github.repository'))
  const tagCfg = String(meta?.with?.tags ?? '')
  check('image.yml 有 sha-<short> tag', /type=sha,format=short/.test(tagCfg))
  check('image.yml 有版本号 tag', /type=raw,value=\$\{\{ steps\.version\.outputs\.value \}\}/.test(tagCfg))
  check('image.yml 的 latest 只在 main 上', /type=raw,value=latest,enable=\$\{\{ github\.ref == 'refs\/heads\/main' \}\}/.test(tagCfg))
  check('image.yml 的 edge 只在集成分支上', /type=raw,value=edge,enable=/.test(tagCfg))
  check('image.yml 有 v* tag 规则', /type=ref,event=tag/.test(tagCfg))

  const buildStep = byPrefix('docker/build-push-action')
  check('image.yml 使用 buildx', uses.some((u) => u.startsWith('docker/setup-buildx-action')))
  check('image.yml 的 context 为仓库根', (buildStep?.with?.context ?? '.') === '.', String(buildStep?.with?.context))
  check('image.yml 的 file 指向 apps/web/Dockerfile', buildStep?.with?.file === DOCKERFILE, String(buildStep?.with?.file))
  check(
    'image.yml 只在非 PR 时 push',
    String(buildStep?.with?.push ?? '').includes('pull_request'),
    String(buildStep?.with?.push)
  )
  check('image.yml 明确只出 linux/amd64（多架构成本见注释）', buildStep?.with?.platforms === 'linux/amd64', String(buildStep?.with?.platforms))
  check('image.yml 开 gha 缓存（读写）', String(buildStep?.with?.['cache-from'] ?? '').includes('gha') && String(buildStep?.with?.['cache-to'] ?? '').includes('gha'))
}

// ── 7) ci.yml：不再有第二套镜像构建，原有检查仍在 ──────────────────────────
let ci = null
try {
  ci = yaml.load(read(CI))
  check('ci.yml 能被 YAML 解析', true)
} catch (error) {
  check('ci.yml 能被 YAML 解析', false, error.message)
}
if (ci) {
  const jobs = ci.jobs ?? {}
  const hasImageJob = Object.values(jobs).some((job) =>
    (job.steps ?? []).some((s) => String(s.uses ?? '').includes('docker/build-push-action'))
  )
  check('ci.yml 不再重复构建镜像（唯一构建点是 image.yml）', !hasImageJob, Object.keys(jobs).join(','))

  const checkRuns = (jobs.check?.steps ?? []).map((s) => String(s.run ?? ''))
  check('check job 跑了 desktop 单测', checkRuns.some((r) => r.includes('test:desktop')))
  check('check job 跑了版本一致性断言', checkRuns.some((r) => r.includes('check:versions')))
  check('ci.yml 注明了镜像构建已迁到 image.yml', /image\.yml/.test(read(CI)))
}

// ── 8) 配套文件：备用脚本与运维文档 ────────────────────────────────────────
const redeploy = 'scripts/redeploy.sh'
check('存在 scripts/redeploy.sh', fs.existsSync(abs(redeploy)))
if (fs.existsSync(abs(redeploy))) {
  const script = read(redeploy)
  check('redeploy.sh 有可执行位', (fs.statSync(abs(redeploy)).mode & 0o111) !== 0)
  check('redeploy.sh 叠加两个 compose 文件', /docker-compose\.build\.yaml/.test(script) && /docker-compose\.yml/.test(script))
  check('redeploy.sh 会 build 并 up -d', /build/.test(script) && /up -d/.test(script))
  check('redeploy.sh 检查容器健康状态', /State\.Health|health/i.test(script))
}
const ops = 'out/OPS.md'
check('存在 out/OPS.md 运维说明', fs.existsSync(abs(ops)))
if (fs.existsSync(abs(ops))) {
  const doc = read(ops)
  check('OPS.md 说明 watchtower 只看 digest、看不到源码', /digest/.test(doc) && /看不到|看不见/.test(doc))
  check('OPS.md 给出回滚到 sha- 的方法', /sha-/.test(doc) && /回滚/.test(doc))
  check('OPS.md 覆盖私有包 401', /401/.test(doc))
}

// ── 9) 旧的「build && up -d」提示不再残留 ─────────────────────────────────
for (const file of ['apps/web/src/server/pages.mjs', 'apps/web/src/server/updater.mjs']) {
  const src = read(file)
  check(`${path.basename(file)} 不再提示 docker compose build`, !/docker compose build/.test(src))
  check(`${path.basename(file)} 提示改为 pull + up`, /docker compose pull deva-web/.test(src))
}

console.log(`\nRESULT pass=${pass} fail=${fail}`)
// 说明：本脚本只做静态断言，不连接 docker daemon；镜像能否真正构建/推送由 image.yml 在 runner 上证明。
process.exit(fail ? 1 : 0)
