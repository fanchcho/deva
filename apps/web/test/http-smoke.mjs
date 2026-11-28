import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {deviceSmoke} from './device-smoke.mjs'
const repo = new URL('../../../', import.meta.url).pathname
process.chdir(repo)
await fs.mkdir(path.join(repo, '.tmp'), { recursive: true })
const tmp = await fs.mkdtemp(path.join(repo, '.tmp/web-http-smoke-'))
const report = process.env.WEB_SMOKE_REPORT_DIR || tmp
await fs.mkdir(report, { recursive: true })
const env={...process.env,HOME:tmp,TMPDIR:tmp,DEVA_WEB_DATA:path.join(tmp,'data'),DEVA_WEB_BROWSE_TOP:tmp,DEVA_UPDATE_CHECK_MINUTES:'-1',DEVA_WEB_ADMIN_PASSWORD:'repair-test-password',HOST:'127.0.0.1',PORT:'0'}
const p=spawn(process.execPath,['apps/web/server.mjs'],{env,stdio:['ignore','pipe','pipe']})
let output=''; p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b)
try{
for(let i=0;i<400&&!output.includes('[deva-web] http://')&&p.exitCode===null;i++)await new Promise(r=>setTimeout(r,50))
const base=/\[deva-web\] (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];assert.ok(base,output)
let cookie=''
const req=async(url,options={})=>{let r=await fetch(base+url,{redirect:'manual',...options,headers:{cookie,...options.headers}});console.log(options.method||'GET',url,r.status);return r}
assert.equal((await req('/api/deliverables/file?sessionId=x&toolUseId=t&index=0')).status,401);await req('/healthz');await req('/');await req('/api/me');await req('/login');await req('/favicon.svg');await req('/favicon.ico')
let r=await req('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'admin',password:env.DEVA_WEB_ADMIN_PASSWORD})});assert.equal(r.status,302)
cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')
const html=await (await req('/')).text()
for(const u of new Set([...html.matchAll(/(?:src|href)="((?:\.\/|\/)[^"?#]+\.(?:js|css))"/g)].map(m=>new URL(m[1],base).pathname)))assert.equal((await req(u)).status,200,u)
const boot=await(await req('/boot.js')).text(),csrf=/__DEVA_CSRF__="([^"]+)"/.exec(boot)[1]
for(const u of ['/api/me','/api/channels','/api/fs/list','/api/dir-pick/pending','/api/update','/admin','/not-found.js','/%E0%A4%A'])await req(u)
const channels=await(await req('/api/channels')).json();await fs.writeFile(path.join(report,'channels.json'),JSON.stringify(channels,null,2))
const invoke=async(channel,args=[])=>{let r=await req('/api/invoke',{method:'POST',headers:{'content-type':'application/json','x-deva-csrf':csrf},body:JSON.stringify({channel,args})});const b=await r.json();console.log(channel,JSON.stringify(b).slice(0,250));return b}
const owner = (await (await req('/api/me')).json()).user.id
const chatDir = path.join(tmp,'data/users',owner,'.deva/data/chats')
await fs.mkdir(chatDir,{recursive:true})
const deliveredFile = path.join(tmp,'download.txt')
const scriptFile = path.join(tmp,'blocked.py')
await fs.writeFile(deliveredFile,'download-bytes')
await fs.writeFile(scriptFile,'print(1)')
await fs.writeFile(path.join(chatDir,'download-fixture.json'),JSON.stringify({
  id:'download-fixture',messages:[],createdAt:Date.now(),updatedAt:Date.now(),
  delivered:{download:[deliveredFile,scriptFile]}
}))
const fileUrl='/api/deliverables/file?sessionId=download-fixture&toolUseId=download&index='
const download = await req(fileUrl+'0')
assert.equal(download.status,200)
assert.match(download.headers.get('content-disposition'),/^attachment;/)
assert.equal(await download.text(),'download-bytes')
assert.equal((await req(fileUrl+'0',{method:'HEAD'})).status,200)
const blocked=await req(fileUrl+'1');assert.equal(blocked.status,415)
assert.equal((await blocked.json()).code,'WEB_FILE_TYPE_UNSUPPORTED')
assert.equal((await req(fileUrl+'99')).status,404)
assert.equal((await req('/api/deliverables/file?path='+encodeURIComponent(deliveredFile))).status,400)
const reveal=await invoke('deliverables:reveal',['download-fixture','download',0])
assert.equal(reveal.ok,false);assert.equal(reveal.code,'WEB_REVEAL_UNSUPPORTED')
const secondName='download'+Date.now().toString(36)
assert.equal((await req('/admin/create',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,username:secondName,password:'download-test-password',role:'user'})})).status,200)
const secondLogin=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:secondName,password:'download-test-password'})})
assert.equal(secondLogin.status,302)
const secondCookie=secondLogin.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')
assert.equal((await req(fileUrl+'0',{headers:{cookie:secondCookie}})).status,404)
console.log('PASS cross-user delivered-file access rejected')
console.log('PASS authorized download, unsupported type, invalid identity and explicit reveal error')
assert.equal((await invoke('chat:context-usage',['missing'])).ok,true)
const userHome=path.join(tmp,'data/users',owner,'.deva')
const projectRoot=path.join(tmp,'memory-project')
await fs.mkdir(projectRoot,{recursive:true})
const projectKey=createHash('sha1').update(projectRoot).digest('hex').slice(0,24)
for(const [scope,relative,prefix,n] of [[null,'memory.json','m_',100],[{personaId:'memory-http'},'personas/memory/memory-http.json','r_',100],[projectRoot,`projects/${projectKey}/memory.json`,'p_',60]]) {
  const file=path.join(userHome,relative)
  await fs.mkdir(path.dirname(file),{recursive:true})
  await fs.writeFile(file,JSON.stringify({version:2,entries:Array.from({length:n},(_,i)=>({id:prefix+i,type:'reference',title:'item '+i,body:'original body '+i,createdAt:i+1,updatedAt:i+1}))}))
  const result=await invoke('memory:write',[{type:'feedback',title:'new rule',body:'retain full rule'},null,scope])
  assert.equal(result.value.ok,true)
  const active=(await invoke('memory:list',[scope])).value
  const archive=(await invoke('memory:archive',[scope])).value
  assert.equal(active.entries.length+archive.length,n+1)
  assert.ok(archive.length>0)
  assert.equal(archive[0].body,'original body 0')
  assert.equal((await invoke('memory:restore',[archive[0].id,scope])).value.ok,true)
  assert.ok((await invoke('memory:list',[scope])).value.entries.some(e=>e.body==='original body 0'))
  assert.ok(Array.isArray((await invoke('memory:check',[scope])).value.stale))
}
console.log('PASS three memory scopes, automatic eviction, archive full bodies, restore and health check')
const legacyPath=path.join(userHome,'personas/memory/legacy-http.json')
await fs.writeFile(legacyPath,JSON.stringify({entries:[{id:'r_legacy',content:'旧版正文，完整迁入三层',createdAt:1}]}))
assert.equal((await invoke('memory:list',[{personaId:'legacy-http'}])).value.entries[0].body,'旧版正文，完整迁入三层')
assert.equal(JSON.parse(await fs.readFile(legacyPath)).version,2)
assert.equal((await invoke('config:set',[{models:{activeModelId:'fixture:test',providers:[{id:'fixture',enabled:true,adapter:'openai',apiHost:'http://127.0.0.1:1',models:[{id:'test',enabled:true,contextWindow:128000,maxOutput:4096}]}]}}])).ok,true)
assert.equal((await invoke('chat:create-session',[{sessionId:'context-fixture',personaId:'general',model:'fixture:test'}])).ok,true)
const compact=(await invoke('chat:set-compact-ratio',[{sessionId:'context-fixture',ratio:0.4}])).value
assert.equal(compact.ratio,0.4)
assert.equal(compact.compactAt,Math.floor(compact.window*0.4))
const originalUsage=(await invoke('chat:context-usage',['context-fixture','fixture:test'])).value
assert.equal(originalUsage.trigger,compact.compactAt)
assert.equal((await invoke('chat:compact-usage',['context-fixture'])).value.ratio,0.4)
assert.equal((await invoke('chat:set-compact-ratio',[{sessionId:'context-fixture',ratio:2}])).value.ratio,0.4)
assert.notEqual((await invoke('chat:set-compact-ratio',[{sessionId:'context-fixture',ratio:null}])).value.ratio,0.4)
console.log('PASS context panel retained; compact chip snapshot, per-session ratio, bounds and reset')

