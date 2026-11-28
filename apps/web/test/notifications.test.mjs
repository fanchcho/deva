import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { installNotifications } from '../src/web/notifications.js'

test('reply/task notifications reach Web events and clicks navigate exactly once', async () => {
  const dir = await fs.mkdtemp(new URL('../../../.tmp/web-notifications-', import.meta.url).pathname)
  const prior = process.env.DEVA_HOME; process.env.DEVA_HOME = dir
  try {
    const m = await import('../src/backend/electron-shim.mjs?notification-test'), events = []
    m.setEventSink((...v) => events.push(v))
    assert.equal(m.Notification.isSupported(), true)
    const notification = new m.Notification({title:'Done',body:'Actual reply'})
    notification.on('click', () => m.fakeWebContents.send('tasks:navigate',{sessionId:'s'}))
    notification.show();assert.equal(events[0][0],'web:notification');assert.equal(events[0][1].body,'Actual reply')
    const id=events[0][1].id;assert.equal((await m.__invoke('web:notification-click',[id])).ok,true)
    assert.deepEqual(events[1],['tasks:navigate',{sessionId:'s'}])
    await assert.rejects(m.__invoke('web:notification-click',[id]),/EXPIRED/)
    notification.close()
  } finally { if(prior===undefined) delete process.env.DEVA_HOME; else process.env.DEVA_HOME=prior;await fs.rm(dir,{recursive:true,force:true}) }
})

test('denied native notifications fall back to clickable in-page notices', async () => {
  const previous={document:globalThis.document,Notification:globalThis.Notification,setTimeout:globalThis.setTimeout}, nodes=[], calls=[]
  const element=()=>({children:[],setAttribute(){},append(...x){this.children.push(...x)},remove(){this.removed=true}})
  globalThis.document={createElement:element,body:{append:x=>nodes.push(x)}}
  globalThis.Notification={permission:'denied'};globalThis.setTimeout=()=>0
  try {
    let receive;installNotifications(async(...v)=>calls.push(v),(_channel,fn)=>receive=fn)
    receive({id:'one',title:'Reply',body:'finished'});assert.equal(nodes[0].children[0].textContent,'Reply: finished')
    nodes[0].children[0].onclick();await new Promise(r=>setImmediate(r))
    assert.deepEqual(calls,[['web:notification-click','one']]);assert.equal(nodes[0].removed,true)
  } finally {Object.assign(globalThis,previous)}
})
