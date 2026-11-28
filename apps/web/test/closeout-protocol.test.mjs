import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import fs from 'node:fs/promises'
import {WebSocketServer} from 'ws'
import {once,EventEmitter} from 'node:events'
const require=createRequire(import.meta.url)
const repo=new URL('../../../',import.meta.url).pathname
await fs.mkdir(repo+'.tmp/web-closeout',{recursive:true})
async function bundle(file,plugins=[]) {return (await build({entryPoints:[repo+file],bundle:true,write:false,platform:'node',format:'cjs',plugins})).outputFiles[0].text}
function evaluate(code,extra={}) {const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require,console,Buffer,URL,Date,process,...extra});return module.exports}

test('relay client heartbeat reconnects dead sockets, preserves envelopes and slows rejected keys',async()=>{
 const sockets=[],timers=new Map(),states=[],received=[];let now=0,seq=0,attached,closed=0
 const timer=(fn,ms)=>{const id={n:++seq,unref(){return this}};timers.set(id,{fn,ms});return id}
 class Socket extends EventEmitter {static OPEN=1;readyState=1;sent=[];constructor(url,options){super();this.url=url;this.options=options;sockets.push(this)}send(s){this.sent.push(s)}terminate(){if(this.readyState===3)return;this.readyState=3;this.emit('close')}close(){this.terminate()}}
 class Clock extends Date {static now(){return now}}
 const plugin={name:'relay-socket-boundary',setup(b){b.onResolve({filter:/^ws$/},()=>({path:'ws',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default globalThis.Socket;',loader:'js'}))}}
 const m=evaluate(await bundle('apps/desktop/src/main/services/remote/web/relay.ts',[plugin]),{Socket,Date:Clock,setInterval:timer,setTimeout:timer,clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id)})
 const client=m.startRelayClient({url:'https://relay.example/path/',deskId:'desk',key:'key',onState:s=>states.push(s),sink:{attach:c=>{attached=c;return {onText:x=>received.push(x),onClose:()=>closed++}}}})
 const s=sockets[0];assert.equal(s.url,'wss://relay.example/path/desk/desk');assert.equal(s.options.headers.authorization,'Bearer key')
 s.emit('open');const beat=[...timers.values()].find(t=>t.ms===20000);now=20000;beat.fn();assert.equal(s.sent.at(-1),'ping')
 s.emit('message',Buffer.from('pong'),false);s.emit('message',Buffer.from('{"t":"open","c":"phone"}'),false)
 s.emit('message',Buffer.from('{"t":"msg","c":"phone","d":"ciphertext"}'),false);assert.deepEqual(received,['ciphertext'])
 attached.sendText('reply');assert.deepEqual(JSON.parse(s.sent.at(-1)),{t:'msg',c:'phone',d:'reply'})
 now=66001;beat.fn();assert.equal(s.readyState,3);assert.equal(closed,1);assert.equal(states.at(-1),'connecting')
 const retry=[...timers.values()].find(t=>t.ms===1000);assert.ok(retry);timers.clear();retry.fn()
 sockets[1].emit('unexpected-response',null,{statusCode:403});assert.equal(states.at(-1),'error');assert.ok([...timers.values()].some(t=>t.ms===60000))
 client.close();assert.equal(timers.size,0)
 const invalid=[];m.startRelayClient({url:'file:///tmp',onState:(...args)=>invalid.push(args)}).close();assert.equal(invalid[0][0],'error')
})

test('browser injected dialog, focus, selection and badge scripts execute their DOM contracts',async()=>{
 const scripts=evaluate(await bundle('apps/desktop/src/main/services/browser/page-scripts.ts'))
 const window={},events=[];const document={activeElement:null};class Navigator {setAppBadge(){throw new Error('native badge must not run')}clearAppBadge(){throw new Error('native badge must not run')}}
 const ctx=vm.createContext({window,document,Navigator,Promise,Event:class {constructor(type){this.type=type}}})
 vm.runInContext(scripts.DIALOG_SHIM,ctx);assert.equal(window.confirm('delete?'),false);window.__devaDialogAnswer={accept:true};assert.equal(window.confirm('delete?'),true);assert.equal(window.confirm('again?'),false)
 window.__devaDialogAnswer={accept:true,text:'answer'};assert.equal(window.prompt('input'), 'answer');assert.equal(window.prompt('input'),null);assert.equal(window.__devaDialogs.length,5)
 const el={isConnected:true,tagName:'SELECT',multiple:true,options:[{value:'a',textContent:' First '},{value:'b',textContent:'Second'}],focus(){document.activeElement=this},dispatchEvent:e=>events.push(e.type)}
 window.__devaRefs=new Map([['e1',{deref:()=>el}]])
 assert.equal(vm.runInContext(scripts.callScript(scripts.FOCUS_FN,'e1',false),ctx).ok,true)
 assert.equal(vm.runInContext(scripts.callScript(scripts.SELECT_FN,'e1',['Second']),ctx).picked[0],'Second');assert.equal(el.options[1].selected,true);assert.deepEqual(events,['input','change'])
 assert.equal(vm.runInContext(scripts.callScript(scripts.SELECT_FN,'e1',['missing']),ctx).error,'no-match')
 el.isConnected=false;assert.equal(vm.runInContext(scripts.callScript(scripts.FOCUS_FN,'e1'),ctx).error,'stale')
 vm.runInContext(scripts.BADGE_SHIM,ctx);await new Navigator().setAppBadge(99);await new Navigator().clearAppBadge()
})

test('gateway attaches over CDP, forwards API/events and rejects transport loss promptly',async()=>{
 const {DevaControl}=require('../../desktop/web-gateway/deva.js')
 const dir=await fs.mkdtemp(repo+'.tmp/web-closeout/cdp-')
 const wss=new WebSocketServer({port:0,host:'127.0.0.1'});await once(wss,'listening')
 await fs.writeFile(dir+'/DevToolsActivePort',wss.address().port+'\n/devtools/browser/test')
 let peer;const methods=[]
 wss.on('connection',ws=>{peer=ws;ws.on('message',raw=>{
  const m=JSON.parse(raw);methods.push(m.method);let result={}
  if(m.method==='Target.getTargets')result={targetInfos:[{type:'page',url:'http://localhost/index.html',targetId:'page'}]}
  if(m.method==='Target.attachToTarget')result={sessionId:'session'}
  if(m.method==='Runtime.evaluate'){
   if(m.params.expression==='hang')return
   if(m.params.expression==='bad'){ws.send(JSON.stringify({id:m.id,error:{message:'CDP rejected'}}));return}
   if(m.params.expression.includes('__gwBridge'))result={result:{value:'already'}}
   else result={result:{value:m.params.expression}}
  }
  ws.send(JSON.stringify({id:m.id,result}))
 })})
 const control=new DevaControl({userDataDir:dir,log:()=>{}})
 try {
  await control.attach();assert.equal(control.pageReady,true)
  assert.deepEqual(methods.slice(0,5),['Target.getTargets','Target.attachToTarget','Runtime.enable','Runtime.addBinding','Runtime.evaluate'])
  const payload={text:'quote"\n'};assert.equal(await control.callApi('deva.chat.send',[payload,undefined]),'window.deva.chat.send('+JSON.stringify(payload)+',null)')
  const event=once(control,'event');peer.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:'__gwEmit',payload:JSON.stringify({k:'sessions'})}}));assert.equal((await event)[0].k,'sessions')
  await assert.rejects(control.eval('bad'),/CDP rejected/)
  const pending=control._send('Runtime.evaluate',{expression:'hang'})
  const result=pending.then(()=>false,()=>true)
  await control.stop()
  assert.equal(control.pending.size,0,'disconnect must reclaim requests immediately')
  assert.equal(await result,true)
 }finally{control.stopWatch();await control.stop();for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await fs.rm(dir,{recursive:true,force:true})}
})

