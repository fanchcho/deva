import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {ensureSession,getSession} from '../src/main/services/chat-store.ts'
import {setMemberFolder} from '../src/main/services/chat-members.ts'
import {onSessionsChanged} from '../src/main/services/chat-bus.ts'
test('member mount updates parent roster and child before publishing; unmount preserves identity',()=>{
 const main=ensureSession('folder-parent'),sub=ensureSession('folder-child');sub.parentId=main.id
 main.members=[{sessionId:sub.id,root:null,name:'member'}]
 const observed=[];const off=onSessionsChanged(()=>observed.push([getSession(main.id).members[0].root,getSession(sub.id).focusRoot,JSON.parse(fs.readFileSync(path.join(process.env.DEVA_HOME,'data/chats',main.id+'.json'),'utf8')).members[0].root,JSON.parse(fs.readFileSync(path.join(process.env.DEVA_HOME,'data/chats',sub.id+'.json'),'utf8')).focusRoot]))
 setMemberFolder(sub,process.env.DEVA_HOME);setMemberFolder(sub,null);off()
 assert.deepEqual(observed,[[process.env.DEVA_HOME,process.env.DEVA_HOME,process.env.DEVA_HOME,process.env.DEVA_HOME],[null,null,null,null]])
 assert.equal(main.members[0].name,'member');assert.equal(sub.parentId,main.id)
})
