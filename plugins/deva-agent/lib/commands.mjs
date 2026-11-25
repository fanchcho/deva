/**
 * 会话窗口里切身份的两条入口：
 *  · 斜杠命令 `/deva:identity [id|default]` —— Studio 原生命令面板，输入框直接打；
 *  · 消息前缀 `@deva:<id> ...` —— input.transform 拦截并把前缀从消息里剥掉。
 *
 * 两者都只写**会话级**覆盖（不碰 `~/.deva` 身份文件里的默认值），所以同一账号不同会话可以各用各的身份。
 * 身份目录（可选 id/name/description/persona）全部来自 `~/.deva/deva-agent/identity.json`。
 */
import {
  readSessionIdentityId, resolveIdentityId, writeSessionIdentityId,
} from './selection.mjs'
import { canonicalIdentityId, listIdentityCatalog } from './deva-home.mjs'

const RESET_WORDS = new Set(['default', 'off', 'reset', 'clear', '默认'])

const sourceLabel = source => source === 'session' ? '本会话' : source === 'studio-agent' ? 'Studio Agent' : '默认（~/.deva）'

async function catalog(config) {
  return await listIdentityCatalog(config)
}

/** 当前身份状态：本轮生效身份、来源（session/file）与可选目录。 */
async function describe(state, identity, config) {
  const resolved = await resolveIdentityId(state, identity, config)
  const view = await catalog(config)
  return { current: resolved.id, source: resolved.source, identities: view.identities }
}

export const identityCommand = {
  name: 'identity',
  description: '查看或切换本会话的身份：/deva:identity 查看，/deva:identity <身份id> 切换，/deva:identity default 回到默认。',
  /** args 是原始参数字符串；返回值即命令结果（JSON）。 */
  async execute(args, run) {
    const config = run.config
    const text = String(args ?? '').trim()
    if (!text || text.toLowerCase() === 'list' || text === '查看') {
      return await describe(run.state, run.identity, config)
    }
    if (RESET_WORDS.has(text.toLowerCase())) {
      await writeSessionIdentityId(run.state, null, null, { config, sessionId: run.identity?.sessionId })
      const next = await describe(run.state, run.identity, config)
      run.messages?.notify?.(`已清除本会话身份，回到默认：${next.current}`, 'success')
      return next
    }
    const rawId = text.split(/\s+/)[0].toLowerCase()
    const id = canonicalIdentityId(rawId)
    const view = await catalog(config)
    if (!view.identities.some(item => item.id === id)) {
      throw new Error(`未知身份：${rawId}（可选：${view.identities.map(item => item.id).join(' / ')}；身份目录 ${view.personasDir}）`)
    }
    await writeSessionIdentityId(run.state, id, view.identities.map(item => item.id), { config, sessionId: run.identity?.sessionId })
    const next = await describe(run.state, run.identity, config)
    const name = next.identities.find(item => item.id === id)?.name || id
    run.messages?.notify?.(`本会话身份已切换为：${name}`, 'success')
    return next
  },
}

const PREFIX = /^@deva:([a-z][a-z0-9_-]{0,63})(?:[\s，,]+|$)/i
const COMMAND_TEXT = /^(?:\/)?deva:identity(?:\s+(.*))?$/i

function describeText(resolved, identities) {
  const name = identities.find(item => item.id === resolved.id)?.name || resolved.id
  return `本会话身份：${name}（id: ${resolved.id}，来源 ${sourceLabel(resolved.source)}）。可选 ${identities.map(item => item.id).join(' / ')}；/deva:identity default 回到默认。`
}

/**
 * 会话内前缀：`@deva:xiaomajiang 帮我看看这段代码` → 切本会话身份，并把前缀从这条消息里去掉。
 *
 * 为什么不挂 input.transform 钩子：宿主只在 runtime === 'ekko-agent' 时给插件下发 hook 能力，
 * 插件 Agent（plugin:deva/deva）拿不到，钩子注册了也不会被调用（已实测）。所以在 Agent 自己
 * 的 run() 里消费前缀——同一份逻辑、可测试、不依赖宿主运行时的差异。
 */
export async function applyInputIdentity(input, state, identity, { allowSwitch = true, own = null, config } = {}) {
  const content = Array.isArray(input?.input) ? input.input : []
  const index = content.findIndex(block => block?.type === 'text' && typeof block.text === 'string')
  if (index < 0) return { input, switched: null }
  const raw = content[index].text.trim()
  const view = await listIdentityCatalog(config)

  // 输入框里打整条命令：直接切换并本地回话，不惊动模型
  const command = raw.match(COMMAND_TEXT)
  if (command && !allowSwitch) {
    const resolved = { id: own, source: 'agent' }
    return { input, switched: null, reply: describeText(resolved, view.identities) }
  }
  if (command) {
    const arg = String(command[1] ?? '').trim().split(/\s+/)[0]?.toLowerCase() || ''
    if (arg && !RESET_WORDS.has(arg)) {
      const target = canonicalIdentityId(arg)
      if (!view.identities.some(item => item.id === target)) {
        throw new Error(`未知身份：${arg}（可选：${view.identities.map(item => item.id).join(' / ')}；身份目录 ${view.personasDir}）`)
      }
      await writeSessionIdentityId(state, target, view.identities.map(item => item.id), { config, sessionId: identity?.sessionId })
    } else if (RESET_WORDS.has(arg)) {
      await writeSessionIdentityId(state, null, null, { config, sessionId: identity?.sessionId })
    }
    const resolved = await resolveIdentityId(state, identity, config)
    return { input, switched: null, reply: describeText(resolved, view.identities) }
  }

  const match = content[index].text.match(PREFIX)
  if (!match) return { input, switched: null }
  const rawId = match[1].toLowerCase()
  const id = canonicalIdentityId(rawId)
  if (!view.identities.some(item => item.id === id)) return { input, switched: null }
  if (!allowSwitch) {
    if (canonicalIdentityId(own) !== id) return { input, switched: null }
    const strippedOwn = content[index].text.slice(match[0].length).trim() || '继续'
    const nextOwn = content.map((block, i) => (i === index ? { ...block, text: strippedOwn } : block))
    return { input: { ...input, input: nextOwn }, switched: null }
  }
  await writeSessionIdentityId(state, id, view.identities.map(item => item.id), { config, sessionId: identity?.sessionId })
  const stripped = content[index].text.slice(match[0].length).trim() || '继续'
  const next = content.map((block, i) => (i === index ? { ...block, text: stripped } : block))
  return { input: { ...input, input: next }, switched: id }
}

export { readSessionIdentityId }