test('relay room protocol preserves ciphertext, replacement, offline and device key persistence',async()=>{
 const {Relay,MAX_FRAME}=evaluate(await bundle('apps/relay-node/src/relay.ts'))
 class Socket extends EventEmitter {OPEN=1;readyState=1;bufferedAmount=0;sent=[];send(s){this.sent.push(s)}close(code){this.code=code;this.readyState=3;this.emit('close')}terminate(){this.close(1006)}message(s){this.emit('message',Buffer.from(s),false)}}
 const relay=new Relay(),desk=new Socket(),phone=new Socket(),offline=new Socket()
 relay.addPhone('missing',offline);assert.equal(offline.code,4503)
 relay.addDesk('one',desk);relay.addPhone('one',phone);const c=JSON.parse(desk.sent[0]).c
 phone.message('opaque ciphertext');assert.equal(JSON.parse(desk.sent.at(-1)).d,'opaque ciphertext')
 desk.message(JSON.stringify({t:'msg',c,d:'reply ciphertext'}));assert.equal(phone.sent.at(-1),'reply ciphertext')
 phone.message('ping');assert.equal(phone.sent.at(-1),'pong')
 const other=new Socket();relay.addDesk('two',other);other.message(JSON.stringify({t:'msg',c,d:'wrong room'}));assert.notEqual(phone.sent.at(-1),'wrong room')
 const replacement=new Socket();relay.addDesk('one',replacement);assert.equal(desk.code,4000);assert.equal(JSON.parse(replacement.sent[0]).c,c)
 phone.message('x'.repeat(MAX_FRAME+1));assert.equal(phone.code,1009)
 const p2=new Socket();relay.addPhone('one',p2);replacement.close(1000);assert.equal(p2.code,4503)
 const {DeskKeys}=evaluate(await bundle('apps/relay-node/src/keys.ts'));const dir=await fs.mkdtemp(repo+'.tmp/web-closeout/keys-')
 try {const keys=new DeskKeys(dir);assert.equal(keys.verify('desk','secret'),'ok');assert.equal(new DeskKeys(dir).verify('desk','wrong'),'forbidden');assert.equal(new DeskKeys(dir).verify('desk','secret'),'ok')}finally{await fs.rm(dir,{recursive:true,force:true})}
})

