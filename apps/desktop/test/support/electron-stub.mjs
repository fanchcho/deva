/**
 * `electron` 的单测替身：只实现被测模块用到的表面，并使 IPC 处理器可被测试直接调用。
 *
 * 目的：主进程服务里的「通道参数校验」逻辑都在 `ipcMain.handle(...)` 的回调里（如 memory 的 scope、
 * workspace 的路径闸门）。单测不启动 Electron，只把注册的处理器记下来，测试再按通道名调用，
 * 从而在真实代码路径上验证参数校验与错误分支。
 */

/** 通道名 → 处理器 */
export const ipcHandlers = new Map()
/** 通道名 → 监听器（config.ts 的 config:get-sync 用 ipcMain.on） */
export const ipcListeners = new Map()

export const ipcMain = {
  handle(channel, fn) {
    if (ipcHandlers.has(channel)) throw new Error(`duplicate handler: ${channel}`)
    ipcHandlers.set(channel, fn)
  },
  on(channel, fn) {
    const list = ipcListeners.get(channel) ?? []
    list.push(fn)
    ipcListeners.set(channel, list)
  },
  removeHandler(channel) {
    ipcHandlers.delete(channel)
  },
  removeListener(channel, fn) {
    ipcListeners.set(
      channel,
      (ipcListeners.get(channel) ?? []).filter((x) => x !== fn)
    )
  }
}

/** 测试调用已注册的 IPC 处理器（等价于渲染层 invoke）。 */
export function invokeHandler(channel, ...args) {
  const fn = ipcHandlers.get(channel)
  if (!fn) throw new Error(`no handler: ${channel}`)
  // BrowserWindow 参数在真实调用里是 event，由 Electron 注入；这里给 null。
  return fn(null, ...args)
}

/** 每个用例前清空注册表，避免跨用例串味。 */
export function resetIpc() {
  ipcHandlers.clear()
  ipcListeners.clear()
  appPaths.clear()
}

const appPaths = new Map()
appPaths.set('home', '/tmp')

export const app = {
  getPath: (name) => appPaths.get(name) ?? `/tmp/${name}`,
  setPath: (name, value) => appPaths.set(name, value),
  getVersion: () => '0.0.0-test',
  getAppPath: () => '/tmp/app',
  isPackaged: false,
  on: () => undefined,
  whenReady: async () => undefined,
  quit: () => undefined
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] })
}

export const shell = {
  openPath: async () => ''
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('safeStorage not available in tests')
  },
  decryptString: () => {
    throw new Error('safeStorage not available in tests')
  }
}

export const BrowserWindow = class {}
export const nativeTheme = { shouldUseDarkColors: false, on: () => undefined }
export const screen = { getPrimaryDisplay: () => ({ scaleFactor: 1, size: { width: 0, height: 0 } }) }
export const Menu = { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) }
export const Tray = class {}
export const Notification = class {}
export const clipboard = { readText: () => '', writeText: () => undefined }
export const shellOpenExternal = async () => undefined
shell.openExternal = shellOpenExternal

export default { app, ipcMain, dialog, shell, safeStorage, BrowserWindow, nativeTheme, screen, Menu, Tray, Notification, clipboard }

// Projection tests import provider types through compaction; network use must fail loudly.
export const session = { fromPartition: () => { throw new Error('Network session unavailable in pure logic tests') } }
export const nativeImage = new Proxy({}, { get: () => { throw new Error('Native image unavailable in pure logic tests') } })
export class WebContentsView { constructor() { throw new Error('Native view unavailable in pure logic tests') } }
