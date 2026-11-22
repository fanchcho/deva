/**
 * SSE 解析与空闲看门狗。
 *
 * 两个都是线上故障的落点：
 *  · 分帧错了 → 事件丢 / 粘连，Anthropic 与 OpenAI 两套流都走这里；
 *  · 半开 TCP 上 read() 永远不返回 → 缺了看门狗整轮对话就永久挂住（不是报错，是不动）。
 */
import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { StreamIdleError, STREAM_IDLE_MS, iterateSSE } from '../src/main/providers/sse.ts'

/** 用固定分块拼一个 Response，模拟 fetch 的响应体。 */
function streamOf(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
        controller.close()
      }
    })
  )
}

/** 永不吐出数据、也不结束的流（模拟半开连接）。 */
function stalledStream() {
  return new Response(
    new ReadableStream({
      start() {
        /* 故意什么都不做 */
      }
    })
  )
}

async function collect(res, idleMs) {
  const out = []
  for await (const ev of iterateSSE(res, idleMs)) out.push(ev)
  return out
}

test('基本分帧：event + data 成对产出', async () => {
  const out = await collect(streamOf(['event: message_start\ndata: {"a":1}\n\n']))
  assert.deepEqual(out, [{ event: 'message_start', data: '{"a":1}' }])
})

test('多行 data 用换行拼起来，注释行（心跳）忽略', async () => {
  const out = await collect(streamOf([': ping\n\ndata: line1\ndata: line2\n\n']))
  assert.deepEqual(out, [{ event: undefined, data: 'line1\nline2' }])
})

test('data: 后的单个空格被去掉，多余空格保留', async () => {
  const out = await collect(streamOf(['data:  two\n\n', 'data:none\n\n']))
  assert.deepEqual(
    out.map((e) => e.data),
    [' two', 'none']
  )
})

test('\\r\\n 换行等价于 \\n（否则分帧漏判）', async () => {
  const out = await collect(streamOf(['event: x\r\ndata: 1\r\n\r\n']))
  assert.deepEqual(out, [{ event: 'x', data: '1' }])
})

test('事件跨 chunk 切开也能拼回（分块边界落在帧中间）', async () => {
  const out = await collect(streamOf(['event: mess', 'age\nda', 'ta: {"x"', ':true}\n', '\n']))
  assert.deepEqual(out, [{ event: 'message', data: '{"x":true}' }])
})

test('一次 chunk 里多个事件全部产出', async () => {
  const out = await collect(streamOf(['data: 1\n\ndata: 2\n\ndata: 3\n\n']))
  assert.deepEqual(
    out.map((e) => e.data),
    ['1', '2', '3']
  )
})

test('尾部不完整的一帧不产出（流结束时还没等到空行）', async () => {
  const out = await collect(streamOf(['data: complete\n\ndata: dangling']))
  assert.deepEqual(
    out.map((e) => e.data),
    ['complete']
  )
})

test('只有注释行的心跳帧不产出事件', async () => {
  const out = await collect(streamOf([': keep-alive\n\n: keep-alive\n\n']))
  assert.deepEqual(out, [])
})

test('UTF-8 多字节字符被 chunk 切开仍能正确解码（流式解码）', async () => {
  const bytes = new TextEncoder().encode('data: 中文\n\n')
  // 把「中」的 3 个字节拆到两个 chunk 里
  const cut = 6 + 1
  const res = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, cut))
        c.enqueue(bytes.slice(cut))
        c.close()
      }
    })
  )
  const out = await collect(res)
  assert.deepEqual(out, [{ event: undefined, data: '中文' }])
})

test('没有 body 的响应直接结束，不抛错', async () => {
  assert.deepEqual(await collect(new Response(null)), [])
})

test('空闲看门狗：超过 idleMs 拿不到数据就抛 StreamIdleError', async () => {
  const res = stalledStream()
  await assert.rejects(() => collect(res, 30), (error) => {
    assert.ok(error instanceof StreamIdleError)
    assert.equal(error.name, 'StreamIdleError')
    // 名字不是 AbortError，上层才会归一到「可重试的网络错误」
    assert.notEqual(error.name, 'AbortError')
    return true
  })
})

test('StreamIdleError 文案带上秒数，且分中英文', async () => {
  const zh = new StreamIdleError(60_000)
  assert.match(zh.message, /60/)
  assert.match(zh.message, /空闲|中断/)
})

test('idleMs=0 时不启用看门狗（不会因为等待而失败）', async () => {
  const out = await collect(streamOf(['data: 1\n\n']), 0)
  assert.deepEqual(
    out.map((e) => e.data),
    ['1']
  )
})

test('STREAM_IDLE_MS 常量是 60s（改动要同时想清楚慢思考模型）', () => {
  assert.equal(STREAM_IDLE_MS, 60_000)
})
