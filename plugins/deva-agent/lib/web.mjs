/**
 * web_fetch：唯一的上网工具（仅 http/https，超时、大小上限、HTML 转纯文本）。
 *
 * 与桌面端 tools.ts 的 web_fetch 保持同一语义，但只依赖 node 内建 fetch：
 *  · 协议白名单 http/https，重定向跟随但每次重定向后仍是同一协议；
 *  · 响应体按上限读取（超过即停止读取并标注），二进制内容不假装成文本；
 *  · HTML 去标签、解实体、保留正文；正文过长时全文写入会话运行目录，
 *    只把开头、结尾与文件路径交给模型，避免把上下文塞满。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TIMEOUT_MS = 30000
const MAX_BYTES = 5 * 1024 * 1024
const MAX_TEXT = 100000
const PREVIEW = 8000

export class WebError extends Error {}

function safeCodePoint(value) {
  const point = Number(value)
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
}

/** 解码常见 HTML 实体；&amp; 最后解，避免二次解码。 */
export function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
}

/** 手写 HTML → 纯文本（零依赖）：抽 title，去脚本/样式/注释，块级标签转换行，折叠空白。 */
export function htmlToText(html) {
  const titleMatch = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || null : null
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
  text = text.replace(/<\/?(?:br|p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|blockquote|pre)[^>]*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
  text = text.replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title, text }
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 4096)
  for (const byte of sample) if (byte === 0) return true
  return false
}

/** 只读到上限为止；超出时返回 capped=true，不把无限响应读进内存。 */
async function readCapped(response, limit) {
  const reader = response.body?.getReader()
  if (!reader) return { buffer: Buffer.alloc(0), capped: false }
  const chunks = []
  let total = 0
  let capped = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      if (total + chunk.length > limit) {
        chunks.push(chunk.subarray(0, limit - total))
        capped = true
        break
      }
      chunks.push(chunk)
      total += chunk.length
    }
  } finally {
    try { await reader.cancel() } catch { /* 已经结束 */ }
  }
  return { buffer: Buffer.concat(chunks), capped }
}

async function spill(text, runtimeDir) {
  if (!runtimeDir) return null
  try {
    const name = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
    const dir = join(runtimeDir, 'web')
    await mkdir(dir, { recursive: true })
    const full = join(dir, name)
    await writeFile(full, text, 'utf8')
    return full
  } catch {
    return null
  }
}

/** 正文过长：全文落盘，返回开头 + 结尾 + 路径。落盘失败就明确说明被截断。 */
async function boundText(text, runtimeDir) {
  if (text.length <= MAX_TEXT) return text
  const full = await spill(text, runtimeDir)
  const head = text.slice(0, PREVIEW)
  const tail = text.slice(-PREVIEW)
  return [
    `（正文 ${text.length} 字符，超过 ${MAX_TEXT}，以下为开头与结尾）`,
    head,
    '\n…\n',
    tail,
    full
      ? `\n完整内容已写入：${full}（可用 read_file 分段读取）`
      : '\n（全文未落盘：本轮没有可写的运行目录，中间内容已丢弃）',
  ].join('\n')
}

/** 供模型使用的工具定义。 */
export const WEB_TOOL = {
  name: 'web_fetch',
  description: '获取一个网页 / HTTP(S) 资源并转为可读文本：HTML 自动去标签、解码实体，JSON / 纯文本原样返回。仅支持 http/https，有超时与大小上限；正文超过 100000 字符时全文存入本轮运行目录，只返回开头、结尾与文件路径。需要 JS 渲染或登录的页面无法读取。',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要获取的完整 URL，必须以 http:// 或 https:// 开头' },
    },
    required: ['url'],
    additionalProperties: false,
  },
}

/**
 * 执行 web_fetch。ctx = { signal, runtimeDir, log }
 * 失败一律抛 WebError，由调用方转成工具结果交回模型。
 */
export async function executeWebFetch(input, ctx = {}) {
  const raw = String(input?.url ?? '').trim()
  if (!raw) throw new WebError('url 不能为空')
  let url
  try { url = new URL(raw) } catch { throw new WebError(`URL 无效：${raw}`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebError(`仅支持 http/https（收到 ${url.protocol}）`)
  if (ctx.signal?.aborted) throw new WebError('本轮已被取消')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = () => controller.abort()
  ctx.signal?.addEventListener?.('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Deva-Studio-Plugin/1 (+https://github.com/sqfcyily/deva)',
        accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    const type = String(response.headers.get('content-type') || '').toLowerCase()
    const { buffer, capped } = await readCapped(response, MAX_BYTES)
    if (!response.ok) throw new WebError(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    const textual = ['html', 'json', 'xml', 'text', 'javascript'].some(token => type.includes(token)) || type === ''
    if (!textual && looksBinary(buffer)) throw new WebError(`非文本内容（${type || '未知类型'}），未加载`)
    const rawText = buffer.toString('utf8')
    const isHtml = type.includes('html') || /^\s*(?:<!doctype html|<html)/i.test(rawText)
    const { title, text } = isHtml ? htmlToText(rawText) : { title: null, text: rawText }
    const header = [
      `URL: ${response.url || url.href}`,
      title ? `标题: ${title}` : null,
      `类型: ${type || '未知'}`,
      capped ? `（响应体超过 ${MAX_BYTES} 字节，已截断）` : null,
    ].filter(Boolean).join('\n')
    const body = await boundText(text.trim() || '（无可读文本内容）', ctx.runtimeDir)
    return `${header}\n\n${body}`
  } catch (error) {
    if (ctx.signal?.aborted) throw new WebError('本轮已被取消')
    if (error?.name === 'AbortError') throw new WebError(`请求超时（>${TIMEOUT_MS / 1000}s）`)
    if (error instanceof WebError) throw error
    throw new WebError(`获取失败：${error?.message || error}`)
  } finally {
    clearTimeout(timer)
    ctx.signal?.removeEventListener?.('abort', onAbort)
  }
}
