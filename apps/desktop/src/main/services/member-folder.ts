import { getSession, save as saveProject, type StoredSession } from './chat-store'
import { publishSessionsChanged } from './chat-bus'

export function setMemberFolder(sub: StoredSession, folder: string | null): void {
  const main = sub.parentId ? getSession(sub.parentId) : undefined
  const ref = main?.members?.find((m) => m.sessionId === sub.id)
  if (main && ref) {
    ref.root = folder
    saveProject(main.id)
  }
  sub.focusRoot = folder
  saveProject(sub.id)
  publishSessionsChanged()
}
