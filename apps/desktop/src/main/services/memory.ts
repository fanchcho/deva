import { writeFileAtomic } from './atomic-write'
import { evictionCandidates, recallArchive, checkMemories, type ArchivedMemory } from './memory-archive'
import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join } from 'path'
import { getDevaHome } from './config'

/**
 * 记忆（Memory）服务 v2（方案 design/memory-v2-plan.html，借鉴 Claude Code），分三层（scope）：
 * - **global**（界面叫「关于你」）：`<DEVA_HOME>/memory.json`，用户本人的情况，以及对所有角色都适用的做事要求。
 * - **role**（角色记忆）：`<DEVA_HOME>/personas/memory/<角色 id>.json`，某个角色做自己那类工作时学到的东西；
 *   只有这个角色读写（它的定时任务、它当成员时只读）。按 id 存，改名不受影响；删角色时连同删除（先备份）。
 * - **project**（项目记忆）：`<DEVA_HOME>/projects/<key>/memory.json`，按工作区隔离的私有经验与进展，不入版本库。
 *   key = 工作区真实路径（realpath）规整后 sha1 前 24 位。团队共享的约定仍归 AGENTS.md。
 *
 * 每条记忆有类型（user 用户 / feedback 做事方式 / project 进展 / reference 资料）、一句话标题和多行正文。
 * 随消息下发的是标题索引（做事方式类附正文，见 listing.ts），其余正文由模型用 memory_read 按 id 读取——记忆再多
 * 也只占索引的上下文。上限按索引行计：条数与索引总字数两重上限，各层独立；模型写入撞上限时先自动归纳
 * （memory-consolidate.ts）。
 *
 * 旧版（v1，每条一句话 content）读到时自动转换：先备份原文件，标题取原文第一句、正文保留原文、类型暂记为 user，
 * 并标记待整理，由下一轮对话用当轮模型补上类型与标题（memory-tidy.ts）。
 *
 * 由模型经 memory_read / memory_write / memory_delete 读写（memory-tools.ts），用户经 `memory:*` IPC 在面板里查看、
 * 修改、删除；两边同一套校验。主进程单线程 + 同步读改写，多会话并行写入不会交错；写入走临时文件 + rename。
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']

export interface MemoryEntry {
  /** 稳定短 id（全局 m_ / 角色 r_ / 项目 p_ + 8 位十六进制），供读取正文、更新、删除引用。 */
  id: string
  type: MemoryType
  /** 一句话标题：进索引，只看它就能判断与当前任务是否相关。 */
  title: string
  /** 正文：规则或事实，做事方式与进展类另写原因与何时适用；可为空。 */
  body: string
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
  seenCount?: number
}

/** 写入入参：新增时 type 与 title 必填；按 id 更新时省略的字段保持原值。 */
export interface MemoryInput {
  type?: MemoryType
  title?: string
  body?: string
}

/** 记忆作用域：全局（用户本人）/ 某个角色 / 某个工作区。 */
export type MemoryScope = { kind: 'global' } | { kind: 'role'; personaId: string } | { kind: 'project'; root: string }

export const GLOBAL_SCOPE: MemoryScope = { kind: 'global' }

/**
 * 一次回合里各层记忆的读写方式（主对话全可写；项目成员全局与角色只读、项目可写；定时任务全只读）。
 * 项目记忆的工作区以 ToolContext.workspaceRoot 的实时值为准（轮中挂载后即生效），这里只记读写方式。
 */
export interface MemoryAccess {
  global: 'rw' | 'ro'
  role: { personaId: string; name: string; mode: 'rw' | 'ro' }
  project: 'rw' | 'ro'
}

/** 标题、正文字数上限（各层共用）。 */
export const MEMORY_TITLE_MAX = 60
export const MEMORY_BODY_MAX = 1500
/** 全局与每个角色：条数 / 索引总字数上限。 */
export const MEMORY_MAX_ENTRIES = 100
export const MEMORY_INDEX_BUDGET = 4000
/** 每个项目：条数 / 索引总字数上限。 */
export const PROJECT_MEMORY_MAX_ENTRIES = 60
export const PROJECT_MEMORY_INDEX_BUDGET = 3000

