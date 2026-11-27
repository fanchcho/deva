export class LruMap extends Map {
  constructor(limit = 20) { super(); this.limit = limit }
  get(key) {
    const value = super.get(key)
    if (super.has(key)) { super.delete(key); super.set(key, value) }
    return value
  }
  set(key, value) { super.delete(key); super.set(key, value); this.prune(); return this }
  prune() {
    for (const [key, value] of this) {
      if (this.size <= this.limit) break
      if (!value?.pending) super.delete(key)
    }
  }
}
export function createTtlCache(load, ttl, limit = 20) {
  const entries = new LruMap(limit)
  return {
    async get(key, input = key) {
      const hit = entries.get(key)
      if (hit?.pending) return hit.pending
      if (hit && Date.now() - hit.at < ttl) return hit.value
      const entry = { pending: null, at: Date.now() }
      entry.pending = Promise.resolve().then(() => load(input)).then(value => {
        entry.pending = null; entry.value = value; entry.at = Date.now(); entries.prune()
        return value
      }, error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.set(key, entry)
      return entry.pending
    },
    invalidate() { entries.clear() },
  }
}
