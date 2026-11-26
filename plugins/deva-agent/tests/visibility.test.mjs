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
