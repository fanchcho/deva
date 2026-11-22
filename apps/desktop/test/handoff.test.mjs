/** 定时任务交接的协议解析：参数归一、正文序列化 / 反解析往返、首行摘要。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HANDOFF_TAG,
  buildHandoffBody,
  headOf,
  parseHandoff,
  parseHandoffArgs
} from '../src/main/services/handoff.ts'

test('parseHandoffArgs：需要处理时必须给出 summary 或 content，否则返回错误说明', () => {
  assert.equal(parseHandoffArgs({ needs_action: true }), '缺少 summary 与 content。')
  assert.equal(parseHandoffArgs({ needs_action: true, summary: '  ', content: '\n' }), '缺少 summary 与 content。')
  // null / 非对象 → 视作「只是告知」，不报错
  assert.deepEqual(parseHandoffArgs(null), { summary: '', content: '', needsAction: false })
})

test('parseHandoffArgs：缺 summary 时取 content 首行；缺 content 时用 summary 顶上', () => {
  const a = parseHandoffArgs({ needs_action: true, content: '# 标题行\n正文' })
  assert.equal(typeof a, 'object')
  assert.equal(a.summary, '标题行')
  assert.equal(a.content, '# 标题行\n正文')

  const b = parseHandoffArgs({ needs_action: true, summary: '只有摘要' })
  assert.equal(b.summary, '只有摘要')
  assert.equal(b.content, '只有摘要')
})

test('parseHandoffArgs：摘要折叠空白；只是告知时不校验内容', () => {
  const a = parseHandoffArgs({ needs_action: true, summary: '  多个   空格  折叠 ', content: 'x' })
  assert.equal(a.summary, '多个 空格 折叠')

  const b = parseHandoffArgs({ needs_action: false })
  assert.deepEqual(b, { summary: '', content: '', needsAction: false })
})

test('parseHandoffArgs：needs_action 只认布尔 true（字符串 "true" 视为只是告知）', () => {
  assert.equal(parseHandoffArgs({ needs_action: 'true', summary: 's' }).needsAction, false)
  assert.equal(parseHandoffArgs({ needs_action: 1, summary: 's' }).needsAction, false)
})

test('headOf：首个非空行、去标题井号、截到 60 字', () => {
  assert.equal(headOf('\n\n## 小标题\n正文'), '小标题')
  assert.equal(headOf(''), '')
  assert.equal(headOf('x'.repeat(200)).length, 60)
})

test('buildHandoffBody / parseHandoff 往返（需要处理）', () => {
  const input = { summary: '发现 2 个新 bug', content: '## 详情\n- bug1\n- bug2', needsAction: true }
  const body = buildHandoffBody('夜间巡检', input)
  assert.ok(body.includes(HANDOFF_TAG))

  const parsed = parseHandoff(body)
  assert.ok(parsed)
  assert.equal(parsed.title, '夜间巡检')
  assert.equal(parsed.summary, '发现 2 个新 bug')
  assert.equal(parsed.needsAction, true)
  assert.equal(parsed.content, '## 详情\n- bug1\n- bug2')
})

test('buildHandoffBody / parseHandoff 往返（只是告知：不写全文）', () => {
  const body = buildHandoffBody('每日提醒', { summary: '今天有 3 个会议', content: '不该出现的全文', needsAction: false })
  const parsed = parseHandoff(body)
  assert.equal(parsed.summary, '今天有 3 个会议')
  assert.equal(parsed.needsAction, false)
  assert.equal(parsed.content, '')
  assert.ok(!body.includes('不该出现的全文'))
})

test('parseHandoff：不含标签 → null；缺结束标签也能解析（不崩）', () => {
  assert.equal(parseHandoff('普通消息'), null)
  const truncated = `${HANDOFF_TAG}\n任务：T\n摘要：S\n处理：需要\n全文：\n正文未结束`
  const parsed = parseHandoff(truncated)
  assert.equal(parsed.title, 'T')
  assert.equal(parsed.summary, 'S')
  assert.equal(parsed.needsAction, true)
  assert.equal(parsed.content, '正文未结束')
})
