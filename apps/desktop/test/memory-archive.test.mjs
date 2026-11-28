import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { writeMemory, listMemories, listArchive, restoreMemory, memoryLimits, memoryPath, markMemoriesSeen, replaceMemories } from '../src/main/services/memory.ts'
import { checkMemories } from '../src/main/services/memory-archive.ts'

test('three scopes archive overflow without losing bodies, restore and track usage', () => {
  const scopes=[{kind:'global'},{kind:'role',personaId:'archive-test'},{kind:'project',root:process.env.DEVA_HOME}]
  for(const scope of scopes){
    const n=memoryLimits(scope).maxEntries
    for(let i=0;i<n+2;i++)assert.equal(writeMemory({type:'reference',title:'entry '+i,body:'full body '+i},undefined,scope).ok,true)
    const active=listMemories(scope), archived=listArchive(scope)
    assert.equal(active.length+archived.length,n+2)
    assert.ok(archived.length>=2)
    assert.equal(archived[0].body,'full body 0')
    assert.equal(listArchive(scope,'full body 0').length,1)
    assert.equal(restoreMemory(scope,archived[0].id).ok,true)
    assert.ok(listMemories(scope).some(e=>e.body==='full body 0'))
    const first=listMemories(scope)[0]
    markMemoriesSeen(scope,[first.id])
    assert.equal(listMemories(scope)[0].seenCount,1)
    assert.ok(listMemories(scope)[0].lastSeenAt>0)
    assert.ok(Array.isArray(checkMemories(listMemories(scope)).stale))
  }
})

test('legacy content migration backs up and keeps full text; corruption never overwrites', () => {
  const scope={kind:'role',personaId:'legacy-archive'}
  const file=memoryPath(scope)
  fs.mkdirSync(path.dirname(file),{recursive:true})
  const raw=JSON.stringify({entries:[{id:'r_old',content:'旧正文。不能丢失',createdAt:1}]})
  fs.writeFileSync(file,raw)
  assert.equal(listMemories(scope)[0].body,'旧正文。不能丢失')
  assert.ok(fs.readdirSync(path.join(path.dirname(file),'memory-backups')).length)
  assert.equal(JSON.parse(fs.readFileSync(file)).version,2)
  fs.writeFileSync(file,'broken')
  assert.throws(()=>writeMemory({type:'user',title:'new'},undefined,scope),/MEMORY_CORRUPT/)
  assert.equal(fs.readFileSync(file,'utf8'),'broken')
})

test('replacing active memories keeps archive intact',()=>{
 const scope={kind:'role',personaId:'archive-test'}
 const archived=listArchive(scope)
 replaceMemories(scope,[])
 assert.deepEqual(listArchive(scope),archived)
})

test('old separate archive migrates once without truncation, malformed archive fails closed', () => {
  const scope={kind:'project',root:path.join(process.env.DEVA_HOME,'legacy-project')}
  const file=memoryPath(scope), old=path.join(path.dirname(file),'memory-archive.json')
  fs.mkdirSync(path.dirname(file),{recursive:true})
  const body='原始正文'.repeat(500)
  const raw=JSON.stringify({entries:[{id:'a_old',originalId:'p_original',content:body,createdAt:1,archivedAt:2,seenCount:7}]})
  fs.writeFileSync(old,raw)
  assert.equal(listArchive(scope)[0].body,body)
  assert.equal(listArchive(scope).length,1)
  assert.equal(listArchive(scope)[0].seenCount,7)
  assert.equal(restoreMemory(scope,'a_old').ok,false)
  assert.equal(listArchive(scope)[0].body,body)
  assert.equal(fs.readFileSync(old,'utf8'),raw)
  const before=fs.readFileSync(file,'utf8')
  fs.writeFileSync(old,'bad')
  assert.throws(()=>listArchive(scope),/MEMORY_ARCHIVE_INCOMPATIBLE/)
  assert.equal(fs.readFileSync(file,'utf8'),before)
})

test('manual merge preserves originals; refused merge leaves disk untouched', async () => {
  const {mergeMemories}=await import('../src/main/services/memory.ts')
  const scope={kind:'role',personaId:'merge-test'}
  const a=writeMemory({type:'feedback',title:'A',body:'rule A'},undefined,scope).entry
  const b=writeMemory({type:'feedback',title:'B',body:'rule B'},undefined,scope).entry
  const before=fs.readFileSync(memoryPath(scope),'utf8')
  assert.equal(mergeMemories(scope,[a.id,b.id],{type:'feedback',title:''}).ok,false)
  assert.equal(fs.readFileSync(memoryPath(scope),'utf8'),before)
  assert.equal(mergeMemories(scope,[a.id,b.id],{type:'feedback',title:'Both',body:'rule A; rule B'}).ok,true)
  assert.deepEqual(listArchive(scope).map(e=>e.body),['rule A','rule B'])
  assert.equal(listMemories(scope).length,1)
  const archived=listArchive(scope)[0]
  assert.equal(restoreMemory(scope,archived.id).entry.id,a.id)
  assert.equal(listArchive(scope).length,1)
})

