import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'esbuild'

const mobile = new URL('../../desktop/src/mobile/', import.meta.url).pathname
globalThis.window = { isSecureContext: false, matchMedia: () => ({ matches: false }) }
globalThis.location = { protocol: 'http:', href: 'http://localhost/', hash: '' }
async function modules() {
  const icons = new Set()
  for (const dir of [mobile, mobile + '../renderer/src/components/']) {
    for (const file of await fs.readdir(dir)) {
      if (!/\.tsx?$/.test(file)) continue
      const source = await fs.readFile(dir + file, 'utf8')
      for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) {
        for (const name of m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(x => /^[A-Za-z][A-Za-z0-9]*$/.test(x))) icons.add(name)
      }
    }
  }
  const files = ['cache', 'outbox', 'session-ops', 'home', 'settings', 'cards', 'chat-menu', 'files', 'avatar', 'onboard', 'strings', 'drawer', 'chat', 'App']
  const result = await build({
    stdin: { contents: files.map((f, i) => `export * as m${i} from './${f}'`).join(';'), resolveDir: mobile },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'mobile-hooks', setup(b) {
      b.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react|react-markdown|remark-gfm)$/ }, a => ({ path: a.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
        a.path === 'react' ? `export const useState=init=>{const s=globalThis.__mobileHooks,i=s.i++;if(!(i in s.slots))s.slots[i]=typeof init==='function'?init():init;return [s.slots[i],v=>{s.slots[i]=typeof v==='function'?v(s.slots[i]):v}]};export const useRef=v=>{const s=globalThis.__mobileHooks,i=s.i++;return s.slots[i]??=( {current:v})};export const useEffect=()=>{};export const useLayoutEffect=()=>{};export const useCallback=f=>f;export const useMemo=f=>f();export const memo=f=>f;export const useId=()=>"id";export const createContext=v=>({_currentValue:v});export const useContext=c=>c._currentValue;export const forwardRef=f=>f;export class Component {constructor(props){this.props=props}};export const Fragment='fragment';export const createElement=(type,props,...children)=>({type,props:{...props,children}});export default {createElement,Fragment};` :
        a.path === 'react/jsx-runtime' ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' :
        a.path === 'lucide-react' ? [...icons].map(n => `export const ${n}='${n}';`).join('') :
        a.path === 'react-markdown' ? 'export default "Markdown";' : 'export default ()=>{};'
      }))
    } }]
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
function hooks() { globalThis.__mobileHooks = { i: 0, slots: [] } }
function render(fn) { globalThis.__mobileHooks.i = 0; return fn() }
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function expand(tree) {
  if (!tree || typeof tree !== 'object') return tree
  if (Array.isArray(tree)) return tree.map(expand)
  if (typeof tree.type === 'function') return expand(tree.type.prototype?.render ? new tree.type(tree.props).render() : tree.type(tree.props))
  return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('mobile cached history upgrades legacy replies, keeps complete tails and isolates desks', async () => {
  const store = new Map(), previous = globalThis.indexedDB
  const request = result => { const r = { result }; queueMicrotask(() => r.onsuccess?.()); return r }
  globalThis.indexedDB = { open: () => request({ transaction: () => ({ objectStore: () => ({ get: k => request(structuredClone(store.get(k))), put: (v, k) => store.set(k, structuredClone(v)), delete: k => store.delete(k) }) }) }) }
  try {
    const { m0: cache } = await modules()
    cache.saveSnapshot('one', { sessions: [{ id: 's' }], personas: [], tasks: [{ id: 't' }], syncedAt: 5 })
    await tick()
    assert.equal((await cache.loadSnapshot('one')).tasks[0].id, 't')
    assert.equal(await cache.loadSnapshot('two'), undefined)
    store.set('one:h:legacy', { messages: [{ id: '0', role: 'assistant', text: 'old', notes: ['note'], files: [{ name: 'file' }] }], start: 0, total: 1 })
    assert.deepEqual((await cache.loadHistory('one', 'legacy')).messages[0].parts.map(p => p.k), ['text', 'file', 'note'])
    for (let i = 0; i < 31; i++) await cache.saveHistory('one', 's' + i, { messages: [{ id: '0.1', role: 'user', text: 'partial' }, { id: '1', role: 'user', text: 'complete' }], start: 0, total: 2 })
    assert.equal(await cache.loadHistory('one', 's0'), undefined)
    assert.equal((await cache.loadHistory('one', 's30')).start, 1)
    await cache.dropDesk('one')
    assert.equal(await cache.loadSnapshot('one'), undefined)
    assert.equal(await cache.loadHistory('one', 's30'), undefined)
  } finally { globalThis.indexedDB = previous }
})

test('mobile optimistic session actions roll back errors; outbox retries and reconciles exactly once', async () => {
  const { m1: out, m2: sessions } = await modules()
  hooks()
  const state = { current: new Map([['s', { id: 's', title: 'chat', busy: false }]]) }, calls = [], notices = []
  let ok = false
  const link = { current: { deskId: 'd', result: async fn => { calls.push(fn('rid')); return { ok, message: 'denied' } }, createSession: () => ({ sid: 'new', done: Promise.resolve(null) }), models: async () => [{ ref: 'p:m' }], sendText: async () => ({ ok, message: 'denied', at: '1' }) } }
  const ops = render(() => sessions.useSessionOps(link, state, fn => { state.current = fn(state.current) }, (...v) => notices.push(v)))
  assert.equal(ops.create('general'), 'new')
  assert.ok(ops.fromServer([]).has('new'))
  await ops.archive('s', true); assert.equal(state.current.get('s').archived, undefined)
  await ops.remove('s'); assert.ok(state.current.has('s'))
  assert.equal(await ops.setModel('s', 'p:m'), false)
  ok = true
  await ops.archive('s', true); assert.equal(state.current.get('s').archived, true)
  assert.equal(await ops.setModel('s', 'p:m'), true)
  assert.deepEqual(await ops.loadModels(), [{ ref: 'p:m' }])
  await ops.remove('s'); assert.equal(state.current.has('s'), false)
  assert.deepEqual(calls.map(c => c.t), ['archive', 'delete', 'set_model', 'archive', 'set_model', 'delete'])
  hooks(); ok = false
  const history = { current: new Map() }
  const current = () => render(() => out.useOutbox(link, history, (...v) => notices.push(v)))
  current().send('s', 'hello', [], false); await tick()
  const failed = current().outbox.get('s')[0]
  assert.equal(failed.state, 'failed')
  ok = true; current().retry('s', failed.id); await tick()
  assert.equal(current().outbox.get('s')[0].state, 'sent')
  current().reconcile('s', { messages: [{ id: '1', role: 'user', text: 'hello' }], start: 0, total: 2 }, false)
  assert.equal(current().outbox.size, 0)
  current().reconcile('s', { messages: [{ id: '1', role: 'user', text: 'hello' }], start: 0, total: 2 }, false)
  assert.equal(current().outbox.size, 0)
})

test('mobile component actions retain plan confirmation, file opening, filtering, archive and settings navigation', async () => {
  globalThis.window = { isSecureContext: false, matchMedia: () => ({ matches: false }) }
  globalThis.location = { protocol: 'http:', href: 'http://localhost/', hash: '' }
  const api = await modules(), calls = []
  try {
    hooks()
    const plan = nodes(expand(api.m5.PromptCard({ view: { kind: 'plan', key: 'p', plan: 'actual plan', state: 'open' }, onAction: async (key, value) => { calls.push([key, value]); return null } })))
    const approve = plan.find(n => n.type === 'button' && String(n.props.children).includes('批准'))
    assert.ok(approve); approve.props.onClick(); await tick()
    assert.deepEqual(calls[0], ['p', { k: 'plan', key: 'p', d: 'approve' }])
    const file = api.m7.FileCard({ file: { name: 'result.txt' }, onOpen: () => calls.push('open-file') })
    file.props.onClick(); assert.equal(calls.at(-1), 'open-file')
    assert.equal(api.m3.matchFilter({ hidden: true }, { kind: 'all' }), false)
    assert.equal(api.m3.matchFilter({ archived: true }, { kind: 'all' }), false)
    assert.equal(api.m3.matchFilter({ archived: true }, { kind: 'archived' }), true)
    assert.equal(api.m3.ownerOf({}), 'general')
    hooks()
    const store = { personas: new Map(), tasks: [], ready: true, back: () => {}, ops: { archive: (...v) => calls.push(v) } }
    const menu = nodes(api.m6.ChatMenu({ store, s: { id: 's', title: 'chat' }, onClose: () => {} }))
    menu.find(n => n.type === 'button' && n.props.className === 'act').props.onClick()
    assert.deepEqual(calls.at(-1), ['s', true])
    hooks()
    const settings = nodes(api.m4.Settings({ store: { ...store, desks: [{ deskId: 'other', computer: 'other' }], phase: { kind: 'ready' }, switchDesk: id => calls.push(id), notify: 'unsupported', theme: 'system', textSize: 'md' } }))
    settings.find(n => n.type === 'button' && n.props.className === 'cell').props.onClick()
    assert.equal(calls.at(-1), 'other')
    hooks()
    const welcome = nodes(api.m9.StatePage({ kind: 'welcome', onScan: () => calls.push('scan') }))
    assert.ok(!welcome.some(n => n.type === 'button'), 'HTTP page must explain system camera rather than expose an unusable camera control')
    assert.ok(api.m10.fmtBytes(1024).includes('KB'))
  } finally { delete globalThis.window; delete globalThis.location; delete globalThis.__mobileHooks }
})