test('scheduler due tick catches up once, serializes and deduplicates; stop cancels initial tick',async()=>{
 const now=Date.UTC(2026,10,29,12,5),schedule={kind:'recurring',cron:'* * * * *',tz:'UTC'}
 const state={tasks:[{id:'a',status:'active',nextRunAt:now-120000,schedule,title:'a'},{id:'b',status:'paused',nextRunAt:now-1,schedule}],runs:[],calls:[],runner:null,finish:null}
 const plugin={name:'scheduler-boundary',setup(b){b.onResolve({filter:/^(electron|\.\/tasks|\.\/chat|\.\/chat-bus)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?'export const Notification={isSupported:()=>false};':a.path==='./chat'?'export const runScheduledTask=t=>{state.calls.push(t.id);return new Promise(r=>state.finish=r)}':a.path==='./chat-bus'?'export const publishAppNotice=()=>{};':`export const listTasks=()=>state.tasks;export const getTask=id=>state.tasks.find(t=>t.id===id);export const appendRun=(id,r)=>state.runs.push(r);export const applyRunResult=id=>{state.tasks.find(t=>t.id===id).nextRunAt=Date.now()+60000;return {}};export const setTaskRunner=f=>state.runner=f;`,loader:'js'}))}}
 let seq=0;const timers=new Map();const set=(fn)=>{const id=++seq;timers.set(id,fn);return id}
 class Clock extends Date {static now(){return now}}
 const m=evaluate(await bundle('apps/desktop/src/main/services/scheduler.ts',[plugin]),{state,Date:Clock,setTimeout:fn=>{const id=++seq;timers.set(id,()=>{timers.delete(id);fn()});return id},setInterval:set,clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)})
 assert.equal(m.planFires(state.tasks,now).length,1);assert.equal(m.countMissed(schedule,now-120000,now),2)
 m.startScheduler(()=>null);m.startScheduler(()=>null);assert.equal(timers.size,2)
 const tick=[...timers.values()][0];tick();tick();assert.deepEqual(state.calls,['a']);assert.equal(state.runner('a'),'running')
 state.finish({stopReason:'end_turn',text:'finished'});await new Promise(r=>setImmediate(r));assert.equal(state.runs.length,2);assert.equal(state.runs[0].status,'skipped');assert.equal(state.runs[1].status,'ok')
 m.stopScheduler();assert.equal(timers.size,0);m.startScheduler(()=>null);assert.equal(timers.size,2);m.stopScheduler();assert.equal(timers.size,0,'stop must cancel startup timeout as well as interval')
})

test('schedule clock contract covers once, cron validation and DST local-time alignment',async()=>{
 const {nextRun,parseCron}=evaluate(await bundle('apps/desktop/src/main/services/schedule.ts'),{Intl})
 const once={kind:'once',at:'2026-11-29T12:00',tz:'UTC'},at=Date.UTC(2026,10,29,12)
 assert.equal(nextRun(once,at-1),at);assert.equal(nextRun(once,at),null)
 assert.equal(parseCron('*/0 * * * *'),null);assert.equal(parseCron('60 * * * *'),null)
 const daily={kind:'recurring',cron:'0 10 * * *',tz:'America/New_York'}
 assert.equal(nextRun(daily,Date.UTC(2026,2,7,16)),Date.UTC(2026,2,8,14))
 assert.equal(nextRun({kind:'recurring',cron:'30 2 * * *',tz:'America/New_York'},Date.UTC(2026,2,8,5)),Date.UTC(2026,2,8,7))
})
