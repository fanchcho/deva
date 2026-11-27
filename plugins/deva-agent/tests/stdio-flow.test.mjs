import test from 'node:test'
import assert from 'node:assert/strict'
import {Writable} from 'node:stream'
import {JsonLineBuffer,writeWithBackpressure} from '../lib/stdio-flow.mjs'
test('oversized unterminated MCP frame is rejected',()=>{
 const frames=new JsonLineBuffer(16)
 assert.deepEqual(frames.push('abc\n'),['abc'])
 assert.throws(()=>frames.push('x'.repeat(17)),/MCP_PROTOCOL_LIMIT/)
})
test('slow consumer waits for drain and close aborts waiting writes',async()=>{
 let complete
 const stream=new Writable({highWaterMark:1,write(_c,_e,cb){complete=cb}})
 const abort=new AbortController();let done=false
 const pending=writeWithBackpressure(stream,'abc',abort.signal).then(()=>{done=true})
 await new Promise(r=>setImmediate(r));assert.equal(done,false);complete();await pending
 const waiting=writeWithBackpressure(stream,'def',abort.signal)
 abort.abort();await assert.rejects(waiting,/closed/)
 assert.equal(stream.listenerCount('drain'),0);stream.destroy()
})

test('real fake-MCP child with an oversized unterminated frame is killed',async()=>{
 const {createClient}=await import('../lib/mcp.mjs')
 const client=createClient({name:'oversize',type:'stdio',command:process.execPath,args:['-e',"process.stdout.write('x'.repeat(9*1024*1024));setInterval(()=>{},1000)"]})
 try {await assert.rejects(client.connect(),/MCP_PROTOCOL_LIMIT/);assert.equal(client.closed,true)} finally {client.close()}
})
