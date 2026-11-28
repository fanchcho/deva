import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {acquireFileLock,recoverable} from '../src/main/services/file-lock.mjs'
import {tempDir} from './support/tmp.mjs'
test('lock recovery rejects live/reused PID, unknown permissions, foreign host and clock rollback',()=>{
 const owner={version:1,host:'h',pid:123,token:'t',createdAt:1,heartbeatAt:1,startedAt:0,command:'node'}
 for(const state of ['alive','unknown'])assert.equal(recoverable(owner,{host:'h',now:900000,inspect:()=>state}),false)
 assert.equal(recoverable(owner,{host:'h',now:900000,inspect:()=> 'dead'}),true)
 assert.equal(recoverable(owner,{host:'h',now:0,inspect:()=> 'dead'}),false)
 assert.equal(recoverable(owner,{host:'other',now:900000,inspect:()=> 'dead'}),false)
})
test('killed owner can be recovered after aging; active owner and simultaneous acquire cannot form two masters',async t=>{
 const file=path.join(tempDir(t),'config.json'), module=new URL('../src/main/services/file-lock.mjs',import.meta.url).href
 const child=spawn(process.execPath,['--input-type=module','-e',`import{acquireFileLock}from ${JSON.stringify(module)};acquireFileLock(${JSON.stringify(file)});console.log('locked');setInterval(()=>{},1000)`],{stdio:['ignore','pipe','pipe']})
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject)})
 assert.throws(()=>acquireFileLock(file),{code:'DEVA_CONCURRENT_WRITE'})
 const exit=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exit
 const owner=JSON.parse(fs.readFileSync(file+'.lock','utf8'));owner.createdAt=owner.heartbeatAt=Date.now()-600000
 fs.writeFileSync(file+'.lock',JSON.stringify(owner))
 const release=acquireFileLock(file)
 assert.throws(()=>acquireFileLock(file),{code:'DEVA_CONCURRENT_WRITE'})
 assert.match(fs.readFileSync(file+'.lock-audit.jsonl','utf8'),/recover-dead-owner/)
 release();assert.ok(!fs.existsSync(file+'.lock'))
 assert.equal(fs.readFileSync(new URL('../src/main/services/file-lock.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../../../plugins/deva-agent/lib/file-lock.mjs',import.meta.url),'utf8'))
})

test('OS identity adapters fail closed across Windows/macOS permissions and PID reuse',async()=>{
 const {processIdentity,inspectOwner}=await import('../src/main/services/file-lock.mjs')
 for(const platform of ['win32','darwin']){
  const calls=[]
  const identity=processIdentity(123,{platform,run:(...args)=>{calls.push(args);return 'start executable'}})
  assert.equal(identity.length,64)
  assert.equal(calls[0][0],platform==='win32'?'powershell.exe':'ps')
  assert.equal(processIdentity(123,{platform,run:()=>{throw Object.assign(new Error('denied'),{code:'EACCES'})}}),null)
  assert.equal(inspectOwner(123,{identity},{signal:()=>{},identity:()=>identity}),'alive')
  assert.equal(inspectOwner(123,{identity},{signal:()=>{},identity:()=> 'other'}),'reused')
  assert.equal(inspectOwner(123,{identity},{signal:()=>{throw {code:'EPERM'}}}),'unknown')
  assert.equal(inspectOwner(123,{identity},{signal:()=>{throw {code:'ESRCH'}}}),'dead')
 }
})
test('lock heartbeat advances without losing ownership',async t=>{
 const file=path.join(tempDir(t),'heartbeat.json'), release=acquireFileLock(file)
 const initial=JSON.parse(fs.readFileSync(file+'.lock','utf8'))
 await new Promise(r=>setTimeout(r,1100))
 const after=JSON.parse(fs.readFileSync(file+'.lock','utf8'))
 assert.equal(initial.token,after.token);assert.ok(after.heartbeatAt>initial.heartbeatAt)
 assert.ok(after.identity);release()
})

test('two processes racing to recover the same confirmed dead lock never both own it',async t=>{
 const file=path.join(tempDir(t),'race.json'), module=new URL('../src/main/services/file-lock.mjs',import.meta.url).href
 // Obtain an actual dead PID instead of guessing a currently unused PID.
 const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await new Promise(r=>dead.once('exit',r))
 const release=acquireFileLock(file), owner=JSON.parse(fs.readFileSync(file+'.lock','utf8'));release()
 owner.pid=dead.pid;owner.createdAt=owner.heartbeatAt=Date.now()-600000;fs.writeFileSync(file+'.lock',JSON.stringify(owner))
 const children=[0,1].map(()=>spawn(process.execPath,['--input-type=module','-e',`import{acquireFileLock}from ${JSON.stringify(module)};console.log('ready');process.stdin.once('data',()=>{try{const release=acquireFileLock(${JSON.stringify(file)});console.log('won');setTimeout(()=>{release();process.exit()},300)}catch(e){console.log(e.code);process.exit()}})`],{stdio:['pipe','pipe','pipe']}))
 let released = false
 const results=await Promise.all(children.map(child=>new Promise((resolve,reject)=>{let out='';child.stdout.on('data',d=>{out+=d;if(out==='ready\n')child.ready=true;if(!released && children.every(p=>p.ready)){released=true;for(const p of children)p.stdin.end('go')}});child.once('error',reject);child.once('exit',code=>code?reject(new Error(String(code))):resolve(out))})))
 assert.equal(results.filter(s=>s.includes('won')).length,1)
 assert.equal(results.filter(s=>s.includes('DEVA_CONCURRENT_WRITE')).length,1)
 assert.equal(fs.readFileSync(file+'.lock-audit.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(e=>e.event==='recover-dead-owner').length,1)
})

test('foreign recovery guard fails closed and preserves holder metadata',t=>{
 const file=path.join(tempDir(t),'guard.json'), guard=file+'.lock.recovery'
 const owner={version:1,token:'guard-owner',pid:process.pid,host:'same-host',createdAt:1,heartbeatAt:1,startedAt:1,command:'node',identity:'identity'}
 fs.writeFileSync(guard,JSON.stringify(owner))
 for(const state of ['alive','reused','unknown'])assert.equal(recoverable(owner,{host:'same-host',now:900000,inspect:()=>state}),false)
 assert.equal(recoverable(owner,{host:'same-host',now:0,inspect:()=> 'dead'}),false)
 assert.throws(()=>acquireFileLock(file),{code:'DEVA_CONCURRENT_WRITE'})
 assert.deepEqual(JSON.parse(fs.readFileSync(guard,'utf8')),owner)
})
