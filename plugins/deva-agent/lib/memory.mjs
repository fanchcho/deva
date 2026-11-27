import { sharedMemoryPath, fileMemoryStore } from './memory-file.mjs'
import { markCorrupt } from './corrupt-files.mjs'
/**
 * 记忆（memory_read / memory_write / memory_delete）v2：三层作用域 + 类型与标题。
 *
 *  · global —— 用户本人的情况，以及对所有角色都适用的做事要求（Studio 的 user 作用域存储）；
 *  · role   —— 当前身份做自己这类工作学到的经验（user 存储里按身份 id 分区）；
 *  · project —— 只在当前工作区有用的私有经验（按工作区真实路径哈希分区）。
 *
 * 每条记忆有类型（user 用户 / feedback 做事方式 / project 进展 / reference 资料）、一句话标题和正文。
 * 随消息下发的只有标题索引，正文由模型用 memory_read 按 id 读取；写满时先自动归纳旧条目再写入
 * （lib/memory-consolidate.mjs）。上限按索引行计，各层独立。
 *
 * 唯一真源为桌面 ~/.deva 三作用域 JSON；旧 state.user 数据原样保留，不再作为活动存储。
 * 旧版（v1，每条一句话 content）读到时就地转换：标题取第一句、正文保留原文、类型暂记 user。
 */
import { validateStored } from './storage-contracts.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { realpath } from 'node:fs/promises'

/** 标题、正文字数上限（各层共用）。 */
export const MEMORY_TITLE_MAX = 60
export const MEMORY_BODY_MAX = 1500
/** 全局与角色：条数 / 索引总字数上限。 */
export const MEMORY_MAX_ENTRIES = 100
export const MEMORY_INDEX_BUDGET = 4000
/** 每个项目：条数 / 索引总字数上限。 */
export const PROJECT_MEMORY_MAX_ENTRIES = 60
export const PROJECT_MEMORY_INDEX_BUDGET = 3000

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference']
const TYPE_LABEL = { user: '用户', feedback: '做事方式', project: '进展', reference: '资料' }
const SCOPES = ['global', 'role', 'project']

export class MemoryError extends Error {}

export function isMemoryType(value) {
  return typeof value === 'string' && MEMORY_TYPES.includes(value)
}

export function memoryTypeLabel(type) {
  return TYPE_LABEL[type] ?? TYPE_LABEL.user
}

export function scopeLabel(scope) {
  return scope === 'project' ? '项目记忆' : scope === 'role' ? '角色记忆' : '全局记忆'
}

export function memoryLimits(scope) {
  return scope === 'project'
    ? { maxEntries: PROJECT_MEMORY_MAX_ENTRIES, budget: PROJECT_MEMORY_INDEX_BUDGET }
    : { maxEntries: MEMORY_MAX_ENTRIES, budget: MEMORY_INDEX_BUDGET }
}

/** id 前缀 → 作用域。 */
export function scopeOfId(id) {
  return String(id).startsWith('p_') ? 'project' : String(id).startsWith('r_') ? 'role' : 'global'
}

/** 工作区 → 稳定的项目记忆键：真实路径的 sha1 前 24 位（符号链接别名指向同一项目即同一份记忆）。 */
export async function projectMemoryKey(workspaceDir) {
  const raw = String(workspaceDir || '').trim()
  if (!raw) throw new MemoryError('项目记忆需要已挂载的工作区')
  let real = raw
  try { real = await realpath(raw) } catch { /* 目录已不存在时按原路径算 */ }
  let norm = real.replace(/[\\/]+$/, '')
  if (process.platform === 'win32' || process.platform === 'darwin') norm = norm.toLowerCase()
  return createHash('sha1').update(norm).digest('hex').slice(0, 24)
}

