export class JsonLineBuffer {
  constructor(maxBytes = 8 * 1024 * 1024) { this.maxBytes = maxBytes; this.buffer = '' }
  push(chunk) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > this.maxBytes) throw new Error('MCP_PROTOCOL_LIMIT: stdio frame/buffer exceeds limit')
    const lines = this.buffer.split('\n'); this.buffer = lines.pop()
    return lines
  }
}

export function writeWithBackpressure(stream, text, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', done); stream.off('error', fail); stream.off('close', closed)
      signal.removeEventListener('abort', closed)
    }
    const done = () => { cleanup(); resolve() }
    const fail = error => { cleanup(); reject(error) }
    const closed = () => fail(new Error('MCP stdio closed'))
    if (signal.aborted || !stream.writable) { closed(); return }
    stream.once('drain', done); stream.once('error', fail); stream.once('close', closed)
    signal.addEventListener('abort', closed, { once: true })
    try { if (stream.write(text)) done() } catch (error) { fail(error) }
  })
}
