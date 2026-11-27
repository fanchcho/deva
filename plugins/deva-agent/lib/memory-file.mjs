import { join, dirname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { readStrictText, writeAtomic, ensurePrivateDirectory } from './deva-fs.mjs'
import { markCorrupt, assertWritable } from './corrupt-files.mjs'

export function sharedMemoryPath(scope, ctx, key) {
  const root = ctx.config?.sharedDevaHome || process.env.DEVA_HOME || join(homedir(), '.deva')
  if (!isAbsolute(root)) throw new Error('DEVA_HOME_NOT_ABSOLUTE')
  if (scope === 'role') {
    const id = ctx.identityId === 'deva' ? 'general' : ctx.identityId
    if (!id) return null
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) throw new Error('MEMORY_INVALID_PERSONA')
    return join(root, 'personas', 'memory', `${id}.json`)
  }
  if (scope === 'project') return key ? join(root, 'projects', key, 'memory.json') : null
  return join(root, 'memory.json')
}

// Each operation owns its snapshot; compare under the existing file lock before rename.
export function fileMemoryStore(path, scope, ctx) {
  let raw, document
  return {
    path,
    async get() {
      assertWritable(path)
      raw = readStrictText(path)?.raw ?? null
      try {
        document = raw === null ? { version: 2, ...(scope === 'project' ? { root: ctx.workspaceDir } : scope === 'role' ? { personaId: ctx.identityId === 'deva' ? 'general' : ctx.identityId } : {}), entries: [] } : JSON.parse(raw)
        if (!document || !Array.isArray(document.entries)) throw new Error('MEMORY_INVALID_FILE')
        return document.entries
      } catch (error) { throw markCorrupt(path, Object.assign(new Error('记忆文件损坏，只读保护；请恢复原文件后重启插件'), { code: 'MEMORY_CORRUPT', cause: error })) }
    },
    async set(_key, entries) {
      if (raw === undefined) await this.get()
      ensurePrivateDirectory(dirname(path))
      writeAtomic(path, JSON.stringify({ ...document, version: 2, entries }, null, 2), { expectedRaw: raw })
    },
  }
}