for (const channel of ['personas:list','skills:list','mcp:list','tasks:list','profile:get']) {
  assert.equal((await invoke(channel)).ok,true,channel)
}
assert.equal((await invoke('config:set',[{chatFontSize:'lg'}])).ok,true)
assert.equal((await invoke('config:get')).value.chatFontSize,'lg')
const attachment=await invoke('fs:paste-attachment',[{name:'hello.txt',mime:'text/plain',size:5,data:{base64:'aGVsbG8='}}])
assert.equal(attachment.ok,true)
assert.equal(await fs.readFile(attachment.value.path,'utf8'),'hello')
assert.equal((await invoke('workspace:role-home',['general'])).ok,true)
assert.equal((await invoke('chat:create-session',[{sessionId:'repair-session',personaId:'general'}])).ok,true)
assert.equal((await invoke('chat:rename-session',[{sessionId:'repair-session',title:'Web regression'}])).value.title,'Web regression')
assert.ok((await invoke('chat:list-sessions')).value.some(s=>s.id==='repair-session'))
assert.equal((await invoke('chat:delete-session',['repair-session',null])).ok,true)
const needed=[...new Set([... (await fs.readFile('apps/desktop/src/preload/index.ts','utf8')).matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map(m=>m[1]))]
assert.deepEqual(needed.filter(c=>!channels.channels.includes(c)),[])
console.log('PASS all preload invoke channels registered')
const ctrl = new AbortController()
const events = await fetch(base+'/api/events',{headers:{cookie},signal:ctrl.signal})
assert.equal(events.status,200); console.log('GET /api/events',events.status)
const opening = invoke('fs:open-folder')
let picks=[]
for(let i=0;i<100&&!picks.length;i++){picks=(await(await req('/api/dir-pick/pending')).json()).picks; if(!picks.length)await new Promise(r=>setTimeout(r,50))}
assert.ok(picks.length)
assert.equal((await req('/api/dir-pick/'+picks[0].id,{method:'POST',headers:{'content-type':'application/json','x-deva-csrf':csrf},body:JSON.stringify({path:picks[0].roots[0]})})).status,200)
assert.equal((await opening).ok,true)
ctrl.abort()
console.log('PASS interactive directory picker round trip')
const secondBoot=await(await req('/boot.js',{headers:{cookie:secondCookie}})).text()
const secondCsrf=/__DEVA_CSRF__="([^"]+)"/.exec(secondBoot)[1]
const otherState=await(await req('/api/invoke',{method:'POST',headers:{cookie:secondCookie,'content-type':'application/json','x-deva-csrf':secondCsrf},body:JSON.stringify({channel:'general:get-state',args:[]})})).json()
await deviceSmoke({invoke,tmp,userHome,secondPort:otherState.value.port})

