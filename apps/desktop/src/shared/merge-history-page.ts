/** Replace complete global turns, including already loaded overlap, preserving the live tail. */
export function mergeHistoryPage<T extends { role: string; deferred?: { revision: string; turn: number } }>(
  messages: T[], page: { from: number; to: number; revision: string }, incoming: T[]
): T[] {
  if (!messages.some(m => m.deferred?.revision === page.revision && m.deferred.turn >= page.from && m.deferred.turn < page.to)) return messages
  let turn = -1, start = -1, end = messages.length
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue
    turn++
    if (turn === page.from) start = i
    if (turn === page.to) { end = i; break }
  }
  if (start < 0) return messages
  return [...messages.slice(0, start), ...incoming, ...messages.slice(end)]
}
