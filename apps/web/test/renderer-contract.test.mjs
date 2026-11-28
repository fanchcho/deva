import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function load(file) {
  const result = await build({ entryPoints: [new URL('../../desktop/src/renderer/src/' + file, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [{ name: 'renderer-boundaries', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom|lucide-react)$|\/i18n\/i18n$|\/components\/(ToastProvider|DialogProvider)$/ }, a => ({ path: a.path, namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
      a.path === 'react' ? `export const useState=init=>{const s=globalThis.__renderer,i=s.i++;if(!(i in s.slots))s.slots[i]=typeof init==='function'?init():init;return [s.slots[i],v=>s.slots[i]=typeof v==='function'?v(s.slots[i]):v]};export const useRef=v=>({current:v});export const useEffect=()=>{};export const useMemo=f=>f();export const createContext=v=>({Provider:'Provider',value:v});export const useContext=c=>c.value;` :
      a.path === 'react/jsx-runtime' ? `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';` :
      a.path === 'react-dom' ? 'export const createPortal=n=>n;' :
      a.path === 'lucide-react' ? ['AppWindow','ChevronLeft','ChevronRight','File','FileArchive','FileAudio','FileCode2','FileSpreadsheet','FileText','FileVideo','Folder','Image','Presentation','X'].map(n => `export const ${n}='${n}';`).join('') :
      a.path.endsWith('/i18n/i18n') ? 'export const useI18n=()=>({t:k=>k});' :
      a.path.endsWith('/DialogProvider') ? 'export const useDialog=()=>({confirm:async()=>true});' :
      'export const useToast=()=>({show:v=>globalThis.__renderer.notices.push(v)});'
    }))
  } }] })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
function hooks() { globalThis.__renderer = { i: 0, slots: [], notices: [] } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function render(fn) { globalThis.__renderer.i = 0; return fn() }
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [] }

test('layout writes serialize sibling fields, roll back failed saves and preserve resize controls', async () => {
  const prior = globalThis.window, writes = [], rollbacks = []
  let saved = { sidebarWidth: 300 }, fail = false
  hooks()
  globalThis.window = { deva: { config: { getSync: () => ({ layout: saved }), set: async ({ layout }) => { writes.push(layout); if (fail) throw new Error('disk full'); saved = layout } } } }
  try {
    const m = await load('redesign/resizable.tsx'), save = m.useSaveLayout()
    save({ sidebarWidth: 320 }, v => rollbacks.push(v)); save({ composerHeight: 110 }, v => rollbacks.push(v)); await tick()
    assert.deepEqual(saved, { sidebarWidth: 320, composerHeight: 110 }); assert.equal(writes.length, 2)
    fail = true; save({ sidebarWidth: 480 }, v => rollbacks.push(v)); await tick()
    assert.deepEqual(rollbacks, [saved]); assert.match(globalThis.__renderer.notices[0].message, /disk full/)
    fail = false; save({ composerHeight: undefined }, () => assert.fail('unexpected rollback')); await tick(); assert.deepEqual(saved, { sidebarWidth: 320 })
    assert.equal(m.clampSidebar(900, 1000), 464); assert.equal(m.clampComposer(500, 800), 360)
    const moves = [], commits = [], handle = m.ResizeHandle({ axis: 'x', value: 300, onChange: v => moves.push(v), onCommit: () => commits.push(true) })
    const target = { setPointerCapture: () => {}, releasePointerCapture: () => {} }
    handle.props.onPointerDown({ button: 0, clientX: 10, pointerId: 1, preventDefault: () => {}, currentTarget: target })
    handle.props.onPointerMove({ clientX: 40 }); handle.props.onPointerUp({ pointerId: 1, currentTarget: target })
    assert.deepEqual(moves, [330]); assert.deepEqual(commits, [true])
  } finally { globalThis.window = prior; delete globalThis.__renderer }
})

test('model store preserves colon IDs, custom headers and official provider reset', async () => {
  const prior = globalThis.window, deleted = []; hooks()
  globalThis.window = { deva: { secrets: { delete: async id => deleted.push(id) } } }
  try {
    const m = await load('store/models.tsx'), value = () => render(() => m.ModelsProvider({ children: null })).props.value
    const first = value().providers[0], id = first.id
    value().updateProvider(id, { enabled: true, headers: { 'X-Custom': 'yes' } })
    value().addModel(id, 'qwen3:8b'); value().setActiveModel(id, 'qwen3:8b')
    assert.equal(value().activeModel.model.id, 'qwen3:8b')
    assert.deepEqual(value().providers[0].headers, { 'X-Custom': 'yes' })
    value().updateProvider(id, { headers: {} }); assert.equal('headers' in value().providers[0], false)
    value().removeProvider(id); assert.ok(value().providers.find(p => p.id === id)); assert.equal(value().activeModelId, null); assert.deepEqual(deleted, [id])
    const custom = value().addCustomProvider('Local'); value().removeProvider(custom); assert.equal(value().providers.some(p => p.id === custom), false)
    assert.equal(m.hasUsableModel([{ enabled: true, purpose: 'decision', models: [{ enabled: true }] }]), false)
  } finally { globalThis.window = prior; delete globalThis.__renderer }
})

test('attachment cards retain remove action and extension-based icons; context numbers clamp correctly', async () => {
  hooks()
  try {
    const { FileCard } = await load('redesign/attachments.tsx')
    for (const [ext, color] of [['docx','word'],['xlsx','excel'],['zip','archive'],['apk','program'],['mp4','video'],['wav','audio']]) {
      let removed = false
      const card = FileCard({ name: 'result.' + ext, kind: 'text', size: 100, onRemove: () => { removed = true } })
      assert.equal(card.props.style['--tc'], 'var(--ft-' + color + ')')
      const remove = nodes(card).find(n => typeof n.type === 'function'); const button = remove.type(remove.props)
      button.props.onClick({ stopPropagation: () => {} }); assert.equal(removed, true)
    }
    const m = await load('redesign/context-usage.ts')
    assert.equal(m.usagePercent({ used: 1, window: 10000 }), '<0.1%'); assert.equal(m.usagePercent({ used: 199, window: 1000 }), '19.9%')
    assert.equal(m.usageRatio({ used: 200, window: 100 }), 1); assert.equal(m.usagePercent({ used: null, window: 100 }), '')
    assert.equal(m.approxTokens(128000), '128K')
  } finally { delete globalThis.__renderer }
})
