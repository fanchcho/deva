import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {setConfig} from '../src/main/services/config.ts'
import {resolveModelRefForSend,listEnabledModels} from '../src/main/services/model-resolve.ts'

test('general model selection follows explicit, session, role, global and reports no model',()=>{
  setConfig({models:{activeModelId:'p:global',providers:[{id:'p',adapter:'openai',apiHost:'http://127.0.0.1:1',models:['explicit','session','role','global'].map(id=>({id,enabled:true}))}]}})
  assert.equal(resolveModelRefForSend({explicitRef:'p:explicit',sessionModel:'p:session',personaModel:'p:role'}).model,'explicit')
  assert.equal(resolveModelRefForSend({explicitRef:'missing:x',sessionModel:'p:session',personaModel:'p:role'}).model,'session')
  assert.equal(resolveModelRefForSend({sessionModel:'missing:x',personaModel:'p:role'}).model,'role')
  assert.equal(resolveModelRefForSend({}).model,'global')
  assert.equal(listEnabledModels().length,4)
  setConfig({models:{providers:[]}})
  assert.equal(resolveModelRefForSend({}),null)
})
