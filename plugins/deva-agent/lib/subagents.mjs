import { closePendingTools, createCheckpointController } from './checkpoint.mjs'
/**
 * 子智能体（Subagents）：在隔离上下文里跑一项多步任务，只把结论交回主轮。
 *
 * 与桌面端 apps/desktop/src/main/services/subagents.ts 同一套类型与职责正文：
 * General（全部工具）/ Explore / Plan / Research（只读工具集），另有 fork（继承主对话）。
 *
 * 两处按 Studio 插件的真实能力收窄，并如实写在工具描述里：
 *  · **前台执行**：插件运行期内没有「结束后唤醒主轮」的通道，后台子智能体的结论无处送达，
 *    所以 run_subagent 一律等它跑完再返回结论，不提供 foreground 参数，也不假装在后台跑；
 *  · 子智能体不再派生（depth 上限 1），交互类、记忆写删、技能、待办清单等工具对其不可见。
 *
 * 工具集只做**收窄**：保留的每次调用照常走同一套工具实现与工作区边界检查，没有任何提权。
 */
import { normalizeSubagents, validateStored } from './storage-contracts.mjs'
import { createHash } from 'node:crypto'

const READONLY_TOOLS = ['read_file', 'list_dir', 'glob', 'grep', 'web_fetch', 'run_command']

export const GENERAL_SUBAGENT = {
  name: 'General',
  description:
    '通用子智能体，具备全部工具；适合多步检索后再理解归纳的调研，或与主线相对独立的封闭子任务。要找某个关键词或文件、又没把握前几次就能找准时，也交给它去搜。',
  tools: '*',
  prompt: '',
}

const EXPLORE = {
  name: 'Explore',
  description:
    '只读的检索定位子智能体：在代码库或文件夹（文档、笔记、数据）里查清「在哪里、有几处、怎么命名的」，回报「路径:行号 + 说明」，不改动、不评审。',
  tools: READONLY_TOOLS,
  prompt: [
    '你的专长是**在庞大或陌生的代码库或文件夹（文档、笔记、数据）里做广度检索与定位**：把「在哪里、有几处、怎么命名的」查清楚。',
    '',
    '- **先广后深**：先用 glob / grep 铺开候选面（同一概念多试几种命名、大小写写法与同义说法），再用 read_file 只读命中处前后的片段；不要通读整个文件。',
    '- 你**没有写入工具**（write_file / edit_file）——这是定位任务不是改动任务；run_command 只用于只读查询（git log / git grep / ls 之类），不要用它改动任何东西。',
    '- 结论逐条列「**路径:行号** —— 一句话说明」，必要处附三五行关键片段；有多处同类实现或内容要列全，不要只报第一个。',
    '- 没找到就明说没找到，并交代搜过哪些模式与目录——这比编一个看似合理的位置有用得多。',
    '- 只做定位与事实陈述：**不做评审、不提改动建议**，那是主智能体的判断。',
  ].join('\n'),
}

const PLAN = {
  name: 'Plan',
  description: '为一项改动做只读调研并给出分步实施方案、关键文件与取舍；只读，不落笔实现。',
  tools: READONLY_TOOLS,
  prompt: [
    '你的专长是**为一项非平凡的改动做方案调研**：先把现状摸清，再给出可直接执行的实施方案。',
    '',
    '- **先调研后成文**：找到相关文件、现有约定，以及可复用的既有函数 / 工具；**优先复用现有实现而不是新造**，方案要贴着这个代码库的既有风格，不要泛泛谈通用最佳实践。',
    '- 你**没有写入工具**（write_file / edit_file）——本次只出方案，一个字都不落笔；run_command 只用于只读查询。',
    '- 结论包含四块：① 分步实施方案（每步点名要改哪个文件、怎么改）② 关键文件清单（路径 + 一句话职责）③ 做过的取舍与被否掉的备选 ④ 风险点与验证方式。',
    '- 拿不准的地方不要含糊带过，也不要为此停下来等人回答——你无法提问。把它们**集中列在结论末尾的「待确认项」**里，每项写清问题与你建议的默认取向；正文方案里不夹问句，涉及处按建议默认写成「默认采用 X」。',
    '- 你的结论会交回主智能体，请按「可直接给人读的实施方案」来写，别写成给自己看的调研流水账。',
  ].join('\n'),
}

