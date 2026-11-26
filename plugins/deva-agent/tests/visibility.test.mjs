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
