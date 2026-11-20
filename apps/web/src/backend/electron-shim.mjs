/**
 * 服务端 electron 兼容层。
 *
 * 目标：让 apps/desktop/src/main 下的真实业务代码在 Node 里跑起来，
 * 只替换窗口、对话框、剪贴板、safeStorage 这些桌面专有实现。
 */
import { EventEmitter } from 'node:events'
import { fork } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CDPWebContents } from './chromium.mjs'

const DEVA_HOME = process.env.DEVA_HOME ?? path.join(os.homedir(), '.deva-web')
fs.mkdirSync(DEVA_HOME, { recursive: true })

// ───────────────────────── 事件出口 ─────────────────────────
/** 由 server 注入：把主进程 webContents.send 变成 SSE 广播 */
export const __events = { sink: null }
export function setEventSink(fn) {
  __events.sink = fn
}
function emitEvent(channel, payload) {
  try {
    __events.sink?.(channel, payload)
  } catch (error) {
    console.error('[web] event sink failed:', channel, error)
  }
}

// ───────────────────────── ipcMain ─────────────────────────
const handlers = new Map()
const listeners = new Map()

export const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn)
  },
  handleOnce(channel, fn) {
    handlers.set(channel, fn)
  },
  removeHandler(channel) {
    handlers.delete(channel)
  },
  on(channel, fn) {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel).add(fn)
  },
  once(channel, fn) {
    this.on(channel, fn)
  },
  removeListener(channel, fn) {
    listeners.get(channel)?.delete(fn)
  },
  removeAllListeners(channel) {
    listeners.delete(channel)
  }
}

export function __listChannels() {
  return [...handlers.keys()].sort()
}

const fakeEvent = () => ({
  sender: fakeWebContents,
  senderFrame: null,
  frameId: 0,
  returnValue: undefined,
  reply: () => undefined
})

export async function __invoke(channel, args) {
  const fn = handlers.get(channel)
  if (!fn) {
    const error = new Error(`not ported: ${channel}`)
    error.code = 'NOT_PORTED'
    throw error
  }
  return await fn(fakeEvent(), ...(args ?? []))
}

export function __send(channel, args) {
  const set = listeners.get(channel)
  if (!set) return
  for (const fn of set) {
    try {
      fn(fakeEvent(), ...(args ?? []))
    } catch (error) {
      console.error('[web] ipc send handler failed:', channel, error)
    }
  }
}

// ───────────────────────── app ─────────────────────────
class DevaApp extends EventEmitter {
  constructor() {
    super()
    this.isPackaged = false
    this.commandLine = {
      appendSwitch: () => undefined,
      appendArgument: () => undefined,
      hasSwitch: () => false,
      getSwitchValue: () => ''
    }
  }
  getPath(name) {
    switch (name) {
      case 'home':
        return os.homedir()
      case 'downloads':
        return path.join(os.homedir(), 'Downloads')
      case 'temp':
        return os.tmpdir()
      case 'logs':
        return path.join(DEVA_HOME, 'logs')
      case 'appData':
        return path.join(DEVA_HOME, '.appdata')
      default:
        return DEVA_HOME
    }
  }
  getVersion() {
    // 由 server.mjs / worker 环境注入（dist/build-info.json 的版本）；未知时不要伪装成某个旧版本
    return process.env.DEVA_VERSION || '0.0.0'
  }
  getName() {
    return 'Deva'
  }
  getLocale() {
    return 'zh-CN'
  }
  getPreferredSystemLanguages() {
    return ['zh-CN', 'en-US']
  }
  getAppPath() {
    return process.cwd()
  }
  isReady() {
    return true
  }
  whenReady() {
    return Promise.resolve()
  }
  requestSingleInstanceLock() {
    return true
  }
  releaseSingleInstanceLock() {}
  setAppUserModelId() {}
  setLoginItemSettings() {}
  setAsDefaultProtocolClient() {
    return true
  }
  disableHardwareAcceleration() {}
  focus() {}
  quit() {
    setTimeout(() => process.exit(0), 50)
  }
  exit(code = 0) {
    process.exit(code)
  }
}

export const app = new DevaApp()

// ───────────────────────── 窗口 ─────────────────────────
export const fakeWebContents = {
  id: 1,
  session: null,
  send(channel, payload) {
    emitEvent(channel, payload)
  },
  sendToFrame() {},
  on() {},
  once() {},
  isDestroyed() {
    return false
  },
  setWindowOpenHandler() {},
  executeJavaScript: async () => undefined,
  openDevTools() {},
  setZoomFactor() {},
  getURL: () => 'about:blank'
}

