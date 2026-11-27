import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'

const corrupt = new Map()
export function markCorrupt(file, error) {
  const path = resolve(file)
  let hash = null
  try { hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex') } catch { /* unreadable */ }
  const detail = { path, hash, errorCode: error.cause?.code ?? error.code ?? 'PARSE_ERROR', message: error.message }
  corrupt.set(path, detail)
  return Object.assign(error, detail, { readOnly: true })
}
export function assertWritable(file) {
  const detail = corrupt.get(resolve(file))
  if (detail) throw Object.assign(new Error(`${detail.message}; SESSION_CORRUPT_READ_ONLY: ${detail.path}`), detail, { code: 'SESSION_CORRUPT_READ_ONLY' })
}
export function readJsonFile(file) {
  assertWritable(file)
  let bytes
  try { bytes = fs.readFileSync(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw markCorrupt(file, error) }
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Invalid persisted JSON object'), { code: 'INVALID_SHAPE' })
    return value
  }
  catch (error) { throw markCorrupt(file, error) }
}
// Recovery creates a separate JSON branch; it never replaces the configured source.
export function recoverCorruptFile(file, confirmed) {
  if (confirmed !== true) throw new Error('SESSION_RECOVERY_CONFIRMATION_REQUIRED')
  const path = resolve(file)
  if (!corrupt.has(path)) throw new Error('SESSION_NOT_MARKED_CORRUPT')
  const backup = path.replace(/\.json$/, '') + `.corrupt-${new Date().toISOString().replace(/:/g, '-')}.json`
  fs.copyFileSync(path, backup, fs.constants.COPYFILE_EXCL)
  const branch = join(dirname(path), `${randomUUID()}.json`)
  fs.writeFileSync(branch, '{}\n', { flag: 'wx', mode: 0o600 })
  return { backup, branch }
}
