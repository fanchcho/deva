/** ask_user 入参解析：多问 / 旧式单问 / 兜底 / 选项归一 / 必答与可跳过判定。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAskQuestions } from '../src/main/services/ask-questions.ts'

test('多问格式：题干、选项、多选、必答', () => {
  const qs = parseAskQuestions({
    questions: [
      { question: '用哪个数据库？', options: ['Postgres', 'SQLite'], multiSelect: true },
      { question: '要继续吗？', options: [{ label: '是' }, { label: '否', description: '先不做' }] }
    ]
  })
  assert.equal(qs.length, 2)
  assert.deepEqual(qs[0], {
    question: '用哪个数据库？',
    options: [{ label: 'Postgres' }, { label: 'SQLite' }],
    multi: true,
    required: true
  })
  assert.equal(qs[1].options[1].description, '先不做')
  assert.equal(qs[1].multi, false)
})

test('选项别名键（value / title / text / name）都能识别；没有 label 的项丢弃', () => {
  const [q] = parseAskQuestions({
    questions: [{ question: '选一个', options: [{ value: 'A' }, { title: 'B' }, { text: 'C' }, { name: 'D' }, {}, 42] }]
  })
  assert.deepEqual(
    q.options.map((o) => o.label),
    ['A', 'B', 'C', 'D']
  )
})

test('与界面内置「自己输入」重复的选项被剔除（含省略号 / 标点 / 大小写差异）', () => {
  const [q] = parseAskQuestions({
    questions: [
      {
        question: '选一个',
        options: ['A', '自己输入', '自定义…', 'Custom', 'Enter your own', '其他']
      }
    ]
  })
  assert.deepEqual(
    q.options.map((o) => o.label),
    ['A', '其他']
  )
})

test('只有选项没有题干 → 兜底题干；题干与选项都空 → 跳过该问', () => {
  const qs = parseAskQuestions({
    questions: [{ options: ['A'] }, {}, { question: '   ' }]
  })
  assert.equal(qs.length, 1)
  assert.equal(qs[0].question, '请选择：')
})

test('旧式单问格式（顶层 question / options）被收编', () => {
  const qs = parseAskQuestions({ question: '旧式问题', options: ['x', 'y'] })
  assert.equal(qs.length, 1)
  assert.equal(qs[0].question, '旧式问题')
  assert.deepEqual(
    qs[0].options.map((o) => o.label),
    ['x', 'y']
  )
})

test('完全空入参绝不返回空数组（兜底一条通用问题）', () => {
  for (const args of [undefined, null, {}, { questions: [] }, 0, 'string']) {
    const qs = parseAskQuestions(args)
    assert.equal(qs.length, 1)
    assert.equal(qs[0].question, '请选择：')
    assert.deepEqual(qs[0].options, [])
  }
})

test('required：显式 false 即可跳过；显式 true 强制必答（即使题干含「可留空」）', () => {
  const qs = parseAskQuestions({
    questions: [
      { question: 'A 可留空', required: false },
      { question: 'B 可留空', required: true },
      { question: 'C' }
    ]
  })
  assert.equal(qs[0].required, false)
  assert.equal(qs[1].required, true)
  assert.equal(qs[2].required, true)
})

test('未显式声明时按题干口径：留空 / 选填 / optional / （可选）→ 可跳过', () => {
  const cases = ['备注（可留空）', '补充说明，选填', 'anything optional', '标签（可选）']
  for (const question of cases) {
    const [q] = parseAskQuestions({ questions: [{ question }] })
    assert.equal(q.required, false, `应视为可选: ${question}`)
  }
})

test('反向语抵消误判：必填 / 请勿留空 / 非必填的细微差别', () => {
  const required = ['此项必填', '请勿留空', '不可留空']
  for (const question of required) {
    const [q] = parseAskQuestions({ questions: [{ question }] })
    assert.equal(q.required, true, `应视为必答: ${question}`)
  }
  // 「非必填」= 可留空：不得被 REQUIRED_HINT_RE 的「必填」误判
  const [q] = parseAskQuestions({ questions: [{ question: '此项非必填' }] })
  assert.equal(q.required, false)
})

test('裸「可选」不算可留空（避免误伤「可选方案」）', () => {
  const [q] = parseAskQuestions({ questions: [{ question: '可选方案有哪些？' }] })
  assert.equal(q.required, true)
})

test('非对象项与非法选项被跳过而不崩溃', () => {
  const qs = parseAskQuestions({
    questions: [null, 42, 'str', { question: '有效', options: 'not-array' }]
  })
  assert.equal(qs.length, 1)
  assert.deepEqual(qs[0].options, [])
})
