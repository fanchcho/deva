import type { WebSession } from '../shared/remote-web'
export function isUnread(s: WebSession, seen: Map<string, number>): boolean {
  if (s.busy || s.waiting || s.previewRole !== 'assistant') return false
  return s.updatedAt > Math.max(seen.get(s.id) ?? 0, s.readAt ?? 0)
}