interface Limits {
  maxEntries: number
  budget: number
}

export function memoryLimits(scope: MemoryScope): Limits {
  return scope.kind === 'project'
    ? { maxEntries: PROJECT_MEMORY_MAX_ENTRIES, budget: PROJECT_MEMORY_INDEX_BUDGET }
    : { maxEntries: MEMORY_MAX_ENTRIES, budget: MEMORY_INDEX_BUDGET }
}

/** id 前缀 → 作用域类别（供读取 / 更新 / 删除时自动定位）。 */
export function scopeKindOfId(id: string): MemoryScope['kind'] {
  return id.startsWith('p_') ? 'project' : id.startsWith('r_') ? 'role' : 'global'
}

/** 角色 id 是否可直接当文件名（同 personas.ts 的 isSafeId）。 */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id) && id !== '.' && id !== '..'
}

/**
 * 工作区 → 稳定的项目记忆键。按真实路径算（符号链接 / 大小写不同的写法指向同一项目即同一份记忆），
 * 取不到真实路径（目录已不存在等）回落原路径。Windows / macOS 默认大小写不敏感，统一转小写。
 */
export function projectMemoryKey(root: string): string {
  let p = root
  try {
    p = realpathSync.native(root)
  } catch {
    /* 回落原路径 */
  }
  let norm = p.replace(/[\\/]+$/, '')
  if (process.platform === 'win32' || process.platform === 'darwin') norm = norm.toLowerCase()
  return createHash('sha1').update(norm).digest('hex').slice(0, 24)
}

/** 某作用域的记忆文件路径（归纳、迁移的备份放在同目录的 memory-backups/ 下）。 */
export function memoryPath(scope: MemoryScope): string {
  if (scope.kind === 'project')
    return join(getDevaHome(), 'projects', projectMemoryKey(scope.root), 'memory.json')
  if (scope.kind === 'role') return join(getDevaHome(), 'personas', 'memory', `${scope.personaId}.json`)
  return join(getDevaHome(), 'memory.json')
}

const TYPE_LABEL: Record<MemoryType, string> = { user: '用户', feedback: '做事方式', project: '进展', reference: '资料' }

/** 给模型看的类型名（界面另有自己的叫法，见 i18n）。 */
export function memoryTypeLabel(t: MemoryType): string {
  return TYPE_LABEL[t]
}

export function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === 'string' && (MEMORY_TYPES as readonly string[]).includes(v)
}

export function scopeLabel(scope: MemoryScope): string {
  return scope.kind === 'project' ? '项目记忆' : scope.kind === 'role' ? '角色记忆' : '全局记忆'
}

