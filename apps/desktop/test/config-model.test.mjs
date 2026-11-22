/**
 * 配置读写（config.json）与模型引用解析：
 *  · config:set 的浅合并 / undefined 删除键语义；
 *  · config.json 损坏时回落空配置而不是崩溃（子进程隔离，避免污染模块级缓存）；
 *  · model-resolve 对非法引用的容错（永不抛错、按 fallback 回落）与用户覆盖值校验。
 *
 * config.ts 的模块级缓存在首次读取时固定 DEVA_HOME（register.mjs 已指向临时目录），
 * 用例之间只用不同的顶层键，避免相互干扰。
 */
import './support/home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { invokeHandler, resetIpc } from './support/electron-stub.mjs'
import { getConfig, registerConfigIpc, setConfig } from '../src/main/services/config.ts'
import {
  modelOverrides,
  resolveDefaultEffort,
  resolveDefaultModel,
  resolveModelRef,
  resolveModelRefOrNull
} from '../src/main/services/model-resolve.ts'

const HOME = process.env.DEVA_HOME
const CONFIG_FILE = join(HOME, 'config.json')

test('config:set 浅合并；undefined 删除键；写盘为完整 JSON', () => {
  resetIpc()
  registerConfigIpc()
  invokeHandler('config:set', { theme: 'dark', nested: { a: 1 } })
  invokeHandler('config:set', { theme: 'light', removed: 'x' })
  invokeHandler('config:set', { removed: undefined })

  const cfg = getConfig()
  assert.equal(cfg.theme, 'light')
  assert.deepEqual(cfg.nested, { a: 1 })
  assert.ok(!('removed' in cfg))

  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  const onDisk = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  assert.equal(onDisk.theme, 'light')
})

test('config:get 返回同一份内存快照；非对象 patch 是 no-op', () => {
  resetIpc()
  registerConfigIpc()
  setConfig({ marker: 'v1' })
  assert.equal(invokeHandler('config:get').marker, 'v1')
  assert.doesNotThrow(() => setConfig(null))
  assert.equal(getConfig().marker, 'v1')
})

test('损坏的 config.json → 视为空配置，不抛错（子进程隔离）', () => {
  const home = mkdtempSync(join(tmpdir(), 'deva-corrupt-'))
  writeFileSync(join(home, 'config.json'), '{ not json')
  const script = `
    const { getConfig } = await import(${JSON.stringify(join(process.cwd(), 'src/main/services/config.ts'))})
    process.stdout.write(JSON.stringify(getConfig()))
  `
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      './test/support/register.mjs',
      '--input-type=module',
      '-e',
      script
    ],
    { cwd: process.cwd(), env: { ...process.env, DEVA_HOME: home }, encoding: 'utf8' }
  )
  assert.deepEqual(JSON.parse(out), {})
})

test('resolveModelRef：非法 / 悬空引用一律回落 fallback（永不抛错）', () => {
  const fallback = { adapter: 'anthropic', providerId: 'p', baseURL: '', model: 'm' }
  for (const ref of [undefined, null, '', '   ', 'no-colon', ':missing', 'p:', 42]) {
    assert.deepEqual(resolveModelRef(ref, fallback), fallback, `应回落: ${JSON.stringify(ref)}`)
  }
  assert.equal(resolveModelRefOrNull('p:whatever'), null)
})

test('resolveModelRef：命中已配置服务商与模型时返回解析结果（adapter 规范化）', () => {
  setConfig({
    models: {
      activeModelId: 'prov-a:m1',
      providers: [
        { id: 'prov-a', adapter: 'openai', apiHost: 'https://api.example.com', models: [{ id: 'm1' }] },
        { id: 'prov-b', adapter: 'weird', models: [{ id: 'm2' }] }
      ]
    }
  })
  assert.deepEqual(resolveModelRef('prov-a:m1', { adapter: 'anthropic', providerId: '', baseURL: '', model: '' }), {
    adapter: 'openai',
    providerId: 'prov-a',
    baseURL: 'https://api.example.com',
    model: 'm1'
  })
  // 未知 adapter 规范化为 anthropic
  assert.equal(resolveModelRefOrNull('prov-b:m2').adapter, 'anthropic')
  assert.deepEqual(resolveDefaultModel(), { adapter: 'openai', providerId: 'prov-a', baseURL: 'https://api.example.com', model: 'm1' })
})

test('resolveDefaultModel：无配置 / 悬空 → null', () => {
  setConfig({ models: { activeModelId: undefined } })
  assert.equal(resolveDefaultModel(), null)
  setConfig({ models: { activeModelId: 'nope:missing' } })
  assert.equal(resolveDefaultModel(), null)
})

test('modelOverrides：只取落在合法范围内的整数；非法值当作未填', () => {
  setConfig({
    models: {
      providers: [
        {
          id: 'p',
          adapter: 'anthropic',
          models: [
            { id: 'good', contextWindow: 200_000, maxOutput: 8192 },
            { id: 'bad', contextWindow: 999, maxOutput: 1.5 },
            { id: 'missing' }
          ]
        }
      ]
    }
  })
  assert.deepEqual(modelOverrides('p', 'good'), { contextWindow: 200_000, maxOutput: 8192 })
  assert.deepEqual(modelOverrides('p', 'bad'), {})
  assert.deepEqual(modelOverrides('p', 'missing'), {})
  assert.deepEqual(modelOverrides('nope', 'good'), {})
})

test('resolveDefaultEffort：合法档位直取，非法 / 缺失 → default', () => {
  setConfig({ models: { activeEffort: 'high' } })
  assert.equal(resolveDefaultEffort(), 'high')
  setConfig({ models: { activeEffort: 'ultra' } })
  assert.equal(resolveDefaultEffort(), 'default')
  setConfig({ models: { activeEffort: undefined } })
  assert.equal(resolveDefaultEffort(), 'default')
})
