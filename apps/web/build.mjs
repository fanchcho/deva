#!/usr/bin/env node
/**
 * 构建 Web 运行层：
 * 1. 复用 deva 仓库里已构建好的 renderer（apps/desktop/out/renderer）
 * 2. 把 preload/index.ts 原样打包成浏览器脚本，electron 模块替换成 Web 版 shim
 * 3. 产出 dist/shim.js + dist/manifest.json
 *
 * 用法：node build.mjs [deva 仓库路径]
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(process.argv[2] ?? process.env.DEVA_APP_DIR ?? path.join(here, '..', '..'))
const desktopDir = path.join(appDir, 'apps', 'desktop')
const rendererDir = path.join(desktopDir, 'out', 'renderer')
const preloadEntry = path.join(desktopDir, 'src', 'preload', 'index.ts')

for (const p of [rendererDir, preloadEntry]) {
  if (!fs.existsSync(p)) {
    console.error(`[build] 缺少 ${p}`)
    console.error('[build] 先在 deva 仓库执行 pnpm install && pnpm build，或用 DEVA_APP_DIR 指定仓库路径')
    process.exit(1)
  }
}

const outDir = path.join(here, 'dist')
fs.mkdirSync(outDir, { recursive: true })

// 1) 浏览器侧 preload shim
await build({
  entryPoints: [preloadEntry],
  outfile: path.join(outDir, 'shim.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  alias: {
    electron: path.join(here, 'src', 'electron-shim.js')
  },
  // preload 里只有这两处 Node 专有成员，直接常量折叠
  define: {
    'process.platform': '"linux"',
    'process.contextIsolated': 'false'
  }
})

const mainDir = path.join(desktopDir, 'src', 'main')
const electronShim = path.join(here, 'src', 'backend', 'electron-shim.mjs')
const backendAlias = {
  electron: electronShim,
  'electron-updater': path.join(here, 'src', 'backend', 'updater-stub.mjs'),
  '@deva/main': mainDir
}

// 2) Node 后端：把真实主进程服务打进一个 CJS 包
await build({
  entryPoints: [path.join(here, 'src', 'backend', 'index.ts')],
  outfile: path.join(outDir, 'backend.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  alias: backendAlias,
  external: ['@lydell/node-pty'],
  logLevel: 'warning'
})

// 3) PTY 宿主：独立进程，process.parentPort 用 IPC 顶替
await build({
  entryPoints: [path.join(mainDir, 'pty-host.ts')],
  outfile: path.join(outDir, 'pty-host.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  external: ['@lydell/node-pty'],
  banner: {
    js: `if(!process.parentPort){process.parentPort={postMessage:(m)=>process.send(m),on:(e,cb)=>process.on('message',(m)=>cb({data:m}))}}`
  },
  logLevel: 'warning'
})

// node-pty 是原生模块，不能打进 bundle；软链到 dist 以便 require 解析
const nativeSource = path.join(appDir, 'node_modules', '@lydell')
const nativeTarget = path.join(outDir, 'node_modules', '@lydell')
if (fs.existsSync(nativeSource)) {
  fs.mkdirSync(path.dirname(nativeTarget), { recursive: true })
  // 仓库可能被整体搬过家，旧软链会指向已经不存在的老路径；先摘掉再建。
  try {
    if (fs.lstatSync(nativeTarget).isSymbolicLink()) fs.unlinkSync(nativeTarget)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    fs.symlinkSync(nativeSource, nativeTarget, 'dir')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

const version = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).version

// 记录构建时用的上游 commit，运行期用它和 GitHub 上的最新提交比对。
// 拿不到 git 信息（比如打包成 tar 再构建）就留空，不影响构建。
function gitInfo() {
  const read = (args) => {
    try {
      return execFileSync('git', ['-C', appDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return ''
    }
  }
  const commit = read(['rev-parse', 'HEAD'])
  let ref = process.env.DEVA_REF || read(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (ref === 'HEAD') ref = '' // detached HEAD：交给 DEVA_UPDATE_REF / 默认值
  return { commit, ref }
}
const git = gitInfo()

// dist 里 pty-host.js 是 CJS，父级 package.json 的 type=module 会误判，需要局部覆盖
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify({ appDir, rendererDir, version }, null, 2)
)
fs.writeFileSync(
  path.join(outDir, 'build-info.json'),
  JSON.stringify({ commit: git.commit, ref: git.ref, version, builtAt: new Date().toISOString() }, null, 2)
)

console.log(
  `[build] shim.js + backend.cjs + pty-host.js ok, renderer=${rendererDir}, deva=${version}, commit=${git.commit.slice(0, 7) || '-'}`
)
