import './support/home.mjs'
import './support/local-http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import {requestMount,runAgentLoop} from '../src/main/services/agent-loop.ts'
import {runSubagentCall} from '../src/main/services/subagent-run.ts'
import {runTurn,abortTurn,insertMessage} from '../src/main/services/chat-turns.ts'
import {cancelBackground,pendingNotices,enqueueNotice,wakeForNotices,takeNotices} from '../src/main/services/background-tasks.ts'
import {pendingMemberReports,memberDispatches,memberToMain} from '../src/main/services/chat-members.ts'
import {pendingHandoffs} from '../src/main/services/chat-task-handoff.ts'
import {ensureSession,save} from '../src/main/services/chat-store.ts'
import {loadSubagent,subagentIdFor} from '../src/main/services/subagent-store.ts'
import {onChatEvent} from '../src/main/services/chat-bus.ts'
import {backgroundSubagents,busySessions,rewinding,pendingMount,releasePending,pendingUndo} from '../src/main/services/chat-state.ts'

async function until(predicate){for(let i=0;i<500;i++){if(predicate())return;await delay(10)}assert.fail('state transition timed out')}
async function provider(t){
 const requests=[]
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();requests.push({res})})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 t.after(()=>{server.closeAllConnections();server.close()})
 const model={adapter:'openai',providerId:'state-machine-test',baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'test'}
 const finish=(i,text)=>{requests[i].res.end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')}
 return {requests,model,finish}
}
function parent(id,model){
 const session=ensureSession(id);session.messages=[{role:'user',content:'parent'},{role:'assistant',content:[{type:'tool_use',id:id+'-call',name:'run_subagent',input:{}}]}];save(id)
 const controller=new AbortController()
 const run={args:{turnId:id+'-turn',sessionId:id,history:session.messages,system:'test',tools:[],personaId:'default',model,ctx:{workspaceRoot:null,homeDir:process.env.DEVA_HOME,signal:controller.signal},controller,depth:0,interactive:true,allowSubagents:true,allowAskUser:false,enqueueNotice},isSub:false,runChild:runAgentLoop}
 return {session,run,tc:{id:id+'-call',name:'run_subagent',args:{agent:'fork',prompt:'child',description:'child'}}}
}

test('mount boundary preserves synchronous event, pending registration and stop resolution',async t=>{
 const events=[];t.after(onChatEvent(p=>events.push(p)))
 const waiting=requestMount('mount-turn','mount-session','choose','member')
 const event=events.find(p=>p.event.type==='mount_request')
 assert.equal(event.event.question,'choose');assert.equal(event.event.member,'member')
 assert.equal(pendingMount.get(event.event.key).turnId,'mount-turn')
 releasePending('mount-turn');assert.equal(await waiting,null);assert.equal(pendingMount.has(event.event.key),false)
})

test('background completion after rollback is silent and cannot revive removed tool history',async t=>{
 const p=await provider(t),{session,run,tc}=parent('rollback-child',p.model)
 busySessions.set(session.id,'parent-turn')
 t.after(()=>{busySessions.delete(session.id);rewinding.delete(session.id);pendingNotices.delete(session.id)})
 await runSubagentCall(run,tc);await until(()=>p.requests.length===1)
 rewinding.add(session.id);cancelBackground(session.id)
 session.messages=[{role:'user',content:'rolled back'}];save(session.id)
 p.finish(0,'late result');await until(()=>!backgroundSubagents.has(tc.id))
 assert.equal(pendingNotices.has(session.id),false)
 assert.deepEqual(session.messages,[{role:'user',content:'rolled back'}])
 assert.equal(loadSubagent(session.id,subagentIdFor(tc.id)),undefined)
})

test('stop during background finish retains a non-waking notice; group completion wakes only at final child',async t=>{
 const p=await provider(t),a=parent('group-child',p.model),b={...a,tc:{id:'second-call',name:'run_subagent',args:{agent:'fork',prompt:'second'}}}
 busySessions.set(a.session.id,'parent-turn');t.after(()=>{busySessions.delete(a.session.id);pendingNotices.delete(a.session.id)})
 await runSubagentCall(a.run,a.tc);await runSubagentCall(b.run,b.tc);await until(()=>p.requests.length===2)
 p.finish(0,'first finished');await until(()=>!backgroundSubagents.has(a.tc.id))
 assert.equal(pendingNotices.get(a.session.id)[0].wake,false)
 const last=backgroundSubagents.get(b.tc.id);last.stoppedByUser=true;last.controller.abort()
 await until(()=>!backgroundSubagents.has(b.tc.id))
 const notices=pendingNotices.get(a.session.id)
 assert.deepEqual(notices.map(n=>[n.subagent,n.wake]),[['done',false],['stopped',true]])
 assert.match(takeNotices(a.session.id),/first finished/)
})

