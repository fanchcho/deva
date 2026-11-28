import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleInvoke } from '../src/server/invoke.mjs'
import { BackendPool } from '../src/server/backend-pool.mjs'
import { SseBudget } from '../src/server/sse-budget.mjs'
import { AuditLog } from '../src/server/audit-log.mjs'
const wait = ms => new Promise(r=>setTimeout(r,ms))
test('audit failure: one side effect, one response, one append; fail closed and read degraded', async () => {
  for (const [healthy,channel,effects] of [[true,'chat:send',1],[false,'chat:send',0],[false,'chat:list-sessions',1]]) {
    let calls=0, appends=0, responses=0, body
    const req=Readable.from([Buffer.from(JSON.stringify({channel}))]);req.method='POST';req.headers={'x-deva-csrf':'c'}
    await handleInvoke(req,{writeHead(){return this},end(data){responses++;body=JSON.parse(data)}},{id:'u'},{csrf:'c'}, {
      pool:{invoke:async()=>{calls++;return 'success'}},jailCheck:async()=>{},audit:{probe:()=>healthy,append(){appends++;throw new Error('ENOSPC')}}
    })
    assert.equal(calls,effects);assert.equal(responses,1);assert.equal(appends,healthy?1:0)
    if(effects){assert.equal(body.ok,true);assert.equal(body.audit,'degraded')}else assert.equal(body.error,'AUDIT_UNAVAILABLE')
  }
})
function fixture(options={}) {
  const worker=new EventEmitter();worker.exitCode=null;worker.kill=()=>{worker.exitCode=0}
  const sent=[];worker.send=(message,callback)=>{sent.push({message,callback});return false}
  const pool=new BackendPool({idleMs:20,requestMs:100,spawnWorker:()=>worker,...options})
  const user={id:'u',username:'u',workspace:'.',home:'.'};const entry=pool.entry(user)
  worker.emit('message',{t:'ready'})
  return {worker,pool,user,entry,sent}
}
test('RPC limits, IPC false blocks sends, cancellation and timers reclaim slots', async()=>{
  const {worker,pool,user,entry,sent}=fixture({maxInflight:1,maxQueue:2,requestMs:1000})
  const a=pool.invoke(user,'a',[]);await wait(1)
  const control=new AbortController();const b=pool.invoke(user,'b',[],{signal:control.signal}).catch(e=>e.code)
  const c=pool.invoke(user,'c',[]).catch(e=>e.message)
  await assert.rejects(pool.invoke(user,'over',[]),{code:'RPC_OVERLOADED',retryAfterMs:1000})
  assert.equal(sent.length,1);assert.equal(entry.queue.length,2)
  control.abort();assert.equal(await b,'RPC_CANCELLED')
  sent[0].callback();assert.equal(sent.length,1)
  worker.emit('message',{t:'reply',id:sent[0].message.id,ok:true,value:42})
  assert.equal(await a,42);assert.equal(sent.length,2)
  sent[1].callback();worker.emit('message',{t:'reply',id:sent[1].message.id,ok:true,value:43})
  assert.equal(await c,43);assert.equal(entry.pending.size,0);assert.equal(entry.queue.length,0)
  pool.stopAll();worker.exitCode=0
})
test('active lease protects idle; hung RPC still times out', async()=>{
  const {worker,pool,user,entry,sent}=fixture({requestMs:60})
  worker.emit('message',{t:'lease',active:true})
  const pending=pool.invoke(user,'hung',[]).catch(e=>e.message)
  await wait(5);sent[0].callback();await wait(30);assert.equal(entry.alive,true)
  assert.match(await pending,/超时/);await wait(30);assert.equal(entry.alive,true)
  worker.emit('message',{t:'lease',active:false});await wait(30);assert.equal(entry.alive,false);worker.exitCode=0
})
class Response extends EventEmitter {
  writableLength=0; frames=[]; ended=false
  write(frame){this.frames.push(frame);this.writableLength+=Buffer.byteLength(frame);return false}
  end(frame){this.frames.push(frame);this.ended=true}
  destroy(){this.emit('close')}
}
test('SSE drain, byte budget, connection budget and explicit resync',()=>{
  const budget=new SseBudget({maxBuffer:180,maxConns:1}),req=new EventEmitter(),res=new Response()
  const client=budget.add('u',req,res)
  budget.broadcast('u','chat:event',{event:{type:'text',text:'x'}})
  assert.equal(res.frames.length,1);assert.ok(client.bytes>0)
  res.writableLength=0;res.emit('drain');assert.equal(res.frames.length,2)
  const extra=new Response();assert.equal(budget.add('u',new EventEmitter(),extra),null);assert.ok(extra.ended)
  budget.broadcast('u','chat:event',{event:{type:'done',text:'x'.repeat(200)}})
  assert.ok(res.ended);assert.match(res.frames.at(-1),/resync/);assert.match(res.frames.at(-1),/unconfirmed/)
  assert.equal(budget.users.size,0);res.destroy();extra.destroy()
})
test('audit startup indexes 1024 files once; steady append performs zero directory/stat scans',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'audit-budget-'));const log=new AuditLog(root)
  const dir=path.join(root,'audit/users/u/managed-v1');fs.mkdirSync(dir,{recursive:true})
  for(let i=0;i<1024;i++)fs.writeFileSync(path.join(dir,`${1700000000000+i}-aaaaaaaa.jsonl`),'{}\n')
  fs.writeFileSync(path.join(dir,'legacy.jsonl'),'legacy')
  let stats=0,reads=0;const stat=fs.lstatSync,read=fs.readdirSync
  fs.lstatSync=(...args)=>{stats++;return stat(...args)};fs.readdirSync=(...args)=>{reads++;return read(...args)}
  try {
    log.append('u',{ok:true});const startup={stats,reads};stats=0;reads=0
    log.append('u',{ok:true});assert.equal(stats,0);assert.equal(reads,0)
    console.log(JSON.stringify({retention1024:{startup,steady:{stats,reads}}}))
    assert.equal(fs.readFileSync(path.join(dir,'legacy.jsonl'),'utf8'),'legacy')
  }finally{fs.lstatSync=stat;fs.readdirSync=read;fs.rmSync(root,{recursive:true})}
})

