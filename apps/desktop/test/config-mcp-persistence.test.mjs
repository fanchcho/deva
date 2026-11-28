import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hasSecret } from '../src/main/services/secrets.ts'
import { getConfig, getDevaHome, registerConfigIpc } from '../src/main/services/config.ts'
import { invokeHandler } from './support/electron-stub.mjs'
import { upsertServer, deleteServer, getServerConfig, setEnabled, isEnabled } from '../src/main/services/mcp-config.ts'

registerConfigIpc()
const home = getDevaHome()
const configFile = join(home, 'config.json')
const mcpFile = join(home, 'mcp.json')
const input = { id: 'qa', name: 'old', transport: 'stdio', command: 'node', enabled: false }

test('F02 IPC 写失败保留磁盘/内存，成功后读回一致', async () => {
  invokeHandler('config:set', { chatFontSize: 'md', closeToTray: true })
  const before = readFileSync(configFile, 'utf8')
  mkdirSync(`${configFile}.lock`)
  try {
    await assert.rejects(async () => invokeHandler('config:set', { chatFontSize: 'xl' }), /配置正在被其它进程修改/)
    assert.equal(getConfig().chatFontSize, 'md')
    assert.equal(readFileSync(configFile, 'utf8'), before)
    const reloaded = await import(`../src/main/services/config.ts?reload=${Date.now()}`)
    assert.equal(reloaded.getConfig().chatFontSize, 'md')
    console.log('F02 exclusive-lock: IPC rejected; memory=md, disk bytes intact, fresh module reload=md')
  } finally { rmSync(`${configFile}.lock`, { recursive: true }) }
  invokeHandler('config:set', { chatFontSize: 'lg' })
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).chatFontSize, 'lg')
})

test('F03 新增/修改/删除失败保留旧记录，成功读回一致，启用态失败也回滚', async () => {
  upsertServer(input)
  const before = readFileSync(mcpFile, 'utf8')
  const secretsFile = join(home, 'secrets.json')
  const keyId = 'mcp:qa:token'
  writeFileSync(secretsFile, JSON.stringify({ [keyId]: randomBytes(32).toString('base64') }))
  mkdirSync(`${mcpFile}.lock`)
  try {
    for (const [name, action] of [
      ['add', () => upsertServer({ ...input, id: 'new' })],
      ['update', () => upsertServer({ ...input, name: 'changed' })],
      ['delete', () => deleteServer('qa')]
    ]) {
      await assert.rejects(async () => action(), /配置正在被其它进程修改/)
      assert.equal(readFileSync(mcpFile, 'utf8'), before)
      assert.equal(getServerConfig('qa').name, 'old')
      assert.equal(getServerConfig('new'), null)
      console.log(`F03 ${name}: exclusive-lock rejected; original mcp.json bytes intact; old record read back`)
    }
  } finally { rmSync(`${mcpFile}.lock`, { recursive: true }) }
  mkdirSync(`${configFile}.lock`)
  try {
    assert.throws(() => upsertServer({ ...input, name: 'changed', enabled: true }), /配置正在被其它进程修改/)
    assert.equal(getServerConfig('qa').name, 'old')
    assert.throws(() => setEnabled('qa', true), /配置正在被其它进程修改/)
    assert.equal(isEnabled('qa'), false)
    await assert.rejects(() => deleteServer('qa'), /配置正在被其它进程修改/)
    assert.equal(getServerConfig('qa').name, 'old')
    console.log('F03 config.json failure: upsert/delete compensated; enable memory unchanged')
  } finally { rmSync(`${configFile}.lock`, { recursive: true }) }
  const saved = upsertServer({ ...input, name: 'changed', enabled: true })
  assert.deepEqual(getServerConfig('qa'), saved)
  assert.equal(isEnabled('qa'), true)
  upsertServer({ ...input, id: 'new' })
  assert.equal(getServerConfig('new').name, 'old')
  const beforeDelete = readFileSync(mcpFile, 'utf8')
  const beforeSecret = readFileSync(secretsFile, 'utf8')
  mkdirSync(`${secretsFile}.lock`)
  try {
    await assert.rejects(() => deleteServer('qa'), /配置正在被其它进程修改/)
    assert.equal(readFileSync(mcpFile, 'utf8'), beforeDelete)
    assert.deepEqual(getServerConfig('qa'), saved)
    assert.equal(isEnabled('qa'), true)
    assert.equal(await hasSecret(keyId), true)
    assert.equal(readFileSync(secretsFile, 'utf8'), beforeSecret)
    console.log('F03 secrets.json failure: delete rejected and MCP bytes, enablement, secret state preserved')
  } finally { rmSync(`${secretsFile}.lock`, { recursive: true }) }
  await deleteServer('qa')
  assert.equal(getServerConfig('qa'), null)
  assert.equal(await hasSecret(keyId), false)
  console.log('F03 success: add/update round-trip matches; delete readback=null')
})
