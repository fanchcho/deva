import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function adapters() {
  const root = new URL('../../desktop/src/main/services/remote/', import.meta.url).pathname
  const result = await build({
    stdin: { contents: "export * from './feishu';export * from './telegram';export * from './feishu-onboard'", resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'im-transports', setup(b) {
      b.onResolve({ filter: /^@larksuiteoapi\/node-sdk$|^\.\.\/\.\.\/http$/ }, a => ({ path: a.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
        a.path.endsWith('/http') ? 'export const httpFetch=(...args)=>globalThis.__im.fetch(...args);' :
        `export const Domain={Lark:'lark',Feishu:'feishu'},LoggerLevel={warn:1};export class Client{constructor(){return globalThis.__im.client}};export class EventDispatcher{register(events){globalThis.__im.events=events;return this}};export class WSClient{constructor(options){this.options=options}async start(){this.options.onReady()}close(){}};export const registerApp=opts=>globalThis.__im.register(opts);`
      }))
    } }]
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

test('Feishu adapter authenticates, deduplicates messages, sends replies and retires typing reactions', async () => {
  const sent = [], inbound = [], states = []
  const record = method => async value => { sent.push([method, value]); return { code: 0, data: { message_id: 'reply', reaction_id: 'reaction' } } }
  globalThis.__im = { client: { auth: { v3: { tenantAccessToken: { internal: async () => ({ code: 0 }) } } }, im: { v1: { message: { create: record('create'), patch: record('patch'), delete: record('delete') }, messageReaction: { create: record('typing'), delete: record('stop-typing') } } } } }
  const { FeishuAdapter, startFeishuScan } = await adapters()
  const adapter = new FeishuAdapter('f', { appId: 'id', appSecret: 'secret', domain: 'feishu' })
  try {
    await adapter.start({ onState: s => states.push(s), onMessage: m => inbound.push(m) })
    assert.deepEqual(states, ['connecting', 'connected'])
    const frame = { sender: { sender_type: 'user', sender_id: { open_id: 'u' } }, message: { message_id: 'm', chat_id: 'c', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'hello' }), create_time: String(Date.now()) } }
    globalThis.__im.events['im.message.receive_v1'](frame)
    globalThis.__im.events['im.message.receive_v1'](frame)
    globalThis.__im.events['im.message.receive_v1']({ ...frame, message: { ...frame.message, message_id: 'group', chat_type: 'group' } })
    assert.equal(inbound.length, 1); assert.equal(inbound[0].ref, 'm')
    const chat = { channel: 'f', chatId: 'c' }
    assert.equal(await adapter.sendReply(chat, { text: '**answer**', note: 'done' }), 'reply')
    assert.match(sent[0][1].data.content, /answer/)
    await adapter.startTyping(chat, ['m']); await adapter.startTyping(chat, ['m'])
    await adapter.stopTyping(chat, ['m'])
    assert.equal(sent.filter(([m]) => m === 'typing').length, 1)
    assert.equal(sent.filter(([m]) => m === 'stop-typing').length, 1)
    globalThis.__im.register = async opts => {
      assert.ok(opts.addons.scopes.tenant.includes('im:message.reactions:write_only'))
      assert.equal(opts.createOnly, true)
      opts.onQRCodeReady({ url: 'https://example.invalid/scan', expireIn: 60 })
      return { client_id: 'id', client_secret: 'secret', user_info: { open_id: 'u', tenant_brand: 'lark' } }
    }
    const scan = await startFeishuScan()
    assert.equal(scan.url, 'https://example.invalid/scan')
    assert.deepEqual(await scan.outcome, { kind: 'done', appId: 'id', appSecret: 'secret', openId: 'u', domain: 'lark' })
  } finally { await adapter.stop(); delete globalThis.__im }
})

test('Telegram adapter preserves private message contract, card actions, typing and explicit API errors', async () => {
  const calls = [], inbound = []
  let denied = false
  globalThis.__im = { fetch: async (url, options) => {
    calls.push([url.split('/').at(-1), JSON.parse(options.body)])
    return new Response(JSON.stringify(denied ? { ok: false, error_code: 401, description: 'unauthorized' } : { ok: true, result: { message_id: 5 } }))
  } }
  const { TelegramAdapter, tgCall } = await adapters()
  const adapter = new TelegramAdapter('t', { token: 'fixture' }), chat = { channel: 't', chatId: '1' }
  try {
    const frame = { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 2 }, date: Date.now() / 1000, text: 'hello' }
    adapter.onMessage({ onMessage: m => inbound.push(m) }, frame)
    adapter.onMessage({ onMessage: m => inbound.push(m) }, { ...frame, chat: { id: 1, type: 'group' } })
    assert.equal(inbound.length, 1); assert.equal(inbound[0].text, 'hello')
    await adapter.sendReply(chat, { text: '**answer**', note: 'done' })
    assert.match(calls[0][1].text, /answer/)
    await adapter.renderPrompt(chat, { kind: 'plan', key: 'p', plan: 'plan', state: 'open', sessionTitle: 'chat' })
    const markup = calls.at(-1)[1].reply_markup
    assert.ok(markup.inline_keyboard.flat().some(b => b.text.includes('批准')))
    await adapter.startTyping(chat); await adapter.startTyping(chat); await adapter.stopTyping(chat)
    assert.equal(calls.filter(([m]) => m === 'sendChatAction').length, 1)
    denied = true
    await assert.rejects(tgCall('fixture', 'getMe'), e => e.code === 401 && !e.message.includes('fixture'))
  } finally { await adapter.stop(); delete globalThis.__im }
})
