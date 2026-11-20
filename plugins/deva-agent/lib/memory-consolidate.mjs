/**
 * 记忆写满后的自动归纳（对标宿主 apps/desktop/src/main/services/memory-consolidate.ts）。
 *
 * 写入撞上条数或索引总字数上限时，不再直接拒写：先用当前对话的模型把已有条目归纳一遍
 *（同主题合并、新的取代矛盾的旧的、删过时与一次性的、相对日期换成具体日期），压到上限的七成左右，
 * 再照常写入新条目。新条目原文原样保存，不经模型改写。
 *
 * 安全：归纳前的全部条目先写进本轮运行目录的 memory-backups/（保留最近 5 份）；模型输出解析不了、
 * 有条目超长、或归纳后仍放不下新条目，一律放弃归纳、退回原来的拒写，记忆不动。
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MEMORY_BODY_MAX,
  MEMORY_TITLE_MAX,
  formatMemoryLine,
  isMemoryType,
  listMemories,
  memoryLimits,
  memoryTypeLabel,
  memoryUsage,
  newId,
  normalizeBody,
  normalizeTitle,
  replaceMemories,
  scopeLabel,
  writeMemory,
  MemoryError,
} from './memory.mjs'

/** 归纳后的目标用量：上限的七成，留出余量，免得之后每写一条都要再归纳一次。 */
const TARGET_RATIO = 0.7
/** 验收线：写入新条目后条数与字数都须低于上限的九成，否则视为没归纳到位。 */
const ACCEPT_RATIO = 0.9
const TIMEOUT_MS = 90_000
const MAX_TOKENS = 8192
const ATTEMPTS = 2
const KEEP_BACKUPS = 5

/** 同一层同时只归纳一次：并发撞满的写入共用这一次的结果。 */
const inflight = new Map()

/**
 * 写入一条记忆；撞上限时先归纳再写。失败一律抛 MemoryError（调用方只需处理一种结果形状）。
 * model 是 (system, user, signal) => Promise<string> 的取文本函数；为空时不能归纳，按原样拒写。
 * 返回 { result, consolidated? }：consolidated 非空表示发生过归纳，带上前后用量与备份路径。
 */
export async function writeMemoryWithConsolidation(input, id, scope, ctx, model, signal) {
  const targetId = typeof id === 'string' && id.trim() ? id.trim() : undefined
  const explicitScope = input?.scope ?? scope
  try {
    return { result: await writeMemory(input, ctx, targetId) }
  } catch (error) {
    // 只有「写满了」且能调模型时才值得归纳；其余（重复、超长、无存储）原样抛出。
    if (!(error instanceof MemoryError) || !isFull(error.message) || !model) throw error
  }
  const outcome = await consolidate(explicitScope, input, targetId, ctx, model, signal)
  if (!outcome.ok) {
    throw new MemoryError(`${scopeLabel(explicitScope)}已写满，自动归纳没有成功（${outcome.reason}）：请带 id 合并相近条目或删除过时条目后再写`)
  }
  // 要更新的那条可能已被并进别的条目：那就按新增写入（新增须带类型，取原条目的）。
  const exists = targetId ? (await listMemories(explicitScope, ctx)).some(entry => entry.id === targetId) : false
  // 新增时 scope 显式带上：原输入多半没写 scope，重写要落到同一层。
  const retryInput = exists ? input : { ...input, scope: explicitScope }
  const result = await writeMemory(retryInput, ctx, exists ? targetId : undefined)
  return { result, consolidated: outcome.stats }
}

/** 拒写原因是否属于「写满了」（只有这两种才值得归纳）。 */
function isFull(message) {
  return String(message).includes('已满（上限') || String(message).includes('的索引总量已达上限')
}

function consolidateKey(scope, ctx) {
  return `${scope}#${ctx.workspaceDir || ''}#${ctx.identityId || ''}`
}

