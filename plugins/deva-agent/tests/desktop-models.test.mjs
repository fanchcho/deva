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

test('插件读写桌面 activeModelId，能拾取下一次桌面更改；只读免授权但写入仍受控', async () => {
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
    assert.equal((await readModelSelection(outsider)).modelRef, 'alpha:a2')
    await assert.rejects(saveModelSelection(outsider, { baseUrl: '', modelName: '' }), /管理员/)
    assert.equal((await saveModelSelection(run, { baseUrl: '', modelName: '' })).modelRef, '')
    assert.equal(JSON.parse(await readFile(configFile(dir), 'utf8')).models.activeModelId, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// 回归：页面只读镜像不得被「本机/内网/HTTP 需批准」拦死。
// 用用户 2026-11-25 反馈的第二台 Windows 设备原样配置（custom provider + 复合 activeModelId + 本机 HTTP 网关）。
const windowsReportedConfig = {
  personas: { enabled: { general: true, xiaomajiang: true }, selected: 'xiaomajiang' },
  models: {
    activeModelId: 'custom-1794383812625:cn:deepseek-v4.1-flash',
    activeEffort: 'default',
    providers: [{
      id: 'custom-1794383812625', name: 'cpa', kind: 'custom', purpose: 'llm', adapter: 'openai',
      apiHost: 'http://127.0.0.1:7863/v1', enabled: true,
      models: ['cn:auto', 'cn:deepseek-v4-flash', 'cn:deepseek-v4-pro', 'cn:deepseek-v4.1-flash', 'cn:glm-5.2', 'cn:glm-5.3', 'cn:glm-5.3-flash', 'cn:hy3', 'cn:hy3-x', 'cn:hy4-preview-f', 'cn:hy4free', 'cn:hy4std', 'cn:kimi-k2.8-preview', 'cn:kimi-k3-1', 'cn:kimi-k3.1-pro', 'cn:mimo-v2.6-pro', 'cn:minimax-m3.1-flash', 'cn:space-bunny', 'cn:step-5-preview'].map(id => ({ id, name: id, enabled: true })),
    }, {
      id: 'magpie', name: 'Magpie', kind: 'official', purpose: 'llm', adapter: 'openai',
      apiHost: 'https://magpie.example/v1', enabled: false, models: [],
    }],
  },
}

async function reportedFixture(dir) {
  await mkdir(join(dir, '.deva'), { recursive: true })
  await writeFile(configFile(dir), JSON.stringify(windowsReportedConfig, null, 2), 'utf8')
}

test('桌面已生效的 custom provider + 复合 activeModelId 照实回显，不被网络批准策略拦成空态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-reported-'))
  try {
    await reportedFixture(dir)
    const config = { ...configFor(dir), sharedDevaUserId: 1 }
    const view = await readModelSelection(runFor(config))
    assert.equal(view.modelRef, 'custom-1794383812625:cn:deepseek-v4.1-flash')
    assert.equal(view.providerId, 'custom-1794383812625')
    assert.equal(view.providerName, 'cpa')
    assert.equal(view.modelName, 'cn:deepseek-v4.1-flash')
    assert.equal(view.baseUrl, 'http://127.0.0.1:7863/v1')
    assert.equal(view.adapter, 'openai')
    // 关键：本机 HTTP 只影响“能不能直连”，不改变页面显示，也不禁用页面。
    assert.equal(view.needsNetworkApproval, true)
    assert.equal(view.desktopAccessRequired, undefined)
    assert.equal(view.reasoningEffort, undefined)
    assert.deepEqual(view.desktopModels.map(m => m.modelName), ['cn:auto', 'cn:deepseek-v4-flash', 'cn:deepseek-v4-pro', 'cn:deepseek-v4.1-flash', 'cn:glm-5.2', 'cn:glm-5.3', 'cn:glm-5.3-flash', 'cn:hy3', 'cn:hy3-x', 'cn:hy4-preview-f', 'cn:hy4free', 'cn:hy4std', 'cn:kimi-k2.8-preview', 'cn:kimi-k3-1', 'cn:kimi-k3.1-pro', 'cn:mimo-v2.6-pro', 'cn:minimax-m3.1-flash', 'cn:space-bunny', 'cn:step-5-preview'])
    // 已停用的 provider 不进选项
    assert.equal(view.desktopModels.some(m => m.ref.startsWith('magpie:')), false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('未授权、桌面空配置、引用失效三种情况给出可区分的结果而不是同一句“未选择”', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-states-'))
  try {
    await mkdir(join(dir, '.deva'), { recursive: true })
    await writeFile(configFile(dir), JSON.stringify({ personas: { enabled: { general: true } }, models: { providers: [] } }, null, 2), 'utf8')
    const config = { ...configFor(dir), sharedDevaUserId: 1 }

    // 1) 桌面确实没有默认模型：空态，但没有 unresolved，也不是授权失败。
    const empty = await readModelSelection(runFor(config))
    assert.equal(empty.modelRef, '')
    assert.equal(empty.unresolvedModelRef, undefined)
    assert.equal(empty.desktopAccessRequired, undefined)
    assert.equal(empty.desktopConfigExists, true)

    // 2) activeModelId 指向已不存在的 provider：引用失效，原样回显。
    await writeFile(configFile(dir), JSON.stringify({
      models: { activeModelId: 'ghost:g1', providers: [{ id: 'real', name: 'Real', adapter: 'openai', apiHost: 'https://real.example/v1', enabled: true, models: [{ id: 'r1', enabled: true }] }] },
    }, null, 2), 'utf8')
    const broken = await readModelSelection(runFor(config))
    assert.equal(broken.unresolvedModelRef, 'ghost:g1')
    assert.equal(broken.modelRef, '')

    // 3) 未授权账号：只给路径与账号信息，不读桌面内容。
    const outsider = await readModelSelection(runFor(config, 2))
    assert.equal(outsider.desktopAccessRequired, undefined)
    assert.equal(outsider.unresolvedModelRef, 'ghost:g1')
    assert.equal(outsider.desktopModels.length, 1)
    assert.equal(outsider.hasApiKey, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('拿不到 POSIX 归属的宿主（Windows）仍可读桌面配置，并如实标注 unverifiable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-desktop-win-'))
  const realGetuid = process.getuid
  try {
    await reportedFixture(dir)
    Object.defineProperty(process, 'getuid', { value: undefined, configurable: true })
    const config = { ...configFor(dir), sharedDevaUserId: 1 }
    const view = await readModelSelection(runFor(config))
    assert.equal(view.modelName, 'cn:deepseek-v4.1-flash')
    assert.equal(view.desktopOwnership, 'unverifiable')
  } finally {
    Object.defineProperty(process, 'getuid', { value: realGetuid, configurable: true })
    await rm(dir, { recursive: true, force: true })
  }
})
