/**
 * 静态资源服务：renderer 产物 + Web 层自有资源。
 *
 * 与旧实现的差别：
 *  · 用 stat 生成弱 ETag + Last-Modified，命中 If-None-Match / If-Modified-Since 时回 304；
 *  · 非 HTML 用 createReadStream 流式发送，不再把整个文件读进内存；
 *  · HTML 需要注入启动脚本，仍整读，但 content-length 按注入后的内容计算。
 *
 * 依赖注入 rendererDir / assetsDir / injectIndex，便于单测（见 test/static.test.mjs）。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { isInside, json } from './util.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
}

// Web 层自有静态资源（Renderer 产物之外的那些），统一放 src/web，按扩展名给 MIME。
const WEB_ASSETS = new Set(['/mobile.css', '/picker.css', '/picker.js', '/favicon.svg', '/favicon.ico'])

function etagOf(info) {
  return `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
}

/** 弱比较：忽略 W/ 前缀；`*` 匹配任何现有资源。 */
function etagMatches(header, etag) {
  const target = etag.replace(/^W\//, '')
  return String(header ?? '').split(',').some((value) => {
    const candidate = value.trim()
    return candidate === '*' || candidate.replace(/^W\//, '') === target
  })
}

function isFresh(req, info, etag) {
  const inm = req.headers['if-none-match']
  if (inm !== undefined) return etagMatches(inm, etag)
  // HTTP 日期只到秒，按秒比较。
  const ims = Date.parse(req.headers['if-modified-since'] ?? '')
  return Number.isFinite(ims) && Math.floor(info.mtimeMs / 1000) <= Math.floor(ims / 1000)
}

async function sendFile(req, res, file, { cacheControl, inject = null }) {
  const info = await fsp.stat(file)
  if (!info.isFile()) throw new Error('not a file')
  const headers = {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    etag: etagOf(info),
    'last-modified': info.mtime.toUTCString()
  }
  if (isFresh(req, info, headers.etag)) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  if (inject) {
    const body = inject(await fsp.readFile(file, 'utf8'))
    headers['content-length'] = Buffer.byteLength(body)
    res.writeHead(200, headers)
    if (req.method === 'HEAD') res.end()
    else res.end(body)
    return
  }
  headers['content-length'] = info.size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

export function createStaticHandler({ rendererDir, assetsDir, injectIndex }) {
  const root = path.resolve(rendererDir)
  return async function serveStatic(req, res, urlPath) {
    if (WEB_ASSETS.has(urlPath)) {
      try {
        await sendFile(req, res, path.join(assetsDir, urlPath.slice(1)), {
          // 样式/脚本随版本变化，不许缓存；图标是静态标识，允许短缓存。
          cacheControl: urlPath.endsWith('.css') || urlPath.endsWith('.js')
            ? 'no-store'
            : 'public, max-age=3600'
        })
      } catch {
        json(res, 404, { ok: false, error: 'not found' })
      }
      return
    }
    let decoded
    try {
      decoded = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath)
    } catch {
      // 畸形百分号转义（/%E0%A4%A）是客户端错误，不是 500
      json(res, 400, { ok: false, error: 'bad request path' })
      return
    }
    const abs = path.resolve(root, decoded.replace(/^\/+/, ''))
    if (!isInside(root, abs)) {
      json(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    const ext = path.extname(abs).toLowerCase()
    try {
      await sendFile(req, res, abs, {
        cacheControl: ext === '.html' ? 'no-store' : 'public, max-age=3600',
        inject: ext === '.html' ? injectIndex : null
      })
    } catch {
      json(res, 404, { ok: false, error: 'not found' })
    }
  }
}