test('startup queue budget is enforced before ready and hung IPC releases all tasks', async()=>{
  const worker=new EventEmitter();worker.exitCode=null;worker.send=()=>false;worker.kill=()=>{worker.exitCode=0}
  const pool=new BackendPool({idleMs:0,requestMs:30,maxInflight:2,maxQueue:2,spawnWorker:()=>worker})
  const user={id:'startup',workspace:'.',home:'.'}
  const a=pool.invoke(user,'a',[]).catch(e=>e.message),b=pool.invoke(user,'b',[]).catch(e=>e.message)
  await assert.rejects(pool.invoke(user,'c',[]),{code:'RPC_OVERLOADED'})
  worker.emit('message',{t:'ready'})
  const hold=setTimeout(()=>{},1000)
  try {assert.match(await a,/超时/);assert.match(await b,/超时/);assert.equal(pool.entries.size,0)}finally{clearTimeout(hold)}
})

test('default RPC admission never exceeds 32 active and 128 queued', async()=>{
  const {worker,pool,user,entry}=fixture({idleMs:0,requestMs:1000})
  worker.send=(_message,callback)=>{callback?.();return true}
  const requests=Array.from({length:160},()=>pool.invoke(user,'work',[]).catch(e=>e.message))
  assert.equal(entry.pending.size,32);assert.equal(entry.queue.length,128)
  await assert.rejects(pool.invoke(user,'over',[]),{code:'RPC_OVERLOADED'})
  pool.stopAll();worker.exitCode=0;await Promise.all(requests)
})
test('SSE overflow prioritizes a terminal frame when socket budget permits',()=>{
  const budget=new SseBudget({maxBuffer:220,maxConns:4}),res=new Response()
  budget.add('u',new EventEmitter(),res)
  budget.broadcast('u','chat:event',{event:{type:'text',text:'x'.repeat(90)}})
  budget.broadcast('u','chat:event',{event:{type:'done'}})
  assert.ok(res.ended);assert.match(res.frames.at(-1),/"done"/);assert.match(res.frames.at(-1),/resync/)
  res.destroy()
})
