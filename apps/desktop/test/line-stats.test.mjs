/** 加减行数统计：精确路径与退化路径。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lineCount, lineStats } from '../src/main/services/line-stats.ts'

test('无变化 → 0/0，不是近似', () => {
  assert.deepEqual(lineStats('a\nb\nc', 'a\nb\nc'), { added: 0, removed: 0, approx: false })
})

test('纯新增 / 纯删除', () => {
  assert.deepEqual(lineStats('a\nb', 'a\nb\nc\nd'), { added: 2, removed: 0, approx: false })
  assert.deepEqual(lineStats('a\nb\nc\nd', 'a\nb'), { added: 0, removed: 2, approx: false })
})

test('修改一行记作 −1 +1（与 git 口径一致）', () => {
  assert.deepEqual(lineStats('a\nb\nc', 'a\nB\nc'), { added: 1, removed: 1, approx: false })
})

test('中间插入不牵动后文行数', () => {
  const before = 'l1\nl2\nl3\nl4\nl5'
  const after = 'l1\nl2\nnew\nl3\nl4\nl5'
  assert.deepEqual(lineStats(before, after), { added: 1, removed: 0, approx: false })
})

test('空文件 ↔ 非空文件', () => {
  assert.deepEqual(lineStats('', 'x\ny'), { added: 2, removed: 0, approx: false })
  assert.deepEqual(lineStats('x\ny', ''), { added: 0, removed: 2, approx: false })
})

test('CRLF 与末尾换行归一（"a\\nb\\n" 与 "a\\nb" 行数相同）', () => {
  assert.deepEqual(lineStats('a\r\nb\r\n', 'a\nb'), { added: 0, removed: 0, approx: false })
  assert.equal(lineCount('a\nb\n'), 2)
  assert.equal(lineCount(''), 0)
})

test('完全不同的长文本走多重集近似并标 approx', () => {
  // 2000 行全不同 → Myers 的 D 超过 MAX_D(2000) 上限，退化
  const before = Array.from({ length: 2000 }, (_, i) => `old-${i}`).join('\n')
  const after = Array.from({ length: 2000 }, (_, i) => `new-${i}`).join('\n')
  const stats = lineStats(before, after)
  assert.equal(stats.approx, true)
  assert.deepEqual(stats, { added: 2000, removed: 2000, approx: true })
})

test('近似路径下的重复行按多重集计数（不被共同的重复内容骗成 0 差异）', () => {
  const before = Array.from({ length: 1500 }, () => 'dup').concat(Array.from({ length: 1500 }, (_, i) => `x${i}`)).join('\n')
  const after = Array.from({ length: 1500 }, () => 'dup').concat(Array.from({ length: 1600 }, (_, i) => `y${i}`)).join('\n')
  const stats = lineStats(before, after)
  assert.equal(stats.approx, true)
  assert.deepEqual({ added: stats.added, removed: stats.removed }, { added: 1600, removed: 1500 })
})
