import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeGeometry, probeLabel } from '../client.mjs'

test('click labels never include arbitrary page text or credential values', () => {
  assert.equal(probeLabel({ textContent: '获取模型列表' }), '获取模型列表')
  assert.equal(probeLabel({ textContent: 'secret-key-value', value: 'secret-key-value' }), '[other]')
  assert.equal(probeLabel({ textContent: 'dialog contains secret' }), '[other]')
})

test('geometry distinguishes present offscreen candidates and collapsed iframe', () => {
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflow: 'auto', overflowY: 'auto' }
  const win = { innerHeight: 500, innerWidth: 320, getComputedStyle: () => style, document: { documentElement: { scrollHeight: 1500, clientHeight: 500 } } }
  const node = { parentElement: { clientHeight: 180 }, offsetHeight: 100, clientHeight: 100, getBoundingClientRect: () => ({ top: 900, bottom: 1000, left: 0, right: 320, width: 320, height: 100 }) }
  const off = probeGeometry(node, win)
  assert.equal(off.present, 1); assert.equal(off.inViewport, 0); assert.equal(off.scrollHeight, 180)
  node.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 320, width: 320, height: 0 })
  assert.equal(probeGeometry(node, win).inViewport, 0)
  node.getBoundingClientRect = () => ({ top: 50, bottom: 50, left: 0, right: 320, width: 320, height: 0 })
  assert.equal(probeGeometry(node, win).inViewport, 0)
  assert.deepEqual(probeGeometry(null, win), { present: 0 })
})

test('first render reveals offscreen choices without moving visible or empty lists', async () => {
  const { revealModelChoices } = await import('../client.mjs')
  let calls = 0
  const node = { options: [1], getBoundingClientRect: () => ({ top: 900, bottom: 1020 }), scrollIntoView(options) { assert.equal(options.block, 'nearest'); calls++ } }
  revealModelChoices(node, 700)
  assert.equal(calls, 1)
  node.getBoundingClientRect = () => ({ top: 100, bottom: 220 })
  revealModelChoices(node, 700)
  node.options = []
  revealModelChoices(node, 0)
  assert.equal(calls, 1)
})

test('host Unauthorized errors retain the visible HTTP 401 meaning', async () => {
  const { modelRpcDiagnostics } = await import('../client.mjs')
  const output = {}
  const call = modelRpcDiagnostics({ rpc: { call: async () => { throw Error('Unauthorized') } } }, output)
  await assert.rejects(call('get-model-selection'), /HTTP 401/)
  assert.equal(JSON.parse(output.value).http, 401)
})

test('model merge preserves local references and removes duplicate remote ids', async () => {
  const { mergeModelCandidates } = await import('../client.mjs')
  const local = [{id:'a',ref:'p:a'}, {id:'a',ref:'q:a'}]
  assert.deepEqual(mergeModelCandidates(local,[{id:'a'},{id:'b'},{id:'b'}]), [...local,{id:'b'}])
})

test('navigation titles contain no release number in every locale', async () => {
  const { readFileSync } = await import('node:fs')
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url)))
  for (const locale of Object.values(manifest.i18n)) assert.doesNotMatch(locale.views.model, /Deva|0\.8\./)
  assert.equal(manifest.views.find(view => view.id === 'model').title, '模型')
})

test('discovery errors distinguish approval, auth, missing endpoint, timeout, format and connection', async () => {
  const { discoveryFailure } = await import('../client.mjs')
  for (const [message, pattern] of [['modelTrustedBases',/未批准/],['HTTP 401',/鉴权/],['HTTP 404',/接口不存在/],['RPC_TIMEOUT',/超时/],['Unexpected token in JSON',/JSON/],['ECONNREFUSED',/不可达/]]) assert.match(discoveryFailure(message), pattern)
})

 test('button candidates and collapsed native select have independent geometry', async () => {
  const { candidateGeometryTargets } = await import('../client.mjs')
  const buttons = { getBoundingClientRect: () => ({ top: 50, bottom: 100, left: 0, right: 100, width: 100, height: 50 }) }
  const select = { getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) }
  const win = { innerHeight: 500, innerWidth: 320, getComputedStyle: () => ({}), document: { documentElement: {} } }
  const samples = candidateGeometryTargets({ querySelector: selector => selector === '.deva-model-candidates' ? buttons : select }).map(([element,node]) => ({element,...probeGeometry(node,win)}))
  assert.deepEqual(samples.map(s => [s.element,s.top,s.bottom,s.inViewport]), [['candidate-buttons',50,100,1],['native-select',0,0,0]])
})
