import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '../lib/mcp.mjs'
import { writeAtomic } from '../lib/deva-fs.mjs'
import { readJsonFile, recoverCorruptFile } from '../lib/corrupt-files.mjs'
import { migrateLegacyLayout } from '../lib/deva-layout.mjs'
import { LruMap, createTtlCache } from '../lib/bounded-cache.mjs'
const tick=()=>new Promise(r=>setImmediate(r))
test('parity: corrupt migration never deletes original; confirmed recovery copies bytes then branches',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parity-')),legacy=path.join(dir,'deva-agent')
 const previous=process.env.DEVA_BACKUP_ROOT;process.env.DEVA_BACKUP_ROOT=path.join(dir,'backups')
 try {
  fs.mkdirSync(legacy);const file=path.join(legacy,'identity.json'),raw=Buffer.from('{broken')
  fs.writeFileSync(file,raw)
  assert.throws(()=>migrateLegacyLayout({sharedDevaHome:dir}),e=>e.readOnly&&e.hash.length===64)
  assert.deepEqual(fs.readFileSync(file),raw)
  assert.throws(()=>writeAtomic(file,'{}'),{code:'SESSION_CORRUPT_READ_ONLY'})
  assert.throws(()=>recoverCorruptFile(file,false),/CONFIRMATION/)
  const result=recoverCorruptFile(file,true)
  assert.deepEqual(fs.readFileSync(result.backup),raw);assert.deepEqual(fs.readFileSync(file),raw)
  assert.deepEqual(JSON.parse(fs.readFileSync(result.branch)),{})
  assert.equal(readJsonFile(path.join(dir,'missing.json')),null)
 }finally{if(previous===undefined)delete process.env.DEVA_BACKUP_ROOT;else process.env.DEVA_BACKUP_ROOT=previous;fs.rmSync(dir,{recursive:true})}
})
test('parity: direct atomic write cannot overwrite undiscovered malformed JSON',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parity-direct-')),file=path.join(dir,'config.json')
 try{fs.writeFileSync(file,'{bad');assert.throws(()=>writeAtomic(file,'{}'));assert.equal(fs.readFileSync(file,'utf8'),'{bad')}finally{fs.rmSync(dir,{recursive:true})}
})
test('parity: MCP default 32 active / 128 queue, overload, cancellation, no queued side effect',async()=>{
 const c=createClient({type:'http',name:'fixture',url:'http://unused'}),sent=[]
 c.deliver=async(id,method)=>{sent.push(method)}
 const promises=[]
 for(let i=0;i<32;i++){promises.push(c.request('active',{}).catch(e=>e));await tick()}
 const ctrl=new AbortController()
 promises.push(c.request('cancelled',{}, {signal:ctrl.signal}).catch(e=>e))
 for(let i=0;i<127;i++)promises.push(c.request('queued',{}).catch(e=>e))
 await assert.rejects(c.request('overflow',{}),{code:'RPC_OVERLOADED',retryAfterMs:1000})
 assert.equal(sent.length,32);assert.equal(c.pending.size,160)
 ctrl.abort();assert.equal(c.pending.size,159)
 c.settle(1,{result:1});await tick();assert.equal(sent.length,33);assert.ok(!sent.includes('cancelled'))
 c.close();await Promise.all(promises);assert.equal(c.pending.size,0)
})
test('parity: blocked send admits only one transport call; queued request times out',async()=>{
 const c=createClient({type:'http',name:'fixture',url:'http://unused'});let sent=0,release
 c.deliver=()=>{sent++;return new Promise(r=>{release=r})}
 const a=c.request('a',{}, {timeout:50}).catch(e=>e)
 const b=c.request('b',{}, {timeout:10}).catch(e=>e)
 await tick();assert.equal(sent,1);assert.match((await b).message,/超时/)
 release();await a;assert.equal(c.pending.size,0);c.close()
})
test('parity: LRU pins pending work, bounded TTL reloads evicted entries',async()=>{
 const map=new LruMap(2);map.set('active',{pending:true});map.set('old',{});map.get('old');map.set('new',{})
 assert.ok(map.has('active'));assert.ok(!map.has('old'));assert.equal(map.size,2)
 let loads=0;const cache=createTtlCache(async key=>{loads++;return key},10000,2)
 await cache.get('a');await cache.get('b');await cache.get('a');await cache.get('c');await cache.get('b')
 assert.equal(loads,4)
 let resolve;const held=createTtlCache(()=>new Promise(r=>{resolve=r}),10000,1)
 const first=held.get('one'),same=held.get('one');await tick();resolve(1)
 assert.equal(await first,1);assert.equal(await same,1)
})

test('parity: EACCES records unavailable hash and blocks later writes',()=>{
 const file=path.join(os.tmpdir(),'unreadable-parity.json'),read=fs.readFileSync
 fs.readFileSync=(p,...args)=>{if(p===file)throw Object.assign(new Error('denied'),{code:'EACCES'});return read(p,...args)}
 try {assert.throws(()=>readJsonFile(file),e=>e.readOnly&&e.hash===null&&e.errorCode==='EACCES');assert.throws(()=>writeAtomic(file,'{}'),{code:'SESSION_CORRUPT_READ_ONLY'})}finally{fs.readFileSync=read}
})
test('parity: hung sending request times out and closes connection without retry',async()=>{
 const c=createClient({type:'http',name:'fixture',url:'http://unused'});let sent=0
 c.deliver=()=>{sent++;return new Promise(()=>{})}
 const a=c.request('a',{}, {timeout:10}),b=c.request('b',{}, {timeout:100})
 const results=await Promise.allSettled([a,b]);assert.ok(results.every(r=>r.status==='rejected'))
 assert.equal(sent,1);assert.equal(c.pending.size,0);assert.equal(c.closed,true)
})

test('parity: inbound RPC budgets are per user and queued cancellation never executes',async()=>{
 const {RpcAdmission}=await import('../lib/rpc-admission.mjs'),gate=new RpcAdmission({maxInflight:1,maxQueue:1,timeout:1000})
 let release,effects=0;const a=gate.run('u',()=>new Promise(r=>{release=r}));await tick()
 const ctrl=new AbortController(),b=gate.run('u',()=>{effects++},ctrl.signal).catch(e=>e.code)
 await assert.rejects(gate.run('u',()=>{}),{code:'RPC_OVERLOADED',retryAfterMs:1000})
 assert.equal(await gate.run('other',()=>42),42)
 ctrl.abort();assert.equal(await b,'RPC_CANCELLED');release(1);assert.equal(await a,1);await tick()
 assert.equal(effects,0);assert.equal(gate.users.size,0)
})
test('parity: timed-out active handler keeps lease until its side effect finishes',async()=>{
 const {RpcAdmission}=await import('../lib/rpc-admission.mjs'),gate=new RpcAdmission({maxInflight:1,maxQueue:0,timeout:10})
 let release;const a=gate.run('u',()=>new Promise(r=>{release=r}))
 await assert.rejects(a,{code:'RPC_TIMEOUT'})
 await assert.rejects(gate.run('u',()=>{}),{code:'RPC_OVERLOADED'})
 release();await tick();assert.equal(gate.users.size,0)
})