const ws = (await (await req('/api/fs/list')).json()).path
const persona = await invoke('personas:upsert',[{name:'Merge persona',workspace:ws,prompt:'test',enabled:true}])
assert.equal(persona.ok,true)
assert.equal((await invoke('chat:create-session',[{sessionId:'merge-persona',personaId:persona.value.id}])).ok,true)
let list=(await invoke('chat:list-sessions')).value
assert.equal(list.find(s=>s.id==='merge-persona').focusRoot,ws)
assert.equal((await invoke('chat:set-model',[{sessionId:'merge-persona',modelRef:'fixture:test'}])).value.ok,true)
await invoke('chat:set-effort',[{sessionId:'merge-persona',effort:'high'}])
await invoke('chat:set-focus',[{sessionId:'merge-persona',focusRoot:null}])
let persisted=JSON.parse(await fs.readFile(path.join(chatDir,'merge-persona.json'),'utf8'))
assert.equal(persisted.model,'fixture:test');assert.equal(persisted.effort,'high');assert.equal(persisted.focusRoot,null)
await invoke('chat:set-focus',[{sessionId:'merge-persona',focusRoot:ws}])
persisted=JSON.parse(await fs.readFile(path.join(chatDir,'merge-persona.json'),'utf8'));assert.equal(persisted.focusRoot,ws)
assert.equal((await invoke('chat:set-model',[{sessionId:'no-lazy-session',modelRef:'fixture:test'}])).value.ok,false)
assert.equal((await invoke('chat:rewind-apply',[{sessionId:'merge-persona',turn:100,mode:'conversation'}])).value.error,'bad-turn')
assert.equal((await invoke('chat:rewind-apply',[{sessionId:'missing-session',turn:0,mode:'conversation'}])).value.error,'no-session')
await invoke('chat:delete-session',['merge-persona',null])
console.log('PASS model/effort persistence, workspace mount/unmount, lazy session and rewind guards')
await invoke('personas:upsert',[{id:persona.value.id,name:'Merge persona',workspace:ws+'/missing'}])
await invoke('chat:create-session',[{sessionId:'merge-invalid',personaId:persona.value.id}])
list=(await invoke('chat:list-sessions')).value
assert.equal(list.find(s=>s.id==='merge-invalid').focusRoot,null)
await invoke('chat:delete-session',['merge-invalid',null])
await invoke('personas:remove',[persona.value.id])
console.log('PASS persona workspace auto-mount and invalid-directory fallback')

