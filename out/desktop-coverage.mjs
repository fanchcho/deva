#!/usr/bin/env node
/**
 * desktop 源码的「可被 Node 原生导入」边界统计。
 *
 * 单测直接 import 主进程 .ts 源码（node --experimental-strip-types）。这里逐个尝试导入，
 * 把不能导入的文件按原因归类，用来解释「哪些模块没有单测、为什么」——
 * 不是漏测，而是这些模块要么需要 bundler / DOM / Electron 运行时，要么语法上无法 type-strip。
 *
 * 用法：node out/desktop-coverage.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'apps/desktop/src')
const TESTED = new Set(
  fs
    .readdirSync(path.join(ROOT, 'apps/desktop/test'))
    .filter((f) => f.endsWith('.test.mjs'))
    .flatMap((f) => {
      const text = fs.readFileSync(path.join(ROOT, 'apps/desktop/test', f), 'utf8')
      return [...text.matchAll(/from '(\.[^']+)\.ts'/g)].map((m) =>
        path.normalize(path.join('apps/desktop/test', m[1] + '.ts')).replace(/\\/g, '/')
      )
    })
)

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

const files = walk(SRC)
  .filter((f) => /\.(ts|tsx|js|mjs|d\.ts)$/.test(f))
  .map((f) => path.relative(ROOT, f))
  .sort()

const importable = []
const failures = new Map()

for (const rel of files) {
  try {
    await import(pathToFileURL(path.join(ROOT, rel)).href)
    importable.push(rel)
  } catch (error) {
    const msg = String(error?.message ?? error).split('\n')[0]
    let kind
    if (/\.tsx$|\.js$|\.d\.ts$/.test(rel)) kind = '需要 bundler / 浏览器环境（renderer、preload、移动端）'
    else if (/Directory import .* is not supported/.test(msg)) kind = '目录导入（../providers 之类，Node ESM 不支持）'
    else if (/does not provide an export named/.test(msg)) kind = '缺 electron 命名导出（替身未覆盖的 API）'
    else if (/Parameter property|parameter property/.test(msg)) kind = 'TS 参数属性（无法 type-strip）'
    else if (/document is not defined|window is not defined|navigator is not defined/.test(msg)) kind = '依赖浏览器全局'
    else kind = `其他：${msg.slice(0, 120)}`
    if (!failures.has(kind)) failures.set(kind, [])
    failures.get(kind).push(rel)
  }
}

console.log('# desktop 源码导入边界（node --experimental-strip-types + test/support 解析钩子）')
console.log(`源文件总数: ${files.length}`)
console.log(`可被 Node 原生导入: ${importable.length}`)
console.log(`不可导入: ${files.length - importable.length}`)
console.log()

const byKind = [...failures.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [kind, list] of byKind) {
  console.log(`## ${kind} —— ${list.length} 个`)
  for (const f of list.slice(0, 12)) console.log(`  ${f}`)
  if (list.length > 12) console.log(`  … 另 ${list.length - 12} 个`)
  console.log()
}

console.log('## 已有单测直接 import 的源文件')
for (const f of [...TESTED].sort()) {
  console.log(`  ${importable.includes(f) ? '✓' : '✗'} ${f}`)
}

const uncovered = importable.filter((f) => !TESTED.has(f))
console.log()
console.log(`## 可导入但当前没有直接单测: ${uncovered.length} 个（多为被上面模块间接覆盖的叶子/类型模块）`)
for (const f of uncovered.slice(0, 40)) console.log(`  ${f}`)
if (uncovered.length > 40) console.log(`  … 另 ${uncovered.length - 40} 个`)
