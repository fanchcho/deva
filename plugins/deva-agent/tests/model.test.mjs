import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { endpoint, callModel, sseFrames } from '../lib/model.mjs'

/** 起一个只在 127.0.0.1 上回放固定 SSE 的假网关。 */
async function gateway(handler) {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => handler(request, response, body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

const sse = (response, frames) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test('endpoint joins /v1 only once', () => {
  assert.equal(endpoint('http://x/api/models', '/chat/completions'), 'http://x/api/models/v1/chat/completions')
  assert.equal(endpoint('http://x/api/models/v1', '/chat/completions'), 'http://x/api/models/v1/chat/completions')
  assert.throws(() => endpoint('', '/chat/completions'), /baseUrl/)
})

test('sseFrames tolerates CRLF chunks split across reads', async () => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      // 把 \r\n\r\n 拆到三个 chunk 里：单独规整每个 chunk 会漏掉跨块的 CRLF。
      controller.enqueue(encoder.encode('data: {"a":1}\r'))
      controller.enqueue(encoder.encode('\n\r'))
      controller.enqueue(encoder.encode('\ndata: {"b"'))
      controller.enqueue(encoder.encode(':2}\r\n\r\ndata: [DONE]\r\n\r\n'))
      controller.close()
    },
  })
  const frames = []
  for await (const frame of sseFrames({ body: stream })) frames.push(frame)
  assert.deepEqual(frames, ['{"a":1}', '{"b":2}'])
})

test('sseFrames flushes a final frame without a trailing blank line', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"last":true}\r\n'))
      controller.close()
    },
  })
  const frames = []
  for await (const frame of sseFrames({ body: stream })) frames.push(frame)
  assert.deepEqual(frames, ['{"last":true}'])
})

test('chat_completions streams text, reasoning and tool calls', async () => {
  let seen
  const server = await gateway((request, response, body) => {
    seen = { url: request.url, auth: request.headers.authorization, body: JSON.parse(body) }
    sse(response, [
      { choices: [{ delta: { reasoning_content: '想一想' } }] },
      { choices: [{ delta: { content: '先看仓库' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"package.json"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } },
    ])
  })
  try {
    const deltas = [], reasoning = []
    const result = await callModel({
      apiMode: 'chat_completions', model: { model: 'gpt-test' }, baseUrl: server.baseUrl, token: 'tk',
      system: 'sys', tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
      messages: [{ role: 'user', text: '看下版本' }],
      onDelta: async delta => deltas.push(delta), onReasoning: async delta => reasoning.push(delta),
    })
    assert.equal(seen.url, '/v1/chat/completions')
    assert.equal(seen.auth, 'Bearer tk')
    assert.equal(seen.body.messages[0].role, 'system')
    assert.equal(seen.body.messages[0].content, 'sys')
    assert.equal(seen.body.messages[1].content, '看下版本')
    assert.equal(seen.body.tools[0].function.name, 'read_file')
    assert.deepEqual(deltas, ['先看仓库'])
    assert.deepEqual(reasoning, ['想一想'])
    assert.equal(result.text, '先看仓库')
    assert.equal(result.finish, 'tool_calls')
    assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'read_file', arguments: '{"path":"package.json"}' }])
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 5, cacheReadTokens: 3 })
  } finally { await server.close() }
})

