/** Optional extractive summary for Hermes/Ekko ordinary chats only; Studio owns history rewriting. */
export function summarizeConversation(input, run) {
  if (run.config?.compressionEnabled !== true || run.signal?.aborted) return null
  if (!Number.isSafeInteger(input.summaryBudget) || input.summaryBudget < 128 || !input.transcript?.trim()) return null
  const prefix = `${input.previousSummary ? `${input.previousSummary}\n` : ''}[Deva extractive summary; omitted middle content]\n`
  // Use UTF-8 bytes as a conservative upper bound, leaving host validation authoritative.
  const budget = Math.min(input.summaryBudget, 16000)
  const room = budget - Buffer.byteLength(prefix)
  if (room < 64) return null // Never discard the previous summary just to squeeze in new text.
  const chars = [...input.transcript]
  let head = '', tail = '', used = 0
  for (const ch of chars) { const size = Buffer.byteLength(ch); if (used + size > Math.floor(room * 0.6)) break; head += ch; used += size }
  for (const ch of chars.reverse()) { const size = Buffer.byteLength(ch); if (used + size + 5 > room) break; tail = ch + tail; used += size }
  return `${prefix}${head}\n...\n${tail}`
}
export function registerCompression(ctx) {
  if (ctx.config?.compressionEnabled !== true) return
  if (typeof ctx.extensions.compression?.register !== 'function') {
    ctx.log.warn('deva: compression 已开启，但宿主未提供注册接口；保持宿主内置摘要器')
    return
  }
  ctx.lifecycle.add(ctx.extensions.compression.register(summarizeConversation))
}
