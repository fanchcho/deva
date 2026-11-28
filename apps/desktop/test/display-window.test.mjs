import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {displayOf} from '../src/main/services/chat-display.ts'
import {turnPage} from '../src/shared/history-page.ts'

test('window projection equals full projection field-by-field across edits, deletes, rollback and mutable sidecars',()=>{
 const s={id:'window',messages:[],notices:[],asks:{},summaries:{},durations:{}}
 for(let i=0;i<24;i++){
  s.messages.push({role:'user',content:[{type:'image',mediaType:'image/png',data:'YWJjZA=='},{type:'text',text:`user-${i}`}]},
   {role:'assistant',content:[{type:'text',text:`answer-${i}`},{type:'tool_use',id:`tool-${i}`,name:'ask_user',input:{questions:[]}}]},
   {role:'user',content:[{type:'tool_result',toolUseId:`tool-${i}`,content:'answered'}]})
  s.notices.push({after:s.messages.length,kind:'error',message:`notice-${i}`})
 }
 const compare=()=>{const full=displayOf(s);for(let from=0;from<24;from+=3)assert.deepEqual(displayOf(s,{from,to:from+3}),turnPage(full,from,3))}
 s.messages.unshift({role:'user',content:'⟦deva:compaction⟧ older summary'})
 s.notices=s.notices.map(n=>({...n,after:n.after+1}))
 compare();s.asks['tool-4']={answers:['changed']};compare()
 s.messages[13].content.at(-1).text='edited';compare()
 const before=structuredClone(s);s.messages.splice(21,3);s.messages.splice(6,3);s.notices=[];compare()
 Object.assign(s,before);compare();s.messages=s.messages.slice(0,30);s.notices=s.notices.filter(n=>n.after<=30);compare()
})
test('tail placeholders preserve full snapshot and cursor after append; rewrite invalidates it',async()=>{
 const {ensureSession}=await import('../src/main/services/chat-store.ts')
 const {loadTail,loadPage}=await import('../src/main/services/history-page.ts')
 const {tailSnapshot}=await import('../src/shared/history-page.ts')
 const s=ensureSession('window-integration')
 s.messages=Array.from({length:24},(_,i)=>[{role:'user',content:`user-${i}`},{role:'assistant',content:`answer-${i}`}]).flat()
 const tail=loadTail(s.id),cursor=tail[0].deferred.revision
 assert.deepEqual(tail,tailSnapshot(displayOf(s),cursor))
 assert.deepEqual(loadPage(s.id,cursor,3).messages,turnPage(displayOf(s),3,10))
 s.messages.push({role:'user',content:'append'})
 assert.ok(loadPage(s.id,cursor,3))
 s.messages[0].content='rewrite';assert.equal(loadPage(s.id,cursor,3),null)
})
