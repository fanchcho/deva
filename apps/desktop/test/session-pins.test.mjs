import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionPins} from '../src/main/services/session-pins.ts'
import {SessionCache} from '../src/main/services/session-cache.ts'
test('switch and destroyed-window semantics release old pins so saved sessions can evict',()=>{
 const pins=new SessionPins(), cache=new SessionCache();cache.maxCount=1;cache.protectedSession=id=>pins.has(id)
 pins.set(1,'old');cache.set('old',{});cache.committed('old');cache.set('new',{});cache.committed('new')
 assert.ok(cache.has('old'));pins.set(1,'new');cache.prune();assert.ok(!cache.has('old'))
 pins.release(1);cache.set('third',{});cache.committed('third');assert.ok(!cache.has('new'))
})