/** 规整标题：单行、去首尾空白。 */
export function normalizeTitle(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/** 规整正文：统一换行、去首尾空白、连续空行压成一个。 */
export function normalizeBody(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 旧版一句话 → 标题：取第一句（最多 60 字），太长截断加省略号。 */
function firstSentence(content) {
  const text = normalizeTitle(content)
  const m = text.match(/^.+?[。！？；!?;](?=\s|$|[^\d])/)
  const s = (m && m[0].length <= MEMORY_TITLE_MAX ? m[0] : text).replace(/[。；;，,、：:]+$/, '')
  return s.length <= MEMORY_TITLE_MAX ? s : `${s.slice(0, MEMORY_TITLE_MAX - 1)}…`
}

/** 索引里的一行（随消息下发、memory_read 回灌与用量计算共用）。 */
export function formatMemoryLine(entry) {
  return `- [${entry.id}] ${memoryTypeLabel(entry.type)} · ${entry.title}`
}

/** 索引总用量（字数），与随消息下发同一口径。 */
export function memoryUsage(entries) {
  return entries.reduce((sum, entry) => sum + formatMemoryLine(entry).length, 0)
}

// ── 存储 ────────────────────────────────────────────────────────────────────────

/** 某层对应的存储桶；项目层缺工作区、角色层缺身份时返回 null。 */
async function memoryStore(state, scope, ctx = {}) {
  const { workspaceDir } = ctx
  const key = scope === 'project' && workspaceDir ? await projectMemoryKey(workspaceDir) : null
  const path = sharedMemoryPath(scope, ctx, key)
  return path ? fileMemoryStore(path, scope, ctx) : null
}

export function newId(scope, existing) {
  const prefix = scope === 'project' ? 'p_' : scope === 'role' ? 'r_' : 'm_'
  const taken = new Set(existing.map(entry => entry.id))
  let id = ''
  do id = `${prefix}${randomBytes(4).toString('hex')}`
  while (taken.has(id))
  return id
}

/** 存量记录 → v2 条目；仅补缺省字段并保留扩展字段，损坏数据拒绝覆盖。 */
function parseEntry(raw) {
  if (!raw || typeof raw !== 'object') throw new MemoryError('记忆记录损坏，拒绝覆盖')
  if (typeof raw.id !== 'string') throw new MemoryError('记忆记录缺少 ID，拒绝覆盖')
  const createdAt = raw.createdAt ?? 0
  const updatedAt = raw.updatedAt ?? createdAt
  if (typeof raw.title === 'string') {
    return {
      ...raw,
      id: raw.id,
      type: raw.type ?? 'user',
      title: raw.title,
      body: raw.body ?? '',
      createdAt,
      updatedAt,
    }
  }
  const body = raw.content ?? raw.body ?? ''
  if (typeof body !== 'string') throw new MemoryError('记忆正文类型非法，拒绝覆盖')
  return { ...raw, id: raw.id, type: raw.type ?? 'user', title: firstSentence(body), body, createdAt, updatedAt }
}

async function readEntries(store) {
  if (!store) return []
  const raw = await store.get('entries')
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new MemoryError('记忆存储不是数组，拒绝覆盖')
  try { return validateStored('memory', raw.map(parseEntry)) }
  catch (error) { throw markCorrupt(store.path, error) }
}

async function writeEntries(store, entries) {
  await store.set('entries', validateStored('memory', entries))
  return entries
}

// ── 读写 ────────────────────────────────────────────────────────────────────────

/**
 * 某层的全部条目（按创建先后）。存储不可用 / 没挂工作区（项目层）时返回空表，不抛错。
 * ctx = { state, workspaceDir, identityId }
 */
export async function listMemories(scope = 'global', ctx = {}) {
  const store = await memoryStore(ctx.state, scope, ctx)
  if (!store) return []
  return readEntries(store)
}

/** 三层一起读，供提示词与 memory_read 使用。三层互不依赖，并发读。 */
export async function readMemories(ctx = {}) {
  const values = await Promise.all(SCOPES.map(scope => listMemories(scope, ctx)))
  return Object.fromEntries(SCOPES.map((scope, index) => [scope, values[index]]))
}

/**
 * 各层的作用域 → 本轮可用的层：项目层没挂工作区时不出现，角色层缺身份时不出现。
 * 返回 [{ scope, label }]，按 layers 顺序。
 */
export async function memoryLayers(ctx = {}) {
  const layers = []
  for (const scope of ['global', 'role', 'project']) {
    if (scope === 'role' && !String(ctx.identityId ?? '').trim()) continue
    if (scope === 'project' && !ctx.workspaceDir) continue
    layers.push({ scope, label: layerLabel(scope, ctx) })
  }
  return layers
}

/** 某层的显示名（角色层带上身份名，项目层带上工作区）。 */
export function layerLabel(scope, { workspaceDir, identityName } = {}) {
  if (scope === 'role') return `角色记忆（${identityName || '当前身份'}）`
  if (scope === 'project') return `项目记忆（${workspaceDir || '未挂载工作区'}）`
  return '全局记忆'
}

/** 写入或更新一条记忆。新增时 type 与 title 必填；带 id 时省略的字段保持原值。 */
export async function writeMemory(input, ctx = {}, id) {
  const { state } = ctx
  const targetId = typeof id === 'string' && id.trim() ? id.trim() : undefined
  const explicit = SCOPES.find(scope => scope === input?.scope)
  // 省略 scope：带 id 按前缀定位；新增默认全局。
  const scope = explicit ?? (targetId ? scopeOfId(targetId) : 'global')
  if (targetId && scopeOfId(targetId) !== scope) {
    throw new MemoryError(`id ${targetId} 属于${scopeLabel(scopeOfId(targetId))}，与所给 scope 不符：更新时可省略 scope，按 id 自动定位`)
  }
  const store = await memoryStore(state, scope, ctx)
  if (!store) {
    if (scope === 'project') throw new MemoryError('当前未挂载工作区，无法写入项目记忆：请改写到 global 或 role')
    throw new MemoryError('当前运行环境没有可用的用户存储，无法保存记忆')
  }
  const limits = memoryLimits(scope)
  const entries = await readEntries(store)
  const hit = targetId ? entries.find(entry => entry.id === targetId) : undefined
  if (targetId && !hit) throw new MemoryError(`${scopeLabel(scope)}中不存在 id 为 ${targetId} 的记忆（可先用 memory_read 查看现有记忆）`)

  const type = input?.type ?? hit?.type
  if (!isMemoryType(type)) throw new MemoryError('缺少有效的类型 type（user / feedback / project / reference）')
  const title = input?.title !== undefined ? normalizeTitle(input.title) : (hit?.title ?? '')
  const body = input?.body !== undefined ? normalizeBody(input.body) : (hit?.body ?? '')
  if (!title) throw new MemoryError('记忆标题为空')
  if (title.length > MEMORY_TITLE_MAX) {
    throw new MemoryError(`标题过长（${title.length} 字，上限 ${MEMORY_TITLE_MAX}）：标题只写一句话概括，细节写进正文 body`)
  }
  if (body.length > MEMORY_BODY_MAX) throw new MemoryError(`正文过长（${body.length} 字，上限 ${MEMORY_BODY_MAX}）：请精简`)

  // 同层里标题相同 = 同一主题：新增时内容也一样视为已记住，不一样则拒写并提示带 id 更新。
  const key = title.toLowerCase()
  const twin = entries.find(entry => entry.id !== targetId && entry.title.toLowerCase() === key)
  if (twin) {
    if (!hit && twin.body === body && twin.type === type) return { scope, entry: twin, created: false }
    throw new MemoryError(`已有同标题的记忆（id=${twin.id}）：同一主题请带这个 id 更新，不要重复新增`)
  }

  const now = Date.now()
  if (hit) {
    const next = { ...hit, type, title, body, updatedAt: now }
    const used = memoryUsage(entries) - formatMemoryLine(hit).length + formatMemoryLine(next).length
    // 只拒「越改越超」：缩短 / 不变的更新即便总量仍超（旧数据）也放行，否则永远没法合并瘦身。
    if (used > limits.budget && formatMemoryLine(next).length > formatMemoryLine(hit).length) {
      throw new MemoryError(`${scopeLabel(scope)}的索引总量已达上限（写入后 ${used} 字，上限 ${limits.budget}）：请带 id 合并相近条目、缩短标题，或删除过时条目后再写`)
    }
    Object.assign(hit, { type, title, body, updatedAt: now })
    await writeEntries(store, entries)
    return { scope, entry: hit, created: false }
  }
  if (entries.length >= limits.maxEntries) {
    throw new MemoryError(`${scopeLabel(scope)}已满（上限 ${limits.maxEntries} 条）：请删除过时条目，或带 id 合并相近条目`)
  }
  const entry = { id: newId(scope, entries), type, title, body, createdAt: now, updatedAt: now }
  const used = memoryUsage(entries) + formatMemoryLine(entry).length
  if (used > limits.budget) {
    throw new MemoryError(`${scopeLabel(scope)}的索引总量已达上限（写入后 ${used} 字，上限 ${limits.budget}）：请带 id 合并相近条目、缩短标题，或删除过时条目后再写`)
  }
  entries.push(entry)
  await writeEntries(store, entries)
  return { scope, entry, created: true }
}

/** 删除一条记忆；返回被删条目，不存在则 null。 */
export async function deleteMemory(id, ctx = {}) {
  const targetId = String(id ?? '').trim()
  if (!targetId) throw new MemoryError('id 不能为空')
  const scope = scopeOfId(targetId)
  const store = await memoryStore(ctx.state, scope, ctx)
  if (!store) throw new MemoryError(scope === 'project' ? '当前未挂载工作区，无法定位项目记忆' : '没有可用的用户存储')
  const entries = await readEntries(store)
  const index = entries.findIndex(entry => entry.id === targetId)
  if (index < 0) return null
  const [removed] = entries.splice(index, 1)
  await writeEntries(store, entries)
  return removed
}

/** 整体替换某层的全部条目（归纳后写回，见 lib/memory-consolidate.mjs）。 */
export async function replaceMemories(scope, entries, ctx = {}) {
  const store = await memoryStore(ctx.state, scope, ctx)
  if (!store) throw new MemoryError(`${scopeLabel(scope)}当前不可写`)
  await writeEntries(store, entries)
}

// ── 提示词 ──────────────────────────────────────────────────────────────────────

/**
 * 记忆索引 → 随消息下发的文字块。做事方式类（feedback）附正文，其余只给标题，正文用 memory_read 读。
 * 每层各自按索引预算裁剪（超出时留最近更新的，其余只计数并提示）。
 */
export function formatMemoryIndex(layers, { feedbackBudget = 2000 } = {}) {
  const blocks = []
  for (const { scope, label, entries } of layers) {
    const limits = memoryLimits(scope)
    const { kept, omitted } = withinBudget(entries, limits.budget)
    if (!kept.length && !omitted) continue
    const feedback = feedbackWithBody(kept, feedbackBudget)
    const lines = [`【${label}】${kept.length} 条${omitted ? `（另 ${omitted} 条超出索引预算未列出，可用 memory_read 查看）` : ''}`]
    for (const entry of kept) {
      lines.push(formatMemoryLine(entry))
      const body = feedback.get(entry.id)
      if (body) lines.push(`  正文：${body.replace(/\n/g, '\n  ')}`)
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** 按索引预算保留条目（超出时丢最早更新的），返回保留的条目与丢掉的条数。 */
function withinBudget(entries, budget) {
  const kept = []
  let used = 0
  const ordered = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const entry of ordered) {
    const line = formatMemoryLine(entry).length
    if (used + line > budget) break
    used += line
    kept.push(entry)
  }
  // 保序：按创建先后展示，便于阅读。
  kept.sort((a, b) => a.createdAt - b.createdAt)
  return { kept, omitted: entries.length - kept.length }
}

/** 做事方式类附正文，合计不超过 feedbackBudget 字（超出时按最近更新保留，其余只给标题）。 */
function feedbackWithBody(entries, feedbackBudget) {
  const out = new Map()
  let used = 0
  const ordered = entries.filter(entry => entry.type === 'feedback').sort((a, b) => b.updatedAt - a.updatedAt)
  for (const entry of ordered) {
    if (!entry.body) continue
    if (used + entry.body.length > feedbackBudget) break
    used += entry.body.length
    out.set(entry.id, entry.body)
  }
  return out
}

// ── 工具 ────────────────────────────────────────────────────────────────────────

export const MEMORY_TOOLS = [
  {
    name: 'memory_read',
    description:
      '读取记忆。带 ids：返回这些条目的类型、标题与正文；不带：返回全局、角色、当前项目各层的完整索引。' +
      '记忆索引已随对话消息附带（做事方式类附了正文）；处理与某条记忆相关的任务前，用它按 id 读取那条的正文。',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: '要读取正文的记忆 id（如 m_1a2b3c4d / r_1a2b3c4d / p_1a2b3c4d）；省略则返回完整索引。',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_write',
    description:
      '写入或更新一条长期记忆。每条有类型 type、一句话标题 title 和正文 body。' +
      'type：user = 用户的身份、职责、熟悉什么、偏好；feedback = 用户纠正过或确认过的做事方式（正文先写规则，再写「原因：」「何时适用：」各一行）；' +
      'project = 代码和文档里看不出来的进行中工作、决定、截止日期（日期写具体日期）；reference = 外部资料、工具在哪、做什么用。' +
      'scope：global = 用户本人、对所有角色都适用；role = 你这个身份做自己这类工作的经验；project = 只在当前工作区有用（须已挂载工作区）。' +
      '不带 id 为新增（type、title 必填）；带已有 id 为更新，省略的字段保持原值，scope 可省略（按 id 前缀定位：m_ 全局、r_ 角色、p_ 项目）。同一主题请带 id 更新，不要重复新增。' +
      '**必须**在写本轮最终回复之前调用（先记再回复，回复里顺带告知），严禁写完回复再补记——回复之后的调用会让整段回复被界面收进过程里。' +
      `标题 ≤${MEMORY_TITLE_MAX} 字，正文 ≤${MEMORY_BODY_MAX} 字；不得记录密码、密钥等敏感信息或一次性任务细节。写满时系统会先自动归纳旧条目再写入，结果里会说明。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '可选：要更新的已有记忆 id；省略则新增。', maxLength: 40 },
        scope: { type: 'string', enum: SCOPES, description: '写到哪一层：global / role / project。新增时省略即 global；带 id 更新时可省略。' },
        type: { type: 'string', enum: MEMORY_TYPES, description: '类型：user / feedback / project / reference。新增时必填。' },
        title: { type: 'string', description: `一句话标题（≤${MEMORY_TITLE_MAX} 字），只看标题就能判断与什么任务相关。新增时必填。`, maxLength: MEMORY_TITLE_MAX },
        body: { type: 'string', description: '正文：事实或规则；feedback / project 类再写「原因：」「何时适用：」各一行。', maxLength: MEMORY_BODY_MAX },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_delete',
    description:
      '删除一条记忆（用户要求忘记、或该记忆已过时、与新的要求或代码现状矛盾时使用）。按 id 前缀定位：m_ 全局、r_ 角色、p_ 项目。' +
      '同样**必须**在写本轮最终回复之前调用，严禁写完回复再补删。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '要删除的记忆 id。', maxLength: 40 } },
      required: ['id'],
      additionalProperties: false,
    },
  },
]