/** 规整标题：单行、去首尾空白。 */
export function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** 规整正文：统一换行、去首尾空白、连续空行压成一个。 */
export function normalizeBody(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 旧版一句话 → 标题：取第一句（最多 60 字），太长截断加省略号。 */
function firstSentence(content: string): string {
  const text = normalizeTitle(content)
  const m = text.match(/^.+?[。！？；!?;](?=\s|$|[^\d])/)
  const s = (m && m[0].length <= MEMORY_TITLE_MAX ? m[0] : text).replace(/[。；;，,、：:]+$/, '')
  return s.length <= MEMORY_TITLE_MAX ? s : `${s.slice(0, MEMORY_TITLE_MAX - 1)}…`
}

// ── 读写文件 ────────────────────────────────────────────────────────────────────

interface MemoryFile {
  legacyArchiveHash?: string
  archive?: ArchivedMemory[]
  entries: MemoryEntry[]
  /** 旧版转换来的条目还没由模型补上类型与标题（见 memory-tidy.ts）。 */
  tidy?: 'pending'
  /** 整理已失败的次数：到上限即放弃，保留规则转换的结果。 */
  tidyTries?: number
}

function parseEntry(raw: unknown): { entry: MemoryEntry; legacy: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string') return null
  const createdAt = Number(e.createdAt) || 0
  const updatedAt = Number(e.updatedAt) || createdAt
  if (typeof e.title === 'string') {
    return {
      entry: {
        id: e.id,
        type: isMemoryType(e.type) ? e.type : 'user',
        title: e.title,
        body: typeof e.body === 'string' ? e.body : '',
        createdAt,
        updatedAt,
        ...(Number(e.lastSeenAt) > 0 ? { lastSeenAt: Number(e.lastSeenAt) } : {}),
        ...(Number(e.seenCount) > 0 ? { seenCount: Number(e.seenCount) } : {})
      },
      legacy: false
    }
  }
  // v1：每条一句话 content。
  if (typeof e.content !== 'string') return null
  return {
    entry: { ...(Number(e.lastSeenAt) > 0 ? { lastSeenAt: Number(e.lastSeenAt) } : {}),
      ...(Number(e.seenCount) > 0 ? { seenCount: Number(e.seenCount) } : {}), id: e.id, type: 'user', title: firstSentence(e.content), body: e.content, createdAt, updatedAt },
    legacy: true
  }
}

function readMemoryFile(scope: MemoryScope): MemoryFile {
  const p = memoryPath(scope)
  const legacyArchive = join(dirname(p), 'memory-archive.json')
  if (!existsSync(p) && (scope.kind === 'role' || !existsSync(legacyArchive))) return { entries: [] }
  let parsed: { entries?: unknown; tidy?: unknown; tidyTries?: unknown; archive?: unknown; legacyArchiveHash?: string }
  let raw: string
  try {
    raw = existsSync(p) ? readFileSync(p, 'utf8') : '{"entries":[]}'
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('MEMORY_CORRUPT: 记忆文件无法读取，保留原文件并禁止覆盖')
  }
  if (!Array.isArray(parsed?.entries)) throw new Error('MEMORY_CORRUPT: entries 无效')
  const entries: MemoryEntry[] = []
  let legacy = false
  for (const r of parsed.entries) {
    const hit = parseEntry(r)
    if (!hit) throw new Error('MEMORY_INCOMPATIBLE: 无法转换的记忆条目，原文件保持不变')
    entries.push(hit.entry)
    legacy ||= hit.legacy
  }
  const archive: ArchivedMemory[] = []
  if (parsed.archive !== undefined && !Array.isArray(parsed.archive)) throw new Error('MEMORY_CORRUPT: archive 无效')
  for (const rawEntry of (parsed.archive ?? []) as unknown[]) {
    const hit = parseEntry(rawEntry)
    const meta = rawEntry as Partial<ArchivedMemory>
    if (!hit || typeof meta.originalId !== 'string' || typeof meta.archivedAt !== 'number') throw new Error('MEMORY_INCOMPATIBLE: 遗忘区条目无效')
    archive.push({ ...hit.entry, originalId: meta.originalId, archivedAt: meta.archivedAt, reason: meta.reason })
    legacy ||= hit.legacy
  }
  const file: MemoryFile = {
    entries, archive,
    legacyArchiveHash: parsed.legacyArchiveHash,
    ...(parsed.tidy === 'pending' ? { tidy: 'pending' as const } : {}),
    ...(typeof parsed.tidyTries === 'number' ? { tidyTries: parsed.tidyTries } : {})
  }
  let archiveRaw: string | undefined
  if (scope.kind !== 'role' && existsSync(legacyArchive)) {
    archiveRaw = readFileSync(legacyArchive, 'utf8')
    const hash = createHash('sha256').update(archiveRaw).digest('hex')
    if (file.legacyArchiveHash !== hash) {
      let rows: unknown
      try { rows = JSON.parse(archiveRaw).entries } catch { throw new Error('MEMORY_ARCHIVE_INCOMPATIBLE: 旧遗忘区无法解析，原文件保留：' + legacyArchive) }
      if (!Array.isArray(rows)) throw new Error('MEMORY_ARCHIVE_INCOMPATIBLE: 旧遗忘区缺少 entries：' + legacyArchive)
      for (const row of rows) {
        const hit = parseEntry(row)
        if (!hit || typeof row.originalId !== 'string' || typeof row.archivedAt !== 'number')
          throw new Error('MEMORY_ARCHIVE_INCOMPATIBLE: 旧遗忘区条目无法转换，原文件保留：' + legacyArchive)
        const twin = archive.find(e => e.id === hit.entry.id)
        if (twin && twin.title === hit.entry.title && twin.body === hit.entry.body) continue
        archive.push({ ...hit.entry, id: twin ? 'a_' + randomBytes(8).toString('hex') : hit.entry.id,
          originalId: row.originalId, archivedAt: row.archivedAt, reason: row.reason })
      }
      file.legacyArchiveHash = hash
    } else archiveRaw = undefined
  }
  if (legacy || archiveRaw !== undefined) {
    // 复用 v1 -> v2 迁移流程：先备份原字节，再一次原子写回。旧遗忘区保留，以 hash 防止重复导入。
    const dir = join(dirname(p), 'memory-backups')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(join(dir, `memory-v1-${stamp}.json`), raw, 'utf8')
    if (archiveRaw !== undefined) writeFileSync(join(dir, `archive-v1-${stamp}.json`), archiveRaw, 'utf8')
    if (legacy) file.tidy = 'pending'
    writeMemoryFile(scope, file)
  }
  return file
}

function writeMemoryFile(scope: MemoryScope, file: MemoryFile): void {
  const p = memoryPath(scope)
  mkdirSync(dirname(p), { recursive: true })
  // 项目 / 角色记忆顺带记下来源：只为人工排查「这个文件是谁的」，读取时不依赖它。
  const body = {
    version: 2,
    ...(file.legacyArchiveHash ? { legacyArchiveHash: file.legacyArchiveHash } : {}),
    ...(scope.kind === 'project' ? { root: scope.root } : scope.kind === 'role' ? { personaId: scope.personaId } : {}),
    ...(file.tidy ? { tidy: file.tidy } : {}),
    ...(file.tidyTries ? { tidyTries: file.tidyTries } : {}),
    archive: file.archive ?? [],
    entries: file.entries
  }
  writeFileAtomic(p, JSON.stringify(body, null, 2))
}

/** 读取某作用域的全部记忆；缺失为空，损坏明确报错，禁止覆盖原数据。 */
export function listMemories(scope: MemoryScope = GLOBAL_SCOPE): MemoryEntry[] {
  if (scope.kind === 'role' && !isSafeId(scope.personaId)) return []
  return readMemoryFile(scope).entries
}

/** 是否有旧版转换来、待模型整理的条目，以及已失败的次数。 */
export function memoryTidyState(scope: MemoryScope): { pending: boolean; tries: number } {
  if (scope.kind === 'role' && !isSafeId(scope.personaId)) return { pending: false, tries: 0 }
  const f = readMemoryFile(scope)
  return { pending: f.tidy === 'pending', tries: f.tidyTries ?? 0 }
}

/** 整理结束：写回整理后的条目并清掉待整理标记（entries 省略 = 只记一次失败）。 */
export function finishMemoryTidy(scope: MemoryScope, entries: MemoryEntry[] | null, giveUp: boolean): void {
  const f = readMemoryFile(scope)
  if (entries) writeMemoryFile(scope, { ...f, entries, tidy: undefined, tidyTries: undefined })
  else if (giveUp) writeMemoryFile(scope, { ...f, tidy: undefined, tidyTries: undefined })
  else writeMemoryFile(scope, { ...f, tidyTries: (f.tidyTries ?? 0) + 1 })
}

export function newMemoryId(scope: MemoryScope, existing: MemoryEntry[]): string {
  const prefix = scope.kind === 'project' ? 'p_' : scope.kind === 'role' ? 'r_' : 'm_'
  const taken = new Set(existing.map((e) => e.id))
  let id = ''
  do id = `${prefix}${randomBytes(4).toString('hex')}`
  while (taken.has(id))
  return id
}

/** 索引里的一行（随消息下发、memory_read 回灌与用量计算共用）。 */
export function formatMemoryLine(e: Pick<MemoryEntry, 'id' | 'type' | 'title'>): string {
  return `- [${e.id}] ${memoryTypeLabel(e.type)} · ${e.title}`
}

/** 索引总用量（字数），与随消息下发同一口径。 */
export function memoryUsage(entries: Pick<MemoryEntry, 'id' | 'type' | 'title'>[]): number {
  return entries.reduce((n, e) => n + formatMemoryLine(e).length, 0)
}

/** 失败原因码：渲染层据此走 i18n，工具回灌则用 error 文本。 */
export type MemoryErrorCode = 'empty' | 'tooLong' | 'full' | 'budget' | 'notFound' | 'duplicate' | 'badType'

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry; created: boolean }
  | { ok: false; code: MemoryErrorCode; error: string }