function consolidate(scope, incoming, replacing, ctx, model, signal) {
  const key = consolidateKey(scope, ctx)
  const running = inflight.get(key)
  if (running) return running
  const promise = run(scope, incoming, replacing, ctx, model, signal).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

async function run(scope, incoming, replacing, ctx, model, signal) {
  const before = await listMemories(scope, ctx)
  if (!before.length) return { ok: false, reason: '没有可归纳的条目' }
  const { system, user } = buildPrompt(scope, before, incoming, replacing)
  let reason = ''
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (signal?.aborted) return { ok: false, reason: '已中止' }
    let text
    try {
      text = await model(system, user, signal)
    } catch (error) {
      reason = error?.message ?? String(error)
      continue
    }
    const parsed = parseEntries(text, scope, before, incoming)
    if (!parsed.ok) {
      reason = parsed.reason
      continue
    }
    const current = await listMemories(scope, ctx)
    const after = mergeConcurrent(before, parsed.entries, current)
    const backup = await backupMemories(scope, current, ctx)
    await replaceMemories(scope, after, ctx)
    return {
      ok: true,
      stats: {
        before: { count: before.length, used: memoryUsage(before) },
        after: { count: after.length, used: memoryUsage(after) },
        backup,
      },
    }
  }
  return { ok: false, reason: reason || '归纳没有产出可用结果' }
}

function buildPrompt(scope, entries, incoming, replacing) {
  const limits = memoryLimits(scope)
  const targetChars = Math.floor(limits.budget * TARGET_RATIO)
  const targetCount = Math.floor(limits.maxEntries * TARGET_RATIO)
  const system = [
    '你负责整理用户的长期记忆。记忆已经写满，请在不丢失有用信息的前提下把它归纳精简，给即将写入的新记忆腾出空间。',
    '每条记忆有类型（user 用户 / feedback 做事方式 / project 进展 / reference 资料）、一句话标题和正文。',
    '',
    '规则：',
    `1. 同一主题的多条合并成一条。标题一句话，不超过 ${MEMORY_TITLE_MAX} 字；正文不超过 ${MEMORY_BODY_MAX} 字。`,
    '2. 前后矛盾的以更新日期较新的为准，删掉被取代的旧条目。',
    '3. 与「即将写入的新记忆」重复、或被它取代的旧条目直接删除。新记忆会另行原样保存，不要把它写进结果。',
    '4. 删除一次性的任务细节、已经结束的进展和明显过时的内容。',
    '5. 做事方式类（用户纠正过、确认过的做法）和明确表达过的偏好优先保留，正文里的「原因」「何时适用」不要删。',
    '6. 只能合并、精简、删除，不得编造原文没有的信息。「昨天」「上周」这类相对时间，按该条的更新日期换成具体日期。',
    '7. 保持原条目的语言。',
    `8. 结果的索引总长不超过 ${targetChars} 字、不超过 ${targetCount} 条（每条按「- [id] 类型 · 标题」一行计，正文不计）。`,
    '',
    '只输出 JSON，不要任何其他文字：',
    '{"entries":[{"id":"原条目 id 或 null","type":"user|feedback|project|reference","title":"…","body":"…"}]}',
    '保留或由旧条目改写、合并而来的条目，id 填它所来自的旧条目 id（合并时填其中更新日期最早的那条）；无法对应到旧条目的填 null。',
  ].join('\n')
  const day = t => (t > 0 ? new Date(t).toISOString().slice(0, 10) : '日期不详')
  const show = entry => {
    const type = entry.type && isMemoryType(entry.type) ? memoryTypeLabel(entry.type) : '类型不变'
    const title = entry.title ?? '（标题不变）'
    const body = entry.body ? `\n  正文：${String(entry.body).replace(/\n/g, '\n  ')}` : ''
    return `${type} · ${title}${body}`
  }
  const user = [
    `当前${scopeLabel(scope)}（${entries.length} 条，索引 ${memoryUsage(entries)} 字）：`,
    ...entries.map(entry => `- [${entry.id}]（更新于 ${day(entry.updatedAt)}）${show(entry)}`),
    '',
    replacing ? `即将写入的新记忆（将改写 [${replacing}] 的原内容）：` : '即将写入的新记忆：',
    show(incoming),
  ].join('\n')
  return { system, user }
}

