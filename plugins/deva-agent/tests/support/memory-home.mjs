import { beforeEach, afterEach } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
const base = resolve('.tmp/memory-tests')
mkdirSync(base, { recursive: true })
let home
beforeEach(() => { home = mkdtempSync(join(base, 'home-')); process.env.DEVA_HOME = home })
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })
