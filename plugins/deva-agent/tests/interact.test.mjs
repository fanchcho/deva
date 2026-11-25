import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeAskUser, normalizeTodos, formatTodos } from '../lib/interact.mjs'

test('ask_user asks in order and joins answers', async () => {
  const asked = []
  const replies = ['要改哪个包？', 'apps/web']
  const text = await executeAskUser({ questions: [{ question: '改哪个？', choices: ['apps/web', 'apps/desktop'] }, { question: '新名字？' }] }, {
    interactions: {
      clarify: async input => { asked.push(input); return { outcome: 'answered', text: replies[asked.length - 1] } },
    },
  })
  assert.deepEqual(asked[0], { question: '改哪个？', choices: ['apps/web', 'apps/desktop'] })
  assert.deepEqual(asked[1], { question: '新名字？' })
  assert.match(text, /Q1: 改哪个？\nA1: 要改哪个包？/)
  assert.match(text, /Q2: 新名字？\nA2: apps\/web/)
})

test('ask_user stops on dismissal and never fabricates an answer', async () => {
  let calls = 0
  const text = await executeAskUser({ questions: [{ question: '继续吗？' }, { question: '第二个问题' }] }, {
    interactions: { clarify: async () => { calls++; return { outcome: 'dismissed' } } },
  })
  assert.equal(calls, 1, '关闭后不再继续问')
  assert.match(text, /用户关闭了提问/)
  assert.doesNotMatch(text, /第二个问题[\s\S]*A2: [^（]/)
})

test('ask_user fails loudly when the host cannot ask', async () => {
  await assert.rejects(executeAskUser({ questions: [{ question: 'x' }] }, {}), /不支持向用户提问/)
  await assert.rejects(executeAskUser({ questions: [] }, { interactions: { clarify: async () => ({}) } }), /不能为空/)
})

test('todo_write validates status and uniqueness of in_progress', () => {
  assert.deepEqual(normalizeTodos([{ content: '读文档', status: 'pending' }]), [{ content: '读文档', status: 'pending' }])
  assert.throws(() => normalizeTodos([{ content: 'x', status: 'done' }]), /状态无效/)
  assert.throws(() => normalizeTodos([{ content: '', status: 'pending' }]), /缺少 content/)
  assert.throws(() => normalizeTodos([{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }]), /最多一个 in_progress/)
  assert.equal(formatTodos([{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }]), '- [x] a\n- [~] b')
  assert.equal(formatTodos([]), '')
})
