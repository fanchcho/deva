import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { build } from 'esbuild'

// Only environment boundaries are replaced. Request construction, SSE parsing,
// model resolution, header filtering and error normalization use shipped code.
async function providers() {
  const root = new URL('../../desktop/src/main/', import.meta.url).pathname
  const result = await build({
    stdin: { contents: `export * from '${root}providers/index.ts'; export * from '${root}providers/types.ts'; export * from '${root}providers/opencode.ts'; export * from '${root}services/provider.ts'`, resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'provider-environment', setup(b) {
      b.onResolve({ filter: /^(electron)$|\/(http|locale)$|\/(services\/)?(config|secrets)$/ }, a => ({ path: a.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
        a.path === 'electron' ? 'export const app={getVersion:()=>"test"};export const ipcMain={handle:(k,v)=>globalThis.__provider.handlers.set(k,v)};' :
        a.path.endsWith('/http') ? 'export const httpFetch=(...a)=>fetch(...a);export const describeNetError=e=>e.message;' :
        a.path.endsWith('/locale') ? 'export const isEn=()=>true;' :
        a.path.endsWith('/config') ? 'export const getConfig=()=>globalThis.__provider.config;' :
        'export const getSecret=async()=>"fixture-key";'
      }))
    } }]
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

const responses = {
  openai: [
    { choices: [{ delta: { content: 'answer', reasoning_content: 'thought' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'read', arguments: '{"path":"x"}' }, extra_content: { google: { thought_signature: 'signature' } } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 60 } } }
  ],
  anthropic: [
    { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 20 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call', name: 'read' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"x"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } }
  ],
  responses: [
    { type: 'response.output_text.delta', delta: 'answer' },
    { type: 'response.output_item.added', item: { type: 'function_call', id: 'item', call_id: 'call', name: 'read' } },
    { type: 'response.function_call_arguments.delta', item_id: 'item', delta: '{"path":"x"}' },
    { type: 'response.output_item.done', item: { type: 'function_call', id: 'item', call_id: 'call', name: 'read' } },
    { type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 4, input_tokens_details: { cached_tokens: 60 } } } }
  ]
}

test('three provider adapters execute HTTP/SSE with tools, images, usage, headers and explicit errors', async () => {
  globalThis.__provider = { handlers: new Map(), config: { models: { providers: [{ id: 'p', headers: { 'x-custom': 'allowed', authorization: 'must-not-override' } }] } } }
  let adapter = 'openai', status = 200, request
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    request = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
    res.writeHead(status, { 'content-type': 'text/event-stream', 'retry-after': '2' })
    if (status !== 200) return res.end('denied')
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] }))
    res.end(responses[adapter].map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const baseURL = `http://127.0.0.1:${server.address().port}`
  try {
    const api = await providers()
    const messages = [
      { role: 'user', content: 'first' }, { role: 'user', content: [{ type: 'text', text: 'second', listing: { kind: 'memory', listed: [] } }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'read', input: {}, signature: 'original' }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'old', content: 'result', images: [{ type: 'image', mediaType: 'image/png', data: 'YWJj' }] }] }
    ]
    const snapshot = structuredClone(messages)
    for (adapter of Object.keys(responses)) {
      const events = await Array.fromAsync(api.streamChat({ adapter, providerId: 'p', baseURL }, { model: 'gemini-test', messages, system: 'system', cache: true, tools: [{ name: 'read', description: 'read', inputSchema: { type: 'object' } }], maxTokens: 100, effort: { format: 'standard', effort: 'high' } }))
      assert.equal(events.find(e => e.type === 'text_delta').text, 'answer')
      assert.deepEqual(events.find(e => e.type === 'tool_call').args, { path: 'x' })
      assert.equal(events.find(e => e.type === 'usage').input, 100)
      assert.equal(events.find(e => e.type === 'usage').cacheRead, 60)
      assert.equal(events.at(-1).stopReason, 'tool_use')
      assert.equal(request.headers['x-custom'], 'allowed')
      assert.equal(request.headers[adapter === 'anthropic' ? 'x-api-key' : 'authorization'], adapter === 'anthropic' ? 'fixture-key' : 'Bearer fixture-key')
      assert.ok(JSON.stringify(request.body).includes('YWJj'))
      assert.ok(!JSON.stringify(request.body).includes('listing'))
      if (adapter === 'openai') {
        assert.equal(request.url, '/chat/completions')
        assert.equal(request.body.messages[2].tool_calls[0].extra_content.google.thought_signature, 'original')
        assert.equal(request.body.reasoning_effort, 'high')
      } else if (adapter === 'anthropic') {
        assert.equal(request.url, '/v1/messages')
        assert.equal(request.body.messages[0].content.length, 2)
        assert.equal(request.body.messages.at(-1).content.at(-1).cache_control.type, 'ephemeral')
      } else {
        assert.equal(request.url, '/responses')
        assert.equal(request.body.store, false)
        assert.ok(request.body.input.some(i => i.type === 'function_call_output' && i.call_id === 'old'))
      }
      for (status of [401, 429]) {
        const failure = await Array.fromAsync(api.streamChat({ adapter, providerId: 'p', baseURL }, { model: 'test', messages: [] }))
        assert.equal(failure[0].error.kind, status === 401 ? 'auth' : 'rate_limit')
        assert.equal(failure.at(-1).stopReason, 'error')
      }
      status = 200
    }
    assert.deepEqual(messages, snapshot, 'normalization must not mutate persisted history')
    api.registerProviderIpc()
    assert.deepEqual(await globalThis.__provider.handlers.get('provider:list-models')(null, { adapter: 'openai', providerId: 'p', baseURL }), { ok: true, models: ['a', 'b'] })
    assert.equal(api.providerHeaders('https://opencode.ai/inference/go', 'p', 'session')['x-opencode-session'], 'session')
    assert.equal(api.opencodeModelsURL('https://opencode.ai/inference/go/openai/v1'), 'https://opencode.ai/inference/go/v1/models')
    assert.equal(api.providerHeaders('https://opencode.ai.invalid/inference', 'p', 'session')['x-opencode-session'], undefined)
    assert.equal(api.httpError(400, 'maximum context length is 4096 tokens').kind, 'context_length')
    assert.equal(api.httpError(400, 'max_tokens too large').kind, 'output_limit')
    assert.equal(api.inbandError('connection lost mid-reply', { kind: 'server' }).kind, 'network')
    assert.equal([...api.settleBrokenCalls([{ id: 'bad', name: 'read', raw: '{' }], 'max_tokens')][0].cause, 'max_tokens')
  } finally {
    delete globalThis.__provider
    await new Promise(resolve => server.close(resolve))
  }
})