const RESEARCH = {
  name: 'Research',
  description:
    '只读的资料调研子智能体：问题涉及第三方库、工具或产品的用法、行为、版本变化，需要查官方文档、changelog / 发布说明或开源源码才能答准时用它；多来源核对，回报结论与出处链接，不改动文件。',
  tools: READONLY_TOOLS,
  prompt: [
    '你的专长是**查外部资料回答问题**：第三方库 / 工具 / 产品怎么用、某个行为是否存在、哪个版本改了什么——查清后给出有出处的结论。',
    '',
    '- **一手来源优先**：官方文档、changelog / 发布说明、官方仓库的源码与 issue，优于博客、问答帖与二手转述；二手说法只作线索，要回到一手来源核实。',
    '- **你没有搜索引擎**，要从已知入口取材：官方文档站（可先试 `/llms.txt`、`/sitemap.xml` 摸清页面目录）、GitHub 仓库（raw.githubusercontent.com 取 README / CHANGELOG，api.github.com 取 releases / issues）、包仓库元数据（registry.npmjs.org、pypi.org/pypi/<包名>/json 等）。工具表里若有搜索类 MCP 工具，先用它找入口。',
    '- **大文件先落地再检索**：web_fetch 会截断超长内容；changelog、长文档这类大文件用 run_command 下载到临时目录，再用 grep 多换几种关键词与同义说法检索，用 read_file 读命中处上下文。',
    '- **对准版本**：问题涉及本机已装的工具或项目依赖时，先查实际版本（命令行 --version、package.json、lock 文件等），结论对应到那个版本，并写明所依据资料的版本或日期。',
    '- 结论分两类写清：**有明文依据**的附出处 URL（必要处摘一两句原文）；**推断或没找到**的如实标明，并交代查过哪些来源与关键词——不要拿看似合理的说法填空。',
    '- 你**没有写入工具**（write_file / edit_file）——只取材不改动；run_command 只用于下载与只读查询，下载的文件放运行目录，不要写进项目目录。',
  ].join('\n'),
}

export const BUILTIN_SUBAGENTS = [GENERAL_SUBAGENT, EXPLORE, RESEARCH, PLAN]

/** 分身：原样继承主对话（历史 + 本轮系统提示词 + 同一模型），没有自己的工具白名单。 */
export const FORK_AGENT = {
  name: 'fork',
  description:
    '继承你当前的完整对话上下文、使用同一模型；适合需要了解前文、又不想让中间过程占用主对话的子任务；主对话已经很长时慎用。',
}

export function isForkAgent(name) {
  return String(name ?? '').trim().toLowerCase() === FORK_AGENT.name
}

export function subagentSummaries() {
  return [...BUILTIN_SUBAGENTS.map(item => ({ name: item.name, description: item.description })), FORK_AGENT]
}

const ALIASES = { 'general-purpose': GENERAL_SUBAGENT }

/** 按名（大小写不敏感）取内置子智能体；未命中返回 null（调用方回落 General）。 */
export function getSubagentByName(name) {
  const wanted = String(name ?? '').trim().toLowerCase()
  if (!wanted) return null
  return BUILTIN_SUBAGENTS.find(item => item.name.toLowerCase() === wanted) ?? ALIASES[wanted] ?? null
}

/** 子智能体不可用的工具：交互、再派生、持久化写入类。 */
export const SUBAGENT_EXCLUDED = new Set([
  'ask_user',
  'skill_view',
  'skill_manage',
  'run_subagent',
  'send_to_subagent',
  'memory_write',
  'memory_delete',
  'todo_write',
])

const MAX_RECORDS = 20
const MAX_CONCLUSION = 20000

const AGENT_LIST = subagentSummaries().map(item => `${item.name}（${item.description}）`).join('；')

