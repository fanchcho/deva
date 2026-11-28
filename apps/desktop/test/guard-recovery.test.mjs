import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {acquireFileLock,recoverable} from '../src/main/services/file-lock.mjs'
import {tempDir} from './support/tmp.mjs'
async function deadPid(){const c=spawn(process.execPath,['-e',''],{stdio:'ignore'});await new Promise(r=>c.once('exit',r));return c.pid}
function owner(pid){return{version:1,token:randomUUID(),pid,host:os.hostname(),createdAt:Date.now()-600000,heartbeatAt:Date.now()-600000,startedAt:1,command:'node',identity:'old'}}
test('three processes reclaim one dead guard: one owner, losers preserve winner, no temporary residue',async t=>{
 const dir=tempDir(t),file=path.join(dir,'config.json'),guard=file+'.lock.recovery'
 fs.writeFileSync(file,'untouched');fs.writeFileSync(guard,JSON.stringify(owner(await deadPid())))
 const module=new URL('../src/main/services/file-lock.mjs',import.meta.url).href
 const source=`import fs from 'node:fs';import{acquireFileLock}from ${JSON.stringify(module)};
 const guard=${JSON.stringify(guard)},file=${JSON.stringify(file)};
 const pause=()=>fs.readSync(0,Buffer.alloc(1),0,1,null),read=fs.readFileSync,link=fs.linkSync;let first=true;
 fs.readFileSync=function(p,...a){const v=read(p,...a);if(p===guard&&first){first=false;fs.writeSync(1,'old-token\\n');pause()}return v};
 fs.linkSync=function(a,b){link(a,b);if(b===guard){fs.writeSync(1,'owned\\n');pause()}};
 try{const release=acquireFileLock(file);release()}catch(e){fs.writeSync(1,e.code+'\\n');if(e.code!=='DEVA_CONCURRENT_WRITE')process.exitCode=1}`
 const children=Array.from({length:3},()=>worker(source))
 t.after(()=>children.forEach(c=>c.child.kill()))
 assert.deepEqual(await Promise.all(children.map(c=>c.line())),['old-token','old-token','old-token'])
 children.forEach(c=>c.go())
 const results=await Promise.all(children.map(c=>c.line()))
 assert.equal(results.filter(s=>s==='owned').length,1);assert.equal(results.filter(s=>s==='DEVA_CONCURRENT_WRITE').length,2)
 const winner=children[results.indexOf('owned')]
 assert.equal(JSON.parse(fs.readFileSync(guard,'utf8')).pid,winner.child.pid)
 await Promise.all(children.filter(c=>c!==winner).map(c=>c.exited))
 assert.equal(JSON.parse(fs.readFileSync(guard,'utf8')).pid,winner.child.pid)
 winner.go();await winner.exited
 assert.equal(fs.readFileSync(file,'utf8'),'untouched');assert.ok(!fs.existsSync(guard));assert.ok(!fs.existsSync(file+'.lock'))
 assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0)
 assert.equal(fs.readdirSync(file+'.lock-audit').length,1)
 assert.equal(fs.readFileSync(file+'.lock-audit.jsonl','utf8').split('\n').filter(s=>s.includes('recover-dead-guard')).length,1)
 console.log('guard contenders=3 old_token_readers=3 winners=1 conflicts=2 winner_guard_preserved=true temporary_files=0')
})
test('live guard, reused PID, unknown permissions and backwards time cannot authorize deletion',t=>{
 const file=path.join(tempDir(t),'config.json'),guard=file+'.lock.recovery',live=owner(process.pid)
 fs.writeFileSync(guard,JSON.stringify(live));assert.throws(()=>acquireFileLock(file),{code:'DEVA_CONCURRENT_WRITE'})
 assert.deepEqual(JSON.parse(fs.readFileSync(guard,'utf8')),live)
 assert.match(fs.readFileSync(file+'.lock-audit.jsonl','utf8'),/guard-recovery-denied/)
 for(const state of ['alive','reused','unknown'])assert.equal(recoverable(live,{inspect:()=>state}),false)
 assert.equal(recoverable(live,{now:0,inspect:()=> 'dead'}),false)
 assert.equal(recoverable({...live,heartbeatAt:Date.now()},{inspect:()=> 'dead'}),false)
})

test('an interrupted recovery is handed off through an immutable successor claim',async t=>{
 const dir=tempDir(t),file=path.join(dir,'chain.json'),guard=file+'.lock.recovery'
 const old=owner(await deadPid())
 fs.writeFileSync(guard,JSON.stringify(old))
 const successor=owner(await deadPid())
 successor.token=randomUUID()
 const claims=file+'.lock-audit'
 fs.mkdirSync(claims,{mode:0o700})
 const claim=path.join(claims,await import('node:crypto').then(({createHash})=>createHash('sha256').update(old.token).digest('hex')+'.json'))
 fs.writeFileSync(claim,JSON.stringify(successor),{mode:0o600})
 const release=acquireFileLock(file)
 assert.ok(fs.existsSync(claim))
 assert.ok(fs.readFileSync(file+'.lock-audit.jsonl','utf8').includes('recover-dead-guard'))
 release()
 console.log('interrupted_claim_chain=1 successor_claim_preserved=1')
})

