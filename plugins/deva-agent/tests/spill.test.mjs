import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spillText } from '../lib/spill.mjs'
import { executeTool } from '../lib/tools.mjs'

test('spillText leaves short output untouched', async () => {
  assert.equal(await spillText('短输出', 100), '短输出')
})

test('spillText saves the full text and keeps both ends of the preview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-spill-'))
  try {
    const text = `开头标记\n${'中间内容\n'.repeat(1000)}结尾报错：exit 1`
    const out = await spillText(text, 500, { runtimeDir: dir, label: 'command' })
    assert.match(out, /输出过长（共 \d+ 字符）/)
    assert.match(out, /开头标记/, '预览必须保留开头')
    assert.match(out, /结尾报错：exit 1/, '预览必须保留结尾（报错常在这里）')
    assert.match(out, /中间省略 \d+ 字符/)
    const file = out.match(/完整内容已保存到：(.+)\n/)[1]
    assert.equal(await readFile(file, 'utf8'), text, '落盘内容必须逐字完整')
    assert.match(file, /tool-results\/command-/, '文件名带 label 前缀')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('spillText without a writable runtime directory says the rest was dropped', async () => {
  const out = await spillText('a'.repeat(4000), 100)
  assert.match(out, /未能保存完整内容/)
  assert.match(out, /其余已丢弃/)
  assert.doesNotMatch(out, /已保存到/)
})

test('a spilled command output can be read back with read_file', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deva-spill-ws-'))
  const runtime = await mkdtemp(join(tmpdir(), 'deva-spill-run-'))
  try {
    await writeFile(join(workspace, 'keep.txt'), 'ok\n')
    const out = await executeTool('run_command', {
      command: 'node -e "console.log(\'起始\'); console.log(\'x\'.repeat(40000)); console.log(\'结尾异常\')"',
    }, { workspaceDir: workspace, runtimeDir: runtime })
    assert.match(out, /完整内容已保存到：/)
    const file = out.match(/完整内容已保存到：(.+)\n/)[1]
    const read = await executeTool('read_file', { path: file, limit: 2 }, { workspaceDir: workspace, runtimeDir: runtime })
    assert.match(read, /起始/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(runtime, { recursive: true, force: true })
  }
})
