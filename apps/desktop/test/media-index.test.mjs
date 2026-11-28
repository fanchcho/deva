import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {collectMediaReferences} from '../src/main/services/media-reference-index.ts'
import {sweepMedia} from '../src/main/services/media-store.ts'
test('index migration and corrupted/stale hints never delete a referenced old blob',async()=>{
 const root=path.join(process.env.DEVA_HOME,'data'), hash='b'.repeat(64)
 fs.mkdirSync(path.join(root,'chats'),{recursive:true});fs.mkdirSync(path.join(root,'media'),{recursive:true})
 const file=path.join(root,'chats','ref.json'), blob=path.join(root,'media',hash)
 fs.writeFileSync(file,JSON.stringify({blob:hash}));fs.writeFileSync(blob,'data');fs.utimesSync(blob,0,0)
 const legacy=path.join(root,'media-reference-index.json');fs.writeFileSync(legacy,'legacy-bytes')
 assert.ok((await collectMediaReferences(root)).has(hash))
 assert.equal(fs.readFileSync(legacy,'utf8'),'legacy-bytes')
 const index=path.join(root,'media-reference-index.v2.jsonl')
 const data=fs.readFileSync(index,'utf8').trim().split('\n').map(line=>JSON.parse(line))
 data.find(row=>row.path===file).entry.refs=[];fs.writeFileSync(index,data.map(row=>JSON.stringify(row)).join('\n')+'\n')
 await sweepMedia();assert.ok(fs.existsSync(blob))
 const before=fs.readFileSync(index,'utf8');assert.ok((await collectMediaReferences(root,true)).has(hash));assert.equal(fs.readFileSync(index,'utf8'),before)
 fs.writeFileSync(index,'invalid');assert.ok((await collectMediaReferences(root)).has(hash))
 const stat=fs.statSync(index);await collectMediaReferences(root);assert.equal(fs.statSync(index).mtimeMs,stat.mtimeMs)
})