export const SUBAGENT_TOOLS = [
  {
    name: 'run_subagent',
    description:
      '启动一个子智能体，在独立上下文里处理一项多步任务，完成后只把结论交回给你。' +
      '任务对得上下面某种子智能体、有彼此独立可以并行的工作、或者回答需要跨多个文件阅读时，交给子智能体——你拿回结论，而不是一堆文件内容。已经知道具体文件、符号或取值的单点查找，直接自己查。检索交出去之后就不要自己再做一遍，等它的结论。' +
      '彼此独立的多项工作，在同一条回复里发起多个调用，它们会并行执行。' +
      '除 fork 外，子智能体看不到主对话，prompt 要写清背景、目标和期望的回报形式；派 Explore 时在 prompt 里说明检索力度（「中等」或「非常彻底」）。' +
      '在 prompt 里写明期望它只做调研，还是动手修改文件或执行有副作用的命令——没说清时它可能多做或少做。' +
      '子智能体的结论不会直接显示给用户，把要紧的部分转述给用户。' +
      '本插件里子智能体一律**前台执行**：调用会等它跑完，直接返回结论，没有后台通知机制，也不要假装它还在后台跑。' +
      '结论末尾附有子智能体 ID：本轮或后续轮次可用 send_to_subagent 给它发消息，它会在保留原有上下文的基础上继续；再次调用 run_subagent 则是全新开始。' +
      `可用的子智能体：${AGENT_LIST}。省略 agent 即通用子智能体 ${GENERAL_SUBAGENT.name}。`,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '用 3-5 个字概括这项子任务（如「检索鉴权逻辑」），作为任务标识展示给用户。', maxLength: 120 },
        agent: {
          type: 'string',
          description: `可选。要使用的子智能体；省略或未命中即 ${GENERAL_SUBAGENT.name}。`,
          enum: subagentSummaries().map(item => item.name),
        },
        prompt: { type: 'string', description: '交给子智能体的任务描述（fork 之外它看不到主对话，背景要写全）。' },
      },
      required: ['description', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_to_subagent',
    description:
      '给之前用 run_subagent 派出的子智能体发一条消息，让它在保留原有上下文的基础上继续工作（追问、补充要求、让它接着做），返回它这一次的结论。' +
      '同一个子智能体能派发的记录保存在本会话里（最近 20 个），ID 由 run_subagent 结论末尾给出。' +
      '前台执行：调用会等它跑完再返回结论。它的结论同样不会直接显示给用户，要紧的部分请转述。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '子智能体 ID，即 run_subagent 结论末尾给出的 ID（如 sub-1a2b3c4d）。', maxLength: 64 },
        message: { type: 'string', description: '发给它的消息。它看得到自己之前的全部上下文，但看不到主对话里后来发生的事。' },
        description: { type: 'string', description: '可选。用 3-5 个字概括这次要它做的事；省略则沿用原任务标题。', maxLength: 120 },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
]

export class SubagentError extends Error {}

function subagentId(seed) {
  return `sub-${createHash('sha1').update(String(seed)).digest('hex').slice(0, 8)}`
}

/** 子智能体系统提示词：固定隔离说明 + 该类型自己的职责正文。 */
export function buildSubagentSystem(def, workspaceDir) {
  const loc = workspaceDir
    ? `当前工作目录：${workspaceDir}。文件与命令工具都以它为根，路径写相对该目录的形式。`
    : '当前会话没有挂载工作区：文件与命令工具不可用，只能使用联网检索类工具。'
  const lines = [
    `你是子智能体「${def.name}」，由主智能体派生来独立完成一项被交办的子任务。`,
    loc,
    '请只专注完成这项子任务；完成后用简洁的简体中文直接给出结论/产物，作为交回主智能体的答复，不要反问。',
    '结论要能被主智能体直接使用：给出结论与依据，点名相关文件（相对工作目录的路径）与必要的代码/取值片段；不要复述过程流水账。',
    '彼此没有依赖的工具调用（同时读几个文件、同时搜几个关键词）务必在同一次回复里一并发出；查找与阅读请用 glob / grep / read_file / list_dir，不要用 run_command 跑 find、grep、cat、ls 代替。',
    '你无法向用户提问（没有 ask_user 工具），也不能再派生其它子智能体；若信息不足，基于合理默认完成，并在结论中说明所做的假设。',
    '工具路径以工作区为界，越界会被拒绝。调用失败时改用其它方式或在结论中说明，切勿原样反复重试。',
  ]
  const body = String(def.prompt || '').trim()
  if (body) lines.push('', '你的职责与专长如下：', body)
  return lines.join('\n')
}

/**
 * 子智能体可用工具：先剔除禁用项，再按该类型的白名单收窄；MCP 工具按桌面端口径全量附加。
 * baseTools 由调用方传入（本插件的工具表），避免 tools.mjs 与本文件互相 import 形成初始化环。
 */
export function subagentTools(def, { baseTools = [], extraTools = [] } = {}) {
  const builtins = baseTools.filter(tool => !SUBAGENT_EXCLUDED.has(tool.name))
  if (def.tools === '*') return [...builtins, ...extraTools]
  const allow = new Set(def.tools)
  return [...builtins.filter(tool => allow.has(tool.name)), ...extraTools]
}

