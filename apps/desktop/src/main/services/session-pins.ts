/** Window IDs own one pin; switching replaces it and destruction releases it. */
export class SessionPins {
  private windows = new Map<number, string>()
  set(window: number, session: string): void { this.windows.set(window, session) }
  hasWindow(window: number): boolean { return this.windows.has(window) }
  release(window: number): void { this.windows.delete(window) }
  has(session: string): boolean { return [...this.windows.values()].includes(session) }
}