function budgetError(scope: MemoryScope, used: number): MemoryWriteResult {
  return {
    ok: false,
    code: 'budget',
    error: `${scopeLabel(scope)}的索引总量已达上限（写入后 ${used} 字，上限 ${memoryLimits(scope).budget}）：请用 memory_write 带 id 合并相近条目、缩短标题，或用 memory_delete 删除过时条目后再写`
  }
}

/** 新增（无 id）或按 id 更新一条记忆。 */
export function writeMemory(input: MemoryInput, id?: string, scope: MemoryScope = GLOBAL_SCOPE, autoArchive = true): MemoryWriteResult {
  if (scope.kind === 'role' && !isSafeId(scope.personaId))
    return { ok: false, code: 'notFound', error: '找不到这个角色的记忆' }
  const file = readMemoryFile(scope)
  const result = editMemoryFile(file, input, id, scope, autoArchive)
  if (result.ok) writeMemoryFile(scope, file)
  return result
}

/** 在内存里完成校验、腾位与写入；调用者统一原子提交，取回不产生半完成状态。 */
function editMemoryFile(file: MemoryFile, input: MemoryInput, id: string | undefined, scope: MemoryScope, autoArchive: boolean): MemoryWriteResult {
  const lim = memoryLimits(scope)
  const entries = file.entries
  const hit = id ? entries.find((e) => e.id === id) : undefined
  if (id && !hit)
    return {
      ok: false,
      code: 'notFound',
      error: `${scopeLabel(scope)}中不存在 id 为 ${id} 的记忆（可先用 memory_read 查看现有记忆）`
    }
  const type = input.type ?? hit?.type
  if (!type || !isMemoryType(type))
    return { ok: false, code: 'badType', error: '缺少有效的类型 type（user / feedback / project / reference）' }
  const title = input.title !== undefined ? normalizeTitle(input.title) : (hit?.title ?? '')
  const body = input.body !== undefined ? normalizeBody(input.body) : (hit?.body ?? '')
  if (!title) return { ok: false, code: 'empty', error: '记忆标题为空' }
  if (title.length > MEMORY_TITLE_MAX)
    return {
      ok: false,
      code: 'tooLong',
      error: `标题过长（${title.length} 字，上限 ${MEMORY_TITLE_MAX}）：标题只写一句话概括，细节写进正文 body`
    }
  if (body.length > MEMORY_BODY_MAX)
    return { ok: false, code: 'tooLong', error: `正文过长（${body.length} 字，上限 ${MEMORY_BODY_MAX}）：请精简` }
  // 同层里标题相同 = 同一主题：新增时内容也一样视为已记住，不一样则提示带 id 更新；更新时撞上别的条目也拒。
  const key = title.toLowerCase()
  const twin = entries.find((e) => e.id !== id && e.title.toLowerCase() === key)
  if (twin) {
    if (!hit && twin.body === body && twin.type === type) return { ok: true, entry: twin, created: false }
    return {
      ok: false,
      code: 'duplicate',
      error: `已有同标题的记忆（id=${twin.id}）：同一主题请带这个 id 更新，不要重复新增`
    }
  }
  const now = Date.now()
  if (hit) {
    const next = { ...hit, type, title, body }
    const used = memoryUsage(entries) - formatMemoryLine(hit).length + formatMemoryLine(next).length
    // 只拒「越改越超」：缩短 / 不变的更新即便总量仍超（旧数据）也放行，否则永远没法合并瘦身。
    if (used > lim.budget && formatMemoryLine(next).length > formatMemoryLine(hit).length) return budgetError(scope, used)
    Object.assign(hit, { type, title, body, updatedAt: now })
    return { ok: true, entry: hit, created: false }
  }
  const entry: MemoryEntry = { id: newMemoryId(scope, entries), type, title, body, createdAt: now, updatedAt: now }
  if (!autoArchive && (entries.length >= lim.maxEntries || memoryUsage(entries) + formatMemoryLine(entry).length > lim.budget)) return budgetError(scope, memoryUsage(entries) + formatMemoryLine(entry).length)
  const victims = evictionCandidates(entries)
  while (entries.length >= lim.maxEntries || memoryUsage(entries) + formatMemoryLine(entry).length > lim.budget) {
    const victim = victims.shift()
    if (!victim) return budgetError(scope, memoryUsage(entries) + formatMemoryLine(entry).length)
    file.archive ??= []
    file.archive.push({ ...victim, originalId: victim.id, id: 'a_' + randomBytes(8).toString('hex'), archivedAt: now, reason: entries.length >= lim.maxEntries ? 'entries' : 'budget' })
    entries.splice(entries.indexOf(victim), 1)
  }
  entries.push(entry)
  return { ok: true, entry, created: true }
}

