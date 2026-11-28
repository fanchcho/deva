import { mergedMcpHost } from './lib/mcp-merged.mjs'
import { registerMemorySettings } from './lib/memory-settings.mjs'
import { registerSkillSettings } from './lib/skill-settings.mjs'
import { discoverModels } from './lib/model-discovery.mjs'
import { registerCompression } from './lib/compression.mjs'
/**
 * 插件入口：一个 Deva Agent、身份/模型/MCP RPC 和一条会话身份命令。
 */
import { maskMcpConfig, mergeMcpSecrets } from './lib/mcp-secrets.mjs'
import { readFileSync } from 'node:fs'
import { assertContracts } from './sdk/harness/contracts.mjs'
import { registerRpc } from './lib/rpc-admission.mjs'
import { createAgentDefinition } from './lib/agent.mjs'
import { listIdentities } from './lib/identities.mjs'
import { readModelSelection, saveModelSelection, savePersonaModel } from './lib/model-selection.mjs'
import { readIdentitySnapshot, readSessionIdentityId, writeIdentityId, writeSessionIdentityId } from './lib/selection.mjs'
import { identityFilePath } from './lib/deva-home.mjs'
import { addStudioPersona, readStudioPersona, updateStudioPersona } from './lib/persona-store.mjs'
import {
  createStudioServer, deleteStudioServer, getStudioServer, publicServer, readStudioMcpPage,
  saveStudioSelection, setStudioServerEnabled, testStudioServer, updateStudioServer,
} from './lib/studio-mcp.mjs'
import { identityCommand } from './lib/commands.mjs'

const contract = assertContracts(JSON.parse(readFileSync(new URL('./contracts/plugin.json', import.meta.url), 'utf8')))

/** 写入类 RPC 的统一返回：Studio 已确认，附带规范化后的展示字段（不含配置）。 */
const saved = server => ({ ok: true, server: publicServer(server) })

function canEditPersonas(run, activationUserId) {
  const owner = run.config?.sharedDevaUserId ?? activationUserId
  return Number.isSafeInteger(owner) && owner > 0 && run.identity?.userId === owner
}

function personaOperation(activationUserId, action) {
  return (input, run) => {
    if (!canEditPersonas(run, activationUserId)) throw new Error('Only the configured Deva owner can read or edit shared identity prompts.')
    run.signal?.throwIfAborted()
    return action(run.config, input)
  }
}

