import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(data)
}

export function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(body)
}

export function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function readJsonBody(req) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

export function parseCookies(header) {
  const out = {}
  for (const part of String(header ?? '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      out[key] = part.slice(idx + 1).trim()
    }
  }
  return out
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c])
}

export function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 旧布局迁移：新文件不存在且旧文件存在时搬到新位置，同盘 rename，跨盘退回复制。 */
export function migrateFile(oldPath, newPath) {
  try {
    if (fs.existsSync(newPath) || !fs.existsSync(oldPath)) return false
    fs.mkdirSync(path.dirname(newPath), { recursive: true, mode: 0o700 })
    try {
      fs.renameSync(oldPath, newPath)
    } catch {
      fs.copyFileSync(oldPath, newPath)
      fs.unlinkSync(oldPath)
    }
    return true
  } catch {
    return false
  }
}

/** 目录迁移：目标已存在就不动（新布局优先），否则整目录 rename；跨盘退化为递归拷贝。 */
export function migrateDir(oldPath, newPath) {
  try {
    if (fs.existsSync(newPath) || !fs.existsSync(oldPath)) return false
    fs.mkdirSync(path.dirname(newPath), { recursive: true, mode: 0o700 })
    try {
      fs.renameSync(oldPath, newPath)
    } catch {
      fs.cpSync(oldPath, newPath, { recursive: true, force: false, errorOnExist: false })
      fs.rmSync(oldPath, { recursive: true, force: true })
    }
    return true
  } catch {
    return false
  }
}

export async function writeJsonAtomic(file, value, mode = 0o600) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode })
  await fsp.rename(tmp, file)
}

/** 登录/审计摘要用：路径参数只留末尾两段，密钥类字段永远脱敏。 */
export function summarize(value, depth = 0) {
  if (value == null) return value
  if (depth > 8) return '…'
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 12).map((v) => summarize(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 20)) {
      out[k] = /key|token|secret|password|cookie|authorization/i.test(k)
        ? '[redacted]'
        : summarize(v, depth + 1)
    }
    return out
  }
  return String(value)
}

/** 路径是否位于 root 之内（解析 .. 与符号链接的字面父目录）。 */
export function isInside(root, target) {
  const r = path.resolve(root)
  const t = path.resolve(target)
  // 根目录（/ 或 C:\）没有尾部分隔符，拼 r + sep 会变成 "//" 导致永远不匹配。
  if (r === path.parse(r).root) return t.startsWith(r)
  return t === r || t.startsWith(r + path.sep)
}
