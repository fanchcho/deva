/**
 * 记忆服务的通道参数校验与错误分支（memory:list / write / delete / clear 的 scope 参数）。
 *
 * 关键约定：scope 传坏参数必须**抛错**而不是静默回落全局——否则「清空项目记忆」会变成清空全局记忆。
 * 同时覆盖 memoryPath / projectMemoryKey / scopeKindOfId / memoryTypeLabel 的确定性行为。
 * Electron 由替身提供（本模块只在 registerMemoryIpc 时用到 ipcMain）；DEVA_HOME 由脚本指向临时目录。
 */
import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { invokeHandler, resetIpc } from './support/electron-stub.mjs'
import { tempDir } from './support/tmp.mjs'
import {
  GLOBAL_SCOPE,
  MEMORY_BODY_MAX,
  MEMORY_MAX_ENTRIES,
  MEMORY_TITLE_MAX,
  MEMORY_TYPES,
  isMemoryType,
  memoryLimits,
  memoryPath,
  memoryTypeLabel,
  projectMemoryKey,
  registerMemoryIpc,
  scopeKindOfId,
  scopeLabel
} from '../src/main/services/memory.ts'

/**
 * DEVA_HOME 在 config.ts 里是模块级缓存（首次调用即固定）；register.mjs 已在加载被测模块前把它
 * 指向独立临时目录，这里直接复用同一个目录做断言。
 */
const HOME = process.env.DEVA_HOME

function setup() {
  resetIpc()
  registerMemoryIpc()
  return HOME
}

test('memory:list：合法 scope 返回快照', () => {
  setup()
  const snap = invokeHandler('memory:list', undefined)
  assert.ok(Array.isArray(snap.entries))
  assert.equal(typeof snap.used, 'number')
  assert.equal(snap.maxTitle, MEMORY_TITLE_MAX)
  assert.equal(snap.maxBody, MEMORY_BODY_MAX)
})

test('memory:list：合法项目 / 角色 scope 可用', () => {
  setup()
  const project = invokeHandler('memory:list', '/tmp/some-project')
  assert.ok(Array.isArray(project.entries))
  const role = invokeHandler('memory:list', { personaId: 'abc-123' })
  assert.ok(Array.isArray(role.entries))
})

test('memory:list：非法 scope 抛错（不能静默回落全局）', () => {
  setup()
  for (const bad of [123, true, '', '   ', {}, { personaId: '' }, { personaId: '../evil' }, { personaId: '..' }, ['x']]) {
    assert.throws(() => invokeHandler('memory:list', bad), { message: 'memory: invalid scope' }, `应拒绝: ${JSON.stringify(bad)}`)
  }
})

test('memory:delete / clear：非法 scope 同样抛错，合法 scope 返回快照', () => {
  setup()
  assert.throws(() => invokeHandler('memory:delete', 'whatever', 42), { message: 'memory: invalid scope' })
  assert.throws(() => invokeHandler('memory:clear', { personaId: 'a/b' }), { message: 'memory: invalid scope' })
  const cleared = invokeHandler('memory:clear', undefined)
  assert.equal(cleared.ok, true)
  assert.ok(Array.isArray(cleared.snapshot.entries))
})

test('memory:write：坏 scope 抛错；空输入新增的结果是明确的失败码而不是崩溃', () => {
  setup()
  assert.throws(() => invokeHandler('memory:write', { title: 'x' }, undefined, 7), {
    message: 'memory: invalid scope'
  })
  const r = invokeHandler('memory:write', {}, undefined, undefined)
  assert.equal(r.ok, false)
  assert.equal(typeof r.code, 'string')
})

test('memoryPath：三层作用域分别落在不同文件', () => {
  assert.equal(memoryPath(GLOBAL_SCOPE), join(HOME, 'memory.json'))
  assert.equal(memoryPath({ kind: 'role', personaId: 'abc' }), join(HOME, 'personas', 'memory', 'abc.json'))
  const project = memoryPath({ kind: 'project', root: '/tmp/project-x' })
  assert.match(project, /projects\/[0-9a-f]{24}\/memory\.json$/)
})

test('projectMemoryKey：稳定、24 位十六进制、同一路径不同写法一致', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'proj'))
  const a = projectMemoryKey(join(dir, 'proj'))
  const b = projectMemoryKey(`${join(dir, 'proj')}/`)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{24}$/)
  assert.notEqual(a, projectMemoryKey(join(dir, 'other')))
})

test('scopeKindOfId：前缀决定类别', () => {
  assert.equal(scopeKindOfId('p_abc'), 'project')
  assert.equal(scopeKindOfId('r_abc'), 'role')
  assert.equal(scopeKindOfId('abc'), 'global')
})

test('isMemoryType / memoryTypeLabel / scopeLabel', () => {
  for (const t of MEMORY_TYPES) {
    assert.equal(isMemoryType(t), true)
    assert.equal(typeof memoryTypeLabel(t), 'string')
    assert.ok(memoryTypeLabel(t).length > 0)
  }
  assert.equal(isMemoryType('unknown'), false)
  assert.equal(isMemoryType(null), false)
  assert.equal(scopeLabel(GLOBAL_SCOPE), '全局记忆')
})

test('memoryLimits：项目记忆上限更小', () => {
  const global = memoryLimits(GLOBAL_SCOPE)
  const project = memoryLimits({ kind: 'project', root: '/tmp/x' })
  assert.equal(global.maxEntries, MEMORY_MAX_ENTRIES)
  assert.ok(project.maxEntries < global.maxEntries)
})

test('读取已存在的全局记忆文件：损坏 JSON 不抛错（视为空）', () => {
  mkdirSync(HOME, { recursive: true })
  writeFileSync(join(HOME, 'memory.json'), '{ broken json')
  resetIpc()
  registerMemoryIpc()
  const snap = invokeHandler('memory:list', undefined)
  assert.ok(Array.isArray(snap.entries))
  assert.ok(existsSync(join(HOME, 'memory.json')))
})