/** @param {import('./sdk/src/index.ts').PluginContext} ctx */
export function apply(ctx) {
  const activationUserId = ctx.identity?.userId
  ctx.log.info(`deva: 激活通道 ctx.host.request=${typeof ctx.host?.request === 'function'}`)
  registerMemorySettings(ctx, contract)
  registerCompression(ctx)
  registerSkillSettings(ctx, contract)
  registerRpc(ctx, contract, 'list-provider-models', (input, run) => discoverModels(run, input))
  registerRpc(ctx, contract, 'get-model-selection', (_input, run) => readModelSelection({ ...run, desktopActivationUserId: activationUserId }))
  registerRpc(ctx, contract, 'save-model-selection', (input, run) => saveModelSelection({ ...run, desktopActivationUserId: activationUserId }, input))
  registerRpc(ctx, contract, 'save-persona-model', (input, run) => savePersonaModel({ ...run, desktopActivationUserId: activationUserId }, input))
  // ~/.deva/personas 只存内容；默认与会话选择保留在 config.json。
  registerRpc(ctx, contract, 'get-identities', async (_input, run) => {
    const snapshot = await readIdentitySnapshot(run.state, run.identity, run.config, { includeEmpty: true })
    return {
      identities: snapshot.identities,
      selected: snapshot.selected,
      filePath: snapshot.path,
      personasDir: snapshot.personasDir,
      created: snapshot.created,
      migrated: snapshot.migrated,
      permissionRepaired: snapshot.repaired,
      canEdit: canEditPersonas(run, activationUserId),
    }
  })
  registerRpc(ctx, contract, 'save-selection', async (input, run) => {
    const selected = await writeIdentityId(run.state, run.identity, input.identity, run.config)
    return { ok: true, selected, filePath: identityFilePath(run.config) }
  })
  registerRpc(ctx, contract, 'get-persona-editor', personaOperation(activationUserId, (config, input) => readStudioPersona(config, input.id)))
  registerRpc(ctx, contract, 'create-persona', personaOperation(activationUserId, addStudioPersona))
  registerRpc(ctx, contract, 'update-persona', personaOperation(activationUserId, updateStudioPersona))
  // 会话内身份：读写当前会话的覆盖（宿主会话存储 + ~/.deva/config.json → personas.sessionSelected）。
  registerRpc(ctx, contract, 'get-session-identity', async (_input, run) => {
    const sessionId = run.identity?.sessionId || ''
    if (!sessionId) return { sessionId: '', identity: '', source: 'none' }
    const [snapshot, override] = await Promise.all([
      readIdentitySnapshot(run.state, run.identity, run.config),
      readSessionIdentityId(run.state, run.identity, run.config),
    ])
    const resolved = override
      ? { id: override, source: 'session' }
      : { id: snapshot.selected, source: 'default' }
    return { sessionId, identity: resolved.id, source: resolved.source }
  })
  registerRpc(ctx, contract, 'save-session-identity', async (input, run) => {
    const sessionId = run.identity?.sessionId
    if (!sessionId) throw new Error('当前调用没有会话上下文，无法设置会话身份')
    const snapshot = await readIdentitySnapshot(run.state, run.identity, run.config)
    const identity = await writeSessionIdentityId(run.state, input.identity, snapshot.identities.map(item => item.id), { config: run.config, sessionId })
    return { ok: true, sessionId, identity }
  })
  registerRpc(ctx, contract, 'clear-session-identity', async (_input, run) => {
    const sessionId = run.identity?.sessionId
    if (!sessionId) throw new Error('当前调用没有会话上下文，无法清除会话身份')
    await writeSessionIdentityId(run.state, null, null, { config: run.config, sessionId })
    const snapshot = await readIdentitySnapshot(run.state, run.identity, run.config)
    return { ok: true, sessionId, identity: snapshot.selected }
  })
  // Settings and runtime share one lossless merged catalog, scoped to the caller.
  registerRpc(ctx, contract, 'get-mcp-servers', (_input, run) => readStudioMcpPage({ ...run, host: mergedMcpHost(run, ctx.identity?.userId) }))
  registerRpc(ctx, contract, 'save-mcp-selection', (input, run) => saveStudioSelection({ ...run, host: mergedMcpHost(run, ctx.identity?.userId) }, input.servers))
  registerRpc(ctx, contract, 'get-mcp-server', async (input, run) => {
    const server = await getStudioServer(mergedMcpHost(run, ctx.identity?.userId), input.name)
    return { server: publicServer(server), config: maskMcpConfig(server.config) }
  })
  registerRpc(ctx, contract, 'create-mcp-server', async (input, run) =>
    saved(await createStudioServer(mergedMcpHost(run, ctx.identity?.userId), { ...input, config: mergeMcpSecrets(input.config, {}) })))
  registerRpc(ctx, contract, 'update-mcp-server', async (input, run) => {
    const previous = await getStudioServer(mergedMcpHost(run, ctx.identity?.userId), input.name)
    return saved(await updateStudioServer(mergedMcpHost(run, ctx.identity?.userId), {
      name: input.name,
      config: mergeMcpSecrets(input.config, previous.config),
    }))
  })
  registerRpc(ctx, contract, 'set-mcp-server-enabled', async (input, run) =>
    saved(await setStudioServerEnabled(mergedMcpHost(run, ctx.identity?.userId), input)))
  registerRpc(ctx, contract, 'delete-mcp-server', async (input, run) => ({
    ok: true, name: (await deleteStudioServer(mergedMcpHost(run, ctx.identity?.userId), input)).name,
  }))
  registerRpc(ctx, contract, 'test-mcp-server', async (input, run) => ({
    ok: true, tools: await testStudioServer(mergedMcpHost(run, ctx.identity?.userId), input),
  }))
  // 会话窗口里切身份：斜杠命令（命令面板可直接用；@deva:<id> 前缀由 Agent 自己消费）
  ctx.extensions.commands.register({
    name: identityCommand.name,
    description: identityCommand.description,
    execute: identityCommand.execute,
  })
  // 只注册一个通用 Agent（跟随设置/会话身份）：会话内用 /deva:identity 或 @deva:<id> 切身份，
  // 不再为每个身份各注册一个固定 Agent——插件对外只暴露一个 Deva Agent。
  const definition = createAgentDefinition({ log: ctx.log, plugin: ctx })
  const registration = ctx.extensions.agents.register(definition)
  ctx.log.info(`deva: Agent 已注册（${registration.id}），身份目录 ${listIdentities().map(item => item.id).join('/')}，支持 /deva:identity 与 @deva:<id> 切换`)
  const dispose = async () => {
    await registration.dispose()
  }
  ctx.lifecycle.add(dispose)
  return dispose
}