function worker(source) {
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']})
 const lines=[],waiting=[];let buffer='',errors=''
 child.stdout.on('data',chunk=>{buffer+=chunk;for(let at;(at=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);const next=waiting.shift();if(next)next(line);else lines.push(line)}})
 child.stderr.on('data',d=>errors+=d)
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code?reject(new Error(errors)):resolve())})
 return {child,exited,line:()=>lines.length?Promise.resolve(lines.shift()):new Promise(resolve=>waiting.push(resolve)),go:()=>child.stdin.write('g')}
}

test('delayed old-token contender cannot delete a newly acquired guard',async t=>{
 const dir=tempDir(t),file=path.join(dir,'aba.json'),guard=file+'.lock.recovery'
 const original=owner(await deadPid());fs.writeFileSync(guard,JSON.stringify(original))
 const module=new URL('../src/main/services/file-lock.mjs',import.meta.url).href
 const common=`import fs from 'node:fs';import{acquireFileLock}from ${JSON.stringify(module)};const guard=${JSON.stringify(guard)}, file=${JSON.stringify(file)};const pause=()=>fs.readSync(0,Buffer.alloc(1),0,1,null);`
 const late=worker(common+`const read=fs.readFileSync;let first=true;fs.readFileSync=function(p,...a){const v=read(p,...a);if(p===guard&&first){first=false;fs.writeSync(1,'old-token\\n');pause()}return v};try{acquireFileLock(file);process.exitCode=2}catch(e){fs.writeSync(1,e.code+'\\n')}`)
 t.after(()=>late.child.kill())
 assert.equal(await late.line(),'old-token')
 const winner=worker(common+`const link=fs.linkSync;fs.linkSync=function(a,b){link(a,b);if(b===guard){fs.writeSync(1,'new-guard\\n');pause()}};const release=acquireFileLock(file);fs.writeSync(1,'won\\n');release()`)
 t.after(()=>winner.child.kill())
 assert.equal(await winner.line(),'new-guard')
 const newer=fs.readFileSync(guard,'utf8');assert.notEqual(JSON.parse(newer).token,original.token)
 late.go();assert.equal(await late.line(),'DEVA_CONCURRENT_WRITE');await late.exited
 assert.equal(fs.readFileSync(guard,'utf8'),newer)
 winner.go();assert.equal(await winner.line(),'won');await winner.exited
 assert.equal(fs.existsSync(guard),false)
 assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0)
 console.log('ABA paused_old_token=1 new_guard_preserved=true temporary_files=0')
})

test('SIGKILL while holding a recovery guard is recoverable after confirmed death and age',async t=>{
 const dir=tempDir(t),file=path.join(dir,'kill.json'),guard=file+'.lock.recovery'
 const module=new URL('../src/main/services/file-lock.mjs',import.meta.url).href
 const child=worker(`import fs from 'node:fs';import{acquireFileLock}from ${JSON.stringify(module)};const link=fs.linkSync;fs.linkSync=function(a,b){link(a,b);if(b===${JSON.stringify(guard)}){fs.writeSync(1,'guard-held\\n');fs.readSync(0,Buffer.alloc(1),0,1,null)}};acquireFileLock(${JSON.stringify(file)})`)
 assert.equal(await child.line(),'guard-held')
 child.child.kill('SIGKILL');await child.exited
 const original=JSON.parse(fs.readFileSync(guard,'utf8'))
 original.createdAt=original.heartbeatAt=Date.now()-600000
 fs.writeFileSync(guard,JSON.stringify(original))
 const release=acquireFileLock(file);release()
 assert.equal(fs.existsSync(guard),false)
 assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0)
 console.log('SIGKILL_guard_recovered=true temporary_files=0')
})

test('recovery rechecks heartbeat, permissions and PID identity; every denial audits and preserves guard',async t=>{
 const dead=await deadPid()
 for(const scenario of ['heartbeat-restored','permission-unknown','pid-reused','clock-rollback','holder-alive'])await t.test(scenario,async t=>{
  const dir=tempDir(t),file=path.join(dir,'deny.json'),guard=file+'.lock.recovery'
  const original=owner(dead)
  if(scenario==='pid-reused'||scenario==='holder-alive')original.pid=process.pid
  if(scenario==='holder-alive')original.identity=(await import('../src/main/services/file-lock.mjs')).processIdentity(process.pid)
  if(scenario==='clock-rollback')original.createdAt=Date.now()+600000
  fs.writeFileSync(guard,JSON.stringify(original))
  let expected=JSON.stringify(original)
  if(scenario==='permission-unknown'){
   const signal=process.kill
   t.mock.method(process,'kill',(pid,...args)=>{if(pid===dead)throw Object.assign(new Error('denied'),{code:'EPERM'});return signal(pid,...args)})
  }
  if(scenario==='heartbeat-restored'){
   const read=fs.readFileSync;let first=true
   t.mock.method(fs,'readFileSync',(p,...args)=>{const result=read(p,...args);if(p===guard&&first){first=false;expected=JSON.stringify({...original,heartbeatAt:Date.now()});fs.writeFileSync(guard,expected)}return result})
  }
  assert.throws(()=>acquireFileLock(file),{code:'DEVA_CONCURRENT_WRITE'})
  assert.equal(fs.readFileSync(guard,'utf8'),expected)
  assert.match(fs.readFileSync(file+'.lock-audit.jsonl','utf8'),/guard-recovery-denied/)
  assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0)
 })
})
