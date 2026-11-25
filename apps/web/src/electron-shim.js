/**
 * 浏览器侧 electron 模块替身。
 * preload/index.ts 只用到 contextBridge / ipcRenderer / webUtils 三个成员，
 * 这里保持同样的调用形态，底层走 HTTP + SSE。
 */

const listeners = new Map()

function csrf() {
  return globalThis.__DEVA_CSRF__ ?? ''
}

function emit(channel, payload) {
  const set = listeners.get(channel)
  if (!set) return
  for (const fn of set) {
    try {
      fn({}, payload)
    } catch (error) {
      console.error('[deva-web] listener error', channel, error)
    }
  }
}

export const contextBridge = {
  exposeInMainWorld(key, value) {
    globalThis[key] = value
  }
}

export const ipcRenderer = {
  async invoke(channel, ...args) {
    const res = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deva-csrf': csrf() },
      body: JSON.stringify({ channel, args })
    })
    const body = await res.json()
    if (!body.ok) throw new Error(body.error ?? `invoke failed: ${channel}`)
    return body.value
  },

  send(channel, ...args) {
    void fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deva-csrf': csrf() },
      body: JSON.stringify({ channel, args, fireAndForget: true })
    }).catch(() => undefined)
  },

  // 浏览器没有同步 IPC：配置在页面加载时由服务端内联，这里直接从全局读
  sendSync(channel) {
    if (channel === 'config:get-sync') return globalThis.__DEVA_CONFIG__ ?? {}
    return null
  },

  on(channel, listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel).add(listener)
  },

  removeListener(channel, listener) {
    listeners.get(channel)?.delete(listener)
  },

  removeAllListeners(channel) {
    listeners.delete(channel)
  }
}

export const webUtils = {
  getPathForFile(file) {
    return file?.path ?? file?.name ?? ''
  }
}

export function __devaEmit(channel, payload) {
  emit(channel, payload)
}

// SSE 替代 ipcRenderer.on：服务端把 {channel, payload} 放在默认 message 事件里，
// 这样任意通道（包括运行时才注册的）都能分发。
if (typeof EventSource !== 'undefined') {
  const source = new EventSource('/api/events')
  source.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg && typeof msg.channel === 'string') emit(msg.channel, msg.payload)
    } catch (error) {
      console.error('[deva-web] bad event', error)
    }
  }
}
