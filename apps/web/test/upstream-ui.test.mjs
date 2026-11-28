import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

// Execute the real components and click handlers against deterministic hook state.
// No browser or screenshot driver: inspect the returned element tree and state transitions.
async function component(file) {
  const code=await build({entryPoints:[new URL('../../desktop/src/renderer/src/redesign/'+file,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{
    name:'ui-dependencies',setup(b){
      b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}))
      b.onResolve({filter:/^(react|react\/jsx-runtime|lucide-react|qrcode)$|\/i18n\/i18n$|\/components\/|\/store\/|^\.\/(PhonePane|GeneralDetail|PlatformLogo|memory-editor|shell-common)$/},args=>({path:args.path,namespace:'ui-stub'}))
      b.onLoad({filter:/.*/,namespace:'ui-stub'},args=>{
        let contents
        if(args.path==='react')contents=`export const useState=initial=>{const i=globalThis.__ui.index++;return [i in globalThis.__ui.states?globalThis.__ui.states[i]:(typeof initial==='function'?initial():initial),v=>globalThis.__ui.updates.push([i,v])]}; export const useEffect=()=>{};export const useLayoutEffect=()=>{}; export const useRef=v=>({current:v}); export const useCallback=f=>f; export const useMemo=f=>f();`
        else if(args.path==='react/jsx-runtime')contents=`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';`
        else if(args.path==='lucide-react')contents=`${['ExternalLink','KeyRound','Loader2','Plus','QrCode','RefreshCw','Search','Smartphone','Trash2','UserMinus','X','Check','ChevronDown','Lightbulb'].map(n=>`export const ${n}='${n}';`).join('')}`
        else if(args.path==='qrcode')contents='export default {}'
        else if(args.path.endsWith('/i18n/i18n'))contents=`export const useI18n=()=>({t:k=>k})`
        else if(args.path.endsWith('/DialogProvider'))contents=`export const useDialog=()=>({confirm:async()=>true})`
        else if(args.path.endsWith('/ToastProvider'))contents=`export const useToast=()=>({show:()=>{}})`
        else if(args.path.endsWith('/humation'))contents=`export const PersonaFace='PersonaFace';export const parseAvatarSpec=()=>null`
        else if(args.path.endsWith('/store/chat'))contents='export const useChatState=()=>globalThis.__modelUI?.chat??({sessions:[]});export const useChatActions=()=>globalThis.__modelUI.actions'
        else if(args.path.endsWith('/store/models'))contents='export const useModels=()=>globalThis.__modelUI.models;export const findActive=()=>globalThis.__modelUI.models.activeModel'
        else if(args.path.endsWith('/store/extensions'))contents='export const useExtensions=()=>({personas:[]})'
        else if(args.path==='./PhonePane')contents=`export const PhoneDetail='PhoneDetail';export const PhoneRow='PhoneRow';export const usePhoneState=()=>({added:true,enabled:true,devices:[]})`
        else if(args.path==='./GeneralDetail')contents=`export const GeneralDetail='GeneralDetail'`
        else if(args.path==='./PlatformLogo')contents=`export const PlatformLogo='PlatformLogo'`
        else if((args.path==='./memory-editor'||args.path==='./shell-common'))contents=`export const fill=(s,v)=>s.replace(/\\{(\\w+)\\}/g,(m,k)=>v[k]??m)`
        else throw new Error('missing test dependency '+args.path)
        return {contents,loader:'js'}
      })
    }
  }]})
  return import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'))
}
function nodes(tree) {
  if(!tree||typeof tree!=='object')return []
  if(Array.isArray(tree))return tree.flatMap(nodes)
  return [tree,...nodes(tree.props?.children)]
}
function state(states){globalThis.__ui={index:0,states,updates:[]}}

test('device navigation retains phone row/detail alongside general row/detail',async()=>{
  const {BotsPane}=await component('BotsPane.tsx')
  try {
    state([[],true,'phone',null,'',null,0])
    const phoneNodes=nodes(BotsPane())
    assert.ok(phoneNodes.some(n=>n.type==='PhoneRow'))
    assert.ok(phoneNodes.some(n=>n.type==='PhoneDetail'))
    const generalButton=phoneNodes.find(n=>n.type==='button'&&nodes(n).some(c=>c.props?.children==='bots.general.title'))
    assert.ok(generalButton)
    generalButton.props.onClick()
    assert.ok(globalThis.__ui.updates.some(([i,v])=>i===2&&v==='general'))
    state([[],true,'general',null,'',null,0])
    const generalNodes=nodes(BotsPane())
    assert.ok(generalNodes.some(n=>n.type==='GeneralDetail'))
    const phoneRow=generalNodes.find(n=>n.type==='PhoneRow')
    phoneRow.props.onClick()
    assert.ok(globalThis.__ui.updates.some(([i,v])=>i===2&&v==='phone'))
  } finally {delete globalThis.__ui}
})

