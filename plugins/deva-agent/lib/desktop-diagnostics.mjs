import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDevaRootSource } from './deva-fs.mjs'
import { listDesktopModels } from './desktop-models.mjs'

/** Diagnostics contain metadata only; never include config or secrets file contents. */
export function desktopDiagnostics(config = {}) {
  const result = { path: '', source: '', exists: null, stat: null, providerCount: null, modelCount: null }
  try {
    const root = resolveDevaRootSource(config)
    result.path = join(root.path, 'config.json')
    result.source = root.source === 'env' ? (process.env.AI_UPPER_HOME?.trim() ? 'AI_UPPER_HOME' : 'DEVA_HOME') : root.source
    try {
      const stat = lstatSync(result.path)
      result.exists = true
      result.stat = { size: stat.size, mode: (stat.mode & 0o777).toString(8), uid: stat.uid, mtime: stat.mtime.toISOString(), file: stat.isFile(), symlink: stat.isSymbolicLink() }
    } catch (error) {
      result.exists = error.code === 'ENOENT' ? false : null
      throw error
    }
    const view = listDesktopModels(config)
    result.providerCount = view.providers.length
    result.modelCount = view.providers.reduce((n, p) => n + p.models.length, 0)
  } catch (error) {
    result.error = String(error?.message || error)
  }
  return JSON.stringify(result, null, 2)
}
