import { useEffect } from 'react'
import type { ChatMessage } from './chat'
export const HISTORY_REQUEST = 'deva-history-request'
export function useVisibleHistory(messages: ChatMessage[], sid: string): void {
  const deferred = messages.find(m => m.deferred)?.deferred
  const revision = deferred?.revision
  const turn = deferred?.turn
  useEffect(() => {
    if (revision !== undefined && turn !== undefined) window.dispatchEvent(new CustomEvent(HISTORY_REQUEST, { detail: { sid, revision, turn } }))
  }, [sid, revision, turn])
}
