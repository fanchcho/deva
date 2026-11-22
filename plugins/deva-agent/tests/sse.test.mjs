import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SseParser } from '../lib/sse.mjs'

function collect(chunks) {
  const parser = new SseParser()
  const frames = []
  for (const chunk of chunks) frames.push(...parser.push(chunk))
  frames.push(...parser.flush())
  return frames.map(frame => frame.data)
}

test('CRLF split across chunks is not mistaken for a frame boundary', () => {
  assert.deepEqual(collect(['data: {"a":1}\r', '\n', '\r\ndata: {"b":2}\r\n\r\n']), ['{"a":1}', '{"b":2}'])
})

test('LF, CRLF and lone CR line endings all work', () => {
  assert.deepEqual(collect(['data: a\n\ndata: b\r\n\r\ndata: c\r\r']), ['a', 'b', 'c'])
})

test('multi-line data joins with newlines and comments are ignored', () => {
  const parser = new SseParser()
  const frames = parser.push(': keepalive\nevent: message\ndata: line1\ndata: line2\n\n')
  assert.deepEqual(frames, [{ event: 'message', data: 'line1\nline2' }])
  assert.deepEqual(parser.flush(), [])
})

test('a final frame without a trailing blank line is flushed', () => {
  assert.deepEqual(collect(['data: last\r\n']), ['last'])
})

test('flush after a dangling carriage return does not lose the frame', () => {
  assert.deepEqual(collect(['data: tail\r']), ['tail'])
})

test('event names are preserved for MCP endpoint discovery', () => {
  const parser = new SseParser()
  const frames = parser.push('event: endpoint\ndata: /messages?session=1\n\n')
  assert.deepEqual(frames, [{ event: 'endpoint', data: '/messages?session=1' }])
})

test('empty keepalive frames are returned but carry no data', () => {
  const parser = new SseParser()
  assert.deepEqual(parser.push('\n\n'), [{ event: 'message', data: '' }])
  assert.deepEqual(parser.flush(), [])
})
