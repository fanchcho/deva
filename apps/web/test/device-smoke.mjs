import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import {build} from 'esbuild'
const cryptoBundle = await build({entryPoints:[new URL('../../desktop/src/shared/remote-crypto.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false})
const {phoneHello,phoneFinish,parseTicket,b64uDecode,b64uEncode} = await import('data:text/javascript;base64,' + Buffer.from(cryptoBundle.outputFiles[0].text).toString('base64'))

const until = async (fn, label) => {
  for (let i = 0; i < 240; i++) {
    const value = await fn()
    if (value) return value
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('timeout: ' + label)
}

async function phoneClient(url, kind, id, secret) {
  const ws = new WebSocket(url)
  const frames = []
  let crypto
  ws.addEventListener('message', e => {
    const raw = JSON.parse(e.data)
    const frame = raw.t === 'x' ? crypto?.open(raw) : raw
    if (frame) frames.push(frame)
  })
  await until(() => ws.readyState === WebSocket.OPEN, 'phone websocket open')
  console.log('PHONE WS', new URL(url).pathname, 101)
  const pending = phoneHello(kind, id)
  ws.send(JSON.stringify(pending.hi))
  const wait = pred => until(() => {
    const i = frames.findIndex(pred)
    return i < 0 ? null : frames.splice(i, 1)[0]
  }, 'phone frame')
  const hi = await wait(f => f.t === 'hi' || f.t === 'err')
  if (hi.t === 'err') { ws.close(); return { error: hi } }
  crypto = phoneFinish(pending.hi, pending.priv, secret, hi)
  assert.ok(crypto, 'server proves knowledge of phone secret')
  const send = f => ws.send(JSON.stringify(crypto.seal(f)))
  send({ t: 'hello', v: 1, name: 'phone regression', kind: 'browser' })
  return { ws, send, wait, close: () => ws.close() }
}

export async function deviceSmoke({ invoke, userHome, secondPort }) {
  const requests=[]
  const mock=http.createServer((req,res)=>{
    let body=''
    req.on('data',chunk=>body+=chunk)
    req.on('end',()=>{
      requests.push(JSON.parse(body))
      res.writeHead(200,{'content-type':'text/event-stream'})
      setTimeout(()=>{
        res.write('data: '+JSON.stringify({id:'local',choices:[{index:0,delta:{content:'local protocol response'},finish_reason:null}]})+'\n\n')
        res.end('data: '+JSON.stringify({id:'local',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})+'\n\ndata: [DONE]\n\n')
      },300)
    })
  })
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve))
  try {
  const cfg=(await invoke('config:get')).value
  cfg.models.providers[0].apiHost='http://127.0.0.1:'+mock.address().port+'/v1'
  await invoke('config:set',[{models:cfg.models}])
  await invoke('secrets:set',['fixture','local-test-key'])
  const st = await until(async () => {
    const s = (await invoke('general:get-state')).value
    return s.state === 'connected' && s
  }, 'general ready')
  assert.ok(st.port > 0 && st.port !== 4317)
  const base = 'http://127.0.0.1:' + st.port
  let token = ''
  const request = async (url, expected, options = {}) => {
    const r = await fetch(base + url, { ...options, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...options.headers } })
    console.log('GENERAL', options.method || 'GET', url, r.status)
    assert.equal(r.status, expected, url + ': ' + r.status)
    return r
  }
  const post = (url, body, expected = 200, headers = {}) => request(url, expected, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  assert.match(await (await request('/', 200)).text(), /<html/i)
  await request('/api/info', 401)
  await post('/api/pair', { code: 'bad' }, 400)
  const code = (await invoke('general:pair-code')).value
  assert.equal(code.ok, true)
  const paired = await (await post('/api/pair', { code: code.code, deviceName: 'general regression' })).json()
  assert.ok(paired.capabilities.includes('general-channel'))
  token = paired.token
  await post('/api/pair', { code: code.code, deviceName: 'replay' }, 400)
  const code2 = (await invoke('general:pair-code')).value
  await post('/api/pair', { code: code2.code, deviceName: 'general regression' }, 409)
  const second = await (await post('/api/pair', { code: code2.code, deviceName: 'second device' })).json()
  assert.ok(second.token)
  await request('/api/info', 200, { headers: { origin: base } })
  await request('/api/info', 403, { headers: { origin: 'http://127.0.0.1:1' } })
  const other = await fetch('http://127.0.0.1:' + secondPort + '/api/info', { headers: { authorization: 'Bearer ' + token } })
  console.log('GENERAL other-user GET /api/info', other.status)
  assert.equal(other.status, 401)
  for (const url of ['/api/personas', '/api/tasks', '/api/sessions']) await request(url, 200)
  const models = await (await request('/api/models', 200)).json()
  assert.ok(models.models.some(m => m.ref === 'fixture:test'))
  const uploaded = await (await request('/api/attachments?name=general.txt', 200, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'general upload bytes' })).json()
  assert.equal(await fs.readFile(uploaded.path, 'utf8'), 'general upload bytes')
  await request('/api/attachments', 400, { method: 'POST', body: 'bytes' })
  const session = await (await post('/api/sessions', { personaId: 'general' })).json()
  assert.equal((await (await request('/api/sessions/' + session.id + '?detail=1', 200)).json()).personaId, 'general')
  await post('/api/sessions/' + session.id + '/rename', { title: 'General renamed' })
  assert.equal((await (await request('/api/sessions/' + session.id, 200)).json()).title, 'General renamed')

  const ctrl=new AbortController()
  const stream=await request('/api/sessions/'+session.id+'/events',200,{signal:ctrl.signal})
  let events=''
  const reading=(async()=>{try{for await(const chunk of stream.body)events+=Buffer.from(chunk).toString()}catch(error){if(!ctrl.signal.aborted)throw error}})()
  try {
    const turn=await(await post('/api/sessions/'+session.id+'/send',{text:'general smoke',attachments:[uploaded.path],modelRef:'fixture:test'})).json()
    assert.ok(turn.turnId)
    await until(()=>events.includes('"type":"done"'),'general SSE done')
    assert.match(events,/"type":"turn_start"/)
    assert.match(events,/local protocol response/)
    assert.equal(requests.at(-1).model,'test')
    assert.match(JSON.stringify(requests.at(-1).messages),/general upload bytes/)
    assert.equal((await(await request('/api/sessions/'+session.id,200)).json()).model,'fixture:test')
  } finally {ctrl.abort();await reading}
  console.log('PASS general send: local mock, model resolution, attachment content, SSE turn_start/text/done')
  await post('/api/sessions/' + session.id + '/archive', { archived: true })
  assert.equal((await (await request('/api/sessions/' + session.id, 200)).json()).archived, true)
  await request('/api/sessions/' + session.id, 200, { method: 'DELETE' })
  await request('/api/sessions/' + session.id, 404)
  const view = (await invoke('general:get-state')).value
  assert.equal(view.devices.find(d => d.id === paired.deviceId).name, 'general regression')
  assert.equal((await invoke('general:rename-device', [paired.deviceId, 'renamed device'])).value.ok, true)
  assert.equal((await invoke('general:get-state')).value.devices.find(d => d.id === paired.deviceId).name, 'renamed device')
  await invoke('general:set-device-enabled', [paired.deviceId, false])
  await request('/api/info', 401)
  await invoke('general:set-device-enabled', [paired.deviceId, true])
  await request('/api/info', 200)

  // The phone protocol remains encrypted WebSocket, with its own one-time ticket and keys.
  assert.equal((await invoke('phone:add')).value.added, true)
  const link = (await invoke('phone:link', ['lan'])).value
  assert.equal(link.ok, true, link.error)
  const address = new URL(link.url)
  const info = new URLSearchParams(address.hash.slice(1))
  const ticket = parseTicket(info.get('p'))
  assert.ok(ticket)
  const phoneBase = 'http://127.0.0.1:' + address.port
  const phoneHtml = await fetch(phoneBase + '/')
  console.log('PHONE GET /', phoneHtml.status)
  assert.equal(phoneHtml.status, 200)
  const html = await phoneHtml.text()
  for (const asset of [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(m => m[1])) {
    const r = await fetch(new URL(asset, phoneBase))
    console.log('PHONE GET', asset, r.status)
    assert.equal(r.status, 200)
  }
  const url = 'ws://127.0.0.1:' + address.port + '/d/' + info.get('d') + '/ws'
  const phone = await phoneClient(url, 'pair', ticket.id, ticket.secret)
  assert.ok(!phone.error)
  try {
    const identity = await phone.wait(f => f.t === 'paired')
    await phone.wait(f => f.t === 'ok')
    assert.ok((await invoke('phone:get-state')).value.devices.some(d => d.id === identity.device))
    const replay = await phoneClient(url, 'pair', ticket.id, ticket.secret)
    assert.equal(replay.error.code, 'auth')
    phone.send({ t: 'models', rid: 'phone-models' })
    assert.ok((await phone.wait(f => f.t === 'models' && f.rid === 'phone-models')).list.some(m => m.ref === 'fixture:test'))
    const sid = 'sess_' + Date.now().toString(36) + '_phone'
    phone.send({ t: 'new', rid: 'new', sid, personaId: 'general' })
    assert.equal((await phone.wait(f => f.t === 'created' && f.rid === 'new')).sid, sid)
    phone.send({ t: 'set_model', rid: 'bad-model', sid, ref: 'missing:model' })
    assert.equal((await phone.wait(f => f.t === 'result' && f.rid === 'bad-model')).ok, false)
    phone.send({ t: 'set_model', rid: 'model', sid, ref: 'fixture:test' })
    assert.equal((await phone.wait(f => f.t === 'result' && f.rid === 'model')).ok, true)
    const uid = 'upload_phone'
    phone.send({ t: 'up_begin', uid, name: 'phone.txt', size: 5, mime: 'text/plain' })
    assert.equal((await phone.wait(f => f.t === 'upload' && f.uid === uid)).state, 'ready')
    phone.send({ t: 'up_chunk', uid, seq: 0, data: b64uEncode(Buffer.from('phone')) })
    phone.send({ t: 'up_end', uid })
    assert.equal((await phone.wait(f => f.t === 'upload' && f.uid === uid && f.state !== 'chunk')).state, 'done')
    const dirs = await fs.readdir(path.join(userHome, 'uploads'))
    assert.equal(await fs.readFile(path.join(userHome, 'uploads', dirs[0], 'phone.txt'), 'utf8'), 'phone')

    phone.send({t:'send',sid,text:'phone smoke',cid:'phone-send',files:[uid]})
    assert.equal((await phone.wait(f=>f.t==='sent'&&f.cid==='phone-send')).ok,true)
    await until(async()=>{const r=await(await request('/api/sessions/'+sid,200)).json();return !r.busy},'phone done')
    assert.equal(requests.at(-1).model,'test')
    assert.match(JSON.stringify(requests.at(-1).messages),/phone/)
    phone.send({t:'history',sid})
    assert.match(JSON.stringify(await phone.wait(f=>f.t==='history'&&f.sid===sid&&!f.live)),/local protocol response/)
    console.log('PASS phone send: local mock, uploaded bytes, selected model, history reply')
    phone.send({ t: 'delete', rid: 'delete', sid })
    assert.equal((await phone.wait(f => f.t === 'result' && f.rid === 'delete')).ok, true)
    assert.ok(!(await invoke('chat:list-sessions')).value.some(s => s.id === sid))
    const resume = await phoneClient(url, 'resume', identity.device, b64uDecode(identity.key))
    try { await resume.wait(f => f.t === 'ok') } finally { resume.close() }
    // Run the actual mobile client against this isolated phone backend, not a replacement client.
    const mobileBundle=await build({entryPoints:[new URL('../../desktop/src/mobile/link.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',write:false})
    const oldGlobals={window:globalThis.window,document:globalThis.document,location:globalThis.location}
    globalThis.window={setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false})}
    globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}}
    globalThis.location=new URL(phoneBase+'/')
    let mobile
    try {
      const {Link}=await import('data:text/javascript;base64,'+Buffer.from(mobileBundle.outputFiles[0].text).toString('base64'))
      mobile=new Link(info.get('d'),{kind:'resume',device:identity.device,key:b64uDecode(identity.key)},{onPhase(){},onFrame(){},onPaired(){}},'contract-test')
      mobile.start();await until(()=>mobile.ready,'actual mobile ready')
      assert.ok((await mobile.models()).some(m=>m.ref==='fixture:test'))
      const created=mobile.createSession('general');assert.ok(created);assert.equal(await created.done,null)
      assert.equal((await mobile.sendText(created.sid,'actual mobile client')).ok,true)
      await until(async()=>!(await(await request('/api/sessions/'+created.sid,200)).json()).busy,'mobile reply')
      assert.equal((await mobile.result(rid=>({t:'delete',rid,sid:created.sid}))).ok,true)
      console.log('PASS actual mobile Link: encrypted resume, models, create/send/delete API contract')
    } finally {mobile?.stop();for(const [k,v] of Object.entries(oldGlobals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v}}
    await invoke('phone:remove-device', [identity.device])
    const revoked = await phoneClient(url, 'resume', identity.device, b64uDecode(identity.key))
    assert.equal(revoked.error.code, 'auth')
    // General token cannot authenticate as a phone device, and phone key is not a general token.
    const wrongGeneral = await request('/api/info', 401, { headers: { authorization: 'Bearer ' + identity.key } })
    assert.equal(wrongGeneral.status, 401)
    const wrongPhone = await phoneClient(url, 'resume', paired.deviceId, b64uDecode(token))
    assert.equal(wrongPhone.error.code, 'auth')
  } finally { phone.close(); await invoke('phone:remove') }
  await invoke('general:remove-device', [paired.deviceId])
  await request('/api/info', 401)
  token = second.token
  await post('/api/devices/self', {})
  await request('/api/info', 401)
  assert.equal((await invoke('general:get-state')).value.devices.length, 0)
  console.log('PASS general + phone: pairing, one-time credentials, isolation, device views, upload, models, delete, reconnect and revoke')
  } finally {mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve))}
}
