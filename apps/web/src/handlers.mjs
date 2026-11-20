/**
 * 主进程通道的 Web 版实现。
 * 只覆盖原型启动所需的最小集合，其余通道返回 not_ported，
 * 让前端按"功能不可用"降级，而不是整页白屏。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_AVATAR =
  '{"selections":{"head":"hm1-p-000004","body":"hm1-p-000028","bottom":"hm1-p-000037","item":"hm1-p-000062","glasses":"hm1-p-000058"},"colors":{"stroke":"000000","hair":"B0B0B0","skin":"FFE0BD","clothes":"2D2D2D","bottom":"000000"},"background":"0D8CE9"}'

export function createHandlers({ devaHome }) {
  const configPath = path.join(devaHome, 'config.json')

  const readConfig = () => {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  const writeConfig = async (patch) => {
    const next = { ...readConfig(), ...patch }
    await fsp.mkdir(devaHome, { recursive: true })
    await fsp.writeFile(configPath, JSON.stringify(next, null, 2))
    return next
  }

  return {
    'app:get-platform': () => process.platform,

    'config:get': () => readConfig(),
    'config:get-sync': () => readConfig(),
    'config:set': (patch) => writeConfig(patch ?? {}),

    'secrets:list': () => [],
    'secrets:available': () => true,
    'secrets:has': () => false,
    'secrets:set': () => ({ ok: false, available: false }),
    'secrets:delete': () => undefined,

    'profile:get': async () => {
      try {
        return JSON.parse(await fsp.readFile(path.join(devaHome, 'profile.json'), 'utf8'))
      } catch {
        return { avatar: DEFAULT_AVATAR, avatarImage: '' }
      }
    },

    'tasks:list': () => [],
    'skills:list': () => [],
    'mcp:list': () => [],
    'personas:list': () => [],
    'chat:list-sessions': () => [],
    'git:available': () => false,

    // 内置浏览器的状态胶囊；Web 版暂时没有浏览器进程
    'browser:state': () => ({
      open: false,
      pinned: false,
      active: null,
      tabs: [],
      current: {},
      operating: {},
      handoff: {}
    }),

    'fs:read-dir': async (dir) => {
      const abs = path.resolve(dir)
      const entries = await fsp.readdir(abs, { withFileTypes: true })
      return entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: path.join(abs, e.name),
          type: e.isDirectory() ? 'dir' : 'file'
        }))
    },

    'fs:read-file': async (file) => {
      const abs = path.resolve(file)
      const stat = await fsp.stat(abs)
      if (stat.size > 2 * 1024 * 1024) return { path: abs, content: '', tooLarge: true }
      return { path: abs, content: await fsp.readFile(abs, 'utf8') }
    },

    // 无害的界面通道：接受并忽略，避免启动阶段报错
    'window:minimize': () => undefined,
    'window:toggle-maximize': () => undefined,
    'window:close': () => undefined,
    'window:set-overlay': () => undefined,
    'window:is-fullscreen': () => false,
    'clipboard:read-text': () => '',
    'clipboard:write-text': () => undefined
  }
}