test('eviction respects recent usage, freshness and count; check is read-only', async () => {
  const {evictionCandidates}=await import('../src/main/services/memory-archive.ts')
  const old=Date.now()-90*86400000
  const entries=[{id:'m_1',type:'user',title:'Build',body:'a',createdAt:old,updatedAt:old},
    {id:'m_2',type:'user',title:'Build project',body:'b',createdAt:old,updatedAt:old,seenCount:9,lastSeenAt:Date.now()}]
  assert.equal(evictionCandidates(entries)[0].id,'m_1')
  assert.deepEqual(checkMemories(entries),{stale:['m_1'],similar:[['m_1','m_2']]})
  assert.equal(entries[0].seenCount,undefined)
})

test('tidy has a read-only preview and archives cold entries only above threshold', async () => {
  const {tidyMemories}=await import('../src/main/services/memory.ts')
  const scope={kind:'role',personaId:'tidy-test'}, file=memoryPath(scope)
  const entries=Array.from({length:50},(_,i)=>({id:'r_'+i,type:'feedback',title:'cold memory '+i+'x'.repeat(47),body:'full '+i,createdAt:1,updatedAt:1}))
  fs.mkdirSync(path.dirname(file),{recursive:true})
  fs.writeFileSync(file,JSON.stringify({version:2,entries}))
  const raw=fs.readFileSync(file,'utf8')
  assert.equal(tidyMemories(scope,true).changed,false)
  assert.equal(fs.readFileSync(file,'utf8'),raw)
  assert.equal(tidyMemories(scope).archived,50)
  assert.equal(listArchive(scope).length,50)
  assert.equal(listMemories(scope).length,0)
})

test('memory tools enforce scope permissions and expose read/recall/check in all three layers', async () => {
  const {memoryReadTool,memoryRecallTool,memoryCheckTool,memoryMergeTool,memoryTidyTool}=await import('../src/main/services/memory-tools.ts')
  const ctx={workspaceRoot:process.env.DEVA_HOME,memoryAccess:{global:'ro',role:{personaId:'archive-test',name:'Role',mode:'ro'},project:'rw'}}
  const project={kind:'project',root:process.env.DEVA_HOME}
  const entry=listMemories(project)[0]
  const prev=entry.seenCount??0
  const read=await memoryReadTool({ids:[entry.id]},ctx)
  assert.match(read.content,/full body/)
  assert.equal(listMemories(project).find(e=>e.id===entry.id).seenCount,prev+1)
  assert.equal(JSON.parse((await memoryCheckTool({},ctx)).content).length,3)
  const recall=JSON.parse((await memoryRecallTool({query:'full body'},ctx)).content)
  assert.deepEqual(new Set(recall.map(e=>e.scope)),new Set(['global','role','project']))
  assert.equal((await memoryMergeTool({ids:['m_1','m_2'],type:'user',title:'merge'},ctx)).isError,true)
  assert.match((await memoryTidyTool({scope:'global'},ctx)).content,/只读/)
})

test('index character limit evicts before count limit and preserves all entries',()=>{
  const scope={kind:'role',personaId:'budget-test'}
  for(let i=0;i<65;i++)assert.equal(writeMemory({type:'reference',title:String(i).padStart(2,'0')+'x'.repeat(58),body:'preserved '+i},undefined,scope).ok,true)
  assert.ok(listMemories(scope).length<65)
  assert.ok(listArchive(scope).length>0)
  assert.equal(listMemories(scope).length+listArchive(scope).length,65)
})

test('three-layer archive indexes are injected without occupying active memory slots',async()=>{
 const {memoryListingPart}=await import('../src/main/services/listing.ts')
 const {memoryPromptSection}=await import('../src/main/services/memory-prompt.ts')
 const access={global:'rw',role:{personaId:'archive-test',name:'Role',mode:'rw'},project:'rw'}
 const scopes=[{kind:'global'},{kind:'role',personaId:'archive-test'},{kind:'project',root:process.env.DEVA_HOME}]
 const before=scopes.map(scope=>listMemories(scope).length)
 const part=memoryListingPart([],access,process.env.DEVA_HOME)
 for(const name of ['archive_global','archive_role','archive_project'])assert.ok(part.text.includes(name),name)
 assert.match(part.text,/memory_recall/)
 assert.deepEqual(scopes.map(scope=>listMemories(scope).length),before)
 assert.match(memoryPromptSection(access,process.env.DEVA_HOME).join('\n'),/memory_recall/)
 const repeated=memoryListingPart([{role:'user',content:[part]}],access,process.env.DEVA_HOME)
 assert.equal(repeated,null)
})
