#!/usr/bin/env node
/**
 * 版本一致性断言（不引入任何依赖）。
 *
 * 事实源：apps/desktop/package.json 的 version 是唯一事实源。
 *   - Electron 的 app.getVersion() 读它（安装包与桌面端 UA/更新检查）；
 *   - apps/web/build.mjs:108 也读它写进 dist/manifest.json，
 *     server.mjs:38 再把 manifest.version 注入 DEVA_VERSION，
 *     worker 里 app.getVersion()（src/backend/electron-shim.mjs:123）与
 *     updater-stub 的 currentVersion 都取自该环境变量。
 * 因此 apps/web/package.json 的 version 必须与之一致，否则「npm 包版本」
 * 与「构建产物 / 运行时展示版本」长期分叉，排查问题时会误判部署版本。
 *
 * 用法：node out/check-versions.mjs
 * 退出码：0 = 一致；1 = 不一致（打印两边实际值与需要改的文件）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))

const desktop = read('apps/desktop/package.json')
const web = read('apps/web/package.json')

const pairs = [
  ['apps/desktop/package.json', desktop.version],
  ['apps/web/package.json', web.version]
]
const versions = new Set(pairs.map(([, v]) => v))

if (versions.size === 1) {
  console.log(`版本一致: ${pairs[0][1]}（${pairs.map(([f]) => f).join(' = ')}）`)
  process.exit(0)
}

console.error('版本不一致：apps/desktop/package.json 是唯一事实源，web 包必须跟随。')
for (const [file, version] of pairs) console.error(`  ${file}: ${version}`)
console.error('修复：把 apps/web/package.json 的 version 改成与 desktop 相同。')
process.exit(1)
