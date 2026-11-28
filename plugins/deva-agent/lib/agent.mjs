import { createTtlCache } from './bounded-cache.mjs'
import { createCheckpointController } from './checkpoint.mjs'
/**
 * Agent 定义：把 Deva 项目 Agent 注册进 Studio（plugin:deva/deva）。
 *
 * scoped 模式默认使用本轮宿主代理，有自定义地址则直连对应 Chat Completions API；
 * global 模式（Agent 自带模型）只用模型页配置的直连地址与模型，没配置时明确报错。
 * 自定义密钥只在服务端保存、读取，不维护模型目录。身份可选：每轮按 user+profile 作用域里保存的选择组装提示词，
 * 没选过就用默认身份（deva）。
 */
import { readFileSync } from 'node:fs'
import { IDENTITY_META } from './identities.mjs'
import { resolveIdentityId } from './selection.mjs'
import { loadIdentityRecord } from './deva-home.mjs'
import { readCustomModel, resolveRunEffort } from './model-selection.mjs'
import { listAgentModels } from './agent-model-catalog.mjs'
import { createCustomModel } from './studio-model.mjs'
import { applyInputIdentity } from './commands.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { formatSkillListing, listSkills } from './skills.mjs'
import { formatFacts, projectFacts } from './project.mjs'
import { runAgentTurn } from './loop.mjs'
import { executeTool } from './tools.mjs'
import { McpPool, parseServerConfig } from './mcp.mjs'
import { listStudioServers, readStoredMcpSelection } from './studio-mcp.mjs'

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
}

const PROTOCOLS = ['chat_completions', 'anthropic_messages', 'codex_responses']

/** 工程事实与技能清单的会话级缓存时长：工具改动会立即失效，外部改动最多等这么久。 */
const FACTS_TTL = 30000
const SKILLS_TTL = 30000

/**
 * 极小的 TTL 缓存：按 key 缓存异步结果，同一 key 的并发读取只执行一次。
 * 失败不缓存（下次重试），invalidate 清空全部条目。
 */

const GLOBAL_NEEDS_MODEL = 'Deva 的「Agent 自带模型」模式需要直连配置：请在 Deva → 设置 → 模型 填写 Base URL 和模型名并保存，或在会话里改用 Studio 模型后重试。'
const INSTRUCTION = `Deva Agent 需要 Studio 注入的模型（scoped 模式）。在 Agent 管理里为它选择模型，或在会话里切换到一个已配置的模型后重试。`

/** 宿主注入的 run.mcpServers 条目 → 本插件客户端的配置形状（宿主条目可能省掉 type）。 */
function injectedServers(injected) {
  return parseServerConfig({ mcpServers: injected || {} })
}

/**
 * 每会话一份 MCP 连接缓存：配置不变就跨轮复用；配置变了由 pool.connectAll 收敛。
 * 连接生命周期绑在会话上（dispose 时断开），不绑单轮 signal——否则第一轮结束就会杀掉子进程。
 */
function createMcpCache(log) {
  const lifecycle = new AbortController()
  let pool = null
  const release = () => {
    if (!pool) return
    pool.close()
    pool = null
  }
  return {
    signal: lifecycle.signal,
    acquire: () => (pool ??= new McpPool({ log })),
    release,
    close() {
      release()
      if (!lifecycle.signal.aborted) lifecycle.abort()
    },
  }
}

/**
 * 统一的工具执行入口：MCP 工具走连接池，其余走本地工具集；成功后再通知缓存失效。
 * 失败（抛错）不通知——写文件/改技能失败时没有产生需要刷新的事实。
 */
function makeExecute({ run, getPool, onToolSuccess }) {
  return async (name, args, ctx) => {
    const pool = getPool()
    const result = pool && name.startsWith('mcp__')
      ? await pool.call(name, args, { signal: run.signal, runtimeDir: run.paths?.runtimeDir })
      : await executeTool(name, args, ctx)
    onToolSuccess?.(name)
    return result
  }
}

/**
 * 只连接宿主清单中的 Studio MCP（`/api/ekko/mcp/servers`），这是 Agent 侧唯一的 MCP 来源。
 * 桌面 `~/.deva/mcp.json` 只做设置页只读兼容展示，不进入运行时；因此不存在同名两份配置互相覆盖。
 * 用户保存过「本 Agent 使用」勾选时，按勾选过滤宿主清单；勾选只存服务名，不复制连接配置。
 * 连接跨轮复用；配置或凭证变了才重连。连接失败写进系统提示词，不中断对话。
 */
