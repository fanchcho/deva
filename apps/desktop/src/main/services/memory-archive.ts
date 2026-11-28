import type { MemoryEntry } from './memory'

export interface ArchivedMemory extends MemoryEntry {
  reason?: 'budget' | 'entries' | 'manual'
  originalId: string
  archivedAt: number
}

export function evictionCandidates(entries: MemoryEntry[]): MemoryEntry[] {
  const recent = Date.now() - 3 * 86400000
  return [...entries].sort((a, b) =>
    Number(a.updatedAt > recent) - Number(b.updatedAt > recent) ||
    (a.lastSeenAt ?? a.createdAt) - (b.lastSeenAt ?? b.createdAt) ||
    (a.seenCount ?? 0) - (b.seenCount ?? 0) || a.createdAt - b.createdAt)
}

export function recallArchive(entries: ArchivedMemory[], query: string): ArchivedMemory[] {
  const q = query.trim().toLowerCase()
  return entries.filter(e => !q || e.id.startsWith(q) || e.originalId === q ||
    (e.title + '\n' + e.body).toLowerCase().includes(q))
}

export function checkMemories(entries: MemoryEntry[]): { stale: string[]; similar: string[][] } {
  const cutoff = Date.now() - 60 * 86400000
  const similar: string[][] = []
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i].title.replace(/[\p{P}\s]/gu, '').toLowerCase()
    if (!key) continue
    for (const other of entries.slice(i + 1)) {
      const candidate = other.title.replace(/[\p{P}\s]/gu, '').toLowerCase()
      if (candidate && (key.includes(candidate) || candidate.includes(key))) similar.push([entries[i].id, other.id])
    }
  }
  return { stale: entries.filter(e => (e.lastSeenAt ?? e.createdAt) < cutoff && (e.seenCount ?? 0) <= 1).map(e => e.id), similar }
}