export class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
    // 只有真正承载网页的窗口（offscreen 网页视图 / 浏览器窗口）才需要 Chromium 页面；
    // 事件出口用的虚拟窗口继续用轻量假对象，省一个 tab。
    this._realContents = Boolean(options.webPreferences)
    this.webContents = this._realContents ? new CDPWebContents(options) : fakeWebContents
    this.id = 1
    this._destroyed = false
  }
  static getAllWindows() {
    return [mainWindow]
  }
  static getFocusedWindow() {
    return mainWindow
  }
  static fromWebContents() {
    return mainWindow
  }
  static fromId() {
    return mainWindow
  }
  isDestroyed() {
    return this._destroyed
  }
  isMinimized() {
    return false
  }
  isFocused() {
    return false
  }
  isAlwaysOnTop() {
    return false
  }
  isMaximizable() {
    return true
  }
  isMaximized() {
    return false
  }
  isFullScreen() {
    return false
  }
  isVisible() {
    return true
  }
  show() {}
  hide() {}
  focus() {}
  blur() {}
  close() {}
  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._realContents) void this.webContents.close()
  }
  minimize() {}
  maximize() {}
  unmaximize() {}
  restore() {}
  setTitle() {}
  setMenuBarVisibility() {}
  setTitleBarOverlay() {}
  setBounds() {}
  setPosition() {}
  setSize() {}
  center() {}
  async loadURL() {}
  async loadFile() {}
  getBounds() {
    return { x: 0, y: 0, width: 1440, height: 900 }
  }
  getContentBounds() {
    return { x: 0, y: 0, width: 1440, height: 900 }
  }
  getPosition() {
    return [0, 0]
  }
  getSize() {
    return [1440, 900]
  }
  getContentSize() {
    return [1440, 900]
  }
  scrollBy() {}
  setAlwaysOnTop() {}
  setSkipTaskbar() {}
  setIgnoreMouseEvents() {}
  addBrowserView() {}
  removeBrowserView() {}
}

export const mainWindow = new BrowserWindow()

// ───────────────────────── 对话框 ─────────────────────────
export const dialog = {
  async showOpenDialog(...args) {
    const options = args.at(-1) ?? {}
    const properties = Array.isArray(options?.properties) ? options.properties : []
    const workspace = process.env.DEVA_WEB_WORKSPACE

    if (properties.includes('openDirectory')) {
      // 浏览器里没有系统目录对话框：通过 server 回环请求，让页面里的 picker
      // 列出受控根目录并由用户选择；选中后 worker 仍走原来的 trustRoot。
      const ctl = process.env.DEVA_WEB_CTL_URL
      const token = process.env.DEVA_WEB_CTL_TOKEN
      if (ctl && token) {
        try {
          const res = await fetch(`${ctl}/api/dir-pick`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-deva-worker-token': token },
            body: JSON.stringify({
              userId: process.env.DEVA_WEB_USER,
              title: options.title ?? '选择文件夹'
            }),
            signal: AbortSignal.timeout?.(6 * 60_000)
          })
          const body = await res.json()
          const value = body?.value
          if (body?.ok && value && !value.canceled && value.path) {
            return { canceled: false, filePaths: [value.path] }
          }
          return { canceled: true, filePaths: [] }
        } catch (error) {
          console.warn('[deva-web] 目录选择失败，回退到用户工作区:', error?.message ?? error)
        }
      }
      // 旧行为兜底：没有控制通道时仍挂载用户自己的工作区，避免整个入口不可用。
      if (workspace) return { canceled: false, filePaths: [workspace] }
    }
    return { canceled: true, filePaths: [] }
  },
  async showSaveDialog() {
    return { canceled: true, filePath: undefined }
  },
  async showMessageBox() {
    return { response: 0, checkboxChecked: false }
  },
  async showErrorBox() {}
}

// ───────────────────────── shell / clipboard ─────────────────────────
export const shell = {
  async openPath() {
    return ''
  },
  async openExternal() {
    return undefined
  },
  showItemInFolder() {},
  async trashItem() {}
}

let clipboardText = ''
export const clipboard = {
  readText() {
    return clipboardText
  },
  writeText(text) {
    clipboardText = String(text ?? '')
  },
  readImage() {
    return nativeImage.createEmpty()
  },
  writeImage() {}
}

// ───────────────────────── safeStorage ─────────────────────────
const KEY_FILE = path.join(DEVA_HOME, '.web-secret')
function masterKey() {
  const fromEnv = process.env.DEVA_WEB_SECRET
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv).digest()
  try {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
  } catch {
    const key = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 })
    return key
  }
}

export const safeStorage = {
  isEncryptionAvailable() {
    return true
  },
  encryptString(plain) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), enc])
  },
  decryptString(buf) {
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  },
  getSelectedStorageBackend() {
    return 'basic_text'
  }
}

// ───────────────────────── nativeImage ─────────────────────────
function pngSize(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  return { width: 0, height: 0 }
}