test('anthropic_messages maps tools, system and usage', async () => {
  let seen
  const server = await gateway((request, response, body) => {
    seen = { url: request.url, key: request.headers['x-api-key'], body: JSON.parse(body) }
    sse(response, [
      { type: 'message_start', message: { usage: { input_tokens: 7, cache_read_input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'grep' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"pattern":"x"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '查一下' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    ])
  })
  try {
    const result = await callModel({
      apiMode: 'anthropic_messages', model: { model: 'claude-test', outputLimit: 2048 }, baseUrl: server.baseUrl, token: 'tk',
      system: 'sys', tools: [{ name: 'grep', description: 'grep', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
      messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'grep', arguments: '{}' }] }, { role: 'tool', toolCallId: 'a', text: 'ok' }],
      onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.equal(seen.url, '/v1/messages')
    assert.equal(seen.key, 'tk')
    assert.equal(seen.body.max_tokens, 2048)
    assert.equal(seen.body.system, 'sys')
    assert.equal(seen.body.tools[0].input_schema.type, 'object')
    assert.equal(seen.body.messages[1].content[0].type, 'tool_use')
    assert.equal(seen.body.messages[2].content[0].type, 'tool_result')
    assert.equal(result.text, '查一下')
    assert.deepEqual(result.toolCalls, [{ id: 'toolu_1', name: 'grep', arguments: '{"pattern":"x"}' }])
    assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 9, cacheReadTokens: 2 })
  } finally { await server.close() }
})

test('codex_responses streams output text and function calls', async () => {
  let seen
  const server = await gateway((request, response, body) => {
    seen = { url: request.url, body: JSON.parse(body) }
    sse(response, [
      { type: 'response.output_item.added', item: { id: 'item_1', type: 'function_call', call_id: 'call_9', name: 'glob' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: '{"pattern":"*.ts"}' },
      { type: 'response.output_text.delta', delta: '搜一下' },
      { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 4, output_tokens: 6, input_tokens_details: { cached_tokens: 1 } } } },
    ])
  })
  try {
    const result = await callModel({
      apiMode: 'codex_responses', model: { model: 'gpt-5', reasoningEffort: 'medium' }, baseUrl: server.baseUrl, token: 'tk',
      system: 'sys', tools: [], messages: [{ role: 'user', text: 'hi' }],
      onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.equal(seen.url, '/v1/responses')
    assert.equal(seen.body.instructions, 'sys')
    assert.equal(seen.body.reasoning.effort, 'medium')
    assert.equal(seen.body.input[0].role, 'user')
    assert.equal(result.text, '搜一下')
    assert.deepEqual(result.toolCalls, [{ id: 'call_9', name: 'glob', arguments: '{"pattern":"*.ts"}' }])
    assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 6, cacheReadTokens: 1 })
  } finally { await server.close() }
})

test('http errors surface the status without leaking the token', async () => {
  const server = await gateway((request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'bad key sk-secret' } }))
  })
  try {
    await assert.rejects(callModel({
      apiMode: 'chat_completions', model: { model: 'm' }, baseUrl: server.baseUrl, token: 'sk-secret',
      messages: [{ role: 'user', text: 'hi' }], tools: [], onDelta: async () => {}, onReasoning: async () => {},
    }), error => {
      assert.match(error.message, /HTTP 401/)
      assert.doesNotMatch(error.message, /sk-secret/)
      return true
    })
  } finally { await server.close() }
})

const DSML_TOOLS = [{ name: 'read_file', description: 'read', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }]
const DSML_BLOCK = [
  '<｜DSML｜tool_calls>',
  '<｜DSML｜invoke name="read_file">',
  '<｜DSML｜parameter name="path" string="true">package.json</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜tool_calls>',
].join('\n')

test('chat_completions recovers DSML tool calls leaked into the text', async () => {
  const server = await gateway((request, response) => {
    sse(response, [
      { choices: [{ delta: { content: '先看仓库\n' } }] },
      // 标记被拆成多段流式发来：扣留要跨块生效。
      { choices: [{ delta: { content: DSML_BLOCK.slice(0, 30) }, finish_reason: 'stop' }] },
      { choices: [{ delta: { content: DSML_BLOCK.slice(30) } }] },
    ])
  })
  try {
    const deltas = []
    const result = await callModel({
      apiMode: 'chat_completions', model: { model: 'deepseek-test' }, baseUrl: server.baseUrl, token: 'tk',
      system: 'sys', tools: DSML_TOOLS, messages: [{ role: 'user', text: '看下版本' }],
      onDelta: async delta => deltas.push(delta), onReasoning: async () => {},
    })
    assert.deepEqual(deltas, ['先看仓库\n'], '标记段不该作为正文发出去')
    assert.equal(result.text, '先看仓库\n')
    assert.equal(result.finish, 'tool_calls')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0].name, 'read_file')
    assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { path: 'package.json' })
  } finally { await server.close() }
})