/** fork 用的历史：去掉末尾未收到工具结果的 assistant 回合，避免把悬空 tool_calls 交给模型。 */
function forkHistory(messages) {
  const copy = messages.map(message => ({
    ...message,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map(call => ({ ...call })) } : {}),
  }))
  while (copy.length) {
    const last = copy.at(-1)
    if (last.role === 'tool') { copy.pop(); continue }
    if (last.role === 'assistant' && last.toolCalls?.length) { copy.pop(); continue }
    break
  }
  return copy
}

function storeOf(run) {
  return run?.state?.agentSession && typeof run.state.agentSession.get === 'function' ? run.state.agentSession : null
}

async function loadRecords(run) {
  const store = storeOf(run)
  if (!store) return {}
  return normalizeSubagents(await store.get('subagents'))
}

/**
 * 记录写入串行化：并行派发的多个子智能体会同时回来写同一条 `subagents` 记录，
 * 「读—改—写」并发会互相覆盖。串行后每个记录都落在上一次写入的结果之上。
 */
let writeChain = Promise.resolve()

async function saveRecord(run, record) {
  const store = storeOf(run)
  if (!store) return false
  const task = writeChain.then(async () => {
    const records = await loadRecords(run)
    records[record.id] = record
    const trimmed = Object.values(records)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, MAX_RECORDS)
    await store.set('subagents', validateStored('subagents', Object.fromEntries(trimmed.map(item => [item.id, item]))))
    return true
  })
  writeChain = task.catch(() => {})
  return task
}

/**
 * 收掉悬空的尾巴：上一轮若在工具调用中途被中止，历史末尾会留下没有结果的 assistant.toolCalls
 * 或孤立 tool 消息，直接续聊会被供应商拒绝。与桌面端 closeDanglingTail 同一口径。
 */

/** 结论文本收口：超长截断并明确标注，不静默丢内容。 */
function clampConclusion(text) {
  const value = String(text ?? '').trim()
  if (!value) return '（子智能体没有给出文本结论）'
  return value.length > MAX_CONCLUSION ? `${value.slice(0, MAX_CONCLUSION)}\n…（结论已截断，原长 ${value.length} 字符）` : value
}

/**
 * 跑一个子智能体记录（新派发与续聊共用）。
 * ctx.runTurn 由 loop.mjs 注入（避免 tools.mjs ↔ subagents.mjs ↔ loop.mjs 的初始化环）。
 */
async function runRecord(record, ctx, { def, fork }) {
  const { run, model, extraTools = [], baseTools = [], execute, facts, workspaceDir, runTurn, depth = 0, maxSteps } = ctx
  // fork 沿用父轮工具表（去掉被禁用的交互/派生类），普通子智能体用该类型的白名单。
  const tools = fork
    ? (ctx.tools || [...baseTools, ...extraTools]).filter(tool => !SUBAGENT_EXCLUDED.has(tool.name))
    : subagentTools(def, { baseTools, extraTools })
  const store = storeOf(run)
  const childStore = store ? {
    get: key => key === 'checkpoint' ? record.checkpoint : store.get(key),
    async set(key, value) {
      if (key !== 'checkpoint') return store.set(key, value)
      record.checkpoint = value
      record.messages = structuredClone(value.data.messages)
      await saveRecord(run, record)
    },
  } : undefined
  const checkpoint = run.identity?.agentId ? createCheckpointController(run.identity, record.checkpoint) : null
  const result = await runTurn({
    run: store ? { ...run, state: { ...run.state, agentSession: childStore } } : run,
    checkpoint,
    input: { input: [{ type: 'text', text: '' }], history: [], instructions: [], options: {} },
    system: record.system,
    workspaceDir,
    facts,
    model,
    maxSteps,
    tools,
    execute,
    depth: depth + 1,
    silent: true,
    // 子轮沿用父轮的记忆身份分区：角色层的读取与父对话看到的是同一份。
    identityId: ctx.identity?.identityId ?? null,
    identityName: ctx.identity?.identityName ?? null,
    initialMessages: record.messages,
  })
  const text = clampConclusion(result?.content?.map(block => block.text).join('\n'))
  const incomplete =
    result?.finishReason === 'tool_limit'
      ? '\n（子智能体达到步数上限，结论可能不完整。）'
      : result?.finishReason === 'length'
        ? '\n（子智能体输出被截断，结论可能不完整。）'
        : ''
  return `${text}${incomplete}`
}

