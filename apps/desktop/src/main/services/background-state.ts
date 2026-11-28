import { getSession, save as saveProject } from './chat-store'

/** 已有结论（未被用户停止）、还在等同组其余几个的后台子智能体组：最后一个哪怕是被停止的也照样唤醒。 */
export const bgGroupsWaiting = new Set<string>()

/** 后台子智能体 Task 卡的状态落边车（background + summaries），重开对话时据此还原。 */
export function setBackgroundState(
  sessionId: string,
  toolUseId: string,
  state: 'running' | 'ok' | 'error',
  summary: string
): void {
  const s = getSession(sessionId)
  if (!s) return
  s.background = { ...s.background, [toolUseId]: state }
  s.summaries = { ...s.summaries, [toolUseId]: summary }
  saveProject(sessionId)
}

