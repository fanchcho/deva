/**
 * Agent 的工具集：文件读写、检索、命令执行、项目速览。
 *
 * 约定：
 *  · 一切写入路径以工作区根为界（resolveSafe + realpath 校验，符号链接不能穿出去），越界直接报错，
 *    不做"猜你想访问哪儿"；只读的 read_file 额外接受本轮运行目录（web_fetch 落盘正文要能读回，见 resolveReadable）；
 *  · 所有工具都是纯 JS 实现，只依赖 node 内建，方便在插件里直接跑、也方便测试；
 *  · 输出有界：检索类结果超长时硬截断并显式标注原长；run_command 先由 maxBuffer 封顶 8 MiB，
 *    上限内的超长输出全文落盘，只回开头与结尾的预览（lib/spill.mjs）——命令报错藏在结尾，只留开头会看不出为什么失败；
 *  · run_command 只跑 bash -lc，超时/取消后 kill 整个进程组，不阻塞 Studio 的取消。
 */
import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile, readdir, stat, mkdir, realpath, lstat, readlink, open } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { WEB_TOOL, executeWebFetch } from './web.mjs'
import { ASK_TOOL, TODO_TOOL, executeAskUser, normalizeTodos, formatTodos } from './interact.mjs'
import { MEMORY_TOOLS, memoryLayers, listMemories, layerLabel, formatMemoryLine, scopeOfId, memoryTypeLabel, deleteMemory, MemoryError } from './memory.mjs'
import { writeMemoryWithConsolidation } from './memory-consolidate.mjs'
import { callModel } from './model.mjs'
import { BROWSER_TOOL, executeBrowser } from './browser.mjs'
import { SKILL_TOOLS, executeSkillTool } from './skills.mjs'
import { SUBAGENT_TOOLS, executeSubagentTool } from './subagents.mjs'
import { spillText } from './spill.mjs'

const MAX_OUTPUT = 20000
const MAX_READ_LINES = 2000
const MAX_SHELL_BYTES = 8 << 20
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.pnpm-store', '.turbo', 'coverage'])
const MAX_FILES = 20000

export class ToolError extends Error {}

