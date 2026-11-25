/**
 * SSE 帧解析（零依赖，模型适配器与 MCP 客户端共用）。
 *
 * 网络分块不会按行边界切：`\r` 和 `\n` 可能落在两个 chunk 里。
 * 这里先把行尾统一成 `\n`，再按空行切帧，跨块时保留未完成的半帧；
 * 流结束时把没有空行收尾的最后一段也交出来，避免尾帧被静默丢掉。
 */
export class SseParser {
  constructor() {
    this.buffer = ''
    /** 上一块以 `\r` 结尾：可能是下一块 `\n` 的前半，先扣下。 */
    this.pendingCR = false
  }

  /** 追加一块文本，返回已经完整的帧：[{ event, data }]。 */
  push(text) {
    let chunk = String(text ?? '')
    if (this.pendingCR) {
      chunk = `\r${chunk}`
      this.pendingCR = false
    }
    if (chunk.endsWith('\r')) {
      this.pendingCR = true
      chunk = chunk.slice(0, -1)
    }
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return this.#drain()
  }

  /** 流结束：补上行尾、交出完整帧，再把没有空行收尾的残留也作为一帧返回。 */
  flush() {
    if (this.pendingCR) {
      this.pendingCR = false
      this.buffer += '\n'
    }
    const frames = this.#drain()
    if (this.buffer.trim()) {
      frames.push(parseFrame(this.buffer))
      this.buffer = ''
    }
    return frames
  }

  #drain() {
    const frames = []
    let index
    while ((index = this.buffer.indexOf('\n\n')) >= 0) {
      frames.push(parseFrame(this.buffer.slice(0, index)))
      this.buffer = this.buffer.slice(index + 2)
    }
    return frames
  }
}

function parseFrame(frame) {
  let event = 'message'
  const data = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line === 'data') data.push('')
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  return { event, data: data.join('\n') }
}