test('member and handoff reports wait for rollback; reports are persisted before notification turn starts',async t=>{
 const p=await provider(t),id='wake-order',s=ensureSession(id);s.messages=[{role:'user',content:'original'}];save(id)
 rewinding.add(id);pendingUndo.set(id,{test:true})
 pendingMemberReports.set(id,[{name:'member',headline:'member done',conclusion:'member body'}])
 pendingHandoffs.set(id,[{title:'task',input:{summary:'task done',content:'task body',needsAction:false},model:p.model}])
 const seen=[];t.after(onChatEvent(e=>{if(e.sessionId===id){const disk=JSON.parse(fs.readFileSync(path.join(process.env.DEVA_HOME,'data','chats',id+'.json'),'utf8'));seen.push({type:e.event.type,content:JSON.stringify(disk.messages)})}}))
 t.after(()=>{rewinding.delete(id);pendingUndo.delete(id);pendingNotices.delete(id);pendingHandoffs.delete(id);pendingMemberReports.delete(id)})
 enqueueNotice(id,{toolUseId:'background',headline:'child done',body:'child body',wake:true,model:p.model})
 assert.equal(s.messages.length,1);assert.equal(p.requests.length,0)
 rewinding.delete(id);wakeForNotices(id);await until(()=>p.requests.length===1)
 const start=seen.find(x=>x.type==='turn_start');assert.ok(start)
 assert.ok(start.content.indexOf('member body')<start.content.indexOf('task body'));assert.ok(start.content.indexOf('task body')<start.content.indexOf('child body'))
 assert.equal(pendingUndo.has(id),false)
 p.finish(0,'summary');await until(()=>!busySessions.has(id))
})

test('stopping a parent turn saves before done and returns inserts without starting queued notifications',async t=>{
 const p=await provider(t),id='stop-parent',s=ensureSession(id);s.messages=[{role:'user',content:'question'}];save(id)
 const seen=[];t.after(onChatEvent(e=>{if(e.sessionId===id)seen.push({type:e.event.type,reason:e.event.stopReason,disk:fs.readFileSync(path.join(process.env.DEVA_HOME,'data','chats',id+'.json'),'utf8')})}))
 const running=runTurn(id,'stop-turn',p.model,null)
 await until(()=>p.requests.length===1)
 enqueueNotice(id,{toolUseId:'late',headline:'late',body:'late result',wake:true,model:p.model})
 await insertMessage({sessionId:id,text:'inserted',model:p.model})
 abortTurn('stop-turn');const outcome=await running
 assert.equal(outcome.stopReason,'aborted');assert.equal(p.requests.length,1)
 assert.equal(pendingNotices.get(id).length,1);assert.equal(busySessions.has(id),false)
 const done=seen.find(x=>x.type==='done');assert.equal(done.reason,'aborted');assert.match(done.disk,/aborted/)
 assert.ok(seen.findIndex(x=>x.type==='done')<seen.findIndex(x=>x.type==='inserts_returned'))
 pendingNotices.delete(id)
})

test('foreground child keeps parent history isolated and persists child before tool result event',async t=>{
 const p=await provider(t),{session,run,tc}=parent('foreground-child',p.model)
 const before=JSON.stringify(session.messages),observed=[]
 tc.args.foreground=true
 t.after(onChatEvent(e=>{if(e.sessionId===session.id&&e.event.type==='tool_result')observed.push(loadSubagent(session.id,subagentIdFor(tc.id)))}))
 const call=runSubagentCall(run,tc);await until(()=>p.requests.length===1)
 p.finish(0,'child conclusion');const result=await call
 assert.equal(result.isErr,false);assert.match(result.conclusion,/child conclusion/)
 assert.equal(JSON.stringify(session.messages),before)
 assert.equal(observed.length,1);assert.match(JSON.stringify(observed[0].messages),/child conclusion/)
 assert.equal(backgroundSubagents.has(tc.id),false)
})


test('member completion persists child and parent before publishing the result',async t=>{
 const p=await provider(t),main=ensureSession('persist-parent'),sub=ensureSession('persist-member')
 sub.parentId=main.id;sub.messages=[{role:'user',content:'member task'}]
 main.members=[{sessionId:sub.id,name:'worker',origin:'created',root:null,duty:'test',addedAt:0}]
 save(main.id);save(sub.id)
 memberDispatches.set(sub.id,[{toolUseId:'dispatch',model:p.model,reportToMe:false,group:'parent-turn',task:'task',delivered:true}])
 const snapshots=[]
 t.after(onChatEvent(e=>{if(e.sessionId===main.id&&e.event.type==='member_report')snapshots.push([main.id,sub.id].map(id=>fs.readFileSync(path.join(process.env.DEVA_HOME,'data','chats',id+'.json'),'utf8')))}))
 const running=runTurn(sub.id,'member-finish',p.model,null,'member')
 await until(()=>p.requests.length===1);p.finish(0,'member-complete');await running
 assert.equal(snapshots.length,1)
 for(const disk of snapshots[0])assert.match(disk,/member-complete/)
 assert.equal(memberDispatches.has(sub.id),false)
})

