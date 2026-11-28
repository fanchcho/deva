import test from 'node:test'
import assert from 'node:assert/strict'
import {isUnread} from '../src/mobile/session-unread.ts'
test('mobile unread state boundary remains identical after cycle extraction',()=>{
 const base={id:'s',updatedAt:20,previewRole:'assistant'}
 assert.equal(isUnread(base,new Map()),true)
 for(const field of ['busy','waiting'])assert.equal(isUnread({...base,[field]:true},new Map()),false)
 assert.equal(isUnread(base,new Map([['s',20]])),false)
 assert.equal(isUnread({...base,readAt:20},new Map()),false)
 assert.equal(isUnread({...base,previewRole:'user'},new Map()),false)
})
