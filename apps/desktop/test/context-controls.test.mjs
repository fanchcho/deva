import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {setConfig} from '../src/main/services/config.ts'
import {compactRatioInfo,triggerTokens,needsCompaction,appendLog,settleCompactLog} from '../src/main/services/compaction.ts'

test('per-session threshold affects actual compaction; log awaits usage and retains failures',()=>{
  setConfig({models:{providers:[{id:'p',adapter:'openai',models:[{id:'test',contextWindow:128000,maxOutput:4096}]}]}})
  const model={adapter:'openai',providerId:'p',model:'test',baseURL:'http://127.0.0.1:1'}
  const session={id:'s',messages:[{role:'user',content:'a'}],compactRatio:0.4,lastInputTokens:52000}
  const info=compactRatioInfo(session,model)
  assert.equal(info.ratio,0.4)
  assert.equal(triggerTokens(model,undefined,info.ratio),51200)
  assert.equal(needsCompaction(session,model),true)
  session.lastInputTokens=51000
  assert.equal(needsCompaction(session,model),false)
  const success={at:1,turn:1,scope:'manual',before:10000,after:null,folded:5}
  const failure={...success,at:2,error:'not shorter'}
  session.compactLog=appendLog(appendLog(undefined,success),failure)
  assert.equal(settleCompactLog(session,2000),true)
  assert.equal(session.compactLog[0].after,2000)
  assert.equal(session.compactLog[1].after,null)
  assert.equal(settleCompactLog(session,3000),false)
})
