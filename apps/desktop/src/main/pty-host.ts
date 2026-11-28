/**
 * PTY 宿主：运行于独立的 Electron Utility Process（非主进程）。
 *
 * 为什么隔离：node-pty 是原生模块，且真实 shell 可能崩溃/卡死。放在 Utility Process
 * 里，崩溃只波及它自己，主进程与窗口不受牵连（见 docs/modules/ide-features.md §4）。
 * 主进程仅做消息中继，渲染层永不触碰 Node。
 *
 * 通信：与主进程通过 `process.parentPort`（MessagePort 语义）收发结构化消息。
 * 线缆类型按项目约定在本文件内结构化复述，不跨层 import。
 */
import * as pty from '@lydell/node-pty'
import { launchPty } from './pty-launch'

/** 主进程 → 宿主 的入站消息。 */
type InboundMessage =
  | {
      type: 'create'
      id: string
      cols: number
      rows: number
      cwd: string | null
      shellPath?: string
      shellArgs?: string[]
    }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'dispose'; id: string }

/** 宿主 → 主进程 的出站消息。 */
type OutboundMessage =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; error?: string }

const sessions = new Map<string, pty.IPty>()

const parentPort = process.parentPort

function post(msg: OutboundMessage): void {
  parentPort.postMessage(msg)
}

function handleCreate(msg: Extract<InboundMessage, { type: 'create' }>): void {
  let proc: pty.IPty
  try {
    proc = launchPty(msg, { spawn: pty.spawn })
  } catch (err) {
    // 起不来（如 shell 缺失）：补发一个 exit，让渲染层给出反馈而非空等。
    post({ type: 'exit', id: msg.id, exitCode: -1, error: err instanceof Error ? err.message : String(err) })
    return
  }
  sessions.set(msg.id, proc)
  proc.onData((data) => post({ type: 'data', id: msg.id, data }))
  proc.onExit(({ exitCode }) => {
    post({ type: 'exit', id: msg.id, exitCode })
    sessions.delete(msg.id)
  })
}

parentPort.on('message', (e: Electron.MessageEvent) => {
  const msg = e.data as InboundMessage
  switch (msg.type) {
    case 'create':
      handleCreate(msg)
      break
    case 'input':
      sessions.get(msg.id)?.write(msg.data)
      break
    case 'resize':
      try {
        sessions.get(msg.id)?.resize(msg.cols, msg.rows)
      } catch {
        /* 窗口尺寸过小或会话已结束时 resize 可能抛错，忽略 */
      }
      break
    case 'dispose':
      try {
        sessions.get(msg.id)?.kill()
      } catch {
        /* 已退出的会话再 kill 会抛错，忽略 */
      }
      sessions.delete(msg.id)
      break
  }
})
