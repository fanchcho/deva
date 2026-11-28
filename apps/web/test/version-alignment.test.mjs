import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {checkVersions} from '../../../scripts/check-versions.mjs'
const root=new URL('../../../',import.meta.url).pathname

test('release version check accepts aligned packages and rejects a stale web package',async()=>{
 await mkdir(root+'.tmp',{recursive:true})
 const dir=await mkdtemp(root+'.tmp/version-check-')
 try {
  for(const name of ['desktop','web']) {
   await mkdir(`${dir}/apps/${name}`,{recursive:true})
   await writeFile(`${dir}/apps/${name}/package.json`,JSON.stringify({version:'1.2.3'}))
  }
  assert.equal(checkVersions(dir),'1.2.3')
  await writeFile(`${dir}/apps/web/package.json`,JSON.stringify({version:'1.2.2'}))
  assert.throws(()=>checkVersions(dir),/Version mismatch: desktop=1.2.3, web=1.2.2/)
 } finally {await rm(dir,{recursive:true})}
})
