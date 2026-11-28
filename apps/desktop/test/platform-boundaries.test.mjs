import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {killTree} from '../src/main/services/process-tree.ts'
import {launchPty} from '../src/main/pty-launch.ts'

for(const platform of ['win32','darwin']){
 test(`${platform}: native PTY success/missing/ACL denied/busy preserve shell and errors`,()=>{
  const request={cwd:'C:/synthetic',cols:80,rows:24}, token={}
  const deps={platform,env:{SHELL:'/bin/zsh'},exists:()=>true,home:()=>'/synthetic/home'}
  let args
  assert.equal(launchPty(request,{...deps,spawn:(...a)=>{args=a;return token}}),token)
  assert.equal(args[0],platform==='win32'?'powershell.exe':'/bin/zsh');assert.equal(args[2].cwd,request.cwd)
  for(const code of ['ENOENT','EACCES','EBUSY'])assert.throws(()=>launchPty(request,{...deps,spawn:()=>{throw Object.assign(new Error(code),{code})}}),{code})
  launchPty(request,{...deps,exists:()=>false,spawn:(...a)=>{args=a;return token}})
  assert.equal(args[2].cwd,'/synthetic/home')
 })
 test(`${platform}: process tree success/failure/permission/busy uses platform fallback`,()=>{
  for(const code of [null,'ENOENT','EACCES','EBUSY']){
   const calls=[],child={pid:123,kill:()=>{calls.push('child')}}
   killTree(child,undefined,{platform,killProcess:(pid,signal)=>{calls.push([pid,signal]);if(code)throw Object.assign(new Error(code),{code})},spawnProcess:(bin,args)=>{calls.push([bin,args]);if(code)throw Object.assign(new Error(code),{code});const p=new EventEmitter();queueMicrotask(()=>p.emit('exit',0));return p}})
   if(platform==='win32')assert.deepEqual(calls[0],['taskkill',['/pid','123','/T','/F']])
   else assert.deepEqual(calls[0],[-123,'SIGKILL'])
   if(code)assert.equal(calls.at(-1),'child')
  }
 })
}
test('Windows MSYS tree cleanup finishes before launcher kill; error + exit do not start taskkill twice',async()=>{
 const children=[],calls=[]
 killTree({pid:321,kill:()=>calls.push('child')},{bash:'git-bash',tag:'test-tag'}, {platform:'win32',spawnProcess:(bin,_args)=>{calls.push(bin);const p=new EventEmitter();children.push(p);return p}})
 assert.deepEqual(calls,['git-bash']);children[0].emit('error',new Error('missing'));children[0].emit('exit',1)
 assert.deepEqual(calls,['git-bash','taskkill']);children[1].emit('exit',0);assert.equal(calls.at(-1),'child')
})
