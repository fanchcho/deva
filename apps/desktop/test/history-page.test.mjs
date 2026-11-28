import test from 'node:test'
import assert from 'node:assert/strict'
import {tailSnapshot,turnPage} from '../src/shared/history-page.ts'
test('tail keeps global turn positions; paging never splits a turn',()=>{
 const all=Array.from({length:1000},(_,i)=>[{role:'user',text:`turn${i}`+'x'.repeat(2000),attachments:[]},{role:'assistant',blocks:[{kind:'text',text:'y'.repeat(2000)}]}]).flat()
 const t=performance.now(),tail=tailSnapshot(all,'r')
 assert.equal(tail.filter(x=>x.role==='user').length,1000)
 assert.equal(tail.filter(x=>x.deferred).length,990)
 assert.deepEqual(turnPage(all,20),all.slice(40,60))
 assert.equal(tail.find(x=>x.deferred?.turn===20).deferred.revision,'r')
 console.log(JSON.stringify({messages:all.length,fullBytes:Buffer.byteLength(JSON.stringify(all)),tailBytes:Buffer.byteLength(JSON.stringify(tail)),sliceMs:performance.now()-t}))
})

test('page cursor survives live tail appends and rejects a rewritten earlier turn', async()=>{
 const {snapshotTail,snapshotPage}=await import('../src/main/services/history-cursor.ts')
 const messages=[]
 for(let i=0;i<20;i++)messages.push({role:'user',text:`user-${i}`,attachments:[]},{role:'assistant',blocks:[{kind:'text',text:`answer-${i}`}]})
 const tail=snapshotTail(messages), cursor=tail.find(m=>m.deferred).deferred
 messages.push({role:'assistant',blocks:[{kind:'text',text:'live tail'}]})
 assert.ok(snapshotPage(messages,cursor.revision,0))
 messages[0].text='rewritten'
 assert.equal(snapshotPage(messages,cursor.revision,0),null)
})
