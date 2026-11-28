import './support/memory-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopMcpPage } from '../lib/desktop-mcp-settings.mjs'
import { SECRET_MASK } from '../lib/mcp-secrets.mjs'
const run = () => ({ config: { sharedDevaHome: process.env.DEVA_HOME }, identity: { userId: 1 } })
const call = input => desktopMcpPage(input, run(), 1)
const path = name => join(process.env.DEVA_HOME, name)
const read = name => JSON.parse(readFileSync(path(name)))
const seed = () => {
  writeFileSync(path('mcp.json'), JSON.stringify({ extra: 7, mcpServers: { same: { name:'桌面显示名',description:'keep',transport:'stdio',command:'node',args:[],env:{TOKEN:{secretRef:'token'}},future:{keep:true}}, other:{name:'Other',transport:'http',url:'https://example.com/mcp'} } }))
  writeFileSync(path('config.json'), JSON.stringify({theme:'dark',mcp:{extra:8,enabled:{same:true,other:false},roles:{same:['general'],other:['general']}}}))
}
test('desktop MCP file CRUD preserves secretRef, unknown fields, order and separate enabled state', () => {
  seed()
  assert.equal(call({action:'list'}).servers[0].source,'desktop')
  const config=call({action:'get',name:'same'}).config
  assert.equal(config.env.TOKEN,SECRET_MASK)
  call({action:'update',name:'same',config:{...config,command:'new-node',enabled:false}})
  const data=read('mcp.json');assert.equal(data.extra,7);assert.deepEqual(Object.keys(data.mcpServers),['same','other']);assert.deepEqual(data.mcpServers.same.env.TOKEN,{secretRef:'token'});assert.deepEqual(data.mcpServers.same.future,{keep:true});assert.equal(data.mcpServers.same.name,'桌面显示名')
  assert.equal(read('config.json').theme,'dark');assert.equal(read('config.json').mcp.extra,8);assert.equal(read('config.json').mcp.enabled.same,false)
  call({action:'toggle',name:'same',enabled:true});assert.equal(read('config.json').mcp.enabled.same,true)
  call({action:'create',name:'new',config:{type:'http',url:'https://example.com',enabled:false}})
  assert.equal(read('mcp.json').mcpServers.new.transport,'http')
  call({action:'delete',name:'same'});assert.equal(read('mcp.json').mcpServers.same,undefined);assert.equal(read('config.json').mcp.enabled.same,undefined);assert.equal(read('config.json').mcp.roles.same,undefined);assert.deepEqual(read('config.json').mcp.roles.other,['general'])
})
for (const [file,raw] of [['mcp.json','{bad'],['mcp.json','{"mcpServers":[]}'],['config.json','{bad'],['config.json','{"mcp":{"enabled":[]}}']]) test(`desktop MCP protects invalid ${file}: ${raw}`,()=>{
  seed();writeFileSync(path(file),raw);const before=readFileSync(path('mcp.json'),'utf8');const cfg=readFileSync(path('config.json'),'utf8')
  assert.throws(()=>call({action:'update',name:'same',config:{type:'stdio',command:'new'}}))
  assert.equal(readFileSync(path('mcp.json'),'utf8'),before);assert.equal(readFileSync(path('config.json'),'utf8'),cfg)
})
test('desktop MCP owner gate denies other accounts without exposing configuration',()=>{seed();assert.throws(()=>desktopMcpPage({action:'list'},run(),2),/OWNER/)} )
test('real desktop upsert fixture is readable through plugin page',()=>{
  writeFileSync(path('mcp.json'),readFileSync(new URL('./fixtures/mcp-desktop.json',import.meta.url)))
  const result=call({action:'list'});assert.equal(result.servers[0].name,'interop')
  const detail=call({action:'get',name:'interop'});assert.equal(detail.config.env.TOKEN,SECRET_MASK)
})
test('failed enabled write rolls connection file back and never returns success', async()=>{
  const { acquireFileLock }=await import('../lib/file-lock.mjs')
  seed();const before=readFileSync(path('mcp.json'),'utf8');const release=acquireFileLock(path('config.json'))
  try {assert.throws(()=>call({action:'update',name:'same',config:{type:'stdio',command:'changed'}}));assert.equal(readFileSync(path('mcp.json'),'utf8'),before)} finally {release()}
})
test('same-source stable IDs reject duplicates and runtime merge keeps Studio priority', async()=>{
  const { mergeServers }=await import('../lib/mcp.mjs')
  seed();assert.throws(()=>call({action:'create',name:'same',config:{type:'stdio',command:'x'}}),/already exists/)
  const desktop={name:'same',command:'desktop'},studio={name:'same',command:'studio'}
  const merged=mergeServers([desktop,{name:'desktop-only'}],[studio])
  assert.equal(merged.filter(x=>x.name==='same').length,1);assert.equal(merged.find(x=>x.name==='same').command,'studio');assert.ok(merged.some(x=>x.name==='desktop-only'))
})
