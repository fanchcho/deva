/**
 * Agent 定义：把 Deva 项目 Agent 注册进 Studio（plugin:deva/deva）。
 *
 * 只有 scoped 模式：模型由 Studio 本轮注入（baseUrl + token），插件既不存密钥，
 * 也不自己维护模型目录。身份可选：每轮按 user+profile 作用域里保存的选择组装提示词，
 * 没选过就用默认身份（deva）。
 */
import { readFileSync } from 'node:fs'
import { IDENTITY_META, loadIdentity } from './identities.mjs'
import { resolveIdentityId } from './selection.mjs'
import { applyInputIdentity } from './commands.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { formatSkillListing } from './skills.mjs'
import { formatFacts, projectFacts } from './project.mjs'
import { runAgentTurn } from './loop.mjs'
import { executeTool } from './tools.mjs'
import { McpPool, parseServerConfig, mergeServers } from './mcp.mjs'
import { resolveStudioServers } from './studio-mcp.mjs'

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
}

const PROTOCOLS = ['chat_completions', 'anthropic_messages', 'codex_responses']

const INSTRUCTION = `Deva Agent 需要 Studio 注入的模型（scoped 模式）。在 Agent 管理里为它选择模型，或在会话里切换到一个已配置的模型后重试。`

/** 宿主注入的 run.mcpServers 条目 → 本插件客户端的配置形状（宿主条目可能省掉 type）。 */
function injectedServers(injected) {
  if (!injected || typeof injected !== 'object') return []
  const { servers } = parseServerConfig({ mcpServers: injected })
  return servers
}

/**
 * 连接本轮可用的 MCP（MCP 页勾选的 Studio 服务 + 宿主注入，同名的宿主优先），
 * 跑完一轮后断开。连接失败不中断对话：把失败原因写进系统提示词，让模型如实告诉用户缺什么。
 */
async function runWithMcp({ run, input, system, workspaceDir, facts, identity, log, runTurn }) {
  const problems = []
  // MCP 页勾选的 Studio 服务：配置每轮现取，用户在 Studio 或设置页改完后下一轮即生效
  const studio = await resolveStudioServers({ host: run.host, state: run.state, identity: run.identity, log })
  problems.push(...studio.problems)
  const servers = mergeServers(studio.servers, injectedServers(run.mcpServers))
  // 记忆的角色层按本轮身份分区：把 id/名称一路带给工具层（runTurn 的默认实现就是 runAgentTurn）。
  const identityScope = { identityId: identity?.id ?? null, identityName: identity?.name ?? null }
  if (!servers.length && !problems.length) {
    return await runTurn({ run, input, system, workspaceDir, facts, identity, ...identityScope })
  }
  const pool = new McpPool({ log })
  try {
    await pool.connectAll(servers, run.signal)
    const notes = [...problems, ...pool.problems]
    const mergedSystem = notes.length
      ? `${system}\n\n## MCP 连接状态\n\n以下 MCP 服务本轮不可用，涉及它们的任务要如实告知用户，不要凭空编造结果：\n${notes.map(note => `- ${note}`).join('\n')}`
      : system
    if (pool.definitions().length) {
      log.info?.(`deva: 本轮 MCP 工具 ${pool.definitions().length} 个（${servers.map(server => server.name).join('/')}）`)
    }
    const execute = async (name, args, ctx) => {
      if (name.startsWith('mcp__')) return pool.call(name, args, { signal: run.signal, runtimeDir: run.paths?.runtimeDir })
      return executeTool(name, args, ctx)
    }
    return await runTurn({
      run, input, system: mergedSystem, workspaceDir, facts, identity,
      ...identityScope, extraTools: pool.definitions(), execute, runTurn,
    })
  } finally {
    pool.close()
  }
}

/**
 * `identityId` 为 null 时是「跟随设置」的通用 Agent（可在会话内切身份）——server.mjs 只注册这一个。
 * 传具体 `identityId` 可造一个固定身份的 Agent（保留给测试/特殊用途，正常安装不使用）。
 * 插件没有全局配置：MCP 服务只有 Studio 一份，身份与勾选存在宿主提供的 user+profile 存储里。
 */
/** @param {{ log?: { info: Function, warn: Function }, runTurn?: Function, identityId?: string|null }} options */
export function createAgentDefinition({ log = console, runTurn = runAgentTurn, identityId = null } = {}) {
  const version = packageVersion()
  const fixed = identityId ? IDENTITY_META[identityId] : null
  return {
    id: fixed ? fixed.id : 'deva',
    name: fixed ? fixed.name : 'Deva',
    vendor: 'Deva',
    description: fixed
      ? `Deva 项目 Agent（固定身份：${fixed.name}）：读写本仓库代码、跑 pnpm 检查与构建，用 Studio 现存模型直接对话。`
      : 'Deva 项目 Agent：读写本仓库代码、跑 pnpm 检查与构建；身份可选（Deva / 小码酱），用 Studio 现存模型直接对话。',
    agentApiVersion: 1,
    getStatus: async () => ({ installed: true, version, source: 'plugin' }),
    management: {
      // Agent 管理的「设置」默认打开身份页；MCP 是同组的第二个 agent-settings 页面。
      settings: () => ({ viewId: 'identity' }),
    },
    modes: { scoped: { protocols: PROTOCOLS } },
    features: { surfaces: ['chat', 'group-chat', 'workflow', 'api'], streaming: true, resume: false },
    runtime: {
      async createSession(session) {
        let disposed = false
        log.info?.(`deva: 创建会话 ${session.identity.sessionId}（${session.paths.workspaceDir}）`)
        return {
          async run(input, run) {
            if (disposed) throw new Error('本会话已释放')
            if (run.mode !== 'scoped' || !run.model?.baseUrl || !run.model?.token) throw new Error(INSTRUCTION)
            const workspaceDir = run.paths.workspaceDir
            // 会话窗口里的 `@deva:<id>` 前缀：先切身份，再把前缀从消息里剥掉
            const consumed = await applyInputIdentity(input, run.state, run.identity,
              fixed ? { allowSwitch: false, own: fixed.id } : {})
            if (consumed.switched) log.info?.(`deva: 会话内前缀切换身份=${consumed.switched}`)
            if (consumed.reply) {
              log.info?.('deva: 会话内命中身份命令，本地回话（不调用模型）')
              return { content: [{ type: 'text', text: consumed.reply }], finishReason: 'stop' }
            }
            // 固定身份的 Agent 不读存储，避免「小码酱 Agent」被设置页改成别的身份
            const resolved = fixed ? { id: fixed.id, source: 'agent' } : await resolveIdentityId(run.state, run.identity)
            const identity = await loadIdentity(resolved.id)
            log.info?.(`deva: 本轮身份=${identity.id}（${identity.name}，来源 ${resolved.source}）`)
            const facts = await projectFacts(workspaceDir)
            const instructions = (input.instructions || []).map(item => item.text).filter(Boolean).join('\n\n')
            const system = buildSystemPrompt({
              identity,
              factsText: formatFacts(facts),
              hostInstructions: instructions,
              skillsText: await formatSkillListing({ host: run.host, log }),
            })
            return await runWithMcp({ run, input: consumed.input, system, workspaceDir, facts, identity, log, runTurn })
          },
          async dispose() {
            disposed = true
          },
        }
      },
    },
  }
}
