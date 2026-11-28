import { registerChannelServerIpc } from '@deva/main/services/channel-server'
import { hasActiveTurns } from '@deva/main/services/chat-state'
/**
 * Web 后端入口：按 main/index.ts 的顺序注册真实业务模块，
 * 只是不创建窗口，事件改由 SSE 广播。
 */
import {
  app,
  ipcMain,
  BrowserWindow,
  setEventSink,
  __invoke,
  __send,
  __listChannels
} from 'electron'

import { registerConfigIpc } from '@deva/main/services/config'
import { registerRoleHomeIpc } from '@deva/main/services/role-home'
import { registerWorkspaceIpc } from '@deva/main/services/workspace'
import { registerSecretsIpc } from '@deva/main/services/secrets'
import { registerProviderIpc } from '@deva/main/services/provider'
import { registerContextUsageIpc } from '@deva/main/services/context-usage'
import { registerReadSyncIpc } from '@deva/main/services/read-sync'
import { registerChatIpc } from '@deva/main/services/chat'
import { listSessions } from '@deva/main/services/chat-store'
import { sweepCheckpoints } from '@deva/main/services/checkpoints'
import { sweepSubagents } from '@deva/main/services/subagent-store'
import { sweepMedia } from '@deva/main/services/media-store'
import { registerSkillsIpc, startSkillsWatcher } from '@deva/main/services/skills'
import {
  ensureSeededPersonas,
  pruneOrphanExtRoles,
  registerPersonasIpc
} from '@deva/main/services/personas'
import { registerProfileIpc } from '@deva/main/services/profile'
import { registerMemoryIpc } from '@deva/main/services/memory'
import { autoConnectEnabledServers, registerMcpIpc } from '@deva/main/services/mcp'
import { registerAttachmentsIpc } from '@deva/main/services/attachments'
import { registerTerminalIpc } from '@deva/main/services/terminal'
import { registerGitIpc } from '@deva/main/services/git'
import { registerClipboardIpc } from '@deva/main/services/clipboard'
import { registerDeliverablesIpc } from '@deva/main/services/deliverables'
import { registerTasksIpc } from '@deva/main/services/tasks'
import { startScheduler } from '@deva/main/services/scheduler'
import { registerRemoteIpc } from '@deva/main/services/remote'
import { registerUpdaterIpc } from '@deva/main/services/updater'
import { registerBrowserIpc, setMainWindowGetter } from '@deva/main/services/browser'
import { trustRoot } from '@deva/main/services/fs-guard'

export interface BackendOptions {
  onEvent: (channel: string, payload: unknown) => void
}

export interface Backend {
  invoke: (channel: string, args: unknown[]) => Promise<unknown>
  send: (channel: string, args: unknown[]) => void
  channels: () => string[]
  hasActiveTurns: () => boolean
}

function step(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`[backend] ${name} ok`)
  } catch (error) {
    console.error(`[backend] ${name} failed:`, error)
  }
}

export async function createBackend(options: BackendOptions): Promise<Backend> {
  ;(setEventSink as unknown as (fn: BackendOptions['onEvent']) => void)(options.onEvent)

  await app.whenReady()

  // 窗口对象只作为事件出口；所有 send 都转到 SSE
  const win = new BrowserWindow({ width: 1440, height: 900 })
  const getWindow = () => win as never

  // 用户上次手动选择、且已持久化的目录，在 worker 重启后重新登记为受信根。
  try {
    const extra = JSON.parse(process.env.DEVA_WEB_TRUST_ROOTS ?? '[]')
    if (Array.isArray(extra)) {
      for (const dir of extra) if (typeof dir === 'string' && dir) trustRoot(dir)
    }
  } catch {
    /* 坏值忽略，按默认工作区启动 */
  }

  step('window channels', () => {
    ipcMain.handle('window:minimize', () => undefined)
    ipcMain.handle('window:toggle-maximize', () => undefined)
    ipcMain.handle('window:close', () => undefined)
    ipcMain.handle('window:is-fullscreen', () => false)
    ipcMain.handle('window:set-overlay', () => undefined)
    ipcMain.handle('app:get-platform', () => process.platform)
  })

  step('config', () => registerConfigIpc())
  step('role-home', () => registerRoleHomeIpc())
  step('workspace', () => registerWorkspaceIpc(getWindow))
  step('secrets', () => registerSecretsIpc())
  step('provider', () => registerProviderIpc())
  step('chat', () => registerChatIpc(getWindow))
  step('context-usage', () => registerContextUsageIpc())
  step('read-sync', () => registerReadSyncIpc(getWindow))
  step('remote', () => registerRemoteIpc(getWindow))
  step('general devices', () => registerChannelServerIpc(getWindow))

  const ids = listSessions().map((m) => m.id)
  void sweepCheckpoints(ids).catch((e) => console.warn('[web] sweepCheckpoints:', e))
  void sweepSubagents(ids).catch((e) => console.warn('[web] sweepSubagents:', e))
  setTimeout(() => { void sweepMedia().catch((e) => console.warn('[web] sweepMedia:', e)) }, 10000).unref()

  step('skills', () => {
    registerSkillsIpc(getWindow)
    startSkillsWatcher(getWindow)
  })
  step('personas', () => {
    ensureSeededPersonas()
    pruneOrphanExtRoles()
    registerPersonasIpc()
  })
  step('profile', () => registerProfileIpc())
  step('memory', () => registerMemoryIpc())
  step('mcp', () => registerMcpIpc(getWindow))
  step('attachments', () => registerAttachmentsIpc(getWindow))
  step('terminal', () => registerTerminalIpc(getWindow))
  step('git', () => registerGitIpc())
  step('clipboard', () => registerClipboardIpc())
  step('deliverables', () => registerDeliverablesIpc())
  step('tasks', () => registerTasksIpc(getWindow))
  step('updater', () => registerUpdaterIpc(getWindow))
  step('browser', () => {
    setMainWindowGetter(getWindow)
    registerBrowserIpc()
  })

  step('mcp autoconnect', () => void autoConnectEnabledServers())
  step('scheduler', () => startScheduler(getWindow))

  return {
    invoke: (channel, args) => __invoke(channel, args),
    send: (channel, args) => __send(channel, args),
    channels: () => __listChannels(),
    hasActiveTurns
  }
}