test('deleted member stop cannot report its finalizer back to parent',async t=>{
 const p=await provider(t),main=ensureSession('deleted-parent'),sub=ensureSession('deleted-member')
 sub.parentId=main.id;sub.messages=[{role:'user',content:'member task'}]
 main.members=[{sessionId:sub.id,name:'worker',origin:'created',root:null,duty:'test',addedAt:0}]
 save(main.id);save(sub.id)
 memberToMain.set(sub.id,'must not wake parent')
 const before=JSON.stringify(main.messages)
 const running=runTurn(sub.id,'member-deleted',p.model,null,'member')
 await until(()=>p.requests.length===1);abortTurn('member-deleted','deleted')
 const result=await running
 assert.equal(result.abortCause,'deleted');assert.equal(result.stopReason,'aborted')
 assert.equal(memberToMain.has(sub.id),false);assert.equal(pendingNotices.has(main.id),false)
 assert.equal(JSON.stringify(main.messages),before);assert.equal(p.requests.length,1)
})

test('task inform commits final SSE text only after turn completion and suppresses aborted inform',async t=>{
 const {deliverResult}=await import('../src/main/services/chat-task-handoff.ts')
 const p=await provider(t),main=ensureSession('inform-owner'),sub=ensureSession('inform-task')
 main.messages=[{role:'user',content:'owner'}];sub.messages=[{role:'user',content:'task'}];save(main.id);save(sub.id)
 const task={sessionId:sub.id,title:'inform',auth:{modelRef:''}}
 const running=runTurn(sub.id,'inform-turn',p.model,null)
 await until(()=>p.requests.length===1)
 assert.equal(deliverResult(task,main.id,{id:'deliver',name:'deliver_result',args:{summary:'summary',needs_action:false}},p.model,'inform-turn').isError,false)
 assert.equal(main.messages.length,1)
 p.finish(0,'SSE-FINAL');const result=await running
 assert.equal(result.handoff.needsAction,false);assert.match(JSON.stringify(main.messages),/SSE-FINAL/)
 const before=JSON.stringify(main.messages),aborted=runTurn(sub.id,'inform-abort',p.model,null)
 await until(()=>p.requests.length===2)
 deliverResult(task,main.id,{id:'abort-deliver',name:'deliver_result',args:{summary:'aborted',needs_action:false}},p.model,'inform-abort')
 abortTurn('inform-abort');assert.equal((await aborted).handoff,undefined)
 assert.equal(JSON.stringify(main.messages),before)
})

test('askTask occupies synchronously; stopping its SSE turn clears ask and queues non-waking notice',async t=>{
 const {askTask,stopTask,taskAsks}=await import('../src/main/services/chat-task-handoff.ts')
 const p=await provider(t),main=ensureSession('ask-owner'),sub=ensureSession('ask-task');save(main.id);save(sub.id)
 const task={sessionId:sub.id,title:'ask',auth:{modelRef:''}}
 const result=askTask(main,task,'subject','question','ask-tool',p.model,true)
 assert.equal(result.isError,false);assert.ok(busySessions.has(sub.id));assert.ok(taskAsks.has(sub.id))
 await until(()=>p.requests.length===1);assert.equal(stopTask(task).isError,false)
 await until(()=>!busySessions.has(sub.id)&&!taskAsks.has(sub.id))
 assert.equal(pendingNotices.get(main.id)[0].wake,false);assert.equal(p.requests.length,1)
 pendingNotices.delete(main.id)
})

test('member busy insertion refusal restores roster and dispatch state synchronously',async t=>{
 const {mainMemberTool,memberDispatches}=await import('../src/main/services/chat-members.ts')
 const p=await provider(t),main=ensureSession('insert-owner'),sub=ensureSession('insert-member')
 sub.parentId=main.id;sub.messages=[{role:'user',content:'first'}]
 main.members=[{sessionId:sub.id,name:'worker',origin:'created',root:null,duty:'test',addedAt:0}];save(main.id);save(sub.id)
 const running=runTurn(sub.id,'insert-test-turn',p.model,null,'schedule')
 t.after(()=>abortTurn('insert-test-turn'))
 await until(()=>p.requests.length===1)
 // Model an ownership change to a compaction/rewind owner: it has no insertable turn.
 busySessions.set(sub.id,'non-insertable-owner')
 const result=await mainMemberTool(main.id,{id:'refused-dispatch',name:'member_send',args:{member:'worker',task:'second',message:'second'}},p.model,'parent')
 busySessions.set(sub.id,'insert-test-turn')
 assert.equal(result.isError,true);assert.equal(memberDispatches.has(sub.id),false);assert.equal(main.members[0].openTasks,undefined)
 await until(()=>p.requests.length===1);abortTurn('insert-test-turn');await running
})