/** 删除一条记忆；返回被删条目（不存在则 null）。 */
export function deleteMemory(id: string, scope: MemoryScope = GLOBAL_SCOPE): MemoryEntry | null {
  if (scope.kind === 'role' && !isSafeId(scope.personaId)) return null
  const file = readMemoryFile(scope)
  const idx = file.entries.findIndex((e) => e.id === id)
  if (idx < 0) return null
  const [removed] = file.entries.splice(idx, 1)
  writeMemoryFile(scope, file)
  return removed
}

/** 整体替换某作用域的全部条目（归纳后写回，见 memory-consolidate.ts）；待整理标记原样保留。 */
export function replaceMemories(scope: MemoryScope, entries: MemoryEntry[], archiveChanged = false): void {
  const f = readMemoryFile(scope)
  if (archiveChanged) {
    const changed = f.entries.filter(e => !entries.some(n => n.id === e.id && n.title === e.title && n.body === e.body && n.type === e.type))
    f.archive = [...(f.archive ?? []), ...changed.map(e => archiveEntry(e, 'manual'))]
  }
  writeMemoryFile(scope, { ...f, entries })
}

/** 清空某作用域的全部记忆（仅用户经面板触发；模型没有对应工具）。 */
export function clearMemories(scope: MemoryScope = GLOBAL_SCOPE): void {
  writeMemoryFile(scope, { ...readMemoryFile(scope), entries: [] })
}

/** 删除角色时连同它的记忆一起删：先备份到同目录的 memory-backups/。 */
export function removeRoleMemory(personaId: string): void {
  if (!isSafeId(personaId)) return
  const p = memoryPath({ kind: 'role', personaId })
  if (!existsSync(p)) return
  try {
    const dir = join(dirname(p), 'memory-backups')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${personaId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      readFileSync(p, 'utf8'),
      'utf8'
    )
    rmSync(p, { force: true })
  } catch {
    /* 备份不了就不删：留着比误删强 */
  }
}

export function listArchive(scope: MemoryScope, query = ''): ArchivedMemory[] {
  if (scope.kind === 'role' && !isSafeId(scope.personaId)) throw new Error('memory: invalid role')
  return recallArchive(readMemoryFile(scope).archive ?? [], query)
}

export function restoreMemory(scope: MemoryScope, id: string): MemoryWriteResult {
  const file = readMemoryFile(scope)
  const archived = file.archive?.find(e => e.id === id)
  if (!archived) return { ok: false, code: 'notFound', error: '找不到归档记忆' }
  // 超长旧数据明确拒绝并保留原文。成功时恢复原 id（若未被占用）及创建时间、使用记录。
  const result = editMemoryFile(file, archived, undefined, scope, true)
  if (!result.ok) return result
  if (result.created) {
    if (!file.entries.some(e => e !== result.entry && e.id === archived.originalId)) result.entry.id = archived.originalId
    Object.assign(result.entry, { createdAt: archived.createdAt, lastSeenAt: archived.lastSeenAt, seenCount: archived.seenCount })
  }
  file.archive = file.archive?.filter(e => e.id !== id)
  writeMemoryFile(scope, file)
  return result
}

