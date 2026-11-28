import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {sweepMedia} from '../src/main/services/media-store.ts'
test('any unreadable reference file aborts media deletion',async()=>{
 const root=path.join(process.env.DEVA_HOME,'data')
 fs.mkdirSync(path.join(root,'media'),{recursive:true});fs.mkdirSync(path.join(root,'chats'),{recursive:true})
 const blob=path.join(root,'media','a'.repeat(64));fs.writeFileSync(blob,'synthetic');fs.utimesSync(blob,0,0)
 const ref=path.join(root,'chats','broken.json');fs.writeFileSync(ref,'{}')
 const original=fs.promises.readFile
 fs.promises.readFile=async(file,...args)=>{if(file===ref)throw Object.assign(new Error('EACCES'),{code:'EACCES'});return original(file,...args)}
 try{await sweepMedia();assert.ok(fs.existsSync(blob))}finally{fs.promises.readFile=original}
})
