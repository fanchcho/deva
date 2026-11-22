/**
 * 原子写：进程被杀 / 写不进去时的行为决定了「配置和密钥会不会被截成半截」。
 *
 * 覆盖：正常写、覆盖、上次崩溃留下的 .tmp、空内容、不写 BOM；
 * 以及失败分支——tmp 本身写不进时**原样抛错**（不去直写，否则会把旧文件截断）。
 *
 * 未覆盖：rename 失败后的「直写回退」。这条只在 Windows 上被杀毒 / 索引服务短暂占用目标文件时触发
 * （EPERM），本机（Linux）没有可移植的触发方式；用 mock 掉 fs 去断言它只会测到 mock 本身，
 * 所以这里明确不写假覆盖。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './support/tmp.mjs'
import { writeFileAtomic } from '../src/main/services/atomic-write.ts'

test('正常写：内容写入目标文件，不残留 .tmp', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'config.json')
  writeFileAtomic(file, '{"a":1}')
  assert.equal(readFileSync(file, 'utf8'), '{"a":1}')
  assert.deepEqual(readdirSync(dir), ['config.json'])
})

test('覆盖已有文件：旧内容整体被替换（不是追加）', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'secrets.json')
  writeFileSync(file, '旧的比较长的一段内容，必须整段消失')
  writeFileAtomic(file, 'new')
  assert.equal(readFileSync(file, 'utf8'), 'new')
})

test('覆盖上次崩溃留下的 .tmp：不报错，且最终只剩目标文件', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'a.json')
  writeFileSync(`${file}.tmp`, '残渣')
  writeFileAtomic(file, 'ok')
  assert.equal(readFileSync(file, 'utf8'), 'ok')
  assert.deepEqual(readdirSync(dir), ['a.json'])
})

test('目标路径是目录：抛错，目录本身不被破坏', (t) => {
  const dir = tempDir(t)
  const target = join(dir, 'dir')
  mkdirSync(target)
  assert.throws(() => writeFileAtomic(target, 'data'))
  assert.ok(existsSync(target))
})

test('tmp 写不进时原样抛错，已有文件内容保持不变（不回退直写）', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'keep.json')
  writeFileSync(file, '重要内容')
  // 把 <file>.tmp 占成目录：writeFileSync(tmp) 必然 EISDIR，和「磁盘满 / 只读」同属第一段失败
  mkdirSync(`${file}.tmp`)
  assert.throws(() => writeFileAtomic(file, '新内容'))
  assert.equal(readFileSync(file, 'utf8'), '重要内容')
})

test('可以写入空字符串（清空配置是合法操作）', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'empty.json')
  writeFileAtomic(file, '')
  assert.equal(readFileSync(file, 'utf8'), '')
})

test('不写 BOM、不额外换行（下游必须是严格 JSON）', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'strict.json')
  writeFileAtomic(file, '{"x":"中"}')
  const buf = readFileSync(file)
  assert.notEqual(buf[0], 0xef)
  const text = buf.toString('utf8')
  assert.equal(text, '{"x":"中"}')
  assert.doesNotThrow(() => JSON.parse(text))
})
