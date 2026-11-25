/** G06: bounded attachment conversion, shared by current input and historical messages. */
import { validateStored } from './storage-contracts.mjs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, extname } from 'node:path'

const MiB = 1024 * 1024
const binaryExtensions = new Set(['.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.mp4', '.doc', '.docx', '.xls', '.xlsx'])
const positive = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)

export async function createAttachmentReader(run, { now = Date.now } = {}) {
  const config = run.config || {}
  const maxFile = positive(config.attachmentMaxFileBytes, 2 * MiB)
  const maxSession = positive(config.attachmentMaxSessionBytes, 8 * MiB)
  const ttl = positive(config.attachmentTtlMs, 24 * 60 * 60 * 1000)
  const roots = [run.paths?.workspaceDir, ...(config.attachmentAllowedRoots || [])].filter(p => typeof p === 'string' && isAbsolute(p))
  const store = run.state?.agentSession
  const saved = await store?.get('attachments')
  const ledger = saved == null ? { schemaVersion: 1, entries: {} } : structuredClone(saved)
  if (ledger.schemaVersion !== 1 || !plain(ledger.entries)) throw new Error('附件预算记录损坏，拒绝重置预算')
  validateStored('attachments', ledger)
  const byPath = new Map()
  const persist = async () => { if (store?.set) await store.set('attachments', validateStored('attachments', ledger)) }
  const read = async block => {
    const base = { assetId: block.assetId, name: block.name || block.assetId }
    const rejected = (code, extra = {}) => ({ ...base, status: 'rejected', code, ...extra })
    if (run.signal?.aborted) throw new Error('本轮已被取消')
    let asset, path
    try {
      asset = await run.attachments.resolve(block.assetId)
      if (!asset || !isAbsolute(asset.localPath || '')) return rejected('INVALID_ASSET_PATH')
      path = resolve(asset.localPath)
      byPath.set(path, block)
      const physical = await realpath(path)
      const authorized = await Promise.all(roots.map(root => realpath(root).catch(() => null)))
      if (!authorized.some(root => root && inside(root, physical))) return rejected('OUTSIDE_AUTHORIZED_ROOT', { localPath: path })
    } catch {
      return rejected('ASSET_UNAVAILABLE', { reason: '宿主未返回可访问附件或文件已删除；请重新上传' })
    }
    const key = block.assetId
    let entry = Object.hasOwn(ledger.entries, key) ? ledger.entries[key] : null
    if (!entry) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return rejected('INVALID_ASSET_ID')
      entry = ledger.entries[key] = { firstSeenAt: now(), bytes: 0 }
      await persist()
    }
    if (!Number.isFinite(entry.firstSeenAt) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('附件预算条目损坏')
    // SDK 0.8.30 has no upload timestamp. TTL begins at the first successful resolution.
    if (now() >= entry.firstSeenAt + ttl || Number.isFinite(asset.expiresAt) && now() >= asset.expiresAt) return rejected('ATTACHMENT_EXPIRED', { localPath: path, expiresAt: entry.firstSeenAt + ttl })
    let file
    try {
      file = await open(path, 'r')
      // Revalidate after open as well; Linux's descriptor path resolves the file actually opened.
      const actual = await realpath(`/proc/self/fd/${file.fd}`).catch(() => realpath(path))
      const allowed = await Promise.all(roots.map(root => realpath(root).catch(() => null)))
      if (!allowed.some(root => root && inside(root, actual))) return rejected('OUTSIDE_AUTHORIZED_ROOT', { localPath: path })
      const stat = await file.stat()
      if (!stat.isFile()) return rejected('NOT_A_FILE', { localPath: path })
      if (stat.size > maxFile) return rejected('FILE_BUDGET_EXCEEDED', { size: stat.size, limit: maxFile, localPath: path })
      const total = Object.values(ledger.entries).reduce((n, item) => n + item.bytes, 0)
      const nextSize = Math.max(entry.bytes, stat.size)
      if (total - entry.bytes + nextSize > maxSession) return rejected('SESSION_BUDGET_EXCEEDED', { size: stat.size, used: total, limit: maxSession, localPath: path })
      entry.bytes = nextSize; await persist()
      const meta = { ...base, status: 'ok', mediaType: asset.mediaType, size: stat.size, localPath: path, expiresAt: entry.firstSeenAt + ttl }
      const media = asset.mediaType || ''
      if (block.type !== 'image' && (binaryExtensions.has(extname(path).toLowerCase()) || !/^(text\/|application\/(json|xml|javascript|x-yaml))/.test(media))) return { ...meta, status: 'metadata_only', code: 'BINARY_NOT_TEXT', kind: 'binary', reason: '不解析二进制正文；仅提供元数据和授权绝对路径供专用工具处理' }
      // Read at most the declared budget plus one byte; growing files cannot cause an unbounded allocation.
      const bytes = Buffer.alloc(stat.size + 1)
      let used = 0
      while (used < bytes.length) { const part = await file.read(bytes, used, bytes.length - used, null); if (!part.bytesRead) break; used += part.bytesRead }
      if (used > stat.size) return rejected('ASSET_CHANGED', { reason: '读取期间文件增长，请重试', localPath: path })
      const data = bytes.subarray(0, used)
      if (block.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(media)) return { ...meta, kind: 'image', image: { mediaType: media, dataBase64: data.toString('base64') } }
      if (data.includes(0)) return { ...meta, status: 'metadata_only', code: 'BINARY_NOT_TEXT', kind: 'binary', reason: '不解析二进制正文；仅提供元数据和授权绝对路径供专用工具处理' }
      try { return { ...meta, kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(data) } }
      catch { return { ...meta, status: 'metadata_only', code: 'BINARY_NOT_TEXT', kind: 'binary', reason: '不解析二进制正文；仅提供元数据和授权绝对路径供专用工具处理' } }
    } catch {
      return rejected('ASSET_READ_FAILED', { localPath: path })
    } finally { await file?.close() }
  }
  return { read, async readPath(path) { const block = byPath.get(resolve(run.paths?.workspaceDir || '.', path)); return block ? read(block) : null } }
}

