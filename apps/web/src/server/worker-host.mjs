/**
 * 单用户后端进程：加载真实主进程业务模块，通过 IPC 把 invoke/send/event 转给父进程。
 * DEVA_HOME / HOME / cwd 由父进程按用户注入，因此每个用户的配置、密钥、会话、
 * 工作区互不可见。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let backend = null
let closing = false

function fail(error) {
  console.error('[worker] fatal:', error)
  process.exit(1)
}

process.on('uncaughtException', (error) => console.error('[worker] uncaught:', error))
process.on('unhandledRejection', (error) => console.error('[worker] unhandled:', error))

async function main() {
  const { createBackend } = require('../../dist/backend.cjs')
  backend = await createBackend({
    onEvent: (channel, payload) => {
      if (process.connected) process.send({ t: 'event', channel, payload })
    }
  })
  process.send({ t: 'ready', channels: backend.channels() })
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.t === 'shutdown') {
    closing = true
    setTimeout(() => process.exit(0), 100)
    return
  }
  if (!backend) return
  if (msg.t === 'invoke') {
    try {
      const value = await backend.invoke(msg.channel, msg.args ?? [])
      if (process.connected) process.send({ t: 'reply', id: msg.id, ok: true, value: value ?? null })
    } catch (error) {
      if (process.connected) {
        process.send({ t: 'reply', id: msg.id, ok: false, error: String(error?.message ?? error) })
      }
    }
    return
  }
  if (msg.t === 'send') {
    try {
      backend.send(msg.channel, msg.args ?? [])
    } catch (error) {
      console.error('[worker] send failed:', error)
    }
  }
})

process.on('disconnect', () => {
  if (!closing) process.exit(0)
})

main().catch(fail)
