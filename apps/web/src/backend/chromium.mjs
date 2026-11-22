/**
 * 用系统 Chromium 的 CDP 实现 Electron WebContents 的一个可用子集。
 *
 * Electron 里网页视图由 Chromium 渲染；纯 Web 版没有 Electron，
 * 于是自己拉一个 headless Chromium，每个 WebContents 对应一个 tab，
 * 通过 CDP 提供 loadURL / executeJavaScript / capturePage / debugger 等能力。
 */
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function findChrome() {
  const fromEnv = process.env.CHROME_PATH || process.env.DEVA_CHROME_PATH
  if (fromEnv) return fromEnv
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ]
  for (const p of candidates) if (fs.existsSync(p)) return p
  return 'chromium'
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Set()
    ws.addEventListener('message', (event) => this._onMessage(event.data))
    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer)
        reject(new Error('CDP connection closed'))
      }
      this.pending.clear()
    })
  }

  _onMessage(raw) {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.id && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.reject(new Error(`${msg.error.message ?? 'CDP error'} (${entry.method})`))
      else entry.resolve(msg.result ?? {})
      return
    }
    for (const fn of this.handlers) {
      try {
        fn(msg)
      } catch (error) {
        console.error('[cdp] event handler failed:', error)
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    const ws = this.ws
    return new Promise((resolve, reject) => {
      if (ws.readyState !== 1) {
        reject(new Error('CDP socket not open'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        ws.send(JSON.stringify(payload))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  onEvent(fn) {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }
}

let browserPromise = null

async function launch() {
  const home = process.env.DEVA_HOME ?? path.join(os.homedir(), '.deva-web')
  const profile = process.env.DEVA_CHROME_PROFILE ?? path.join(home, 'chromium-profile')
  fs.mkdirSync(profile, { recursive: true })
  // 上次进程被强杀会留下 SingletonLock，Chromium 会直接退出（code 21）
  try {
    const lock = path.join(profile, 'SingletonLock')
    const target = fs.readlinkSync(lock)
    const pid = Number(String(target).split('-').pop())
    if (!pid || !fs.existsSync(`/proc/${pid}`)) {
      for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try {
          fs.unlinkSync(path.join(profile, name))
        } catch {
          /* 不存在就算了 */
        }
      }
    }
  } catch {
    /* 没有锁文件 */
  }
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,MediaRouter',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank'
  ]
  const child = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const killOnExit = () => {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  process.once('exit', killOnExit)
  child.on('exit', (code, signal) => {
    console.error(`[cdp] chromium exited code=${code} signal=${signal}`)
    browserPromise = null
  })

  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('启动 Chromium 超时（未拿到 DevTools 地址）')), 20000)
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk)
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
      if (buffer.length > 64 * 1024) buffer = buffer.slice(-8192)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Chromium 启动失败，退出码 ${code}`))
    })
  })

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接 DevTools 超时')), 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('连接 DevTools 失败'))
    })
  })

  const conn = new CdpConnection(ws)
  const knownTargets = new Set()
  // 页面自己开的新窗口一律关掉：Deva 用 setWindowOpenHandler 在应用层另开标签
  conn.onEvent((msg) => {
    if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
      const info = msg.params.targetInfo
      if (!knownTargets.has(info.targetId) && info.url && info.url !== 'about:blank') {
        conn.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
      }
    }
  })
  await conn.send('Target.setDiscoverTargets', { discover: true }).catch(() => {})
  return { conn, child, knownTargets }
}

export function ensureBrowser() {
  if (!browserPromise) {
    browserPromise = launch().catch((error) => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

/** Electron WebContents 的 CDP 实现（够 browser/terminal 这些真实业务模块用）。 */
export class CDPWebContents extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
    this.id = CDPWebContents.nextId++
    this._destroyed = false
    this._url = 'about:blank'
    this._title = ''
    this._loading = false
    this._canGoBack = false
    this._canGoForward = false
    this._historyEntries = []
    this._historyIndex = 0
    this._sessionId = null
    this._targetId = null
    this._windowOpenHandler = null
    this._debuggerHandlers = new Set()
    this._pendingLoad = null
    this._initPromise = this._init()
    this._initPromise.catch((error) => {
      console.error('[cdp] page init failed:', error)
      this.emit('destroyed')
    })
    this.navigationHistory = {
      canGoBack: () => this._canGoBack,
      canGoForward: () => this._canGoForward,
      goBack: () => this._gotoOffset(-1),
      goForward: () => this._gotoOffset(1),
      length: () => this._historyEntries.length,
      getActiveIndex: () => this._historyIndex,
      getEntryAtIndex: (index) => this._historyEntries[index],
      removeEntryAtIndex: (index) => {
        // CDP 没有删除历史项的接口；维护本地视图即可（业务只在初次导航时清理 about:blank）
        this._historyEntries.splice(index, 1)
        this._historyIndex = Math.max(0, this._historyIndex - 1)
      }
    }
    this.debugger = {
      attach: () => undefined,
      detach: () => undefined,
      isAttached: () => true,
      sendCommand: (method, params) => this._send(method, params),
      on: (event, fn) => {
        if (event !== 'message') return
        this._debuggerHandlers.add(fn)
      },
      off: (event, fn) => {
        if (event === 'message') this._debuggerHandlers.delete(fn)
      },
      removeListener: (event, fn) => {
        if (event === 'message') this._debuggerHandlers.delete(fn)
      }
    }
  }

  async _init() {
    const { conn, knownTargets } = await ensureBrowser()
    this._conn = conn
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
    this._targetId = targetId
    knownTargets.add(targetId)
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
    this._sessionId = sessionId
    conn.onEvent((msg) => {
      if (msg.sessionId !== this._sessionId) return
      this._onCdpEvent(msg.method, msg.params ?? {})
    })
    await this._send('Page.enable')
    await this._send('Runtime.enable')
    await this._send('Network.enable').catch(() => {})
    const ua = this.options?.webPreferences?.session?.userAgent
    if (ua) await this._send('Network.setUserAgentOverride', { userAgent: ua }).catch(() => {})
    await this._send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    }).catch(() => {})
    await this._refreshHistory().catch(() => {})
  }

  _send(method, params = {}) {
    if (!this._conn || !this._sessionId) {
      return this._initPromise.then(() => this._conn.send(method, params, this._sessionId))
    }
    return this._conn.send(method, params, this._sessionId)
  }

  _onCdpEvent(method, params) {
    for (const fn of this._debuggerHandlers) {
      try {
        fn({}, method, params)
      } catch (error) {
        console.error('[cdp] debugger handler failed:', error)
      }
    }
    switch (method) {
      case 'Page.frameStartedLoading':
        if (params.frameId === this._mainFrameId() || !this._mainFrameId()) {
          this._loading = true
          this.emit('did-start-loading')
        }
        break
      case 'Page.frameStoppedLoading':
        this._loading = false
        this.emit('did-stop-loading')
        if (this._pendingLoad) {
          this._pendingLoad.resolve()
          this._pendingLoad = null
        }
        this._refreshMeta()
        break
      case 'Page.loadEventFired':
        this._loading = false
        this.emit('did-stop-loading')
        if (this._pendingLoad) {
          this._pendingLoad.resolve()
          this._pendingLoad = null
        }
        this._refreshMeta()
        break
      case 'Page.domContentEventFired':
        this.emit('dom-ready')
        break
      case 'Page.frameNavigated': {
        const frame = params.frame
        if (frame && !frame.parentId) {
          this._url = frame.url || this._url
          this._title = frame.name || this._title
          this.emit('did-navigate', {}, this._url)
          this._refreshMeta()
        }
        break
      }
      case 'Page.navigatedWithinDocument':
        this._url = params.url || this._url
        this.emit('did-navigate-in-page', {}, this._url)
        break
      case 'Page.windowOpen': {
        const handler = this._windowOpenHandler
        const url = String(params.url ?? '')
        if (handler) {
          try {
            handler({ url })
          } catch (error) {
            console.error('[cdp] windowOpen handler failed:', error)
          }
        }
        break
      }
      case 'Page.javascriptDialogOpening':
        // 正常流程由 pages.ts 注入的 DIALOG_SHIM 接管；真弹出来就自动关掉，避免卡死
        this._send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
        break
      case 'Inspector.targetCrashed':
      case 'Page.frameDetached':
        if (params.frameId && params.frameId === this._mainFrameId()) this.emit('destroyed')
        break
    }
  }

  _mainFrameId() {
    return this._mainFrame
  }

  async _refreshMeta() {
    try {
      const { frameTree } = await this._send('Page.getFrameTree')
      this._mainFrame = frameTree?.frame?.id
    } catch {
      /* ignore */
    }
    await this._refreshHistory().catch(() => {})
    try {
      const result = await this._send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true
      })
      const title = String(result?.result?.value ?? '')
      if (title && title !== this._title) {
        this._title = title
        this.emit('page-title-updated', {}, title)
      }
    } catch {
      /* ignore */
    }
  }

  async _refreshHistory() {
    const history = await this._send('Page.getNavigationHistory')
    const index = history.currentIndex ?? 0
    const entries = history.entries ?? []
    this._historyEntries = entries
    this._historyIndex = index
    this._canGoBack = index > 0
    this._canGoForward = index < entries.length - 1
    if (entries[index]?.url) this._url = entries[index].url
    if (entries[index]?.title) this._title = entries[index].title
  }

  async _gotoOffset(offset) {
    const history = await this._send('Page.getNavigationHistory')
    const index = history.currentIndex + offset
    const entry = history.entries?.[index]
    if (!entry) return
    await this._send('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  loadURL(url) {
    return this._initPromise.then(async () => {
      const target = String(url)
      this._url = target
      this._loading = true
      this.emit('did-start-loading')
      const done = new Promise((resolve) => {
        this._pendingLoad = { resolve }
        setTimeout(() => {
          if (this._pendingLoad) {
            this._pendingLoad = null
            resolve()
          }
        }, 30000)
      })
      try {
        const result = await this._send('Page.navigate', { url: target })
        if (result?.errorText) throw new Error(result.errorText)
      } catch (error) {
        this._loading = false
        if (this._pendingLoad) {
          this._pendingLoad.resolve()
          this._pendingLoad = null
        }
        throw error
      }
      await done
      await this._refreshMeta().catch(() => {})
      return undefined
    })
  }

  async executeJavaScript(code) {
    await this._initPromise
    const result = await this._send('Runtime.evaluate', {
      expression: String(code),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails
      const text =
        detail.exception?.description ?? detail.text ?? detail.exception?.value ?? '页面脚本执行失败'
      throw new Error(String(text))
    }
    return result?.result?.value
  }

  async capturePage() {
    await this._initPromise
    const shot = await this._send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const buf = Buffer.from(String(shot.data ?? ''), 'base64')
    return imageFromPng(buf)
  }

  emit(event, ...args) {
    if (event === 'destroyed' && this._destroyed) return super.emit(event, ...args)
    return super.emit(event, ...args)
  }

  isDestroyed() {
    return this._destroyed
  }

  getURL() {
    return this._url
  }

  getTitle() {
    return this._title
  }

  isLoading() {
    return this._loading
  }

  reload() {
    void this._send('Page.reload', { ignoreCache: false }).catch(() => {})
  }

  stop() {
    void this._send('Page.stopLoading').catch(() => {})
  }

  // 兼容 Electron 的若干空实现
  setWindowOpenHandler(handler) {
    this._windowOpenHandler = handler
  }

  setAudioMuted() {}
  setFrameRate() {}
  setZoomFactor() {}
  insertCSS(css) {
    const key = `deva-css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.executeJavaScript(
      `(()=>{const s=document.createElement('style');s.id=${JSON.stringify(key)};s.textContent=${JSON.stringify(
        String(css ?? '')
      )};(document.head||document.documentElement).appendChild(s)})()`
    ).catch(() => {})
    return Promise.resolve(key)
  }
  removeInsertedCSS(key) {
    this.executeJavaScript(
      `(()=>{const e=document.getElementById(${JSON.stringify(String(key))});if(e)e.remove()})()`
    ).catch(() => {})
    return Promise.resolve()
  }
  openDevTools() {}
  sendToFrame() {}
  setWindowOpenHandler2() {}
  onBeforeInput() {}

  async close() {
    if (this._destroyed) return
    this._destroyed = true
    this.emit('destroyed')
    if (this._targetId) {
      await this._conn?.send('Target.closeTarget', { targetId: this._targetId }).catch(() => {})
    }
  }
}

CDPWebContents.nextId = 1

export async function closeBrowser() {
  const current = await browserPromise?.catch(() => null)
  current?.child?.kill()
  browserPromise = null
}

function imageFromPng(buf) {
  const size =
    buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG'
      ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
      : { width: 0, height: 0 }
  const image = {
    isEmpty: () => buf.length === 0,
    getSize: () => size,
    toPNG: () => buf,
    toJPEG: () => buf,
    toDataURL: () => `data:image/png;base64,${buf.toString('base64')}`,
    resize: () => image
  }
  return image
}
