import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { emptyDesktopReason } from '../client.mjs'

test('empty desktop explains path, missing file, schema count and malformed JSON', () => {
  for (const d of [{exists:false}, {exists:true,providerCount:0,modelCount:0}, {exists:true,error:'config.json 不是合法 JSON'}]) {
    const text = emptyDesktopReason({desktopModels:[],desktopDiagnostics:JSON.stringify({path:'/fixture/.deva/config.json',...d})})
    assert.match(text, /\/fixture\/\.deva\/config.json/)
    assert.match(text, /不存在|没有提供方|不是合法 JSON/)
  }
  assert.equal(emptyDesktopReason({desktopModels:[{ref:'p:m'}]}),'')
  assert.match(emptyDesktopReason({desktopModels:[],desktopDiagnostics:'broken'}), /未解析出绝对路径/)
})

test('without HOME resolver uses native os.homedir rather than a Linux USERPROFILE override', () => {
  const env={...process.env,USERPROFILE:String.raw`C:\fixture\home`}
  delete env.HOME; delete env.DEVA_HOME; delete env.AI_UPPER_HOME
  const source=`import{homedir}from'node:os';import{join}from'node:path';import{resolveDevaRoot}from'./lib/deva-fs.mjs';console.log(JSON.stringify({actual:resolveDevaRoot(),expected:join(homedir(),'.deva')}))`
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),env,encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
  const data=JSON.parse(result.stdout);assert.equal(data.actual,data.expected)
})
