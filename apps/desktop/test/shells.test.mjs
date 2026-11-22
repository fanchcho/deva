/**
 * shell 探测与解析：终端与 run_command 都靠它决定跑哪个 shell。
 *
 * 关键约定：渲染层传来的 shellId 是外部输入，命不中必须落到默认 profile 再兜底，
 * 不能原样透传成路径（否则等于让渲染层指定任意可执行文件）。
 * 探测结果在模块级缓存，所以这里只断言「不变量」而不是具体清单（清单随机器而变）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { detectShells, resolveShell } from '../src/main/services/shells.ts'

test('探测结果非空，且每项字段完整', () => {
  const shells = detectShells()
  assert.ok(shells.length > 0)
  for (const s of shells) {
    assert.equal(typeof s.id, 'string')
    assert.ok(s.id.length > 0)
    assert.equal(typeof s.label, 'string')
    assert.ok(s.label.length > 0)
    assert.equal(typeof s.path, 'string')
    assert.ok(Array.isArray(s.args))
  }
})

test('探测到的 shell 路径都真实存在（兜底项除外）', () => {
  const shells = detectShells()
  const probing = shells.filter((s) => s.path.startsWith('/'))
  assert.ok(probing.length > 0, 'posix 上至少应探到一个绝对路径 shell')
  for (const s of probing) assert.ok(existsSync(s.path), `${s.id} → ${s.path}`)
})

test('最多一个默认项；有默认项时它必须存在', () => {
  const shells = detectShells()
  const defaults = shells.filter((s) => s.isDefault)
  assert.ok(defaults.length <= 1, `默认项=${defaults.map((s) => s.id).join(',')}`)
  for (const s of defaults) assert.ok(existsSync(s.path), s.path)
})

test('id 唯一（渲染层按 id 选中，重名会选错）', () => {
  const ids = detectShells().map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, ids.join(','))
})

test('resolveShell(null) 返回存在的默认 shell', () => {
  const r = resolveShell(null)
  assert.equal(typeof r.path, 'string')
  assert.ok(r.path.length > 0)
  assert.ok(Array.isArray(r.args))
  if (r.path.startsWith('/')) assert.ok(existsSync(r.path), r.path)
})

test('resolveShell 命中已知 id 时返回该 shell', () => {
  const first = detectShells()[0]
  const r = resolveShell(first.id)
  assert.equal(r.path, first.path)
  assert.deepEqual(r.args, first.args)
})

test('resolveShell 对伪造 / 空 / 路径式 id 走兜底，不把它当可执行文件', () => {
  for (const bad of ['', 'no-such-shell', '/bin/evil', '../../bin/sh', 'A'.repeat(64)]) {
    const r = resolveShell(bad)
    assert.notEqual(r.path, bad, `不应原样透传: ${bad}`)
    assert.ok(r.path.length > 0)
    assert.ok(Array.isArray(r.args))
  }
})
