import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { json } from './util.mjs'

export async function serveDeliverable(req, res, user, url, pool) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '仅支持下载请求' })
  }
  const sessionId = url.searchParams.get('sessionId')
  const toolUseId = url.searchParams.get('toolUseId')
  const rawIndex = url.searchParams.get('index')
  if (!sessionId || !toolUseId || !/^(0|[1-9]\d*)$/.test(rawIndex ?? '')) {
    return json(res, 400, { ok: false, code: 'INVALID_DELIVERABLE', error: '交付文件标识无效' })
  }
  // Resolve through this user's backend; never accept a client-supplied filesystem path.
  const files = await pool.invoke(user, 'deliverables:inspect', [sessionId, toolUseId])
  const file = files[Number(rawIndex)]
  if (!file || file.size === null) {
    return json(res, 404, { ok: false, code: 'DELIVERABLE_NOT_FOUND', error: '交付文件不存在或无权访问' })
  }
  if (!file.openable) {
    return json(res, 415, { ok: false, code: 'WEB_FILE_TYPE_UNSUPPORTED', error: '此文件类型不支持通过 Web 打开' })
  }
  let handle
  try {
    handle = await open(file.path, 'r')
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('not a regular file')
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)),
      'content-length': stat.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    if (req.method === 'HEAD') res.end()
    else await pipeline(handle.createReadStream({ autoClose: false }), res)
  } catch {
    if (!res.headersSent) json(res, 404, { ok: false, code: 'DELIVERABLE_NOT_FOUND', error: '交付文件无法读取' })
    else res.destroy()
  } finally { await handle?.close() }
}
