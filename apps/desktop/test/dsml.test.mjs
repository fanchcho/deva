/**
 * DeepSeek DSML 兜底：正文里漏出的工具调用标记要恢复成真正的 tool_call，
 * 而在代码块 / 行内代码里讲这种格式的正文不能被当成调用执行。
 *
 * 这是 issue #75 的回归点：标记漏进正文 → finish_reason=stop → 工具没执行、本轮提前结束。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDsmlCalls, recoverDsmlCalls } from '../src/main/providers/dsml.ts'

const BLOCK = [
  '<｜DSML｜tool_calls>',
  '<｜DSML｜invoke name="read_file">',
  '<｜DSML｜parameter name="path" string="true">a.txt</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜tool_calls>'
].join('\n')

/** 把事件数组变成异步可迭代，模拟适配器的事件流。 */
async function* events(list) {
  for (const ev of list) yield ev
}

async function collect(source) {
  const out = []
  for await (const ev of source) out.push(ev)
  return out
}

test('parseDsmlCalls：标准一段返回调用与参数', () => {
  const calls = parseDsmlCalls(BLOCK)
  assert.ok(Array.isArray(calls))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'read_file')
  assert.equal(calls[0].args.path, 'a.txt')
  assert.equal(calls[0].closed, true)
  assert.equal(calls[0].broken, false)
})

test('parseDsmlCalls：竖线写成半角 / 双竖线 / 标签内多空格仍能认', () => {
  const mangled = [
    '<|DSML|tool_calls>',
    '<|DSML|invoke name="read_file">',
    '<||DSML||parameter name="path" string="true">b.txt</||DSML||parameter>',
    '</|DSML|invoke >',
    '</|DSML|tool_calls>'
  ].join('')
  const calls = parseDsmlCalls(mangled)
  assert.ok(calls, '走样的标记应能被规整')
  assert.equal(calls[0].name, 'read_file')
  assert.equal(calls[0].args.path, 'b.txt')
})

test('parseDsmlCalls：竖线与 DSML 之间多空格也认（半角 / 全角混写）', () => {
  const spaced = [
    '<｜ DSML ｜tool_calls>',
    '<｜ DSML ｜invoke name="ls">',
    '<｜ DSML ｜parameter name="dir" string="true">.</｜ DSML ｜parameter>',
    '</｜ DSML ｜invoke></｜ DSML ｜tool_calls>'
  ].join('')
  const calls = parseDsmlCalls(spaced)
  assert.ok(calls)
  assert.equal(calls[0].name, 'ls')
  assert.equal(calls[0].args.dir, '.')
})

test('parseDsmlCalls：没有包裹标签、直接给 invoke 也能认', () => {
  const calls = parseDsmlCalls(
    '<｜DSML｜invoke name="x"><｜DSML｜parameter name="a" string="true">1</｜DSML｜parameter></｜DSML｜invoke>'
  )
  assert.ok(calls)
  assert.equal(calls[0].name, 'x')
})

test('parseDsmlCalls：包裹名 function_calls / calls 都接受', () => {
  for (const wrap of ['function_calls', 'calls']) {
    const block = `<｜DSML｜${wrap}><｜DSML｜invoke name="ls"><｜DSML｜parameter name="dir" string="true">.</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜${wrap}>`
    const calls = parseDsmlCalls(block)
    assert.ok(calls, wrap)
    assert.equal(calls[0].name, 'ls')
  }
})

test('parseDsmlCalls：string="false" 的值必须是合法 JSON，否则标 broken', () => {
  const ok = parseDsmlCalls(
    '<｜DSML｜tool_calls><｜DSML｜invoke name="x"><｜DSML｜parameter name="n" string="false">42</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>'
  )
  assert.equal(ok[0].args.n, 42)
  assert.equal(ok[0].broken, false)

  const bad = parseDsmlCalls(
    '<｜DSML｜tool_calls><｜DSML｜invoke name="x"><｜DSML｜parameter name="n" string="false">not-json</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>'
  )
  assert.equal(bad[0].broken, true)
})

test('parseDsmlCalls：参数写到一半（缺收尾标签）标 broken', () => {
  const calls = parseDsmlCalls(
    '<｜DSML｜tool_calls><｜DSML｜invoke name="x"><｜DSML｜parameter name="a" string="true">unfinished'
  )
  assert.ok(calls)
  assert.equal(calls[0].broken, true)
})

test('parseDsmlCalls：漏写 </invoke> 但参数完整仍可执行（closed=false）', () => {
  const calls = parseDsmlCalls(
    '<｜DSML｜tool_calls><｜DSML｜invoke name="x"><｜DSML｜parameter name="a" string="true">1</｜DSML｜parameter></｜DSML｜tool_calls>'
  )
  assert.ok(calls)
  assert.equal(calls[0].closed, false)
  assert.equal(calls[0].broken, false)
  assert.equal(calls[0].args.a, '1')
})

