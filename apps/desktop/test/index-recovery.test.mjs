import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {ensureSession,save,flushSessionIndex,listSessions} from '../src/main/services/chat-store.ts'
test('batched index flush reflects all successful saves',()=>{
 const start=performance.now()
 for(let i=0;i<100;i++){const s=ensureSession(`index-${i}`);s.title=`title-${i}`;save(s.id)}
 flushSessionIndex()
 const dir=path.join(process.env.DEVA_HOME,'data/chats')
 const index=fs.readdirSync(dir).find(f=>f.startsWith('_')&&f.endsWith('.json'))
 const data=JSON.parse(fs.readFileSync(path.join(dir,index),'utf8'))
 assert.equal(data.length,100);assert.equal(listSessions().length,100)
 assert.ok(!fs.existsSync(path.join(dir,index+'.dirty')))
 console.log(JSON.stringify({saves:100,ms:performance.now()-start}))
})

test('dirty marker rebuilds a stale index after an interrupted process', async()=>{
 const {execFileSync}=await import('node:child_process')
 const {fileURLToPath}=await import('node:url')
 const dir=path.join(process.env.DEVA_HOME,'data/chats')
 const index=fs.readdirSync(dir).find(f=>f.startsWith('_')&&f.endsWith('.json'))
 fs.writeFileSync(path.join(dir,index),'[]');fs.writeFileSync(path.join(dir,index+'.dirty'),'1')
 const register=fileURLToPath(new URL('./support/register.mjs',import.meta.url))
 const source=new URL('../src/main/services/chat-store.ts',import.meta.url).href
 const output=execFileSync(process.execPath,['--import',register,'--input-type=module','-e',`import {listSessions} from ${JSON.stringify(source)};console.log(listSessions().length)`],{encoding:'utf8'})
 assert.equal(Number(output.trim()),100)
 assert.ok(!fs.existsSync(path.join(dir,index+'.dirty')))
})