test('archive renders full body and restore uses current scope; failure is visible',async()=>{
  const {MemoryArchive}=await component('MemoryArchive.tsx')
  const previous=globalThis.window
  const scope={personaId:'role'}
  let calls=[],changed=0
  globalThis.window={deva:{memory:{restore:async(...args)=>{calls.push(args);return {ok:true}},archive:async()=>[]}}}
  try {
    state([[{id:'a_one',title:'Original',body:'full body\nsecond line'}],'','',null,false])
    const tree=nodes(MemoryArchive({scope,onChanged:()=>changed++}))
    assert.ok(tree.some(n=>n.type==='pre'&&n.props.children==='full body\nsecond line'))
    tree.find(n=>n.type==='button'&&n.props.children==='cf.profile.arcRestore').props.onClick()
    await new Promise(resolve=>setImmediate(resolve))
    assert.deepEqual(calls,[['a_one',scope]])
    assert.equal(changed,1)
    globalThis.window.deva.memory.restore=async()=>({ok:false,error:'MEMORY_INCOMPATIBLE: preserved'})
    state([[{id:'a_one',title:'Original',body:'full body'}],'','',null,false])
    nodes(MemoryArchive({scope,onChanged:()=>changed++})).find(n=>n.type==='button'&&n.props.children==='cf.profile.arcRestore').props.onClick()
    await new Promise(resolve=>setImmediate(resolve))
    assert.ok(globalThis.__ui.updates.some(([i,v])=>i===1&&String(v).includes('MEMORY_INCOMPATIBLE')))
    assert.equal(changed,1)
  } finally {globalThis.window=previous;delete globalThis.__ui}
})


test('flat model panel exposes model list and effort in one panel with persisted action callbacks',async()=>{
  const {ModelPanel}=await component('ModelPanel.tsx')
  const prior=globalThis.window
  const calls=[]
  const provider={id:'p',name:'Provider',adapter:'openai',enabled:true,models:[{id:'gpt-5',name:'Model',enabled:true,contextWindow:128000}]}
  globalThis.__modelUI={chat:{currentSessionId:'s',currentBinding:{},sessions:[]},actions:{setSessionModel:v=>calls.push(['model',v]),setSessionEffort:v=>calls.push(['effort',v])},models:{providers:[provider],activeModel:{provider,model:provider.models[0]},activeEffort:'default',setActiveModel:()=>{},setActiveEffort:()=>{}}}
  globalThis.window={deva:{chat:{contextUsage:async()=>null}}}
  function expand(tree){if(Array.isArray(tree))return tree.map(expand);if(!tree||typeof tree!=='object')return tree;if(typeof tree.type==='function')return expand(tree.type(tree.props));return {...tree,props:{...tree.props,children:expand(tree.props?.children)}}}
  try {
    state([true])
    const tree=nodes(expand(ModelPanel()))
    assert.ok(tree.some(n=>n.props?.className==='cf-mp__panel'))
    const options=tree.filter(n=>n.props?.role==='menuitemradio'||n.props?.role==='radio')
    const model=options.find(n=>nodes(n).some(c=>c.props?.children==='Model'))
    assert.ok(model);model.props.onClick();assert.deepEqual(calls[0],['model','p:gpt-5'])
    const effort=tree.find(n=>n.type==='button'&&nodes(n).some(c=>c.props?.children==='chat.effort.levels.high'))
    assert.ok(effort);effort.props.onClick();assert.deepEqual(calls[1],['effort','high'])
  } finally {globalThis.window=prior;delete globalThis.__modelUI;delete globalThis.__ui}
})


test('context chip opens threshold controls, resets ratio and displays compression history',async()=>{
 const {ContextChip}=await component('ContextChip.tsx');const calls=[]
 globalThis.__modelUI={chat:{contextUsage:{used:64000,window:128000,compactAt:90000,cacheRead:32000,cacheWrite:1000,ratio:0.7,actualRatio:0.7,minRatio:0.2,maxRatio:0.95,defaultRatio:0.8,windowUncapped:128000,compactLog:[{at:1,turn:2,scope:'manual',before:80000,after:12000,folded:3}]}},actions:{setCompactRatio:v=>calls.push(v),refreshContextUsage:()=>{}}}
 try {state([true]);const tree=nodes(ContextChip());assert.ok(tree.some(n=>n.props?.role==='dialog'));const range=tree.find(n=>n.type==='input'&&n.props.type==='range');assert.equal(range.props.value,70);range.props.onChange({target:{value:'45'}});assert.equal(calls[0],0.45);const reset=tree.find(n=>n.type==='button'&&String(n.props.children).includes('panelReset'));assert.ok(reset);reset.props.onClick();assert.equal(calls[1],null);assert.ok(JSON.stringify(tree).includes('80K'));}finally{delete globalThis.__modelUI;delete globalThis.__ui}
})
