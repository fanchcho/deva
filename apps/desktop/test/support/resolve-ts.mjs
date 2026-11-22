/**
 * 测试用模块解析钩子（node --test 通过 --import ./test/support/register.mjs 装载）。
 *
 * 为什么需要它：desktop 的源码用 tsc / electron-vite 编译，导入写成 `./quote`（无扩展名）；
 * 主进程里 Node 原生加载 TS（type stripping）时不会自动补扩展名，直接 import 会
 * ERR_MODULE_NOT_FOUND。这里只做两件事：
 *  1. 相对说明符找不到时补 `.ts/.tsx/.mts/.js/.mjs/.cjs/.json` 与 `/index.*`；
 *  2. 把 `electron` 指到 test/support/electron-stub.mjs（单测不启动 GUI）。
 *
 * 另外把 `.ts` 一律按 ES module 加载：apps/desktop/package.json 没有 "type": "module"，
 * 不同 Node 版本对无 type 的 .ts 处理不一致（Node 22 早期按 CommonJS），显式声明格式可消除差异。
 */
import { statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json']
const ELECTRON_STUB = new URL('./electron-stub.mjs', import.meta.url).href

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: ELECTRON_STUB, shortCircuit: true }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
    const raw = fileURLToPath(new URL(specifier, context.parentURL)).replace(/[\\/]$/, '')
    for (const candidate of [raw, ...EXTS.map((e) => raw + e), ...EXTS.map((e) => `${raw}/index${e}`)]) {
      if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  // format 必须写成 module-typescript：只写 'module' 会跳过类型剥离，`new Set<string>()` 之类直接语法错。
  if (url.endsWith('.ts')) return nextLoad(url, { ...context, format: 'module-typescript' })
  return nextLoad(url, context)
}
