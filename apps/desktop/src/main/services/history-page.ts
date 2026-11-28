import { createHash } from 'node:crypto'
import { displayOf, displaySession } from './chat-display'
import { turnRanges } from './chat-history'
import type { StoredSession } from './chat-store'
import type { HistoryPage } from '../../shared/history-page'
function revision(s: StoredSession, count: number): string {
  const end = turnRanges(s.messages)[count]?.start ?? s.messages.length
  const hash = createHash('sha256')
  for (let i = 0; i < end; i++) hash.update(JSON.stringify(s.messages[i]))
  hash.update(JSON.stringify([s.proposals,s.notices,s.asks,s.summaries,s.plans,s.autotasks,s.todos,s.background,s.durations]))
  return `${count}:${hash.digest('hex')}`
}
export function loadTail(id: string) {
  const s = displaySession(id)
  if (!s) return []
  const count = turnRanges(s.messages).length, from = Math.max(0, count - 10)
  return displayOf(s, { from, to: count, heads: revision(s, from) })
}
export function loadPage(id: string, cursor: string, from: number): HistoryPage | null {
  const s = displaySession(id), count = Number(cursor.split(':')[0])
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 0) throw new Error('Invalid history turn')
  if (!s || revision(s, count) !== cursor) return null
  const to = Math.min(from + 10, count)
  return { revision: cursor, from, to, messages: displayOf(s, { from, to }) }
}
