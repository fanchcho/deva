/** 极简 frontmatter 解析：四类条目、容错、序列化。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fmArray,
  fmMap,
  fmScalar,
  fmString,
  parseFrontmatter
} from '../src/main/services/frontmatter.ts'

test('无 frontmatter：data 为空、body 为原文', () => {
  const raw = '# 标题\n\n正文'
  assert.deepEqual(parseFrontmatter(raw), { data: {}, body: raw })
})

test('BOM 被去掉后才识别首行 ---', () => {
  const { data, body } = parseFrontmatter('﻿---\nname: demo\n---\nbody\n')
  assert.equal(data.name, 'demo')
  assert.equal(body, 'body\n')
})

test('首行不是 ---（有前导内容）视作无 frontmatter', () => {
  const raw = '\n---\nname: demo\n---\n'
  assert.deepEqual(parseFrontmatter(raw), { data: {}, body: raw })
})

test('没有闭合 --- → 视作无 frontmatter（不抛错）', () => {
  const raw = '---\nname: demo\nbody'
  assert.deepEqual(parseFrontmatter(raw), { data: {}, body: raw })
})

test('四类条目：标量 / 内联数组 / 列表 / 一层映射（含注释与空行）', () => {
  const raw = [
    '---',
    '# 注释行被跳过',
    'name: "带 引号"',
    'tags: [a, "b c", d]',
    'tools:',
    '  - Read',
    '  - Bash(git:*)',
    '',
    'metadata:',
    '  author: me',
    '  version: 1',
    '---',
    '',
    '正文第一行',
    '正文第二行'
  ].join('\n')

  const { data, body } = parseFrontmatter(raw)
  assert.equal(data.name, '带 引号')
  assert.deepEqual(data.tags, ['a', 'b c', 'd'])
  assert.deepEqual(data.tools, ['Read', 'Bash(git:*)'])
  assert.deepEqual(data.metadata, { author: 'me', version: '1' })
  // 结束行之后紧随的一个空行被去掉，其余原样
  assert.equal(body, '正文第一行\n正文第二行')
})

test('空值且既无列表项也无映射 → 空数组', () => {
  const { data } = parseFrontmatter('---\nempty:\n---\n')
  assert.deepEqual(data.empty, [])
})

test('单引号 / 双引号去引号，双引号内转义还原', () => {
  const { data } = parseFrontmatter('---\na: \'x y\'\nb: "say \\"hi\\""\nc: "back\\\\slash"\n---\n')
  assert.equal(data.a, 'x y')
  assert.equal(data.b, 'say "hi"')
  assert.equal(data.c, 'back\\slash')
})

test('不合法的键行被跳过而不是中断解析', () => {
  const { data } = parseFrontmatter('---\nnot a key line\nname: ok\n---\n')
  assert.deepEqual(data, { name: 'ok' })
})

test('CRLF 换行同样可解析', () => {
  const { data, body } = parseFrontmatter('---\r\nname: crlf\r\n---\r\nbody\r\n')
  assert.equal(data.name, 'crlf')
  assert.equal(body, 'body\n')
})

test('fmString：标量 / 数组首项 / 映射与缺失 → 空串', () => {
  const data = { a: 'x', b: ['y', 'z'], c: { k: 'v' } }
  assert.equal(fmString(data, 'a'), 'x')
  assert.equal(fmString(data, 'b'), 'y')
  assert.equal(fmString(data, 'c'), '')
  assert.equal(fmString(data, 'missing'), '')
})

test('fmArray：数组原样返回；标量按空白与逗号拆分；括号内不拆', () => {
  const data = {
    arr: ['a', 'b'],
    spaced: 'Bash(git add:*) Read',
    commas: 'a, b,c',
    parenComma: 'Bash(git add:*)',
    map: { k: 'v' }
  }
  assert.deepEqual(fmArray(data, 'arr'), ['a', 'b'])
  assert.deepEqual(fmArray(data, 'spaced'), ['Bash(git add:*)', 'Read'])
  assert.deepEqual(fmArray(data, 'commas'), ['a', 'b', 'c'])
  assert.deepEqual(fmArray(data, 'parenComma'), ['Bash(git add:*)'])
  assert.deepEqual(fmArray(data, 'map'), [])
  assert.deepEqual(fmArray(data, 'missing'), [])
})

test('fmMap：仅一层映射有值', () => {
  const data = { m: { a: '1' }, s: 'x', arr: ['y'] }
  assert.deepEqual(fmMap(data, 'm'), { a: '1' })
  assert.deepEqual(fmMap(data, 's'), {})
  assert.deepEqual(fmMap(data, 'arr'), {})
})

test('fmScalar 与 parseFrontmatter 往返一致（特殊字符加引号并转义）', () => {
  for (const value of ['plain', 'has space', 'a:b', 'a # b', 'quote"inside', 'back\\slash', '']) {
    const raw = `---\nk: ${fmScalar(value)}\n---\n`
    const { data } = parseFrontmatter(raw)
    assert.equal(data.k, value, `往返失败: ${JSON.stringify(value)}`)
  }
})

test('fmScalar：普通值不加引号，首尾空白要加引号', () => {
  assert.equal(fmScalar('abc'), 'abc')
  assert.equal(fmScalar('a b'), 'a b')
  assert.equal(fmScalar(' a'), '" a"')
  assert.equal(fmScalar(''), '""')
})
