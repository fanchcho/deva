import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeTool, resolveSafe } from '../lib/tools.mjs'
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-tools-'))
  await mkdir(join(dir, 'apps/desktop'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'deva-workspace', version: '0.1.15', scripts: { typecheck: 'pnpm -r typecheck' } }))
  await writeFile(join(dir, 'apps/desktop/main.ts'), 'const answer = 42\nexport default answer\n')
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('read_file returns numbered lines and enforces the workspace boundary', async () => {
  const { dir, cleanup } = await sandbox()
  try {
    const content = await executeTool('read_file', { path: 'apps/desktop/main.ts' }, { workspaceDir: dir })
    assert.match(content, /共 3 行/)
    assert.match(content, /1→const answer = 42/)
    await assert.rejects(executeTool('read_file', { path: '../../etc/passwd' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('read_file', { path: '/etc/passwd' }, { workspaceDir: dir }), /路径越界/)
    assert.throws(() => resolveSafe(dir, '..'), /路径越界/)
  } finally { await cleanup() }
})

test('symbolic links cannot escape the workspace', { skip: process.platform === 'win32' && 'Windows 创建文件符号链接需要额外权限' }, async () => {
  const { dir, cleanup } = await sandbox()
  const outside = await mkdtemp(join(tmpdir(), 'deva-outside-'))
  try {
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(outside, join(dir, 'escape-dir'), 'dir')
    await symlink(join(outside, 'secret.txt'), join(dir, 'secret-link.txt'), 'file')
    await symlink(join(outside, 'missing.txt'), join(dir, 'broken-link.txt'), 'file')

    // 读：文件链接、目录链接、断链都必须拒绝。
    await assert.rejects(executeTool('read_file', { path: 'secret-link.txt' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('read_file', { path: 'escape-dir/secret.txt' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('read_file', { path: 'broken-link.txt' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('list_dir', { path: 'escape-dir' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('grep', { pattern: 'secret', path: 'escape-dir' }, { workspaceDir: dir }), /路径越界/)
    // 写：不能顺着链接写到工作区外，也不能通过链接目录新建文件。
    await assert.rejects(executeTool('write_file', { path: 'secret-link.txt', content: 'pwn' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('edit_file', { path: 'secret-link.txt', old_string: 'secret', new_string: 'pwn' }, { workspaceDir: dir }), /路径越界/)
    await assert.rejects(executeTool('write_file', { path: 'escape-dir/new.txt', content: 'pwn' }, { workspaceDir: dir }), /路径越界/)
    assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'secret\n')

    // 工作区内部互指的链接仍然可用。
    await symlink(join(dir, 'apps/desktop/main.ts'), join(dir, 'inside-link.ts'), 'file')
    const ok = await executeTool('read_file', { path: 'inside-link.ts' }, { workspaceDir: dir })
    assert.match(ok, /const answer = 42/)
  } finally {
    await rm(outside, { recursive: true, force: true })
    await cleanup()
  }
})

test('write_file + edit_file keep the file consistent and reject ambiguous edits', async () => {
  const { dir, cleanup } = await sandbox()
  try {
    await executeTool('write_file', { path: 'notes/todo.md', content: 'a\na\n' }, { workspaceDir: dir })
    assert.equal(await readFile(join(dir, 'notes/todo.md'), 'utf8'), 'a\na\n')
    await assert.rejects(executeTool('edit_file', { path: 'notes/todo.md', old_string: 'a', new_string: 'b' }, { workspaceDir: dir }), /出现 2 次/)
    const applied = await executeTool('edit_file', { path: 'notes/todo.md', old_string: 'a\na', new_string: 'b\nc' }, { workspaceDir: dir })
    assert.match(applied, /替换 1 处/)
    assert.equal(await readFile(join(dir, 'notes/todo.md'), 'utf8'), 'b\nc\n')
    await assert.rejects(executeTool('edit_file', { path: 'notes/todo.md', old_string: 'zzz', new_string: 'y' }, { workspaceDir: dir }), /没有找到/)
  } finally { await cleanup() }
})

test('list_dir, glob and grep stay inside the workspace and skip build output', async () => {
  const { dir, cleanup } = await sandbox()
  try {
    await mkdir(join(dir, 'node_modules/pkg'), { recursive: true })
    await writeFile(join(dir, 'node_modules/pkg/index.js'), 'const answer = 1\n')
    const listing = await executeTool('list_dir', { path: '.' }, { workspaceDir: dir })
    assert.match(listing, /^d .* apps$/m)
    assert.match(listing, /^- .* package\.json$/m)
    const found = await executeTool('glob', { pattern: 'apps/**/*.ts' }, { workspaceDir: dir })
    assert.equal(found.trim(), 'apps/desktop/main.ts')
    const hits = await executeTool('grep', { pattern: 'answer', include: '*.ts' }, { workspaceDir: dir })
    assert.match(hits, /apps\/desktop\/main\.ts:1: const answer = 42/)
    assert.doesNotMatch(hits, /node_modules/)
    // 开头 4 KiB 内出现 NUL 的文件按二进制跳过，不把 needle 当命中。
    await writeFile(join(dir, 'image.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('needle')]))
    const text = await executeTool('grep', { pattern: 'needle' }, { workspaceDir: dir })
    assert.doesNotMatch(text, /image\.bin/)
  } finally { await cleanup() }
})

test('run_command reports exit codes instead of throwing, and respects timeout', async () => {
  const { dir, cleanup } = await sandbox()
  try {
    const ok = await executeTool('run_command', { command: 'pwd && node -e "console.log(1+1)"' }, { workspaceDir: dir })
    assert.match(ok, /exit=0/)
    assert.match(ok, /2/)
    const failed = await executeTool('run_command', { command: 'echo boom >&2; exit 3' }, { workspaceDir: dir })
    assert.match(failed, /exit=3/)
    assert.match(failed, /boom/)
  } finally { await cleanup() }
})

test('run_command timeout kills the whole process group', { skip: process.platform === 'win32' && 'Windows 走 taskkill，不在本用例覆盖' }, async () => {
  const { dir, cleanup } = await sandbox()
  try {
    const out = await executeTool('run_command', {
      command: '(sleep 1.2; echo leaked > leaked.txt) & sleep 5',
      timeout_ms: 1000,
    }, { workspaceDir: dir })
    assert.match(out, /exit=timeout/)
    assert.match(out, /已终止进程组/)
    // 只杀 bash 时，后台子 shell 会在 1.2s 后写下 leaked.txt。
    await new Promise(resolve => setTimeout(resolve, 1000))
    await assert.rejects(readFile(join(dir, 'leaked.txt')), { code: 'ENOENT' })
  } finally { await cleanup() }
})

test('deva_project summarizes version, scripts and git state', async () => {
  const { dir, cleanup } = await sandbox()
  try {
    const facts = { version: '0.1.15', desktopVersion: '0.1.15', branch: 'main', commit: 'abc1234', scripts: ['typecheck: pnpm -r typecheck'], docs: ['README.md'], summary: '' }
    const summary = await executeTool('deva_project', {}, { workspaceDir: dir, facts })
    assert.match(summary, /workspace 版本：0\.1\.15/)
    assert.match(summary, /git：main @ abc1234/)
    assert.match(summary, /未提交改动/)
  } finally { await cleanup() }
})

test('read_file can read back files spilled into this run runtime directory', async () => {
  const { dir, cleanup } = await sandbox()
  const runDir = await mkdtemp(join(tmpdir(), 'deva-run-'))
  try {
    await mkdir(join(runDir, 'web'), { recursive: true })
    const spilled = join(runDir, 'web', 'web-1.txt')
    await writeFile(spilled, '第一行\n第二行\n')
    const content = await executeTool('read_file', { path: spilled }, { workspaceDir: dir, runtimeDir: runDir })
    assert.match(content, /2→第二行/)
    // 运行目录之外仍然越界：只多开这一根，不是放开绝对路径。
    await assert.rejects(executeTool('read_file', { path: '/etc/passwd' }, { workspaceDir: dir, runtimeDir: runDir }), /路径越界/)
    await assert.rejects(executeTool('read_file', { path: join(runDir, '..', 'escape.txt') }, { workspaceDir: dir, runtimeDir: runDir }), /路径越界/)
    // 写入类工具不享受这条额外通道。
    await assert.rejects(executeTool('write_file', { path: spilled, content: 'x' }, { workspaceDir: dir, runtimeDir: runDir }), /路径越界/)
  } finally {
    await cleanup()
    await rm(runDir, { recursive: true, force: true })
  }
})

test('grep can search a spilled tool result in the runtime directory', async () => {
  const { dir, cleanup } = await sandbox()
  const runDir = await mkdtemp(join(tmpdir(), 'deva-run-'))
  try {
    const spilled = join(runDir, 'tool-results', 'command-1.txt')
    await mkdir(join(runDir, 'tool-results'), { recursive: true })
    await writeFile(spilled, '准备通过\n编译失败：找不到模块\n准备通过\n')
    const hits = await executeTool('grep', { pattern: '编译失败', path: join(runDir, 'tool-results') }, { workspaceDir: dir, runtimeDir: runDir })
    assert.match(hits, /command-1\.txt:2: 编译失败：找不到模块/)
    // 运行目录之外仍越界。
    await assert.rejects(executeTool('grep', { pattern: 'x', path: '/etc' }, { workspaceDir: dir, runtimeDir: runDir }), /路径越界/)
  } finally {
    await cleanup()
    await rm(runDir, { recursive: true, force: true })
  }
})

test('unknown tools and missing workspace fail loudly', async () => {
  await assert.rejects(executeTool('nope', {}, { workspaceDir: '/tmp' }), /未知工具/)
  await assert.rejects(executeTool('read_file', { path: 'x' }, {}), /没有工作区/)
})
