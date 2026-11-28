import { createHash } from 'node:crypto'
import type { DisplayMessage } from '../../shared/chat-protocol'
import { tailSnapshot, turnPage, type HistoryPage } from '../../shared/history-page'
function prefixRevision(messages: DisplayMessage[], count: number): string {
  return `${count}:${createHash('sha256').update(JSON.stringify(turnPage(messages, 0, count))).digest('hex')}`
}
export function snapshotTail(messages: DisplayMessage[]) {
  const count = Math.max(0, messages.filter(m => m.role === 'user').length - 10)
  return tailSnapshot(messages, prefixRevision(messages, count))
}
export function snapshotPage(messages: DisplayMessage[], revision: string, from: number): HistoryPage | null {
  const count = Number(revision.split(':')[0])
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 0) throw new Error('Invalid history turn')
  if (prefixRevision(messages, count) !== revision) return null
  return { revision, from, to: Math.min(from + 10, count), messages: turnPage(messages, from, Math.min(10, count - from)) }
}
