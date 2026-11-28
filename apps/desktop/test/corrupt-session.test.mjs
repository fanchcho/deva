import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ensureSession, save, deleteSession, corruptSessions, recoverCorruptSession } from '../src/main/services/chat-store.ts'
import { trimRuntimes, runtimeDraftPins } from '../src/renderer/src/store/runtime-budget.ts'
test('corrupt original survives load/save/delete; explicit recovery copies exact bytes', () => {
  const dir = path.join(process.env.DEVA_HOME, 'data/chats'); fs.mkdirSync(dir,{recursive:true})
  const file = path.join(dir,'broken.json'), bytes = Buffer.from('{broken\xff')
  fs.writeFileSync(file, bytes)
  for (const action of [()=>ensureSession('broken'),()=>save('broken'),()=>deleteSession('broken')]) assert.throws(action,{code:'SESSION_CORRUPT_READ_ONLY'})
  assert.equal(corruptSessions.get('broken').hash.length,64)
  assert.throws(()=>recoverCorruptSession('broken',false), /CONFIRMATION/)
  const branch = recoverCorruptSession('broken',true)
  assert.notEqual(branch.id,'broken')
  assert.deepEqual(fs.readFileSync(file),bytes)
  assert.deepEqual(fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(n=>n.startsWith('broken.corrupt-')))),bytes)
  assert.equal(ensureSession('missing').messages.length,0)
})
test('runtime LRU retains current, streaming, attention and draft pins', () => {
  const map = new Map(Array.from({length:30},(_,i)=>[String(i),{}]))
  runtimeDraftPins.add('0')
  trimRuntimes(map,id=>['1','2','3'].includes(id))
  assert.equal(map.size,20)
  for (const id of ['0','1','2','3','29']) assert.ok(map.has(id))
  assert.ok(!map.has('4')); runtimeDraftPins.clear()
})

test('EACCES is read-only with unavailable hash, never treated as missing', async()=>{
  const { syncBuiltinESMExports } = await import('node:module')
  const original=fs.readFileSync
  fs.readFileSync=(file,...args)=>{if(String(file).endsWith('/denied.json'))throw Object.assign(new Error('denied'),{code:'EACCES'});return original(file,...args)}
  syncBuiltinESMExports()
  try {
    assert.throws(()=>ensureSession('denied'),{code:'SESSION_CORRUPT_READ_ONLY'})
    assert.equal(corruptSessions.get('denied').errorCode,'EACCES')
    assert.equal(corruptSessions.get('denied').hash,null)
    assert.throws(()=>save('denied'),{code:'SESSION_CORRUPT_READ_ONLY'})
  }finally{fs.readFileSync=original;syncBuiltinESMExports()}
})
