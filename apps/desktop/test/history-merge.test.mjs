import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeHistoryPage} from '../src/shared/merge-history-page.ts'
test('overlapping pages replace whole global turns exactly once and retain live tail identity',()=>{
 const all=Array.from({length:30},(_,i)=>[{role:'user',text:`u${i}`},{role:'assistant',text:`a${i}`}]).flat()
 let messages=all.flatMap((m,i)=>i<40?(m.role==='user'?[{...m,deferred:{revision:'r',turn:i/2}}]:[]):[m])
 messages=mergeHistoryPage(messages,{revision:'r',from:5,to:15},all.slice(10,30))
 messages=mergeHistoryPage(messages,{revision:'r',from:0,to:10},all.slice(0,20))
 assert.equal(messages.filter(m=>m.text==='a5').length,1)
 assert.equal(messages.filter(m=>m.role==='user').length,30)
 assert.equal(messages.at(-1),all.at(-1))
 assert.equal(mergeHistoryPage(messages,{revision:'stale',from:0,to:10},[]),messages)
})