/** 从模型输出里取出 JSON 对象的 entries 数组；取不到返回 null。 */
export function parseJsonEntries(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  try {
    const parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null
    const list = parsed?.entries
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/** 解析并校验模型给出的条目；不合格（解析不了、有条目超长、写入新条目后仍接近上限）一律不用。 */
function parseEntries(text, scope, before, incoming) {
  const limits = memoryLimits(scope)
  const list = parseJsonEntries(text)
  if (!list) return { ok: false, reason: '归纳结果不是有效的 JSON' }

  const byId = new Map(before.map(entry => [entry.id, entry]))
  const used = new Set()
  const out = []
  const now = Date.now()
  const incomingTitle = normalizeTitle(incoming?.title ?? '').toLowerCase()
  for (const item of list) {
    const raw = item ?? {}
    const title = normalizeTitle(typeof raw.title === 'string' ? raw.title : '')
    const body = normalizeBody(typeof raw.body === 'string' ? raw.body : '')
    if (!title || title.toLowerCase() === incomingTitle) continue
    if (title.length > MEMORY_TITLE_MAX || body.length > MEMORY_BODY_MAX) return { ok: false, reason: '归纳后有条目超长' }
    if (out.some(entry => entry.title.toLowerCase() === title.toLowerCase())) continue
    const old = typeof raw.id === 'string' && !used.has(raw.id) ? byId.get(raw.id) : undefined
    const type = isMemoryType(raw.type) ? raw.type : (old?.type ?? 'user')
    if (old) {
      used.add(old.id)
      const same = old.title === title && old.body === body && old.type === type
      out.push(same ? old : { ...old, type, title, body, updatedAt: now })
    } else {
      out.push({ id: newId(scope, [...before, ...out]), type, title, body, createdAt: now, updatedAt: now })
    }
  }
  // 写入新条目后仍须低于上限的九成：只删一两条就交差，下一次写入马上又要归纳，白花调用。
  const room = formatMemoryLine({ id: 'x_00000000', type: incoming?.type ?? 'user', title: incoming?.title ?? '' }).length
  if (out.length + 1 > limits.maxEntries * ACCEPT_RATIO || memoryUsage(out) + room > limits.budget * ACCEPT_RATIO) {
    return { ok: false, reason: '归纳后仍接近上限' }
  }
  return { ok: true, entries: out }
}

/**
 * 归纳期间别的对话也可能改了记忆：期间新增的条目原样保留，期间被删掉的不再写回；
 * 期间改过内容的条目以归纳结果为准（影响很小，且归纳前已备份）。
 */
function mergeConcurrent(before, result, current) {
  const was = new Set(before.map(entry => entry.id))
  const now = new Set(current.map(entry => entry.id))
  return [
    ...result.filter(entry => !was.has(entry.id) || now.has(entry.id)),
    ...current.filter(entry => !was.has(entry.id)),
  ]
}

/**
 * 归纳前把当时的全部条目存一份到 `runtimeDir/memory-backups/`，只留最近 KEEP_BACKUPS 份。
 * 没有运行目录时返回说明而不是抛错——备份失败不该让归纳后的写入白白作废。
 */
async function backupMemories(scope, entries, { runtimeDir }) {
  if (!runtimeDir) return '（本轮没有运行目录，未备份）'
  const dir = join(runtimeDir, 'memory-backups')
  const file = join(dir, `${scope}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify({ version: 2, entries }, null, 2), 'utf8')
    const all = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
    for (const name of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await rm(join(dir, name), { force: true })
    return file
  } catch (error) {
    return `（备份失败：${error.message}）`
  }
}
