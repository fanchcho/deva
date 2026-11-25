/**
 * 桌面端 persona 文件的格式层：与 `apps/desktop/src/main/services/frontmatter.ts` /
 * `personas.ts#composePersonaMd` 同一口径，保证两端读写同一份 `.md` 时逐字节兼容。
 *
 *  · frontmatter 只认文件开头的 `---` 块与 `key: 标量`；
 *  · 值含 `: # [ ] { } " ' 换行` 或首尾空白时用双引号并转义 `\` / `"`（与 fmScalar 对称）；
 *  · 正文 = 结束行之后的全部内容（去掉紧随的一个空行），写盘时 trim。
 */

import { createHash } from 'node:crypto'

/** 桌面 `isSafeId`：文件名即身份 id，禁止 `..` 与路径分隔符。 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export function isPersonaId(id) {
  return typeof id === 'string' && ID_RE.test(id) && id !== '.' && id !== '..'
}

function stripQuotes(value) {
  const text = value.trim()
  if (text.length >= 2 && text[0] === '"' && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (text.length >= 2 && text[0] === "'" && text.endsWith("'")) return text.slice(1, -1)
  return text
}

/** 解析 frontmatter：返回 `{ data, body }`；没有有效头部时 data 为空、body 为原文。 */
export function parseFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { data: {}, body: text }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return { data: {}, body: text }
  const data = {}
  for (let i = 1; i < end; i++) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i])
    if (!match) continue
    const rest = match[2].trim()
    // 桌面还支持内联数组/缩进列表/映射；角色文件只用标量，其余形状按空串处理（与 fmString 一致）。
    if (rest.startsWith('[') || rest === '') continue
    data[match[1]] = stripQuotes(rest)
  }
  let bodyStart = end + 1
  if (lines[bodyStart] !== undefined && lines[bodyStart].trim() === '') bodyStart++
  return { data, body: lines.slice(bodyStart).join('\n') }
}

/** 桌面 `fmScalar`：特殊字符或首尾空白时加双引号并转义。 */
export function fmScalar(value) {
  const text = String(value ?? '')
  if (text === '') return '""'
  if (/[:#[\]{}"'\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return text
}

/** 组装 persona 文件：frontmatter 只写非空标量 + 正文（与桌面 composePersonaMd 一致）。 */
export function composePersonaFile({ name, description = '', avatar = '', model = '', workspace = '', prompt = '' }) {
  const lines = ['---', `name: ${fmScalar(name)}`]
  if (description) lines.push(`description: ${fmScalar(description)}`)
  if (avatar) lines.push(`avatar: ${fmScalar(avatar)}`)
  if (model) lines.push(`model: ${fmScalar(model)}`)
  if (workspace) lines.push(`workspace: ${fmScalar(workspace)}`)
  lines.push('---', '', String(prompt).trim(), '')
  return lines.join('\n')
}

/** Replace only the editable metadata and body; keep desktop-only header lines verbatim. */
export function editPersonaFile(raw, { name, description, prompt }) {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const newline = raw.match(/\r?\n/)?.[0] ?? '\n'
  const lines = raw.slice(bom.length).split(/\r?\n/)
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && line.trim() === '---') : -1
  const edited = [`name: ${fmScalar(name)}`]
  if (description) edited.push(`description: ${fmScalar(description)}`)
  const other = []
  for (let i = 1; i < end; i++) {
    const match = /^(?:name|description)\s*:\s*(.*)$/.exec(lines[i])
    if (!match) other.push(lines[i])
    else if (!match[1].trim()) {
      while (i + 1 < end && /^\s+(?:-\s+|[A-Za-z0-9_.-]+\s*:)/.test(lines[i + 1])) i++
    }
  }
  return bom + [lines[0]?.trim() === '---' && end > 0 ? lines[0] : '---', ...edited, ...other,
    end > 0 ? lines[end] : '---', '', ...prompt.split(/\r?\n/), ''].join(newline)
}

/** 桌面 `promptHash`：统一换行、去首尾空白后取 sha256。 */
export function promptHash(prompt) {
  return createHash('sha256').update(String(prompt ?? '').replace(/\r\n/g, '\n').trim()).digest('hex')
}
