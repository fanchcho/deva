import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {writeFileAtomic} from '../src/main/services/atomic-write.ts'
test('two processes compare the same revision; only one wins and permissions are private', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atomic-concurrent-')), file=path.join(dir,'config.json')
 fs.writeFileSync(file,'original')
 const desktop=new URL('../src/main/services/atomic-write.ts',import.meta.url).href
 const plugin=new URL('../../../plugins/deva-agent/lib/deva-fs.mjs',import.meta.url).href
 const run=(module,body)=>new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,['--input-type=module','-e',`import * as m from ${JSON.stringify(module)};try{${body};console.log('ok')}catch(e){console.log(e.code)}`],{stdio:['ignore','pipe','pipe']})
  let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('exit',code=>code?reject(new Error(String(code))):resolve(out.trim()))
 })
 try {
  const result=await Promise.all([run(desktop,`m.writeFileAtomic(${JSON.stringify(file)},'desktop','original')`),run(plugin,`m.writeAtomic(${JSON.stringify(file)},'plugin',{expectedRaw:'original'})`)])
  assert.equal(result.filter(x=>x==='ok').length,1);assert.equal(result.filter(x=>x==='DEVA_CONCURRENT_WRITE').length,1)
  assert.ok(['desktop','plugin'].includes(fs.readFileSync(file,'utf8')))
  if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600)
  assert.throws(()=>writeFileAtomic(file,'overwrite','original'),{code:'DEVA_CONCURRENT_WRITE'})
 }finally{fs.rmSync(dir,{recursive:true})}
})