/** 执行 run_subagent / send_to_subagent。ctx 由 loop.mjs 提供。 */
export async function executeSubagentTool(name, input, ctx = {}) {
  if (ctx.signal?.aborted) throw new SubagentError('本轮已被取消')
  if (!ctx.runTurn) throw new SubagentError('当前运行环境缺少子智能体的运行入口')
  const depth = Number(ctx.depth ?? 0)
  if (depth > 0) throw new SubagentError('子智能体不能再派生或续聊子智能体')
  const args = input && typeof input === 'object' ? input : {}
  const callId = String(ctx.callId ?? '').trim()

  if (name === 'run_subagent') {
    const wantedAgent = typeof args.agent === 'string' ? args.agent.trim() : ''
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) throw new SubagentError('run_subagent 需要 prompt：写清背景、目标和期望的回报形式')
    const fork = isForkAgent(wantedAgent)
    const picked = wantedAgent && !fork ? getSubagentByName(wantedAgent) : null
    const def = picked ?? GENERAL_SUBAGENT
    const label = fork ? FORK_AGENT.name : def.name
    const note = wantedAgent && !fork && !picked
      ? `（没有名为「${wantedAgent}」的子智能体，已改用通用子智能体 ${GENERAL_SUBAGENT.name} 完成。可选：${subagentSummaries().map(item => item.name).join('、')}。）\n`
      : ''
    const id = subagentId(`${ctx.run?.identity?.sessionId || 'session'}#${callId || prompt.slice(0, 40)}`)
    const now = Date.now()
    const system = fork ? String(ctx.system ?? '') : buildSubagentSystem(def, ctx.workspaceDir)
    const messages = fork
      ? [...forkHistory(ctx.messages || []), { role: 'user', text: prompt }]
      : [{ role: 'user', text: prompt }]
    const record = {
      id,
      agent: label,
      description: String(args.description || '').trim() || label,
      system,
      messages,
      createdAt: now,
      updatedAt: now,
    }
    await saveRecord(ctx.run, record)
    let conclusion
    try {
      conclusion = await runRecord(record, ctx, { def, fork })
    } catch (error) {
      closePendingTools(record.messages)
      record.updatedAt = Date.now()
      await saveRecord(ctx.run, record)
      throw new SubagentError(`子智能体「${label}」运行失败：${error?.message || error}${storeOf(ctx.run) ? `（ID：${record.id}，可用 send_to_subagent 继续）` : '（没有会话存储，无法恢复）'}`)
    }
    // 记录落盘后，结论才附带可续聊的 ID；没有会话存储时如实说明，不给出用不了的 ID。
    const saved = await saveRecord(ctx.run, record).catch(() => false)
    const tail = saved ? `\n\n子智能体 ID：${id}` : '\n\n（本环境没有会话存储，这次子智能体无法续聊；需要继续请重新派发。）'
    return `${note}结论（子智能体 ${label}）：\n\n${conclusion}${tail}`
  }

  if (name === 'send_to_subagent') {
    const to = String(args.to ?? '').trim()
    const message = String(args.message ?? '').trim()
    if (!to || !message) throw new SubagentError('send_to_subagent 需要 to（子智能体 ID）与 message')
    const records = await loadRecords(ctx.run)
    const record = records[to]
    if (!record) {
      throw new SubagentError(`子智能体 ${to} 已不可用（记录已被清理或 ID 有误），请用 run_subagent 重新派发`)
    }
    const fork = isForkAgent(record.agent)
    const def = fork ? null : getSubagentByName(record.agent) ?? GENERAL_SUBAGENT
    closePendingTools(record.messages)
    record.messages.push({ role: 'user', text: message })
    record.updatedAt = Date.now()
    if (args.description) record.description = String(args.description).trim()
    await saveRecord(ctx.run, record)
    let conclusion
    try {
      conclusion = await runRecord(record, ctx, { def, fork })
    } catch (error) {
      closePendingTools(record.messages)
      record.updatedAt = Date.now()
      await saveRecord(ctx.run, record)
      throw new SubagentError(`子智能体「${record.agent}」运行失败：${error?.message || error}（ID：${record.id}，可用 send_to_subagent 继续）`)
    }
    await saveRecord(ctx.run, record).catch(() => {})
    return `结论（子智能体 ${record.agent}，${record.id}）：\n\n${conclusion}`
  }

  throw new SubagentError(`未知子智能体工具：${name}`)
}