async function runWithMcp({ run, input, system, workspaceDir, facts, identity, log, runTurn, mcp, onToolSuccess, checkpoint, model }) {
  const problems = []
  let servers = []
  try {
    const catalog = await listStudioServers(run.host)
    const selected = await readStoredMcpSelection(run)
    const wanted = selected === null ? null : new Set(selected)
    const parsed = injectedServers(Object.fromEntries(catalog
      .filter(server => server.enabled && (wanted === null || wanted.has(server.name)))
      .map(server => [server.name, server.config])))
    servers = parsed.servers
    problems.push(...parsed.problems)
  } catch (error) {
    problems.push(`读取 Studio MCP 失败：${error.message}`)
  }
  // 记忆的角色层按本轮身份分区：把 id/名称一路带给工具层（runTurn 的默认实现就是 runAgentTurn）。
  const identityScope = { identityId: identity?.id ?? null, identityName: identity?.name ?? null }
  if (!servers.length && !problems.length) {
    // 用户已把服务全部取消勾选：断开上一轮留下的连接，本轮不背任何 MCP。
    mcp.release()
    const execute = makeExecute({ run, getPool: () => null, onToolSuccess })
    return await runTurn({ run, input, system, workspaceDir, facts, identity, ...identityScope, execute, runTurn, checkpoint, model })
  }
  const pool = mcp.acquire()
  // 握手与工具发现用会话级 signal；单次 tools/call 仍受本轮 run.signal 取消。
  await pool.connectAll(servers, mcp.signal)
  const notes = [...problems, ...pool.problems]
  const mergedSystem = notes.length
    ? `${system}\n\n## MCP 连接状态\n\n以下 MCP 服务本轮不可用，涉及它们的任务要如实告知用户，不要凭空编造结果：\n${notes.map(note => `- ${note}`).join('\n')}`
    : system
  if (pool.definitions().length) {
    log.info?.(`deva: 本轮 MCP 工具 ${pool.definitions().length} 个（${servers.map(server => server.name).join('/')}）`)
  }
  const execute = makeExecute({ run, getPool: () => pool, onToolSuccess })
  return await runTurn({
    run, input, system: mergedSystem, workspaceDir, facts, identity,
    ...identityScope, extraTools: pool.definitions(), execute, runTurn, checkpoint, model,
  })
}

/**
 * `identityId` 为 null 时是「跟随设置」的通用 Agent（可在会话内切身份）——server.mjs 只注册这一个。
 * 传具体 `identityId` 可造一个固定身份的 Agent（保留给测试/特殊用途，正常安装不使用）。
 * 插件全局配置仅包含附件/可选策略；MCP 服务只有 Studio 一份，身份与勾选由宿主分区保存。
 */
/**
 * `plugin` 是插件上下文：宿主调用模型目录时，它的 state/config 已绑定到当前调用者。
 * @param {{ log?: { info: Function, warn: Function }, runTurn?: Function, identityId?: string|null, plugin?: { state: object, config: object } }} options
 */
