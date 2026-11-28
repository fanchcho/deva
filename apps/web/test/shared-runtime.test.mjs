import '../../desktop/test/support/register.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const tempRoot = new URL('../../../.tmp/web-runtime-contract/', import.meta.url).pathname
await fs.mkdir(tempRoot, { recursive: true })
const home = await fs.mkdtemp(path.join(tempRoot, 'home-'))
process.env.DEVA_HOME = home
const { executeTool, registerMcpToolNames, unregisterMcpToolNames } = await import('../../desktop/src/main/services/tools.ts')
const { sealedDecision } = await import('../../desktop/src/main/services/sealed.ts')
const todos = await import('../../desktop/src/main/services/todos.ts')
const bus = await import('../../desktop/src/main/services/chat-bus.ts')
const { runToolSearch, usageListingPart } = await import('../../desktop/src/main/services/tool-search.ts')

test('shared Web tools read/write/edit/search/execute/deliver actual files and reject invalid operations', async () => {
  const root = await fs.mkdtemp(path.join(tempRoot, 'workspace-'))
  const ctx = { workspaceRoot: root, sessionId: 'runtime-contract' }
  try {
    assert.ok(!(await executeTool('write_file', { path: 'a.txt', content: 'first\nsecond\n' }, ctx)).isError)
    assert.match((await executeTool('read_file', { path: 'a.txt' }, ctx)).content, /second/)
    assert.ok(!(await executeTool('edit_file', { path: 'a.txt', old_string: 'second', new_string: 'edited' }, ctx)).isError)
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'first\nedited\n')
    assert.match((await executeTool('list_dir', { path: '.' }, ctx)).content, /a\.txt/)
    assert.match((await executeTool('glob', { pattern: '*.txt' }, ctx)).content, /a\.txt/)
    assert.match((await executeTool('grep', { pattern: 'edited', path: '.' }, ctx)).content, /edited/)
    assert.match((await executeTool('run_command', { command: 'printf web-tool-contract' }, ctx)).content, /web-tool-contract/)
    const delivered = await executeTool('present_files', { paths: ['a.txt', 'a.txt'] }, ctx)
    assert.deepEqual(delivered.delivered, [path.join(root, 'a.txt')])
    assert.equal((await executeTool('present_files', { paths: ['missing.txt'] }, ctx)).isError, true)
    assert.equal((await executeTool('edit_file', { path: 'a.txt', old_string: 'absent', new_string: 'x' }, ctx)).isError, true)
    assert.equal((await executeTool('unknown_tool', {}, ctx)).isError, true)
    assert.equal(sealedDecision('read_file').allowed, true)
    assert.equal(sealedDecision('write_file').allowed, true)
    for (const name of ['ask_user', 'memory_write', 'create_task', 'unknown_tool']) assert.equal(sealedDecision(name).allowed, false, name)
    registerMcpToolNames(['fixture__read'])
    assert.equal(sealedDecision('fixture__read').allowed, true)
    unregisterMcpToolNames(['fixture__read'])
    assert.equal(sealedDecision('fixture__read').allowed, false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('todo snapshots, event subscriptions and lazy tool instructions preserve user-visible state', () => {
  const first = todos.applyTodoWrite([], [], 'one', { title: 'work', todos: [{ content: 'step', status: 'in_progress' }] }, 1)
  assert.equal(todos.todoState([first]).active.items[0].status, 'in_progress')
  assert.deepEqual(todos.applyTodoWrite([first], [], 'cancel', { cancel: true }, 2), { cancel: first.listId })
  assert.equal(todos.todoState([first], [first.listId]).active, null)
  const done = todos.applyTodoWrite([first], [], 'two', { todos: [{ content: 'step', status: 'completed' }] }, 3)
  assert.equal(done.done, true)
  assert.equal(todos.todoState([first, done]).active, null)
  assert.equal(todos.foldTodos([first, done]).length, 1)
  for (const [on, publish, value] of [
    ['onStepSaved', 'publishStepSaved', 's'],
    ['onReadChanged', 'publishReadChanged', { sessionId: 's', at: 1, source: 'remote' }],
    ['onRemoteChange', 'publishRemoteChange', { sessionId: 's', kind: 'deleted' }]
  ]) {
    const seen = [], off = bus[on](e => seen.push(e))
    bus[publish](value); off(); bus[publish](value)
    assert.deepEqual(seen, [value])
  }
  const listing = usageListingPart([], ['create_task'])
  assert.ok(listing.text.includes('create_task'))
  assert.equal(usageListingPart([{ role: 'user', content: [listing] }], ['create_task']), null)
  const search = runToolSearch({ names: ['create_task'] }, new Set(['create_task']))
  assert.equal(search.isError, false)
  assert.ok(search.content.includes('create_task'))
})

test.after(async () => { await fs.rm(home, { recursive: true, force: true }) })