test('DSML inside code fences stays plain text and runs nothing', async () => {
  const server = await gateway((request, response) => {
    sse(response, [{ choices: [{ delta: { content: `讲解如下：\n\`\`\`\n${DSML_BLOCK}\n\`\`\`\n` } , finish_reason: 'stop' }] }])
  })
  try {
    const result = await callModel({
      apiMode: 'chat_completions', model: { model: 'm' }, baseUrl: server.baseUrl, token: 'tk',
      tools: DSML_TOOLS, messages: [{ role: 'user', text: 'hi' }], onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.equal(result.finish, 'stop')
    assert.deepEqual(result.toolCalls, [])
    assert.match(result.text, /讲解如下/)
    assert.match(result.text, /DSML/)
  } finally { await server.close() }
})

test('DSML recovery is off when the turn has no tools', async () => {
  const server = await gateway((request, response) => {
    sse(response, [{ choices: [{ delta: { content: DSML_BLOCK }, finish_reason: 'stop' }] }])
  })
  try {
    const result = await callModel({
      apiMode: 'chat_completions', model: { model: 'm' }, baseUrl: server.baseUrl, token: 'tk',
      tools: [], messages: [{ role: 'user', text: 'hi' }], onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.deepEqual(result.toolCalls, [])
    assert.equal(result.finish, 'stop')
    assert.equal(result.text, DSML_BLOCK)
  } finally { await server.close() }
})

test('gemini replays thought signatures, filling the official placeholder for the first call', async () => {
  let seen
  const server = await gateway((request, response, body) => {
    seen = JSON.parse(body)
    sse(response, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  try {
    await callModel({
      apiMode: 'chat_completions', model: { model: 'gemini-3-pro' }, baseUrl: server.baseUrl, token: 'tk',
      tools: DSML_TOOLS, messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: [
          { id: 'c1', name: 'read_file', arguments: '{}', signature: 'sig-real' },
          { id: 'c2', name: 'read_file', arguments: '{}' },
        ] },
        { role: 'tool', toolCallId: 'c1', text: 'a' },
        { role: 'tool', toolCallId: 'c2', text: 'b' },
      ],
      onDelta: async () => {}, onReasoning: async () => {},
    })
    const calls = seen.messages[1].tool_calls
    assert.equal(calls[0].extra_content.google.thought_signature, 'sig-real')
    assert.equal(calls[1].extra_content, undefined, '并行的非首个调用本就没有签名')

    // 首个调用没有真签名时补官方占位值，否则 Gemini 直接 400。
    await callModel({
      apiMode: 'chat_completions', model: { model: 'gemini-3-pro' }, baseUrl: server.baseUrl, token: 'tk',
      tools: DSML_TOOLS, messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', text: 'a' },
      ],
      onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.equal(seen.messages[1].tool_calls[0].extra_content.google.thought_signature, 'skip_thought_signature_validator')
  } finally { await server.close() }
})

test('non-gemini providers are not sent extra_content', async () => {
  let seen
  const server = await gateway((request, response, body) => {
    seen = JSON.parse(body)
    sse(response, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  try {
    await callModel({
      apiMode: 'chat_completions', model: { model: 'gpt-4o' }, baseUrl: server.baseUrl, token: 'tk',
      tools: DSML_TOOLS, messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', text: 'a' },
      ],
      onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.equal(seen.messages[1].tool_calls[0].extra_content, undefined)
  } finally { await server.close() }
})

test('tool_call deltas without index are keyed by id so parallel calls do not merge', async () => {
  const server = await gateway((request, response) => {
    sse(response, [
      { choices: [{ delta: { tool_calls: [{ id: 'call_a', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'call_a', function: { arguments: '"a"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'call_b', function: { name: 'read_file', arguments: '{"path":"b"}' } }] }, finish_reason: 'tool_calls' }] },
    ])
  })
  try {
    const result = await callModel({
      apiMode: 'chat_completions', model: { model: 'gemini-3-pro' }, baseUrl: server.baseUrl, token: 'tk',
      tools: DSML_TOOLS, messages: [{ role: 'user', text: 'hi' }], onDelta: async () => {}, onReasoning: async () => {},
    })
    assert.deepEqual(result.toolCalls.map(call => call.id), ['call_a', 'call_b'])
    assert.equal(result.toolCalls[0].arguments, '{"path":"a"}')
    assert.equal(result.toolCalls[1].arguments, '{"path":"b"}')
  } finally { await server.close() }
})
