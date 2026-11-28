import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionCache} from '../src/main/services/session-cache.ts'
test('budget evicts saved idle entries while retaining active, current and dirty references', () => {
 const c = new SessionCache(); c.maxCount=2; c.maxBytes=1024
 const pinned={x:1}; c.set('pinned',pinned); c.protectedSession=id=>id==='pinned'; c.committed('pinned')
 c.set('dirty',{x:2}); c.set('old',{x:3}); c.committed('old')
 c.set('new',{x:4}); c.committed('new')
 assert.equal(c.get('pinned'),pinned); assert.ok(c.has('dirty')); assert.ok(!c.has('old'))
 c.committed('dirty'); c.prune(); assert.ok(c.size<=2)
})

test('evicted stored session reloads from disk with equal content and a fresh reference', async () => {
 await import('./support/home.mjs')
 const {sessionCache,ensureSession,save,getSession}=await import('../src/main/services/chat-store.ts')
 sessionCache.maxCount=2
 const first=ensureSession('reload-first');first.title='persisted';save(first.id)
 for(let i=0;i<5;i++){const s=ensureSession(`reload-${i}`);save(s.id)}
 assert.ok(!sessionCache.has(first.id))
 const loaded=getSession(first.id)
 assert.notEqual(loaded,first);assert.equal(loaded.title,'persisted')
})