function archiveEntry(entry: MemoryEntry, reason: ArchivedMemory['reason']): ArchivedMemory {
  return { ...entry, originalId: entry.id, id: 'a_' + randomBytes(8).toString('hex'), archivedAt: Date.now(), reason }
}

/** 合并 2–5 条，原文全部进遗忘区，与合并结果在一次原子写盘中提交。 */
export function mergeMemories(scope: MemoryScope, ids: string[], input: MemoryInput): MemoryWriteResult {
  const unique = [...new Set(ids)]
  if (unique.length < 2 || unique.length > 5) return { ok: false, code: 'badType', error: '每次须合并 2–5 条记忆' }
  const file = readMemoryFile(scope)
  const sources = file.entries.filter(e => unique.includes(e.id))
  if (sources.length !== unique.length) return { ok: false, code: 'notFound', error: '部分记忆不存在于该层，未合并' }
  file.entries = file.entries.filter(e => !unique.includes(e.id))
  const result = editMemoryFile(file, input, undefined, scope, true)
  if (!result.ok) return result
  file.archive = [...(file.archive ?? []), ...sources.map(e => archiveEntry(e, 'manual'))]
  writeMemoryFile(scope, file)
  return result
}

/** 无模型整理：仅高用量时腾出冷条目 / 无损合并明显重叠条目；原文全部归档。 */
export function tidyMemories(scope: MemoryScope, dryRun = false): { archived: number; merged: number; changed: boolean; advice: ReturnType<typeof checkMemories> } {
  const file = readMemoryFile(scope)
  const advice = checkMemories(file.entries)
  const result = { archived: 0, merged: 0, changed: false, advice }
  if (dryRun || memoryUsage(file.entries) < memoryLimits(scope).budget * 0.8) return result
  const stale = file.entries.filter(e => advice.stale.includes(e.id))
  file.archive = [...(file.archive ?? []), ...stale.map(e => archiveEntry(e, 'entries'))]
  file.entries = file.entries.filter(e => !advice.stale.includes(e.id))
  result.archived = stale.length
  for (const [aid, bid] of advice.similar) {
    const a = file.entries.find(e => e.id === aid), b = file.entries.find(e => e.id === bid)
    if (!a || !b || a.type !== b.type) continue
    const title = a.title.length >= b.title.length ? a.title : b.title
    const body = `${a.title}\n${a.body}\n\n${b.title}\n${b.body}`
    if (title.length > MEMORY_TITLE_MAX || body.length > MEMORY_BODY_MAX) continue
    const next: MemoryEntry = { id: newMemoryId(scope, file.entries), type: a.type, title, body,
      createdAt: Math.min(a.createdAt, b.createdAt), updatedAt: Date.now(),
      seenCount: (a.seenCount ?? 0) + (b.seenCount ?? 0), lastSeenAt: Math.max(a.lastSeenAt ?? 0, b.lastSeenAt ?? 0) }
    file.entries = file.entries.filter(e => e !== a && e !== b)
    file.entries.push(next)
    file.archive.push(archiveEntry(a, 'manual'), archiveEntry(b, 'manual'))
    result.merged++
  }
  result.changed = result.archived > 0 || result.merged > 0
  if (result.changed) writeMemoryFile(scope, file)
  return result
}

export function markMemoriesSeen(scope: MemoryScope, ids: string[]): void {
  const file = readMemoryFile(scope)
  for (const e of file.entries) if (ids.includes(e.id)) {
    e.lastSeenAt = Date.now()
    e.seenCount = (e.seenCount ?? 0) + 1
  }
  writeMemoryFile(scope, file)
}

