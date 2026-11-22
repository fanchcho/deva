/** 消息里的 /技能名 与 @名字 识别：路径不误认、引用行跳过、最长匹配。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isQuoteLine, withoutQuotes } from '../src/shared/quote.ts'
import { NEW_MEMBER_TOKENS, mentionRanges } from '../src/shared/mention.ts'
import { slashTokens } from '../src/shared/slash.ts'

test('slashTokens：行首与空白后的 /名字 被认出', () => {
  assert.deepEqual(slashTokens('/review 帮我看看'), [{ start: 0, end: 7, name: 'review' }])
  assert.deepEqual(slashTokens('请用 /review 检查'), [{ start: 3, end: 10, name: 'review' }])
})

test('slashTokens：后跟 / . : 的不算（路径 / 文件名 / 盘符）', () => {
  assert.deepEqual(slashTokens('看下 /etc/hosts'), [])
  assert.deepEqual(slashTokens('/tmp/a.txt'), [])
  assert.deepEqual(slashTokens('C:/Users/x'), [])
  assert.deepEqual(slashTokens('运行 /tmp/script.sh 看看'), [])
})

test('slashTokens：结尾就是裸 /名字 时按技能名处理（无法与名字区分）', () => {
  assert.deepEqual(slashTokens('打开 /tmp'), [{ start: 3, end: 7, name: 'tmp' }])
})

test('slashTokens：同一消息里多个 /技能名 按出现顺序返回', () => {
  const tokens = slashTokens('/a 与 /b，还有 /c')
  assert.deepEqual(
    tokens.map((t) => t.name),
    ['a', 'b', 'c']
  )
})

test('slashTokens：引用行里的 /技能名 不算', () => {
  const text = '> /quoted 是别人说的话\n/review 帮我看看'
  assert.deepEqual(slashTokens(text), [{ start: text.indexOf('/review'), end: text.indexOf('/review') + 7, name: 'review' }])
})

test('slashTokens：名字后紧跟中文标点仍算（只挡 / . : \\ 与字母数字）', () => {
  assert.deepEqual(slashTokens('/review，然后继续'), [{ start: 0, end: 7, name: 'review' }])
})

test('mentionRanges：每个 @ 取最长名字，互不重叠', () => {
  const names = ['设计', '设计师', '开发']
  const text = '@设计师 和 @开发 一起看'
  assert.deepEqual(mentionRanges(text, names), [
    { start: 0, end: 4 },
    { start: 7, end: 10 }
  ])
})

test('mentionRanges：去重与空白名过滤；被更长名字遮蔽时不再单独命中', () => {
  assert.deepEqual(mentionRanges('@设计 说了', ['设计', '设计', '  ']), [{ start: 0, end: 3 }])
  // 排序按长度降序：@设计师 命中后不会再返回 @设计
  assert.deepEqual(mentionRanges('@设计师', ['设计', '设计师']), [{ start: 0, end: 4 }])
})

test('mentionRanges：无名可用或无 @ 时返回空', () => {
  assert.deepEqual(mentionRanges('@x', []), [])
  assert.deepEqual(mentionRanges('', ['a']), [])
  assert.deepEqual(mentionRanges('没有艾特', ['a']), [])
})

test('mentionRanges：名字在 @ 后不要求分隔', () => {
  assert.deepEqual(mentionRanges('@开发部今天怎么样', ['开发部']), [{ start: 0, end: 4 }])
})

test('NEW_MEMBER_TOKENS 含新旧写法', () => {
  for (const token of ['新建成员', '新成员', 'NewMember']) assert.ok(NEW_MEMBER_TOKENS.includes(token))
})

test('isQuoteLine：至多 3 个前导空格；4 个空格是代码块不算引用', () => {
  assert.equal(isQuoteLine('> 引用'), true)
  assert.equal(isQuoteLine('   > 引用'), true)
  assert.equal(isQuoteLine('    > 代码'), false)
  assert.equal(isQuoteLine('正文'), false)
})

test('withoutQuotes：去掉引用行，保留其余行', () => {
  assert.equal(withoutQuotes('> a\n正文\n>> b'), '正文')
})
