/**
 * run_command 用哪个 shell 执行。
 *
 * 这个模块只剩「选 shell」一件事（危险命令名单在 2026-10-09 已整体移除），但它决定了
 * 命令怎么被解释：交互式 flag（-i / --login -i）会挂起一次性执行，所以必须与终端那边分开。
 * 结果是模块级缓存，且平台分支只在 win32 生效，所以这里断言不变量 + 缓存行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolveExecShell } from '../src/main/services/exec-policy.ts'

test('返回值字段完整：file 字符串、args 数组、useShell 布尔', () => {
  const s = resolveExecShell()
  assert.equal(typeof s.file, 'string')
  assert.ok(Array.isArray(s.args))
  assert.equal(typeof s.useShell, 'boolean')
  // useShell=false 时必须给出可执行文件；useShell=true 时 file 可以为空（交给 Node 的 shell）
  if (!s.useShell) {
    assert.ok(s.file.length > 0, 'useShell=false 却没给 shell 路径')
    assert.ok(existsSync(s.file), `${s.file} 不存在`)
  }
})

test('不启用交互 flag（-i / --login -i 会挂起一次性执行）', () => {
  const { args } = resolveExecShell()
  assert.ok(!args.includes('-i'), `args=${args.join(' ')}`)
  assert.ok(!(args.includes('--login') && args.includes('-i')), `args=${args.join(' ')}`)
})

test('posix 上用 -c 传命令；cmd 风格则交给 shell:true', () => {
  const s = resolveExecShell()
  if (process.platform !== 'win32' && !s.useShell) {
    assert.deepEqual(s.args, ['-c'])
    assert.match(s.file, /[\\/](bash|sh)$/)
  }
})

test('同一进程内结果稳定（模块级缓存，端口/终端复用同一份配置）', () => {
  const a = resolveExecShell()
  const b = resolveExecShell()
  assert.equal(a, b, '应返回同一个缓存对象')
})