export async function convertContent(role, blocks, reader) {
  const text = (blocks || []).filter(b => b?.type === 'text').map(b => b.text).join('\n').slice(0, 200000)
  const notes = [], images = []
  for (const block of blocks || []) {
    if (!['file', 'image'].includes(block?.type)) continue
    const result = await reader.read(block)
    const { image, ...metadata } = result
    if (image) images.push(image)
    notes.push(JSON.stringify({ attachment: metadata }))
  }
  // Attachment rejections/metadata are never hidden by truncating the user's text.
  return { role, text: [text, ...notes].filter(Boolean).join('\n\n'), ...(images.length ? { images } : {}) }
}

export async function convertHistory(history, reader) {
  const messages = []
  if ((history || []).length > 200) messages.push({ role: 'user', text: JSON.stringify({ history: { code: 'HISTORY_LIMIT', omittedMessages: history.length - 200, reason: '仅加载最近 200 条；更早附件未读取' } }) })
  for (const message of (history || []).slice(-200)) {
    if (!['user', 'assistant', 'tool', 'system'].includes(message.role)) continue
    const converted = await convertContent(message.role, message.content, reader)
    if (message.role === 'tool') Object.assign(converted, { toolCallId: message.toolCallId || '', name: 'tool' })
    if (converted.text || converted.images?.length || message.role === 'tool') messages.push(converted)
  }
  return messages
}

/** Checkpoint payloads are refreshed through assetId so expiry/root changes cannot revive old attachment data. */
export async function refreshAttachments(messages, reader) {
  for (const message of messages) {
    const parts = String(message.text || '').split('\n\n')
    let found = false
    const images = []
    for (let i = 0; i < parts.length; i++) {
      let old
      try { old = JSON.parse(parts[i]).attachment } catch { continue }
      if (!old || typeof old.assetId !== 'string') continue
      found = true
      const { image, ...attachment } = await reader.read({ assetId: old.assetId, name: old.name, type: old.kind === 'image' ? 'image' : 'file' })
      parts[i] = JSON.stringify({ attachment })
      if (image) images.push(image)
    }
    if (found) { message.text = parts.join('\n\n'); delete message.images; if (images.length) message.images = images }
  }
}
