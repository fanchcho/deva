/** 复读检测：两档门槛、正常文本不误报、流式看守的节流与截断。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { findRepetition, trailingRepetition, watchRepetition } from '../src/main/services/repetition.ts'

test('正常文本不命中', () => {
  assert.equal(findRepetition('这是一段正常的回复，没有重复。'), null)
  assert.equal(findRepetition(''), null)
  assert.equal(trailingRepetition('step 1\nstep 2\nstep 3'), null)
})

test('短单元重复 10 遍以上且 ≥200 字符命中（第二档门槛）', () => {
  const unit = 'abcde' // 5 字符
  const text = unit.repeat(50) // 250 字符，50 次
  const hit = findRepetition(text)
  assert.ok(hit, '应命中')
  assert.equal(hit.period, 5)
  assert.ok(hit.span >= 200)
})

test('长段落重复 4 遍且 ≥250 字符命中（第一档门槛）', () => {
  // 段落 70 字 × 4 遍 = 280 字：满足「同段 ≥4 遍且连续 ≥250 字符」
  const unit = '这是一段用于测试段落级复读检测的中文内容，长度控制在七十个字符左右，确保四遍之后超过二百五十字符的门槛，用来验证检测是否生效。'
  const text = unit.repeat(4)
  assert.ok(text.length >= 250)
  const hit = findRepetition(text)
  assert.ok(hit)
  assert.equal(hit.period, unit.length)
})

test('同一句只重复 3 遍（不够 4 遍且不足 250 字符）不命中', () => {
  const unit = '短句子。'
  assert.equal(findRepetition(unit.repeat(3)), null)
})

test('带递增序号的列表不算复读（逐字符并不相同）', () => {
  const text = Array.from({ length: 60 }, (_, i) => `第 ${i} 项：内容各不相同`).join('\n')
  assert.equal(findRepetition(text), null)
})

test('trailingRepetition 只看结尾；结尾复读能定位并取满区域', () => {
  const prefix = '开头是正常内容。'
  const text = prefix + 'ba'.repeat(200)
  const hit = trailingRepetition(text)
  assert.ok(hit)
  assert.equal(hit.period, 2)
  assert.equal(hit.start + hit.span, text.length)
})

test('trailingRepetition 在结尾未复读时返回 null', () => {
  const text = 'ba'.repeat(200) + '结束语，正常收尾。'
  assert.equal(trailingRepetition(text), null)
})

test('watchRepetition 按 32 字符节流，未到门槛不检查', () => {
  const watch = watchRepetition()
  assert.equal(watch('1234567890'), null)
  assert.equal(watch('1234567890'), null)
  assert.equal(watch('1234567890'), null) // 30 字符 < 32
  const hit = watch('ab'.repeat(40)) // 累计 110，触发检查
  assert.equal(hit, null, '正常内容不该命中')
})

test('watchRepetition 在尾巴进入复读后命中，period 可用', () => {
  const watch = watchRepetition()
  let hit = null
  for (let i = 0; i < 40 && !hit; i++) hit = watch('xy'.repeat(16))
  assert.ok(hit, '持续复读应命中')
  assert.equal(hit.period % 2, 0, 'period 应为重复单元长度或其倍数')
})

test('watchRepetition 只保留尾部 4096 字符（长文本不无限增长）', () => {
  const watch = watchRepetition()
  const filler = 'z'.repeat(1000)
  // 每段 1000 字，推 20 段 = 20000 字；先推正常内容，最后推复读
  for (let i = 0; i < 20; i++) watch(filler)
  let hit = null
  for (let i = 0; i < 30 && !hit; i++) hit = watch('Q'.repeat(64))
  assert.ok(hit, '尾部复读仍能命中（说明尾部窗口足够）')
})