// ── 面板 IPC ────────────────────────────────────────────────────────────────────

export interface MemorySnapshot {
  entries: MemoryEntry[]
  /** 当前索引总字数（与随消息下发同一口径）。 */
  used: number
  budget: number
  maxEntries: number
  maxTitle: number
  maxBody: number
  archivedCount: number
}

function snapshot(scope: MemoryScope): MemorySnapshot {
  const entries = listMemories(scope)
  const lim = memoryLimits(scope)
  return {
    entries,
    used: memoryUsage(entries),
    budget: lim.budget,
    maxEntries: lim.maxEntries,
    maxTitle: MEMORY_TITLE_MAX,
    archivedCount: listArchive(scope).length,
    maxBody: MEMORY_BODY_MAX
  }
}

export type MemoryIpcResult = { ok: true; snapshot: MemorySnapshot } | { ok: false; code: MemoryErrorCode }

/**
 * IPC 入参 → 作用域：省略（undefined / null）= 全局；非空字符串 = 该工作区的项目记忆；`{ personaId }` = 该角色的记忆。
 * 其余一律抛错让 invoke reject——若静默回落全局，渲染层传坏参数时「清空项目记忆」就会变成清空全局记忆。
 */
function ipcScope(arg: unknown): MemoryScope {
  if (arg === undefined || arg === null) return GLOBAL_SCOPE
  if (typeof arg === 'string' && arg.trim()) return { kind: 'project', root: arg.trim() }
  const personaId = (arg as { personaId?: unknown } | null)?.personaId
  if (typeof personaId === 'string' && isSafeId(personaId)) return { kind: 'role', personaId }
  throw new Error('memory: invalid scope')
}

function ipcInput(raw: unknown): MemoryInput {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    ...(isMemoryType(o.type) ? { type: o.type } : {}),
    ...(typeof o.title === 'string' ? { title: o.title } : {}),
    ...(typeof o.body === 'string' ? { body: o.body } : {})
  }
}

/**
 * 面板用：查看 / 修改 / 删除 / 清空。每次都回带最新快照，渲染层直接替换列表。
 * 末位参数 scope：省略 = 全局（个人资料面板）；字符串 = 该工作区的项目记忆；`{ personaId }` = 角色记忆。
 */
export function registerMemoryIpc(): void {
  ipcMain.handle('memory:archive', (_e, scope?: unknown, query?: string) => listArchive(ipcScope(scope), query))
  ipcMain.handle('memory:check', (_e, scope?: unknown) => checkMemories(listMemories(ipcScope(scope))))
  ipcMain.handle('memory:restore', (_e, id: string, scope?: unknown) => restoreMemory(ipcScope(scope), id))
  ipcMain.handle('memory:list', (_e, scope?: unknown): MemorySnapshot => snapshot(ipcScope(scope)))
  ipcMain.handle('memory:write', (_e, input: unknown, id?: string, scopeArg?: unknown): MemoryIpcResult => {
    const scope = ipcScope(scopeArg)
    const target = typeof id === 'string' && id ? id : undefined
    const r = writeMemory(ipcInput(input), target, scope)
    if (!r.ok) return { ok: false, code: r.code }
    // 手动新增撞上已有条目：writeMemory 对模型按幂等成功处理，面板则要明确告诉用户「没有新增」。
    if (!target && !r.created) return { ok: false, code: 'duplicate' }
    return { ok: true, snapshot: snapshot(scope) }
  })
  ipcMain.handle('memory:delete', (_e, id: string, scopeArg?: unknown): MemoryIpcResult => {
    const scope = ipcScope(scopeArg)
    deleteMemory(String(id ?? ''), scope)
    return { ok: true, snapshot: snapshot(scope) }
  })
  ipcMain.handle('memory:clear', (_e, scopeArg?: unknown): MemoryIpcResult => {
    const scope = ipcScope(scopeArg)
    clearMemories(scope)
    return { ok: true, snapshot: snapshot(scope) }
  })
}
