import { acquireFileLock } from './file-lock.mjs'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'

/** All cooperating writers use the same exclusive lock and compare while holding it. */
export function writeFileAtomic(file: string, data: string, expectedRaw?: string | null): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  let release: (() => void) | undefined
  try {
    release = acquireFileLock(file)
    if (expectedRaw !== undefined && (existsSync(file) ? readFileSync(file, 'utf8') : null) !== expectedRaw) {
      throw Object.assign(new Error('配置已被其它进程修改，请重新载入后重试'), { code: 'DEVA_CONCURRENT_WRITE' })
    }
    const fd = openSync(tmp, 'wx', 0o600)
    try { writeFileSync(fd, data, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, file)
  } finally {
    try { rmSync(tmp, { force: true }) } finally { release?.() }
  }
}
