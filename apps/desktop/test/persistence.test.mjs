import './support/home.mjs'
import { onChatEvent } from '../src/main/services/chat-bus.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { ensureSession, save, deleteSession, getSession, unsavedSessions } from '../src/main/services/chat-store.ts'

test('save ENOSPC/EACCES/rename failures preserve disk and retry; failed delete retains cache', () => {
  const session = ensureSession('persistence-regression')
  session.title = 'before'; save(session.id)
  const file = join(process.env.DEVA_HOME, 'data/chats', `${session.id}.json`)
  const before = fs.readFileSync(file, 'utf8')
  const events = []
  const unsubscribe = onChatEvent(event => events.push(event))
  for (const [operation, code] of [['writeFileSync', 'ENOSPC'], ['writeFileSync', 'EACCES'], ['renameSync', 'EPERM'], ['renameSync', 'EBUSY']]) {
    const original = fs[operation]
    fs[operation] = () => { throw Object.assign(new Error(code), { code }) }; syncBuiltinESMExports()
    try {
      session.title = 'after'
      assert.throws(() => save(session.id), { code: 'SESSION_SAVE_FAILED' })
      assert.ok(unsavedSessions.has(session.id))
      assert.equal(fs.readFileSync(file, 'utf8'), before)
    } finally { fs[operation] = original; syncBuiltinESMExports() }
  }
  unsubscribe()
  assert.equal(events.filter(e => e.event.type === 'persistence_error').length, 4)
  assert.ok(events.every(e => e.sessionId === session.id && !JSON.stringify(e).includes(file)))
  save(session.id); assert.ok(!unsavedSessions.has(session.id))
  const original = fs.rmSync
  fs.rmSync = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) }; syncBuiltinESMExports()
  try {
    assert.throws(() => deleteSession(session.id), { code: 'SESSION_DELETE_FAILED' })
    assert.equal(getSession(session.id), session)
  } finally { fs.rmSync = original; syncBuiltinESMExports() }
  deleteSession(session.id)
})

test('retry after compacted append and manifest failure cannot duplicate older messages', async () => {
  const {sessionCache}=await import('../src/main/services/chat-store.ts')
  const marker='⟦deva:compaction⟧'
  const s=ensureSession('compacted-retry')
  s.messages=[{role:'user',content:'one'},{role:'assistant',content:[{type:'text',text:'answer-one'}]},
    {role:'user',content:marker+' first'},{role:'user',content:'two'}]
  save(s.id)
  s.messages.push({role:'assistant',content:[{type:'text',text:'answer-two'}]},
    {role:'user',content:marker+' second'},{role:'user',content:'three'})
  const expected=JSON.stringify(s.messages)
  const original=fs.renameSync
  fs.renameSync=()=>{throw Object.assign(new Error('EPERM'),{code:'EPERM'})};syncBuiltinESMExports()
  try{assert.throws(()=>save(s.id),{code:'SESSION_SAVE_FAILED'})}finally{fs.renameSync=original;syncBuiltinESMExports()}
  save(s.id);sessionCache.delete(s.id)
  assert.equal(JSON.stringify(getSession(s.id).messages),expected)
})
