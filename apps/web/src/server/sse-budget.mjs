// The queue and Node's socket buffer share one per-connection byte budget.
export class SseBudget {
  constructor({ maxBuffer = Number(process.env.DEVA_SSE_MAX_BUFFER ?? 1048576), maxConns = Number(process.env.DEVA_SSE_MAX_CONNS ?? 4) } = {}) {
    if (![maxBuffer, maxConns].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid SSE budget')
    this.maxBuffer = maxBuffer; this.maxConns = maxConns; this.users = new Map()
  }
  add(user, req, res) {
    const set = this.users.get(user) ?? new Set()
    if (set.size >= this.maxConns) { this.resync(res); return null }
    this.users.set(user, set)
    const client = { res, queue: [], bytes: 0, blocked: false }
    set.add(client)
    const cleanup = () => {
      clearInterval(client.timer); res.off('drain', drain)
      set.delete(client); client.queue = []; client.bytes = 0
      if (!set.size) this.users.delete(user)
    }
    const drain = () => {
      client.blocked = false
      while (client.queue.length && !client.blocked) {
        const frame = client.queue.shift(); client.bytes -= Buffer.byteLength(frame)
        try { client.blocked = !res.write(frame) } catch { cleanup(); this.resync(res); return }
      }
    }
    client.cleanup = cleanup
    res.on('drain', drain); req.on('close', cleanup); res.on('close', cleanup)
    client.timer = setInterval(() => this.write(client, ': ping\n\n'), 15000)
    client.timer.unref?.()
    this.write(client, ': connected\n\n')
    return client
  }
  resync(res, terminal = '') {
    try { res.end(terminal + 'event: resync\ndata: {"reason":"SSE_OVERLOADED","snapshotRequired":true,"terminalDelivery":"unconfirmed"}\n\n') } catch { res.destroy() }
    const timer = setTimeout(() => res.destroy(), 1000); timer.unref?.()
    res.once('close', () => clearTimeout(timer))
  }
  write(client, frame, terminal = false) {
    const { res } = client
    if ((res.writableLength ?? 0) + client.bytes + Buffer.byteLength(frame) > this.maxBuffer) {
      const priority = terminal && (res.writableLength ?? 0) + Buffer.byteLength(frame) <= this.maxBuffer ? frame : ''
      client.cleanup(); this.resync(res, priority); return
    }
    try {
      if (client.blocked) { client.queue.push(frame); client.bytes += Buffer.byteLength(frame) }
      else client.blocked = !res.write(frame)
    } catch { client.cleanup(); this.resync(res) }
  }
  broadcast(user, channel, payload) {
    const frame = `data: ${JSON.stringify({ channel, payload: payload ?? null })}\n\n`
    for (const client of this.users.get(user) ?? []) this.write(client, frame, ['done', 'error'].includes(payload?.event?.type))
  }
}
