import { promises as fs, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { acquireFileLock } from './file-lock.mjs'
interface Entry { size: number; mtime: number; ctime: number; refs: string[] }

async function readIndex(file: string): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>()
  const input = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let header = true
  try {
    for await (const line of lines) {
      const value = JSON.parse(line)
      if (header) { if (value.version !== 2) throw new Error('Unknown index'); header = false }
      else {
        if (typeof value.path !== 'string' || !Array.isArray(value.entry?.refs)) throw new Error('Invalid index')
        entries.set(value.path, value.entry)
      }
    }
    return entries
  } catch { return new Map() } finally { lines.close(); input.destroy() }
}

async function writeIndex(file: string, entries: Map<string, Entry>): Promise<void> {
  const release = acquireFileLock(file), temporary = `${file}.${randomUUID()}.tmp`
  try {
    const output = await fs.open(temporary, 'wx', 0o600)
    try {
      await output.writeFile('{"version":2}\n')
      let batch: string[] = []
      for (const [path, entry] of entries) {
        batch.push(JSON.stringify({ path, entry }))
        if (batch.length === 256) { await output.writeFile(batch.join('\n') + '\n'); batch = [] }
      }
      if (batch.length) await output.writeFile(batch.join('\n') + '\n')
      await output.sync()
    } finally { await output.close() }
    await fs.rename(temporary, file)
  } finally { try { await fs.rm(temporary, { force: true }) } finally { release() } }
}

/** Indexes are hints only. No deletion is authorized without a fresh read-only verification. */
export async function collectMediaReferences(root: string, verify = false): Promise<Set<string> | null> {
  // Missing/v1/corrupt indexes migrate by rescan. Existing v1 bytes are retained untouched.
  const file = join(root, 'media-reference-index.v2.jsonl')
  const previous = verify ? new Map<string, Entry>() : await readIndex(file)
  const next = new Map<string, Entry>(), refs = new Set<string>()
  let changed = false
  const scan = async (dir: string): Promise<void> => {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const entry of entries) {
      await new Promise<void>(resolve => setImmediate(resolve))
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { await scan(path); continue }
      if (!/\.jsonl?$/.test(entry.name)) continue
      const stat = await fs.stat(path), cached = previous.get(path)
      let value: Entry
      if (!verify && cached && cached.size === stat.size && cached.mtime === stat.mtimeMs && cached.ctime === stat.ctimeMs) value = cached
      else {
        const text = await fs.readFile(path, 'utf8')
        value = { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
          refs: [...text.matchAll(/"blob":\s*"([0-9a-f]{64})"/g)].map(m => m[1]) }
        const after = await fs.stat(path)
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('reference file changed during scan')
        changed = true
      }
      next.set(path, value)
      for (const ref of value.refs) refs.add(ref)
    }
  }
  try {
    await scan(join(root, 'chats')); await scan(join(root, 'subagents'))
    if (!verify && (changed || previous.size !== next.size)) await writeIndex(file, next)
    return refs
  } catch { return null }
}
