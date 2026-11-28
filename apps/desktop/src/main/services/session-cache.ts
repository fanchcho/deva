/** A budgeted cache; dirty and pinned sessions are never evicted. Budgets are soft for pins. */
export class SessionCache<T> extends Map<string, T> {
  private sizes = new Map<string, number>()
  private saved = new Set<string>()
  protectedSession: (id: string) => boolean = () => false
  maxCount = Number(process.env.DEVA_SESSION_CACHE_COUNT) || 20
  maxBytes = Number(process.env.DEVA_SESSION_CACHE_BYTES) || 256 * 1024 * 1024

  override get(id: string): T | undefined {
    const value = super.get(id)
    if (value !== undefined) { super.delete(id); super.set(id, value) }
    return value
  }

  committed(id: string): void {
    const value = super.get(id)
    if (value === undefined) return
    this.saved.add(id)
    this.sizes.set(id, Buffer.byteLength(JSON.stringify(value)) * 2)
    this.prune(id)
  }

  dirty(id: string): void { this.saved.delete(id) }

  prune(keep = ''): void {
    let bytes = [...this.sizes.values()].reduce((a, b) => a + b, 0)
    for (const id of this.keys()) {
      if (this.size <= this.maxCount && bytes <= this.maxBytes) break
      if (id === keep || !this.saved.has(id) || this.protectedSession(id)) continue
      bytes -= this.sizes.get(id) ?? 0
      this.delete(id)
    }
  }

  override delete(id: string): boolean {
    this.sizes.delete(id)
    this.saved.delete(id)
    return super.delete(id)
  }
}
