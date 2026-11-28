// Drafts live in Composer; pin their runtimes without importing UI into the store.
export const runtimeDraftPins = new Set<string>()
export function trimRuntimes<T>(map: Map<string, T>, pinned: (id: string, value: T) => boolean, limit = 20): string[] {
  const removed: string[] = []
  for (const [id, value] of map) {
    if (map.size <= limit) break
    if (runtimeDraftPins.has(id) || pinned(id, value)) continue
    map.delete(id); removed.push(id)
  }
  return removed
}
