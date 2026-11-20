/**
 * 插件入口：注册一个 Agent + 十枚 RPC（身份两枚、MCP 服务八枚）+ 一条身份命令。
 *
 * 无持久化的业务数据：身份与「这个 Agent 用哪些 MCP 服务」都写在 Studio 提供的
 * user+profile 作用域存储里（见 lib/selection.mjs、lib/studio-mcp.mjs）；
 * MCP 服务的连接配置本身只有一份，在 Studio 自己的 MCP 服务表里，插件不复制、不落盘。
 * 前端页面（client.mjs）只调用这些 RPC，不承接业务逻辑。
 */
import { readFileSync } from 'node:fs'
import { assertContracts, registerRpc } from './sdk/harness/contracts.mjs'
import { createAgentDefinition } from './lib/agent.mjs'
import { listIdentities } from './lib/identities.mjs'
import { readIdentityId, writeIdentityId } from './lib/selection.mjs'
import {
  createStudioServer,
  deleteStudioServer,
  getStudioServer,
  listStudioServers,
  publicServer,
  readSelection,
  setStudioServerEnabled,
  testStudioServer,
  updateStudioServer,
  writeSelection,
} from './lib/studio-mcp.mjs'
import { identityCommand } from './lib/commands.mjs'

const contract = assertContracts(JSON.parse(readFileSync(new URL('./contracts/plugin.json', import.meta.url), 'utf8')))

/** 写入类 RPC 的统一返回：Studio 已确认，附带规范化后的展示字段（不含配置）。 */
const saved = server => ({ ok: true, server: publicServer(server) })

/** @param {import('./sdk/src/index.ts').PluginContext} ctx */
export function apply(ctx) {
  registerRpc(ctx, contract, 'get-identities', async (_input, run) => ({
    identities: listIdentities(),
    selected: await readIdentityId(run.state, run.identity),
  }))
  registerRpc(ctx, contract, 'save-selection', async (input, run) => ({
    ok: true,
    selected: await writeIdentityId(run.state, run.identity, input.identity),
  }))
  registerRpc(ctx, contract, 'get-mcp-servers', async (_input, run) => ({
    servers: (await listStudioServers(run.host)).map(publicServer),
    selected: await readSelection(run.state, run.identity),
  }))
  registerRpc(ctx, contract, 'save-mcp-selection', async (input, run) => ({
    ok: true,
    selected: await writeSelection(run.state, run.identity, input.servers),
  }))
  // Studio 原生 MCP 管理（与 Studio 的「MCP」页同一套接口）：新增、改配置、启停、测试、删除
  registerRpc(ctx, contract, 'get-mcp-server', async (input, run) => {
    const server = await getStudioServer(run.host, input.name)
    return { server: publicServer(server), config: server.config || {} }
  })
  registerRpc(ctx, contract, 'create-mcp-server', async (input, run) =>
    saved(await createStudioServer(run.host, { name: input.name, config: input.config })))
  registerRpc(ctx, contract, 'update-mcp-server', async (input, run) =>
    saved(await updateStudioServer(run.host, { name: input.name, config: input.config })))
  registerRpc(ctx, contract, 'set-mcp-server-enabled', async (input, run) =>
    saved(await setStudioServerEnabled(run.host, { name: input.name, enabled: input.enabled })))
  registerRpc(ctx, contract, 'delete-mcp-server', async (input, run) => ({
    ok: true,
    name: (await deleteStudioServer(run.host, { name: input.name })).name,
  }))
  registerRpc(ctx, contract, 'test-mcp-server', async (input, run) => ({
    ok: true,
    tools: await testStudioServer(run.host, { name: input.name }),
  }))
  // 会话窗口里切身份：斜杠命令（命令面板可直接用；@deva:<id> 前缀由 Agent 自己消费）
  ctx.extensions.commands.register({
    name: identityCommand.name,
    description: identityCommand.description,
    execute: identityCommand.execute,
  })
  // 只注册一个通用 Agent（跟随设置/会话身份）：会话内用 /deva:identity 或 @deva:<id> 切身份，
  // 不再为每个身份各注册一个固定 Agent——插件对外只暴露一个 Deva Agent。
  const definition = createAgentDefinition({ log: ctx.log })
  const registration = ctx.extensions.agents.register(definition)
  ctx.log.info(`deva: Agent 已注册（${registration.id}），身份目录 ${listIdentities().map(item => item.id).join('/')}，支持 /deva:identity 与 @deva:<id> 切换`)
  const dispose = async () => {
    await registration.dispose()
  }
  ctx.lifecycle.add(dispose)
  return dispose
}
