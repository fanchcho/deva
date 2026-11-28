import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import { installBrowserControls } from '../src/web/browser-controls.js'

const require = createRequire(import.meta.url)
async function bundled(file, dependencies, context = {}) {
  const b = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'browser-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.path in dependencies ? { path: a.path, namespace: 'fixture' } : undefined)
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: dependencies[a.path], loader: 'js' }))
  } }] })
  const module = { exports: {} }
  vm.runInNewContext(b.outputFiles[0].text, { module, exports: module.exports, require, console, Buffer, URL, setTimeout, clearTimeout, ...context })
  return module.exports
}

test('Web browser frame/input handlers operate visible CDP targets and reject invalid or hidden input', async () => {
  const handlers = new Map(), calls = []
  let visible = true, objectId = 'file-input'
  const page = { id: 'tab', wc: { isDestroyed: () => false, capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,eA==', getSize: () => ({ width: 1440, height: 900 }) }), debugger: { sendCommand: async (...v) => { calls.push(v); return { result: { objectId } } } } } }
  const m = await bundled('../src/backend/browser-controls.ts', {
    electron: 'export const ipcMain={handle:(key,fn)=>handlers.set(key,fn)}',
    '@deva/main/services/browser/pages': 'export const allPages=()=>[page]',
    '@deva/main/services/browser/host': 'export const uiState=()=>({tabs:visible()?[{id:"tab"}]:[]})',
    '@deva/main/services/fs-guard': 'export const assertInside=p=>{if(!p.startsWith("/allowed/"))throw Error("path denied")}'
  }, { handlers, page, visible: () => visible })
  m.registerWebBrowserIpc()
  const frame = handlers.get('browser:web-frame'), input = data => handlers.get('browser:web-input')(null, 'tab', data)
  assert.equal((await frame(null, 'tab')).width, 1440)
  await input({kind:'click',x:20,y:30}); assert.deepEqual(calls.slice(0,2).map(v=>v[1].type),['mousePressed','mouseReleased'])
  await input({kind:'wheel',x:20,y:30,deltaY:2500}); assert.equal(calls.at(-1)[1].deltaY,2000)
  await input({kind:'text',text:'exact input'}); assert.equal(calls.at(-1)[0],'Input.insertText')
  await input({kind:'key',key:'Enter'}); assert.equal(calls.at(-1)[1].type,'keyUp')
  await input({kind:'file',path:'/allowed/upload.txt'}); assert.ok(calls.some(v=>v[0]==='DOM.setFileInputFiles')); assert.equal(calls.at(-1)[0],'Runtime.releaseObject')
  await assert.rejects(input({kind:'file',path:'/etc/passwd'}),/path denied/)
  objectId=null;await assert.rejects(input({kind:'file',path:'/allowed/x'}),/FILE_INPUT_REQUIRED/)
  await assert.rejects(input({kind:'click',x:-1,y:0}),/INPUT_INVALID/)
  await assert.rejects(input({kind:'unknown'}),/INPUT_UNSUPPORTED/)
  visible=false;await assert.rejects(frame(null,'tab'),/TAB_UNAVAILABLE/);await assert.rejects(input({kind:'text',text:'x'}),/TAB_UNAVAILABLE/)
})

test('Web host supplies real page views, window bounds and view cleanup without native chrome', async () => {
  const dir = await fs.mkdtemp(new URL('../../../.tmp/web-browser-', import.meta.url).pathname)
  class Contents { constructor(options){this.options=options} async loadURL(url){this.url=url} async close(){this.closed=true} }
  try {
    const m = await bundled('../src/backend/electron-shim.mjs', { './chromium.mjs': 'export const CDPWebContents=Contents' }, { Contents, process: { ...process, env: { ...process.env, DEVA_HOME: dir } } })
    const host = new m.BrowserWindow({width:1000,height:600,webPreferences:{preload:'browser'}})
    assert.equal(host.webContents,m.fakeWebContents)
    host.showInactive();await host.loadFile('/renderer/browser.html')
    await assert.rejects(host.loadFile('/renderer/unknown.html'),/WEB_WINDOW_UNSUPPORTED/)
    const view = new m.WebContentsView({webPreferences:{session:'isolated'}})
    assert.ok(view.webContents instanceof Contents);await view.webContents.loadURL('https://example.test');assert.equal(view.webContents.url,'https://example.test')
    host.contentView.addChildView(view);host.setBounds({width:900});assert.equal(host.getContentSize()[0],900)
    assert.ok(m.screen.getAllDisplays().length);assert.equal(m.screen.getDisplayMatching().workArea.width,1440)
    host.destroy();assert.equal(view.webContents.closed,true);assert.equal(host.isDestroyed(),true)
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})

test('browser dialog exposes page input and handoff actions and reports backend errors in DOM', async () => {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.value='';this.open=false}
    setAttribute(k,v){this.attrs[k]=v} append(...v){this.children.push(...v)} replaceChildren(...v){this.children=v}
    showModal(){this.open=true} close(){this.open=false} focus(){} getBoundingClientRect(){return {left:0,top:0,width:720,height:450}}
  }
  const prev={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval}
  const body=new Element('body'),calls=[];let update,fail=false
  globalThis.document={body,createElement:t=>new Element(t)};globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{}
  const state={open:true,active:'a',tabs:[{id:'a',sessionId:'s',title:'Page'}],handoff:{s:{message:'Please log in'}}}
  const tick=()=>new Promise(r=>setImmediate(r))
  try {
    installBrowserControls(async(c,...args)=>{calls.push([c,...args]);if(c==='browser:state')return state;if(fail)throw Error('transport disconnected');if(c==='browser:web-frame')return {image:'data:image/png;base64,eA=='};return {ok:true}},(_c,fn)=>update=fn)
    await tick();const dialog=body.children[0];assert.equal(dialog.open,true)
    const bar=dialog.children[0],image=dialog.children[3],entry=dialog.children[4]
    image.onclick({clientX:50,clientY:30});await tick();assert.deepEqual(calls.find(c=>c[0]==='browser:web-input')[2],{kind:'click',x:100,y:60})
    entry.value='user input';bar.children.find(c=>c.textContent==='输入文字').onclick();await tick();assert.ok(calls.some(c=>c[2]?.text==='user input'));assert.equal(entry.value,'')
    bar.children.find(c=>c.textContent==='完成，继续').onclick();await tick();assert.ok(calls.some(c=>c[0]==='browser:handoff'&&c[2]==='done'))
    fail=true;bar.children.find(c=>c.textContent==='刷新').onclick();await tick();assert.match(dialog.children[2].textContent,/disconnected/)
    update({...state,open:false});assert.equal(dialog.open,false)
  } finally {Object.assign(globalThis,prev)}
})
