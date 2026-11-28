import type { DisplayMessage } from './chat-protocol'
export interface HistoryPage { revision: string; from: number; to: number; messages: DisplayMessage[] }
export function turnPage(messages: DisplayMessage[], from: number, count = 10): DisplayMessage[] {
  let turn = -1
  return messages.filter(m => {
    if (m.role === 'user') turn++
    return turn >= from && turn < from + count
  })
}
export function tailSnapshot(messages: DisplayMessage[], revision: string, count = 10): DisplayMessage[] {
  const total = messages.filter(m => m.role === 'user').length
  let turn = -1
  const out: DisplayMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') turn++
    if (turn < 0 || turn >= total - count) out.push(m)
    else if (m.role === 'user') out.push({ role: 'user', text: m.text.slice(0, 160), attachments: [],
      quiet: m.quiet, notify: m.notify, deferred: { revision, turn } })
  }
  return out
}
