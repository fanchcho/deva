/**
 * 通道参数校验（应用层）：workspace 的 fs:read-dir / fs:write-file / fs:reveal-folder 等 IPC
 * 都以 fs-guard 的受信根为闸门。这里在 net 上验证「参数校验 + 错误分支」：
 *  · 未受信 → assertInside 抛 DENIED（渲染层拿到 reject）；
 *  · 受信后正常读写；
 *  · fs:reveal-folder 对非字符串 / 空串返回 { ok:false } 而不是抛错；
 *  · 超大文件 / 二进制文件不加载正文。
 * Electron 由 test/support/electron-stub.mjs 替身（不启动 GUI），IPC 处理器可直接调用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { invokeHandler, resetIpc } from './support/electron-stub.mjs'
import { tempDir } from './support/tmp.mjs'
import { trustRoot, untrustRoot } from '../src/main/services/fs-guard.ts'
import { registerWorkspaceIpc } from '../src/main/services/workspace.ts'

function setup(t) {
  const root = join(tempDir(t), 'root')
  mkdirSync(root, { recursive: true })
  resetIpc()
  registerWorkspaceIpc(() => null)
  trustRoot(root)
  t.after(() => untrustRoot(root))
  return root
}

test('fs:read-dir：未受信路径被拒绝；受信后列出目录（目录在前，按名排序）', async (t) => {
  const root = setup(t)
  mkdirSync(join(root, 'beta'))
  mkdirSync(join(root, 'alpha'))
  writeFileSync(join(root, 'z.txt'), 'z')

  const entries = await invokeHandler('fs:read-dir', root)
  assert.deepEqual(
    entries.map((e) => `${e.type}:${e.name}`),
    ['dir:alpha', 'dir:beta', 'file:z.txt']
  )

  await assert.rejects(() => invokeHandler('fs:read-dir', join(root, '..')), {
    message: '拒绝访问：路径不在已打开的项目内'
  })
})

test('fs:write-file：受信根内可写；根外拒绝且不落盘', async (t) => {
  const root = setup(t)
  const inside = join(root, 'nested', 'new.txt')
  // 新建文件的父目录尚不存在 → writeFile 会 ENOENT；父目录存在时应成功
  mkdirSync(join(root, 'nested'))
  assert.deepEqual(await invokeHandler('fs:write-file', inside, 'hello'), { ok: true })

  const outside = join(root, '..', 'escape.txt')
  await assert.rejects(() => invokeHandler('fs:write-file', outside, 'x'), {
    message: '拒绝访问：路径不在已打开的项目内'
  })
})

test('fs:reveal-folder：非字符串 / 空串 / 根外 返回 ok:false（不抛错）', async (t) => {
  const root = setup(t)
  assert.deepEqual(await invokeHandler('fs:reveal-folder', 123), { ok: false })
  assert.deepEqual(await invokeHandler('fs:reveal-folder', ''), { ok: false })
  assert.deepEqual(await invokeHandler('fs:reveal-folder', join(root, '..')), { ok: false })
  // 受信但不存在 → stat 失败，同样 ok:false
  assert.deepEqual(await invokeHandler('fs:reveal-folder', join(root, 'missing')), { ok: false })
})

test('fs:read-file：普通文件返回正文；超大文件标 tooLarge；含 NUL 标 binary', async (t) => {
  const root = setup(t)
  writeFileSync(join(root, 'ok.txt'), 'hello 世界')
  assert.deepEqual(await invokeHandler('fs:read-file', join(root, 'ok.txt')), {
    path: join(root, 'ok.txt'),
    content: 'hello 世界'
  })

  // 超过 2MB 上限
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x41))
  const big = await invokeHandler('fs:read-file', join(root, 'big.bin'))
  assert.equal(big.tooLarge, true)
  assert.equal(big.content, '')

  // 小而含 NUL → binary（前 8000 字节内）
  writeFileSync(join(root, 'nul.bin'), Buffer.from([0x41, 0x00, 0x42]))
  const bin = await invokeHandler('fs:read-file', join(root, 'nul.bin'))
  assert.equal(bin.binary, true)
  assert.equal(bin.content, '')
})

test('未注册通道调用会明确报错（防止测试误判为空过）', async (t) => {
  setup(t)
  // invokeHandler 在取处理器时同步抛错，不是 reject
  assert.throws(() => invokeHandler('fs:not-registered'), { message: 'no handler: fs:not-registered' })
})