export const nativeImage = {
  createFromBuffer(buf) {
    const size = pngSize(buf)
    const image = {
      isEmpty: () => false,
      getSize: () => size,
      toPNG: () => buf,
      toJPEG: () => buf,
      toDataURL: () => `data:image/png;base64,${buf.toString('base64')}`,
      resize: () => image
    }
    return image
  },
  createEmpty() {
    return {
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      toPNG: () => Buffer.alloc(0),
      toDataURL: () => ''
    }
  },
  async createThumbnailFromPath() {
    return null
  }
}

// ───────────────────────── 主题 / 托盘 / 菜单 ─────────────────────────
export const nativeTheme = {
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  themeSource: 'system',
  on() {},
  removeListener() {}
}

export class Tray extends EventEmitter {
  setToolTip() {}
  setContextMenu() {}
  setImage() {}
  popUpContextMenu() {}
  destroy() {}
}

export const Menu = {
  buildFromTemplate: (template) => ({ items: template ?? [], popup() {} }),
  setApplicationMenu() {},
  getApplicationMenu: () => null
}

export class Notification extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
  }
  show() {
    console.log('[notify]', this.options.title ?? '', this.options.body ?? '')
  }
  close() {}
  isSupported() {
    return true
  }
}

// ───────────────────────── session / net / protocol / screen ─────────────────────────
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function makeSession() {
  const emitter = new EventEmitter()
  let userAgent = DEFAULT_UA
  const ses = {
    userAgent,
    getUserAgent() {
      return userAgent
    },
    setUserAgent(ua) {
      userAgent = String(ua || DEFAULT_UA)
      ses.userAgent = userAgent
    },
  cookies: {
    async get() {
      return []
    },
    async set() {},
    async remove() {},
    async flushStore() {}
  },
  clearStorageData: async () => undefined,
  setPermissionRequestHandler() {},
  setPermissionCheckHandler() {},
  webRequest: {
    onBeforeRequest() {},
    onBeforeSendHeaders() {},
    onHeadersReceived() {}
  },
  // 模型请求 / web_fetch / MCP 都走这里（Electron 用 Chromium 网络栈，Web 版用 Node fetch）
  fetch: (url, init) => globalThis.fetch(url, init),
  async setProxy() {},
  async resolveProxy() {
    return 'DIRECT'
  }
}
  ses.on = emitter.on.bind(emitter)
  ses.once = emitter.once.bind(emitter)
  ses.off = emitter.off.bind(emitter)
  ses.removeListener = emitter.removeListener.bind(emitter)
  return ses
}

const fakeSession = makeSession()
const partitions = new Map([['', fakeSession]])

export const session = {
  defaultSession: fakeSession,
  fromPartition(name) {
    const key = String(name ?? '')
    if (!partitions.has(key)) partitions.set(key, makeSession())
    return partitions.get(key)
  }
}

export const net = {
  fetch: (...args) => globalThis.fetch(...args),
  request() {
    const emitter = new EventEmitter()
    emitter.end = () => emitter.emit('error', new Error('net.request unsupported in web mode'))
    emitter.abort = () => undefined
    emitter.setHeader = () => undefined
    return emitter
  },
  isOnline: () => true
}

export const protocol = {
  handle() {},
  unhandle() {},
  registerFileProtocol() {},
  interceptFileProtocol() {},
  registerBufferProtocol() {}
}

export const screen = {
  getPrimaryDisplay: () => ({
    workAreaSize: { width: 1440, height: 900 },
    size: { width: 1440, height: 900 },
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 }
  }),
  getAllDisplays: () => [],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  on() {}
}

// Web 模式没有电源/空闲状态：一直当作「刚有操作」。remote/web 的 atDesktop()
// 只在窗口前台时才查空闲时间，Web 端 isFocused() 恒为 false，这里只是让导入成立。
export const powerMonitor = {
  getSystemIdleTime: () => 0,
  getSystemIdleState: () => 'active',
  on() {},
  off() {},
  removeAllListeners() {}
}

const fakeUtility = {
  fork(modulePath) {
    const child = fork(modulePath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    return {
      pid: child.pid,
      postMessage: (msg) => child.send(msg),
      // Electron utilityProcess 的 message 事件直接把消息体交给回调（不是 MessageEvent）
      on: (event, fn) => child.on(event, fn),
      kill: () => child.kill(),
      once: (event, fn) => child.once(event, fn)
    }
  }
}
export const utilityProcess = fakeUtility

export class WebContentsView {
  constructor() {
    this.webContents = fakeWebContents
  }
  setBounds() {}
}

export default {
  app,
  ipcMain,
  BrowserWindow,
  dialog,
  shell,
  clipboard,
  safeStorage,
  nativeImage,
  nativeTheme,
  Tray,
  Menu,
  Notification,
  session,
  net,
  protocol,
  screen,
  powerMonitor,
  utilityProcess,
  WebContentsView
}
