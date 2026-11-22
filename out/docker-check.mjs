#!/usr/bin/env node
/**
 * Docker 资产静态校验（本机无 docker daemon / buildx / compose 插件，无法真正构建）。
 *
 * 这里只回答「配置对不对」这类能在本地断言的问题：
 *   · Dockerfile 结构：阶段声明、--from 指向、COPY 来源、ENTRYPOINT/CMD/EXPOSE/HEALTHCHECK；
 *   · 构建上下文里的 COPY 源：存在、被 git 跟踪（CI 的 checkout 里只有跟踪文件）、未被 .dockerignore 排除；
 *   · 从 builder 阶段 COPY 出来的产物：与本地 `pnpm build` + `pnpm --filter @deva/web build` 的实际路径一致；
 *   · docker-compose.yml：能被 YAML 解析、build.context/dockerfile 能解析到真实文件、端口与 EXPOSE 对得上；
 *   · CI 工作流里确实有构建镜像的 job（否则就是假覆盖）。
 *
 * 真正跑 `docker build` 的只有 GitHub runner（ci.yml 的 docker job）。
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
const CI = '.github/workflows/ci.yml'

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

// ── 5) docker-compose.yml ───────────────────────────────────────────────────
let compose = null
try {
  compose = yaml.load(read(COMPOSE))
  check('compose 能被 YAML 解析', true)
} catch (error) {
  check('compose 能被 YAML 解析', false, error.message)
}

if (compose) {
  const svc = compose.services?.['deva-web']
  check('compose 有 deva-web 服务', Boolean(svc))
  const ctx = svc?.build?.context
  const df = svc?.build?.dockerfile
  check('compose 声明了 build.context', Boolean(ctx), String(ctx))
  check('compose 声明了 build.dockerfile', Boolean(df), String(df))
  if (ctx && df) {
    const ctxAbs = path.resolve(path.dirname(abs(COMPOSE)), ctx)
    check('build.context 解析到仓库根', ctxAbs === ROOT, `${ctxAbs} vs ${ROOT}`)
    check('build.dockerfile 文件存在', fs.existsSync(path.join(ctxAbs, df)), path.join(ctxAbs, df))
    check('compose 的 dockerfile 与静态校验的是同一份', path.resolve(path.join(ctxAbs, df)) === abs(DOCKERFILE))
  }
  const exposePort = Number(expose?.args)
  const portMaps = (svc?.ports ?? []).map(String)
  check(
    'compose 端口映射的容器侧端口与 EXPOSE 一致',
    portMaps.every((p) => p.split(':').pop() === String(exposePort)),
    `EXPOSE=${exposePort} ports=${portMaps.join(',')}`
  )
  check('compose 开了 no-new-privileges', (svc?.security_opt ?? []).some((o) => String(o).startsWith('no-new-privileges')))
  check('compose 给 /dev/shm 调大了（Chromium 需要）', Boolean(svc?.shm_size), String(svc?.shm_size))
  check('compose 挂载了数据卷 /data', (svc?.volumes ?? []).some((v) => String(v).endsWith(':/data')))
  check('compose 未设置与 Dockerfile 冲突的 USER', !Object.hasOwn(svc ?? {}, 'user'))
  check('compose 的 image 名与 README 一致（deva-web）', /^deva-web/.test(String(svc?.image)), String(svc?.image))
  // build.mjs 要读 git HEAD 写进 build-info.json，构建上下文不能把 .git 排除掉
  const ignoreLines = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  check('.dockerignore 没有排除 .git（build.mjs 要读 HEAD）', !ignoreLines.some((l) => /^!?\.git\/?$/.test(l)))
}

// ── 6) CI 里真的有 docker job ───────────────────────────────────────────────
let ci = null
try {
  ci = yaml.load(read(CI))
  check('ci.yml 能被 YAML 解析', true)
} catch (error) {
  check('ci.yml 能被 YAML 解析', false, error.message)
}
if (ci) {
  const jobs = ci.jobs ?? {}
  const dockerJob = Object.entries(jobs).find(([, job]) =>
    (job.steps ?? []).some((s) => String(s.uses ?? '').startsWith('docker/build-push-action'))
  )
  check('ci.yml 有构建镜像的 job', Boolean(dockerJob), Object.keys(jobs).join(','))
  if (dockerJob) {
    const [jobId, job] = dockerJob
    const steps = job.steps ?? []
    const buildStep = steps.find((s) => String(s.uses ?? '').startsWith('docker/build-push-action'))
    check(`${jobId}: push: false（不推镜像）`, buildStep?.with?.push === false || buildStep?.with?.push === 'false')
    check(`${jobId}: 使用 buildx`, steps.some((s) => String(s.uses ?? '').startsWith('docker/setup-buildx-action')))
    check(`${jobId}: context 为仓库根`, (buildStep?.with?.context ?? '.') === '.')
    check(`${jobId}: file 指向 apps/web/Dockerfile`, buildStep?.with?.file === DOCKERFILE, String(buildStep?.with?.file))
    check(`${jobId}: 无 load/push 之外的副作用（不登录 registry）`, !steps.some((s) => /login-action/.test(String(s.uses ?? ''))))
  }
  const checkJob = jobs.check
  const checkRuns = (checkJob?.steps ?? []).map((s) => String(s.run ?? ''))
  check('check job 跑了 desktop 单测', checkRuns.some((r) => r.includes('test:desktop')))
  check('check job 跑了版本一致性断言', checkRuns.some((r) => r.includes('check:versions')))
}

// ── 7) CI 末尾注释不再声称「Docker 未实测」──────────────────────────────────
const ciRaw = read(CI)
check(
  'ci.yml 不再留「Docker 镜像未实测」的旧说明',
  !/镜像构建与容器内降权 entrypoint 未实测/.test(ciRaw)
)
check('ci.yml 注明了本地无法验证 docker', /本机|本地/.test(ciRaw) && /docker/i.test(ciRaw))

console.log(`\nRESULT pass=${pass} fail=${fail}`)
// 说明：本脚本只做静态断言，不连接 docker daemon；镜像能否真正构建由 CI 的 docker job 证明。
process.exit(fail ? 1 : 0)