test('parseDsmlCalls：同名参数写两遍时空值不覆盖已有值', () => {
  const calls = parseDsmlCalls(
    '<｜DSML｜tool_calls><｜DSML｜invoke name="x">' +
      '<｜DSML｜parameter name="action" string="true">evaluate</｜DSML｜parameter>' +
      '<｜DSML｜parameter name="action" string="true"></｜DSML｜parameter>' +
      '</｜DSML｜invoke></｜DSML｜tool_calls>'
  )
  assert.equal(calls[0].args.action, 'evaluate')
})

test('parseDsmlCalls：不像完整一段（夹别的文字 / 一个调用都没有）返回 null', () => {
  assert.equal(parseDsmlCalls(BLOCK + '\n后来又聊了点别的'), null)
  assert.equal(parseDsmlCalls('<｜DSML｜tool_calls></｜DSML｜tool_calls>'), null)
  assert.equal(parseDsmlCalls('就是一段普通正文'), null)
})

test('recoverDsmlCalls：正文里的标记段恢复成 tool_call，stop 改为 tool_use', async () => {
  const out = await collect(
    recoverDsmlCalls(
      events([
        { type: 'text_delta', text: '我先看下文件。\n' },
        { type: 'text_delta', text: BLOCK },
        { type: 'done', stopReason: 'stop' }
      ])
    )
  )
  const text = out.filter((e) => e.type === 'text_delta').map((e) => e.text).join('')
  assert.equal(text, '我先看下文件。\n')
  const calls = out.filter((e) => e.type === 'tool_call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'read_file')
  assert.deepEqual(calls[0].args, { path: 'a.txt' })
  assert.equal(out.at(-1).type, 'done')
  assert.equal(out.at(-1).stopReason, 'tool_use')
})

test('recoverDsmlCalls：代码块里讲 DSML 格式不会被当成调用', async () => {
  const lesson = '这种格式长这样：\n```\n' + BLOCK + '\n```\n就这样。'
  const out = await collect(
    recoverDsmlCalls(events([{ type: 'text_delta', text: lesson }, { type: 'done', stopReason: 'end_turn' }]))
  )
  assert.equal(out.filter((e) => e.type === 'tool_call').length, 0)
  assert.equal(out.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), lesson)
  assert.equal(out.at(-1).stopReason, 'end_turn')
})

test('recoverDsmlCalls：行内代码里的标记同样不算', async () => {
  const inline = '写成 `<｜DSML｜tool_calls>` 即可。'
  const out = await collect(
    recoverDsmlCalls(events([{ type: 'text_delta', text: inline }, { type: 'done', stopReason: 'end_turn' }]))
  )
  assert.equal(out.filter((e) => e.type === 'tool_call').length, 0)
})

test('recoverDsmlCalls：aborted / error 时标记段丢弃，不产生调用', async () => {
  for (const stopReason of ['aborted', 'error']) {
    const out = await collect(
      recoverDsmlCalls(events([{ type: 'text_delta', text: BLOCK }, { type: 'done', stopReason }]))
    )
    assert.equal(out.filter((e) => e.type === 'tool_call').length, 0, stopReason)
    assert.equal(out.at(-1).stopReason, stopReason)
  }
})

test('recoverDsmlCalls：残缺参数在 max_tokens 下上报 tool_call_truncated', async () => {
  const partial = '<｜DSML｜tool_calls><｜DSML｜invoke name="write"><｜DSML｜parameter name="body" string="true">没收尾'
  const out = await collect(
    recoverDsmlCalls(events([{ type: 'text_delta', text: partial }, { type: 'done', stopReason: 'max_tokens' }]))
  )
  const truncated = out.filter((e) => e.type === 'tool_call_truncated')
  assert.equal(truncated.length, 1)
  assert.equal(truncated[0].name, 'write')
  assert.equal(truncated[0].cause, 'max_tokens')
})

test('recoverDsmlCalls：标记被切在多个 delta 里也能拼回来（含半截标记先扣住）', async () => {
  const pieces = ['我先读一下。\n<｜DS', 'ML｜tool_calls><｜DSML｜invoke name="x"><｜DSML｜parameter name="a" string="true">1</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>']
  const out = await collect(
    recoverDsmlCalls(events([...pieces.map((text) => ({ type: 'text_delta', text })), { type: 'done', stopReason: 'stop' }]))
  )
  assert.equal(out.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), '我先读一下。\n')
  assert.equal(out.filter((e) => e.type === 'tool_call').length, 1)
})

test('recoverDsmlCalls：其余事件（thinking / usage）原样透传', async () => {
  const usage = { type: 'usage', input: 10, output: 2 }
  const thinking = { type: 'thinking_delta', text: '想想' }
  const out = await collect(
    recoverDsmlCalls(events([thinking, usage, { type: 'text_delta', text: '好' }, { type: 'done', stopReason: 'stop' }]))
  )
  assert.deepEqual(out[0], thinking)
  assert.deepEqual(out[1], usage)
})

test('recoverDsmlCalls：流没有 done 收尾时，扣下的正文不会被吞掉', async () => {
  const out = await collect(
    recoverDsmlCalls(events([{ type: 'text_delta', text: '正文' }, { type: 'text_delta', text: '<｜DS' }]))
  )
  assert.equal(out.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), '正文<｜DS')
})