test('action handoff takes the busy slot before ordinary background notices can start another turn',async t=>{
 const p=await provider(t),id='action-priority',s=ensureSession(id);s.messages=[{role:'user',content:'owner'}];save(id)
 rewinding.add(id)
 pendingHandoffs.set(id,[{title:'priority',input:{summary:'act',content:'action-body',needsAction:true},model:p.model}])
 enqueueNotice(id,{toolUseId:'queued',headline:'queued',body:'ordinary-body',wake:true,model:p.model})
 rewinding.delete(id);wakeForNotices(id)
 assert.ok(busySessions.has(id));assert.equal(pendingNotices.get(id).length,1)
 await until(()=>p.requests.length===1)
 abortTurn(busySessions.get(id));await until(()=>!busySessions.has(id))
 assert.equal(p.requests.length,1);pendingNotices.delete(id)
})

test('member tools route named owned tasks through synchronous ask and stop',async t=>{
 const {createTask}=await import('../src/main/services/tasks.ts')
 const {mainMemberTool}=await import('../src/main/services/chat-members.ts')
 const p=await provider(t),main=ensureSession('owned-task-parent');save(main.id)
 const created=createTask({title:'owned-task',prompt:'task',schedule:{kind:'recurring',cron:'0 0 * * *',tz:'UTC'},auth:{personaId:'default',modelRef:''},ownerSessionId:main.id})
 assert.equal(created.ok,true);const sub=ensureSession(created.task.sessionId);save(sub.id)
 const result=await mainMemberTool(main.id,{id:'route-ask',name:'member_send',args:{member:'owned-task',task:'question',message:'answer'}},p.model,'main-turn')
 assert.equal(result.isError,false);assert.ok(busySessions.has(sub.id))
 await until(()=>p.requests.length===1)
 const stopped=await mainMemberTool(main.id,{id:'route-stop',name:'member_stop',args:{member:'owned-task'}},p.model,'main-turn')
 assert.equal(stopped.isError,false);await until(()=>!busySessions.has(sub.id))
 assert.equal(pendingNotices.get(main.id)[0].wake,false);pendingNotices.delete(main.id)
})

test('turn completion retains ownership through done and releases before promise settlement',async t=>{
 const p=await provider(t),id='completion-ownership',s=ensureSession(id)
 s.messages=[{role:'user',content:'question'}];save(id)
 const observed=[];t.after(onChatEvent(e=>{if(e.sessionId===id&&e.event.type==='done')observed.push({busy:busySessions.get(id),saved:fs.readFileSync(path.join(process.env.DEVA_HOME,'data','chats',id+'.json'),'utf8')})}))
 const running=runTurn(id,'completion-owner',p.model,null)
 assert.equal(busySessions.get(id),'completion-owner')
 await until(()=>p.requests.length===1);p.finish(0,'OWNERSHIP-FINAL');const result=await running
 assert.equal(result.text,'OWNERSHIP-FINAL');assert.equal(observed.length,1)
 assert.equal(observed[0].busy,'completion-owner');assert.match(observed[0].saved,/OWNERSHIP-FINAL/)
 assert.equal(busySessions.has(id),false)
})

test('completion notification is considered after persistence for normal finish and suppressed for stop',async t=>{
 const {setWindowGetter}=await import('../src/main/services/chat-state.ts')
 const p=await provider(t),id='notify-policy',s=ensureSession(id);s.messages=[{role:'user',content:'question'}];save(id)
 let done=false;const observed=[]
 t.after(onChatEvent(e=>{if(e.sessionId===id&&e.event.type==='done')done=true}))
 setWindowGetter(()=>{if(done)observed.push(fs.readFileSync(path.join(process.env.DEVA_HOME,'data','chats',id+'.json'),'utf8'));return null})
 t.after(()=>setWindowGetter(()=>null))
 const first=runTurn(id,'notify-finish',p.model,null);await until(()=>p.requests.length===1);p.finish(0,'NOTIFY-FINAL');await first
 assert.equal(observed.length,1);assert.match(observed[0],/NOTIFY-FINAL/)
 observed.length=0;done=false
 const stopped=runTurn(id,'notify-stop',p.model,null);await until(()=>p.requests.length===2);abortTurn('notify-stop');await stopped
 assert.equal(observed.length,0)
})
