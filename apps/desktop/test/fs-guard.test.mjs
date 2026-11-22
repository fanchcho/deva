/**
 * fs-guard：渲染层 IPC 的路径闸门。
 *
 * 覆盖用户点名的四种情形：
 *  · 受信根内的正常路径（含根目录本身）；
 *  · `..` 穿越到根外；
 *  · 根内符号链接指向根外（真实穿越面，旧实现只 resolve 不跟随链接）；
 *  · 根内尚不存在的文件（新建文件）也要放行。
 * 另测批量版（insideRootFlags / assertAllInside）与 isWithinDir 的语义一致性。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './support/tmp.mjs'
import {
  assertAllInside,
  assertInside,
  insideRootFlags,
  isInsideRoot,
  isWithinDir,
  listRoots,
  trustRoot,
  untrustRoot
} from '../src/main/services/fs-guard.ts'

const DENIED = '拒绝访问：路径不在已打开的项目内'

/** 每个用例独立根：建 root/ 与 outside/ 两个同级目录。 */
function layout(t) {
  const base = tempDir(t)
  const root = join(base, 'root')
  const outside = join(base, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, 'inside.txt'), 'ok')
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  t.after(() => untrustRoot(root))
  return { base, root, outside }
}

test('受信根：登记 / 列举 / 移除', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  assert.deepEqual(listRoots(), [root])
  assert.equal(isInsideRoot(root), true)

  untrustRoot(root)
  assert.deepEqual(listRoots(), [])
  assert.equal(isInsideRoot(root), false)
})

test('同一根重复登记不产生重复项；尾斜杠写法归一', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  trustRoot(`${root}/`)
  trustRoot(join(root, '.'))
  assert.deepEqual(listRoots(), [root])
})

test('根内路径（含根目录自身）放行', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  assert.equal(isInsideRoot(root), true)
  assert.equal(isInsideRoot(join(root, 'inside.txt')), true)
  assert.doesNotThrow(() => assertInside(join(root, 'inside.txt')))
})

test('根内尚不存在的新建文件放行（对最近的存在祖先做 realpath 后接回尾段）', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  const target = join(root, 'new-dir', 'deep', 'new-file.txt')
  assert.equal(isInsideRoot(target), true)
  assert.doesNotThrow(() => assertInside(target))
})

test('`..` 穿越到根外被拒绝', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  const escaped = join(root, '..', 'outside', 'secret.txt')
  assert.equal(isInsideRoot(escaped), false)
  assert.throws(() => assertInside(escaped), { message: DENIED })
})

test('根内符号链接指向根外：按真实路径判定为越界', (t) => {
  const { root, outside } = layout(t)
  trustRoot(root)
  const link = join(root, 'evil-link')
  symlinkSync(outside, link)

  assert.equal(isInsideRoot(join(link, 'secret.txt')), false)
  assert.throws(() => assertInside(join(link, 'secret.txt')), { message: DENIED })
})

test('根内符号链接指向根内：放行', (t) => {
  const { root } = layout(t)
  trustRoot(root)
  mkdirSync(join(root, 'real'))
  writeFileSync(join(root, 'real', 'a.txt'), 'a')
  symlinkSync(join(root, 'real'), join(root, 'alias'))

  assert.equal(isInsideRoot(join(root, 'alias', 'a.txt')), true)
})

test('根外路径一律拒绝（前缀相同但不同目录不算在内）', (t) => {
  const { base, root, outside } = layout(t)
  trustRoot(root)
  mkdirSync(join(base, 'root-other'))
  writeFileSync(join(base, 'root-other', 'x.txt'), 'x')

  assert.equal(isInsideRoot(join(base, 'root-other', 'x.txt')), false)
  assert.equal(isInsideRoot(join(outside, 'secret.txt')), false)
})

test('批量 insideRootFlags / assertAllInside 与逐条语义一致', async (t) => {
  const { root, outside } = layout(t)
  trustRoot(root)
  symlinkSync(outside, join(root, 'evil-link'))

  const targets = [join(root, 'inside.txt'), join(root, 'new.txt'), join(outside, 'secret.txt'), join(root, 'evil-link', 'secret.txt')]
  const flags = await insideRootFlags(targets)
  assert.deepEqual(flags, [true, true, false, false])
  assert.deepEqual(
    flags,
    targets.map((p) => isInsideRoot(p))
  )

  await assert.doesNotReject(() => assertAllInside([join(root, 'inside.txt')]))
  await assert.rejects(() => assertAllInside([join(root, 'inside.txt'), join(outside, 'secret.txt')]), {
    message: DENIED
  })
})

test('isWithinDir：含目录自身，null 恒为 false，根外为 false', (t) => {
  const { root, outside } = layout(t)
  mkdirSync(join(root, 'sub'))

  assert.equal(isWithinDir(join(root, 'sub', 'x.txt'), root), true)
  assert.equal(isWithinDir(root, root), true)
  assert.equal(isWithinDir(join(outside, 'secret.txt'), root), false)
  assert.equal(isWithinDir(root, null), false)
  // `..` 穿出该目录（即使最终仍落在受信根内）也不算「在此目录内」
  assert.equal(isWithinDir(join(root, 'sub', '..', 'inside.txt'), join(root, 'sub')), false)
})

test('不受信时连根目录本身也拒绝（受信根是显式登记的内存态）', (t) => {
  const { root } = layout(t)
  assert.equal(isInsideRoot(root), false)
  assert.throws(() => assertInside(root), { message: DENIED })
})