export function createAgentDefinition({ log = console, runTurn = runAgentTurn, identityId = null, plugin } = {}) {
  const version = packageVersion()
  const fixed = identityId ? IDENTITY_META[identityId] : null
  return {
    id: fixed ? fixed.id : 'deva',
    name: fixed ? fixed.name : 'Deva',
    vendor: 'Deva',
    description: fixed
      ? `Deva 项目 Agent（固定身份：${fixed.name}）：读写本仓库代码、跑 pnpm 检查与构建，用 Studio 现存模型直接对话。`
      : 'Deva 项目 Agent：读写本仓库代码、跑 pnpm 检查与构建；在 Deva 设置中选择、新增或编辑身份。',
    agentApiVersion: 1,
    getStatus: async () => ({ installed: true, version, source: 'plugin' }),
    management: {
      settings: () => ({ viewId: 'identity' }),
    },
    modes: {
      scoped: { protocols: PROTOCOLS },
      global: {
        async listModels(ctx) {
          if (!plugin) throw new Error('Deva 模型目录需要插件上下文')
          return listAgentModels({ identity: ctx.identity, signal: ctx.signal, state: plugin.state, config: plugin.config, desktopActivationUserId: plugin.identity?.userId })
        },
      },
    },
    features: { surfaces: ['chat', 'group-chat', 'workflow', 'api'], streaming: true, resume: true },
    runtime: {
      async createSession(session) {
        let disposed = false
        const checkpoint = createCheckpointController(session.identity, session.resumeState)
        const mcp = createMcpCache(log)
        // 工程事实与技能清单按会话缓存：每轮重读 package.json / 起两个 git、再请求一次技能接口没有必要。
        const factsCache = createTtlCache(workspaceDir => projectFacts(workspaceDir), FACTS_TTL)
        const skillsCache = createTtlCache(host => listSkills(host), SKILLS_TTL)
        const dispose = () => {
          if (disposed) return
          disposed = true
          mcp.close()
          factsCache.invalidate()
          skillsCache.invalidate()
        }
        session.lifecycle?.add(dispose)
        const onToolSuccess = name => {
          // 技能刚被改过、工作区刚被写过/跑过命令：下一轮立即重读，不等 TTL。
          if (name === 'skill_manage') skillsCache.invalidate()
          if (name === 'write_file' || name === 'edit_file' || name === 'run_command') factsCache.invalidate()
        }
        log.info?.(`deva: 创建会话 ${session.identity.sessionId}（${session.paths.workspaceDir}）`)
        return {
          async run(input, run) {
            if (disposed) throw new Error('本会话已释放')
            run = { ...run, desktopActivationUserId: plugin?.identity?.userId }
            if (run.mode !== 'global' && (!run.model?.baseUrl || !run.model?.token)) throw new Error(INSTRUCTION)
            const workspaceDir = run.paths.workspaceDir
            // Studio 原生页面也会修改技能；每轮重新读取，不能沿用上一轮的启停状态。
            skillsCache.invalidate()
            log.info?.(`deva: 运行通道 surface=${run.identity.surface || 'unknown'} host.request=${typeof run.host?.request === 'function'} injectedMcp=${Object.keys(run.mcpServers || {}).join('/') || 'none'}`)
            // 会话窗口里的 `@deva:<id>` 前缀：先切身份，再把前缀从消息里剥掉
            const consumed = await applyInputIdentity(input, run.state, run.identity,
              fixed ? { allowSwitch: false, own: fixed.id, config: run.config } : { config: run.config })
            if (consumed.switched) log.info?.(`deva: 会话内前缀切换身份=${consumed.switched}`)
            if (consumed.reply) {
              log.info?.('deva: 会话内命中身份命令，本地回话（不调用模型）')
              return { content: [{ type: 'text', text: consumed.reply }], finishReason: 'stop' }
            }
            // 固定身份的 Agent 不读身份存储，避免「小码酱 Agent」被设置页改成别的身份
            const resolved = fixed ? { id: fixed.id, source: 'agent' } : await resolveIdentityId(run.state, run.identity, run.config)
            // 身份正文只从 ~/.deva 的身份文件读；文件损坏时这里直接报错，不回退到宿主旧值或内置正文。
            const identity = await loadIdentityRecord(run.config, resolved.id)
            const custom = fixed ? null : await readCustomModel(run, resolved.id)
            // global 模式没有宿主代理可用：只能走模型页的直连配置，没有就停下说明，不回退。
            if (run.mode === 'global' && !custom) throw new Error(GLOBAL_NEEDS_MODEL)
            const model = custom
              ? createCustomModel(run, { ...custom, reasoningEffort: resolveRunEffort(run, custom.reasoningEffort) })
              : undefined
            log.info?.(`deva: 本轮身份=${identity.id}（${identity.name}，来源 ${resolved.source}，文件 ${identity.path}）`)
            const facts = await factsCache.get(workspaceDir)
            const instructions = (input.instructions || []).map(item => item.text).filter(Boolean).join('\n\n')
            const system = buildSystemPrompt({
              identity,
              factsText: formatFacts(facts),
              hostInstructions: instructions,
              skillsText: await formatSkillListing({ host: run.host, log, loadSkills: host => skillsCache.get('skills', host) }),
            })
            return await runWithMcp({
              run, input: consumed.input, system, workspaceDir, facts, identity, log, runTurn, mcp, onToolSuccess, checkpoint, model,
            })
          },
          checkpoint: () => checkpoint.snapshot(),
          dispose,
        }
      },
    },
  }
}
