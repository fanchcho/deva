import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDesktopModels, readDesktopRoute, selectDesktopModel } from '../lib/desktop-models.mjs'
import { readCustomModel, readModelSelection, saveModelSelection } from '../lib/model-selection.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()

const configFor = dir => ({ sharedDevaHome: join(dir, '.deva'), modelTrustedBases: [] })
const configFile = dir => join(dir, '.deva', 'config.json')

function memoryStorage(records = new Map(), prefix = 'root') {
  return {
    namespace: (...parts) => memoryStorage(records, `${prefix}/${parts.join('/')}`),
    get: async key => records.get(`${prefix}#${key}`),
    set: async (key, value) => { records.set(`${prefix}#${key}`, value) },
    async delete(key) { records.delete(`${prefix}#${key}`) },
  }
}
const runFor = (config, userId = 1) => ({ config, identity: { userId, profile: 'default' }, state: { profile: memoryStorage() } })

async function fixture(dir) {
  await mkdir(join(dir, '.deva'), { recursive: true })
  await writeFile(configFile(dir), JSON.stringify({
    theme: 'dark',
    models: {
      activeModelId: 'alpha:a1',
      activeEffort: 'default',
      providers: [
        { id: 'alpha', name: 'Alpha', kind: 'custom', adapter: 'openai', apiHost: 'https://alpha.example/v1', enabled: true, models: [{ id: 'a1', name: 'A1', enabled: true }, { id: 'a2', name: 'A2', enabled: true }] },
        { id: 'beta', name: 'Beta', kind: 'custom', adapter: 'openai', apiHost: 'https://beta.example/v1', enabled: true, models: [{ id: 'b1', name: 'B1', enabled: true }] },
      ],
    },
    personas: { enabled: { general: true } },
  }, null, 2), 'utf8')
}

test('读取桌面模型：providers/activeModelId，默认路由与其它字段完整保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-models-'))
  try {
    await fixture(dir)
    const view = listDesktopModels(configFor(dir))
    assert.equal(view.activeModelId, 'alpha:a1')
    assert.deepEqual(view.active, { providerId: 'alpha', modelId: 'a1', baseUrl: 'https://alpha.example/v1', modelName: 'a1' })
    assert.deepEqual(view.providers.map(p => p.id), ['alpha', 'beta'])
    const route = readDesktopRoute(configFor(dir))
    assert.deepEqual(route, { baseUrl: 'https://alpha.example/v1', modelName: 'a1', providerId: 'alpha', modelId: 'a1' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('插件选桌面 provider/model：写 activeModelId，其它 provider 与顶层键不动', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-select-'))
  try {
    await fixture(dir)
    const view = selectDesktopModel(configFor(dir), { providerId: 'beta', modelId: 'b1' })
    assert.equal(view.activeModelId, 'beta:b1')
    const cfg = JSON.parse(await readFile(configFile(dir), 'utf8'))
    assert.equal(cfg.theme, 'dark')
    assert.deepEqual(cfg.personas, { enabled: { general: true } })
    assert.deepEqual(cfg.models.providers.map(p => [p.id, p.apiHost, p.models.length]), [['alpha', 'https://alpha.example/v1', 2], ['beta', 'https://beta.example/v1', 1]])
    assert.equal(cfg.models.activeModelId, 'beta:b1')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('选中不存在的模型会补一条 enabled；改 Base URL 在无桌面密钥时允许、有密钥时拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-base-'))
  try {
    await fixture(dir)
    selectDesktopModel(configFor(dir), { providerId: 'beta', modelId: 'b2' })
    let cfg = JSON.parse(await readFile(configFile(dir), 'utf8'))
    assert.deepEqual(cfg.models.providers[1].models.map(m => [m.id, m.enabled]), [['b1', true], ['b2', true]])
    // 无 secrets.json → 允许改 Base URL
    selectDesktopModel(configFor(dir), { providerId: 'beta', modelId: 'b2', baseUrl: 'https://beta2.example/v1' })
    cfg = JSON.parse(await readFile(configFile(dir), 'utf8'))
    assert.equal(cfg.models.providers[1].apiHost, 'https://beta2.example/v1')
    // 桌面为该 provider 存过密钥 → 拒绝换地址
    await writeFile(join(dir, '.deva', 'secrets.json'), JSON.stringify({ beta: 'BASE64CIPHER' }), 'utf8')
    assert.throws(() => selectDesktopModel(configFor(dir), { providerId: 'beta', modelId: 'b2', baseUrl: 'https://beta3.example/v1' }), /已有密钥/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('插件读写桌面 activeModelId，能拾取下一次桌面更改；未授权不返回或写入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-rpc-'))
  try {
    await fixture(dir)
    const config = { ...configFor(dir), sharedDevaUserId: 1 }
    const run = runFor(config)
    assert.equal((await readModelSelection(run)).modelRef, 'alpha:a1')
    selectDesktopModel(config, { providerId: 'beta', modelId: 'b1' })
    assert.equal((await readCustomModel(run)).modelName, 'b1')
    const saved = await saveModelSelection(run, { modelRef: 'alpha:a2', baseUrl: 'https://alpha.example/v1', modelName: 'a2' })
    assert.equal(saved.modelRef, 'alpha:a2')
    assert.equal(JSON.parse(await readFile(configFile(dir), 'utf8')).models.activeModelId, 'alpha:a2')
    const outsider = runFor(config, 2)
    assert.equal((await readModelSelection(outsider)).desktopAccessRequired, true)
    await assert.rejects(saveModelSelection(outsider, { baseUrl: '', modelName: '' }), /管理员/)
    assert.equal((await saveModelSelection(run, { baseUrl: '', modelName: '' })).modelRef, '')
    assert.equal(JSON.parse(await readFile(configFile(dir), 'utf8')).models.activeModelId, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