function truncate(text) {
  const value = String(text ?? '')
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n…（已截断，原长 ${value.length} 字符）` : value
}

/** 把模型给的路径解析到工作区内；绝对路径只有在工作区内部才接受。 */
export function resolveSafe(workspaceDir, target, { allowEmpty = false } = {}) {
  const raw = String(target ?? '').trim()
  if (!raw && !allowEmpty) throw new ToolError('path 不能为空')
  const root = resolve(workspaceDir)
  const full = raw ? (isAbsolute(raw) ? resolve(raw) : resolve(root, raw)) : root
  const rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new ToolError(`路径越界：${raw}（工作区 ${root}）`)
  return { root, full, relative: rel || '.' }
}

function inside(root, full) {
  const rel = relative(root, full)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 只读工具的路径解析：工作区之外，额外接受本轮的运行目录。
 * web_fetch / browser 把超长正文与截图落在 `runtimeDir` 并让模型「用 read_file 读」，
 * 只按工作区解析会当场把这条指引打成「路径越界」。写入类工具仍只走 resolveSafe。
 */
export function resolveReadable(workspaceDir, runtimeDir, target, { allowEmpty = false } = {}) {
  const raw = String(target ?? '').trim()
  if (!raw && !allowEmpty) throw new ToolError('path 不能为空')
  const root = resolve(workspaceDir)
  const full = raw ? (isAbsolute(raw) ? resolve(raw) : resolve(root, raw)) : root
  if (!inside(root, full)) {
    const extra = runtimeDir ? resolve(runtimeDir) : null
    if (!extra || !inside(extra, full)) throw new ToolError(`路径越界：${raw}（工作区 ${root}${extra ? `，运行目录 ${extra}` : ''}）`)
    return { root: extra, full, relative: relative(extra, full) || '.' }
  }
  return { root, full, relative: relative(root, full) || '.' }
}

/**
 * 词法边界之外再解析一次真实路径：工作区里的符号链接可能指向外部，
 * 只按 resolve() 判断会把边界外的文件当成工作区内的路径。
 * 目标不存在时（write_file 新建文件）沿父目录向上找最深的已存在祖先；
 * 目标本身是符号链接时（包括断链）按 readlink 递归解析，避免 writeFile 顺着链接写到外面。
 */
async function resolvePhysical(full, depth = 0) {
  if (depth > 20) throw new ToolError(`符号链接层级过深：${full}`)
  let info
  try {
    info = await lstat(full)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new ToolError(`无法解析路径：${full}（${error.message}）`)
    const parent = dirname(full)
    if (parent === full) return full
    return join(await resolvePhysical(parent, depth + 1), basename(full))
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(full)
    return resolvePhysical(isAbsolute(target) ? target : resolve(dirname(full), target), depth + 1)
  }
  try {
    return await realpath(full)
  } catch (error) {
    throw new ToolError(`无法解析路径：${full}（${error.message}）`)
  }
}

/** 真实路径必须仍在给定的某个根之内；根自身是符号链接时按真实路径比较。 */
async function assertPhysicalInside(roots, full, raw) {
  const real = await resolvePhysical(full)
  const realRoots = []
  for (const root of roots) {
    if (!root) continue
    try { realRoots.push(await realpath(root)) } catch { realRoots.push(resolve(root)) }
  }
  if (!realRoots.some(root => inside(root, real))) {
    throw new ToolError(`路径越界：${raw}（符号链接解析到 ${real}，不在工作区内）`)
  }
}

function lineCount(text) {
  return text.length === 0 ? 0 : text.split('\n').length
}

/** 工具定义（供模型使用）。inputSchema 用 Studio Schema 子集。 */
export const TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description: '读取工作区内的文本文件，返回带行号的内容。可用 offset/limit 分段读大文件。也能读本轮运行目录里的落盘文件（web_fetch 正文、浏览器截图旁的文件），绝对路径照抄即可。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区根的路径' },
        offset: { type: 'integer', description: '起始行号（从 1 开始），默认 1', minimum: 1 },
        limit: { type: 'integer', description: `最多返回多少行，默认 ${MAX_READ_LINES}`, minimum: 1, maximum: MAX_READ_LINES },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: '创建或整份覆盖一个文本文件（父目录会自动创建）。局部修改请优先用 edit_file。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区根的路径' },
        content: { type: 'string', description: '完整文件内容' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description: '精确字符串替换：把文件里的 old_string 换成 new_string。old_string 必须唯一出现，除非 replace_all=true。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区根的路径' },
        old_string: { type: 'string', description: '要替换的原文（含缩进，保持原样）' },
        new_string: { type: 'string', description: '替换后的内容' },
        replace_all: { type: 'boolean', description: '是否替换所有出现，默认 false' },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_dir',
    description: '列出一个目录下的条目（目录在前），默认工作区根。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区根的目录，默认 .' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'glob',
    description: '按 glob 通配符查找文件（支持 ** 与 *），自动跳过 node_modules/.git/out/dist。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '例如 apps/desktop/src/**/*.ts' },
        limit: { type: 'integer', description: '最多返回多少条，默认 200', minimum: 1, maximum: 2000 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'grep',
    description: '按正则搜索文件内容，返回 文件:行号:内容，自动跳过 node_modules/.git/out/dist。path 可指定搜索根（默认工作区；也可指向本轮运行目录里落盘的工具结果）。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式（不支持 lookaround）' },
        path: { type: 'string', description: '搜索根目录，默认工作区根；绝对路径须在工作区或本轮运行目录内' },
        include: { type: 'string', description: '可选的文件名 glob 过滤，例如 *.ts' },
        limit: { type: 'integer', description: '最多返回多少条命中，默认 80', minimum: 1, maximum: 1000 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_command',
    description: '在工作区根目录执行 bash 命令（非交互），返回退出码与输出。适合 pnpm typecheck / build / git status 等。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeout_ms: { type: 'integer', description: '超时毫秒，默认 120000，上限 600000', minimum: 1000, maximum: 600000 },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'deva_project',
    description: '返回 Deva 项目的速览：版本、常用脚本、文档入口、git 分支与未提交改动概览。开工前先看一眼。',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  WEB_TOOL,
  BROWSER_TOOL,
  ...SKILL_TOOLS,
  ...SUBAGENT_TOOLS,
  ASK_TOOL,
  TODO_TOOL,
  ...MEMORY_TOOLS,
]

function globToRegExp(pattern) {
  const normalized = String(pattern).replaceAll('\\', '/').replace(/^\.\//, '')
  let out = ''
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        const slash = normalized[i + 2] === '/'
        out += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else out += '[^/]*'
    } else if (char === '?') out += '[^/]'
    else if ('\\^$+.()|{}[]'.includes(char)) out += `\\${char}`
    else out += char
  }
  return new RegExp(`^${out}$`)
}

async function walk(root, visit) {
  const stack = [root]
  let seen = 0
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (++seen > MAX_FILES) return
      if (await visit(full) === false) return
    }
  }
}

/** 当前身份 id / 名称：记忆的角色层按它分区，也只在该身份下可见。 */
function memoryContext(ctx, workspaceDir) {
  const identity = ctx?.identity
  return {
    state: ctx?.state ?? ctx,
    workspaceDir,
    identityId: identity?.identityId ?? identity?.id ?? null,
    identityName: identity?.identityName ?? identity?.name ?? null,
  }
}

function fullMemoryEntry(entry, where) {
  return [`[${entry.id}] ${memoryTypeLabel(entry.type)} · ${entry.title}（${where}）`, entry.body || '（无正文）'].join('\n')
}

/** 归纳用的取文本函数：用本轮同一个模型，要求 JSON 输出，不挂工具。 */
function memoryConsolidateModel(run, ctx) {
  if (!run?.model) return null
  return async (system, user, signal) => {
    const result = await callModel({
      model: run.model,
      apiMode: run.model?.apiMode,
      baseUrl: run.model?.baseUrl,
      token: run.model?.token,
      system,
      messages: [{ role: 'user', text: user }],
      tools: [],
      signal: signal ?? ctx?.signal,
    })
    return result?.text ?? ''
  }
}

async function executeMemoryRead(args, ctx, workspaceDir) {
  const mem = memoryContext(ctx, workspaceDir)
  const ids = Array.isArray(args.ids) ? args.ids.map(id => String(id ?? '').trim()).filter(Boolean) : []
  if (ids.length) {
    const out = []
    for (const id of ids) {
      const scope = scopeOfId(id)
      const entries = await listMemories(scope, mem)
      const hit = entries.find(entry => entry.id === id)
      if (hit) {
        out.push(fullMemoryEntry(hit, layerLabel(scope, mem)))
      } else out.push(`[${id}] 不存在${scope === 'project' && !workspaceDir ? '（当前未挂载工作区，无法读取项目记忆）' : ''}`)
    }
    return out.join('\n\n')
  }
  const layers = await memoryLayers(mem)
  const blocks = []
  let total = 0
  for (const { scope, label } of layers) {
    const entries = await listMemories(scope, mem)
    total += entries.length
    blocks.push(`【${label}】`, ...(entries.length ? entries.map(formatMemoryLine) : ['（暂无）']), '')
  }
  if (!workspaceDir) blocks.push('（未挂载工作区，无项目记忆）')
  blocks.push('正文用 memory_read 带 ids 读取。')
  return `${blocks.join('\n').trim()}\n\n（共 ${total} 条）`
}

async function executeMemoryWrite(args, ctx, workspaceDir) {
  const mem = memoryContext(ctx, workspaceDir)
  const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : undefined
  const explicit = ['global', 'role', 'project'].find(scope => scope === args.scope)
  // 省略 scope：带 id 按前缀定位；新增默认全局。
  const scope = explicit ?? (id ? scopeOfId(id) : 'global')
  if (scope === 'project' && !workspaceDir) {
    throw new ToolError('当前未挂载工作区，无法写入项目记忆：请改写到 global 或 role，或请用户先挂载项目。')
  }
  const layers = await memoryLayers(mem)
  if (!layers.some(layer => layer.scope === scope)) throw new ToolError('当前对话没有可用的用户存储，无法保存记忆。')
  const input = {
    scope,
    ...(typeof args.type === 'string' ? { type: args.type } : {}),
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
    ...(typeof args.body === 'string' ? { body: args.body } : {}),
  }
  let written
  try {
    written = await writeMemoryWithConsolidation(input, id, scope, mem, memoryConsolidateModel(ctx?.run, ctx), ctx?.signal)
  } catch (error) {
    if (error instanceof MemoryError) throw new ToolError(error.message)
    throw error
  }
  const { result, consolidated } = written
  const where = layerLabel(scope, mem)
  const note = consolidated
    ? `${where}已写满，已自动归纳：${consolidated.before.count} 条 / 索引 ${consolidated.before.used} 字 → ${consolidated.after.count} 条 / 索引 ${consolidated.after.used} 字（归纳前的内容已备份到 ${consolidated.backup}）。\n`
    : ''
  const verb = result.created ? '已记住' : id ? '已更新记忆' : '该记忆已存在'
  return `${note}${verb}（${where}）：${formatMemoryLine(result.entry)}`
}

async function executeMemoryDelete(args, ctx, workspaceDir) {
  const mem = memoryContext(ctx, workspaceDir)
  const id = String(args.id ?? '').trim()
  if (!id) throw new ToolError('缺少要删除的记忆 id')
  const scope = scopeOfId(id)
  const store = await listMemories(scope, mem)
  const hit = store.find(entry => entry.id === id)
  if (!hit) {
    throw new ToolError(`不存在 id 为 ${id} 的记忆（可先用 memory_read 查看）${scope === 'project' && !workspaceDir ? '；当前未挂载工作区，无法定位项目记忆' : ''}`)
  }
  await deleteMemory(id, mem)
  return `已删除记忆（${layerLabel(scope, mem)}）：${formatMemoryLine(hit)}`
}

async function readIfText(full) {
  try {
    const info = await stat(full)
    if (info.size > 2 * 1024 * 1024) return null
    return await readFile(full, 'utf8')
  } catch {
    return null
  }
}

/**
 * 只读开头 4 KiB 判断是否为二进制：grep 遍历时先挡住图片/压缩包，避免为了 NUL 检查
 * 把整个文件读进来。只判断开头是取舍——4 KiB 之后才出现 NUL 的文件由 grep 的全文
 * 检查兜底（content.includes('\0')）。
 */
async function looksBinary(full) {
  let handle
  try {
    handle = await open(full, 'r')
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).includes(0)
  } catch {
    return true
  } finally {
    await handle?.close().catch(() => {})
  }
}

function numberLines(lines, start) {
  return lines.map((line, index) => `${String(start + index).padStart(6)}→${line}`).join('\n')
}

/** 执行一个工具调用。ctx = { workspaceDir, runtimeDir, interactions, agentSession, signal, facts, log } */
export async function executeTool(name, input, ctx) {
  const workspaceDir = ctx?.workspaceDir
  if (ctx?.signal?.aborted) throw new ToolError('本轮已被取消')
  const args = input && typeof input === 'object' ? input : {}
  // 这三个工具与工作区无关：没有工作区的会话（例如纯对话）也要能用。
  if (name === 'web_fetch') return executeWebFetch(args, { signal: ctx?.signal, runtimeDir: ctx?.runtimeDir, log: ctx?.log })
  if (name === 'ask_user') return executeAskUser(args, { interactions: ctx?.interactions, signal: ctx?.signal })
  // 记忆：全局记忆无工作区也能读写，角色记忆要当前身份，项目记忆要求已挂载工作区（memory.mjs 会明确报错）。
  if (name === 'memory_read') return executeMemoryRead(args, ctx, workspaceDir)
  if (name === 'memory_write') return executeMemoryWrite(args, ctx, workspaceDir)
  if (name === 'memory_delete') return executeMemoryDelete(args, ctx, workspaceDir)
  // 浏览器与工作区无关：走宿主桌面浏览器通道（host.browser），没有通道时明确报错。
  if (name === 'browser') {
    return executeBrowser(args, { host: ctx?.host, runtimeDir: ctx?.runtimeDir, signal: ctx?.signal })
  }
  // 技能走 Studio 的技能接口（host.request），与工作区无关：纯对话会话也能查、也能整理技能。
  if (name === 'skill_view' || name === 'skill_manage') {
    return executeSkillTool(name, args, { host: ctx?.host, signal: ctx?.signal, log: ctx?.log })
  }
  // 子智能体：在隔离上下文里跑同一套循环（runTurn 由 loop.mjs 注入）。
  if (name === 'run_subagent' || name === 'send_to_subagent') {
    return executeSubagentTool(name, args, ctx)
  }
  if (name === 'todo_write') {
    const store = ctx?.agentSession
    if (!store) throw new ToolError('当前运行环境没有会话存储，无法保存待办清单')
    const todos = normalizeTodos(args.todos)
    await store.set('todos', todos)
    return todos.length ? `已更新待办清单（${todos.length} 条）：\n${formatTodos(todos)}` : '已清空待办清单'
  }
  if (!workspaceDir) throw new ToolError('当前会话没有工作区，无法使用文件与命令工具')
  switch (name) {
    case 'read_file': {
      const { full, relative: rel } = resolveReadable(workspaceDir, ctx?.runtimeDir, args.path)
      await assertPhysicalInside([workspaceDir, ctx?.runtimeDir], full, args.path)
      const content = await readIfText(full)
      if (content === null) throw new ToolError(`读不到文件（不存在、不是文本或过大）：${rel}`)
      const lines = content.split('\n')
      const offset = Number(args.offset ?? 1)
      const limit = Number(args.limit ?? MAX_READ_LINES)
      const start = Math.max(1, Number.isFinite(offset) ? offset : 1)
      const slice = lines.slice(start - 1, start - 1 + Math.max(1, Number.isFinite(limit) ? limit : MAX_READ_LINES))
      const header = `${rel}（共 ${lines.length} 行，显示 ${start}-${start + slice.length - 1}）`
      return truncate(`${header}\n${numberLines(slice, start)}`)
    }
    case 'write_file': {
      const { full, relative: rel } = resolveSafe(workspaceDir, args.path)
      await assertPhysicalInside([workspaceDir], full, args.path)
      const content = String(args.content ?? '')
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      return `已写入 ${rel}（${Buffer.byteLength(content)} 字节，${lineCount(content)} 行）`
    }
    case 'edit_file': {
      const { full, relative: rel } = resolveSafe(workspaceDir, args.path)
      await assertPhysicalInside([workspaceDir], full, args.path)
      const current = await readIfText(full)
      if (current === null) throw new ToolError(`读不到文件：${rel}`)
      const oldString = String(args.old_string ?? '')
      const newString = String(args.new_string ?? '')
      if (!oldString) throw new ToolError('old_string 不能为空')
      const parts = current.split(oldString)
      if (parts.length === 1) throw new ToolError(`没有找到 old_string（${rel}）；先 read_file 确认原文，包括缩进与换行`)
      if (parts.length > 2 && args.replace_all !== true) throw new ToolError(`old_string 在 ${rel} 中出现 ${parts.length - 1} 次；给更长的上下文，或设置 replace_all=true`)
      const next = parts.join(newString)
      await writeFile(full, next, 'utf8')
      return `已修改 ${rel}（替换 ${parts.length - 1} 处，${lineCount(next)} 行）`
    }
    case 'list_dir': {
      const { full, relative: rel } = resolveSafe(workspaceDir, args.path ?? '.', { allowEmpty: true })
      await assertPhysicalInside([workspaceDir], full, args.path ?? '.')
      let entries
      try { entries = await readdir(full, { withFileTypes: true }) } catch { throw new ToolError(`不是可读目录：${rel}`) }
      const rows = await Promise.all(entries.map(async entry => {
        // 目录不展示大小，省掉一次 stat；文件和符号链接才取 size。
        let size = '-'
        if (!entry.isDirectory()) {
          const info = await stat(join(full, entry.name)).catch(() => null)
          size = String(info?.size ?? 0)
        }
        return `${entry.isDirectory() ? 'd' : '-'} ${size.padStart(10)}  ${entry.name}`
      }))
      rows.sort((a, b) => (a.startsWith('d') === b.startsWith('d') ? a.localeCompare(b) : a.startsWith('d') ? -1 : 1))
      return truncate(`${rel}\n${rows.join('\n') || '（空目录）'}`)
    }
    case 'glob': {
      const matcher = globToRegExp(args.pattern ?? '**/*')
      const limit = Math.min(2000, Math.max(1, Number(args.limit ?? 200)))
      const hits = []
      await walk(resolve(workspaceDir), async full => {
        const rel = relative(resolve(workspaceDir), full).replaceAll(sep, '/')
        if (matcher.test(rel)) hits.push(rel)
        return hits.length < limit
      })
      hits.sort((a, b) => a.localeCompare(b))
      return truncate(hits.length ? hits.join('\n') : '没有匹配的文件')
    }
    case 'grep': {
      let regex
      try { regex = new RegExp(String(args.pattern ?? ''), 'g') } catch (error) { throw new ToolError(`正则无效：${error.message}`) }
      const include = args.include ? globToRegExp(args.include) : null
      const limit = Math.min(1000, Math.max(1, Number(args.limit ?? 80)))
      // 搜索根默认工作区，也可指向本轮运行目录里落盘的工具结果（落盘说明就是这么建议的）。
      const { full: searchRoot } = resolveReadable(workspaceDir, ctx?.runtimeDir, args.path ?? '.', { allowEmpty: true })
      await assertPhysicalInside([workspaceDir, ctx?.runtimeDir], searchRoot, args.path ?? '.')
      const hits = []
      await walk(searchRoot, async full => {
        const rel = relative(searchRoot, full).replaceAll(sep, '/')
        if (include && !include.test(rel.split('/').pop())) return true
        if (await looksBinary(full)) return true
        const content = await readIfText(full)
        if (content === null || content.includes('\0')) return true
        const lines = content.split('\n')
        for (let index = 0; index < lines.length; index++) {
          regex.lastIndex = 0
          if (!regex.test(lines[index])) continue
          hits.push(`${rel}:${index + 1}: ${lines[index].trim().slice(0, 400)}`)
          if (hits.length >= limit) return false
        }
        return true
      })
      return truncate(hits.length ? hits.join('\n') : '没有命中')
    }
    case 'run_command': {
      const command = String(args.command ?? '').trim()
      if (!command) throw new ToolError('command 不能为空')
      const timeout = Math.min(600000, Math.max(1000, Number(args.timeout_ms ?? 120000)))
      const body = await runShell(command, workspaceDir, timeout, ctx?.signal)
      // 命令输出两头都要看（报错常在结尾）：超长时全文落盘，只给首尾预览。
      return spillText(body, MAX_OUTPUT, { runtimeDir: ctx?.runtimeDir, label: 'command' })
    }
    case 'deva_project': {
      const facts = ctx?.facts
      const lines = [
        facts?.version ? `workspace 版本：${facts.version}` : '',
        facts?.desktopVersion ? `桌面端版本：${facts.desktopVersion}` : '',
        facts?.branch ? `git：${facts.branch}${facts.commit ? ` @ ${facts.commit}` : ''}` : '',
        facts?.scripts?.length ? `脚本：\n${facts.scripts.map(s => `  - ${s}`).join('\n')}` : '',
        facts?.docs?.length ? `文档：${facts.docs.join('、')}` : '',
        facts?.summary ? `梳理口径：${facts.summary}` : '',
      ].filter(Boolean)
      const status = await new Promise(resolve => {
        execFile('git', ['status', '--short'], { cwd: workspaceDir, timeout: 2500, maxBuffer: 1 << 20 }, (error, stdout) => {
          resolve(error ? '' : String(stdout).trim())
        })
      })
      if (status) lines.push(`未提交改动：\n${status.split('\n').slice(0, 40).join('\n')}`)
      else lines.push('未提交改动：无（或不是 git 仓库）')
      return truncate(lines.join('\n') || '没有读到项目信息')
    }
    default:
      throw new ToolError(`未知工具：${name}`)
  }
}

function runShell(command, cwd, timeout, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ToolError('本轮已被取消')); return }
    // 注意不能用 execFile：Node 24 的 execFile 不透传 detached，超时只能杀掉 bash 本身。
    // 这里用 spawn 让 bash 成为进程组组长，超时/取消时整组杀掉，避免 pnpm/test 派生的孤儿进程继续跑。
    const child = spawn('bash', ['-lc', command], {
      cwd,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let aborted = false
    let tooLarge = false
    let settled = false

    const killTree = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        // Windows 没有进程组信号，用 taskkill /T 连子进程一起结束。
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
        return
      }
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* 已经退出 */ } }
    }
    const collect = (chunks, chunk, stream) => {
      // 超限后仍然消费数据（不 removeListener），否则管道被写满会卡住子进程。
      if (tooLarge) return
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes
      const room = MAX_SHELL_BYTES - used
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room))
        tooLarge = true
        killTree()
        return
      }
      chunks.push(chunk)
      if (stream === 'stdout') stdoutBytes += chunk.length
      else stderrBytes += chunk.length
    }
    child.stdout.on('data', chunk => collect(stdout, chunk, 'stdout'))
    child.stderr.on('data', chunk => collect(stderr, chunk, 'stderr'))

    const timer = setTimeout(() => { timedOut = true; killTree() }, timeout)
    const onAbort = () => { aborted = true; killTree() }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    // 注册监听与检查之间仍有极小窗口：已经取消就立刻按取消处理。
    if (signal?.aborted) onAbort()

    child.on('error', error => {
      if (settled) return
      settled = true
      cleanup()
      reject(new ToolError(`命令启动失败：${error.message}`))
    })
    child.on('close', (code, sig) => {
      if (settled) return
      settled = true
      cleanup()
      const status = timedOut ? 'timeout' : aborted ? 'aborted' : tooLarge ? 'output-limit' : (code ?? sig ?? 'killed')
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      const body = [
        `$ ${command}`,
        `exit=${status}`,
        timedOut ? `（命令超时（>${timeout}ms），已终止进程组）` : '',
        aborted ? '（本轮已取消，已终止进程组）' : '',
        tooLarge ? `（输出超过 ${MAX_SHELL_BYTES >> 20} MiB，已被截断）` : '',
        out.trim() ? `--- stdout ---\n${out.trimEnd()}` : '',
        err.trim() ? `--- stderr ---\n${err.trimEnd()}` : '',
      ].filter(Boolean).join('\n')
      // 有输出就算跑完了：非零退出码交给模型判断，不在这里抛错。
      // 单条命令先由 MAX_SHELL_BYTES 封顶；超过 20000 字符的正文再由 spillText 落盘并只回预览。
      resolve(body)
    })
  })
}