// Persist an existing project roster as it would be loaded after a worker restart.
const memberId='audit-member', parentId='audit-parent'
await fs.writeFile(path.join(chatDir,memberId+'.json'),JSON.stringify({id:memberId,parentId,messages:[],createdAt:1,updatedAt:1,focusRoot:ws}))
await fs.writeFile(path.join(chatDir,parentId+'.json'),JSON.stringify({id:parentId,messages:[],createdAt:1,updatedAt:1,members:[{sessionId:memberId,name:'Worker',origin:'created',root:ws,duty:'audit',addedAt:1}]}))
await invoke('chat:rename-session',[{sessionId:memberId,title:'Member fixture'}])
await invoke('chat:rename-session',[{sessionId:parentId,title:'Parent fixture'}])
const roster=(await invoke('chat:list-sessions')).value
assert.ok(roster.find(s=>s.id===parentId).members.some(m=>m.sessionId===memberId))
await invoke('chat:set-focus',[{sessionId:memberId,focusRoot:null}])
assert.equal(JSON.parse(await fs.readFile(path.join(chatDir,parentId+'.json'))).members[0].root,null)
assert.equal((await invoke('chat:remove-member',[parentId,memberId])).value.ok,true)
assert.equal(JSON.parse(await fs.readFile(path.join(chatDir,parentId+'.json'))).members[0].removed,true)
assert.equal((await invoke('chat:remove-member',[parentId,memberId])).value.ok,false)
await invoke('chat:delete-session',[parentId,null])
assert.ok(!(await invoke('chat:list-sessions')).value.some(s=>[parentId,memberId].includes(s.id)))
console.log('PASS project roster, member folder synchronization, remove and parent cascade deletion')

const child=spawn(process.execPath,['apps/web/test/smoke.mjs'],{env:{...env,BASE:base,ADMIN_PASSWORD:env.DEVA_WEB_ADMIN_PASSWORD,SMOKE_CREATE_USER:'1'},stdio:'inherit'})
const code=await new Promise(resolve=>child.on('exit',resolve)); console.log('SMOKE_EXIT',code); assert.equal(code,0)
assert.equal(await fs.readFile(attachment.value.path,'utf8'),'hello');console.log('PASS attachment survives second user startup')
}finally{p.kill('SIGTERM');await new Promise(r=>p.on('exit',r));await fs.writeFile(path.join(report,'service.log'),output);console.log('SERVER_CLEANED',p.exitCode,tmp)}
