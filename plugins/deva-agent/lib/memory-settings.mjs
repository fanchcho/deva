import { registerRpc } from './rpc-admission.mjs'
import { resolveIdentityId } from './selection.mjs'
import { listMemories, writeMemory, deleteMemory, scopeOfId } from './memory.mjs'

export async function memoryPage(input, ctx) {
  if (input.action !== 'list' && !input.scope) throw new Error('MEMORY_SCOPE_REQUIRED')
  if (input.id && scopeOfId(input.id) !== input.scope) throw new Error('MEMORY_SCOPE_MISMATCH')
  if (input.scope === 'role' && !ctx.identityId) throw new Error('MEMORY_PERSONA_REQUIRED')
  if (input.scope === 'project' && !ctx.workspaceDir) throw new Error('MEMORY_WORKSPACE_REQUIRED')
  if (input.action === 'save') await writeMemory(input, ctx, input.id)
  if (input.action === 'delete') {
    if (!input.id) throw new Error('MEMORY_ID_REQUIRED')
    await deleteMemory(input.id, ctx)
  }
  const scopes = [{ scope: 'global', label: '全局' }]
  if (ctx.identityId) scopes.push({ scope: 'role', label: `角色:${ctx.identityId}` })
  if (ctx.workspaceDir) scopes.push({ scope: 'project', label: `项目:${ctx.workspaceDir}` })
  const entries = input.scope ? await listMemories(input.scope, ctx) : (await Promise.all(scopes.map(async layer => {
    const entries = await listMemories(layer.scope, ctx)
    return entries.map(entry => ({ ...entry, scope: layer.scope, scopeLabel: layer.label }))
  }))).flat()
  return { entries, scopes, legacyNotice: '旧 Studio 记忆仍原样保留在账号存储，未自动合并；当前页面与工具仅使用桌面记忆文件。回滚插件即可重新访问旧数据。' }
}
export function registerMemorySettings(ctx, contract) {
  registerRpc(ctx, contract, 'memory-page', async (input, run) => {
    const owner = run.config?.sharedDevaUserId ?? ctx.identity?.userId
    if (!Number.isSafeInteger(owner) || owner !== run.identity?.userId) throw new Error('MEMORY_OWNER_REQUIRED')
    const selected = await resolveIdentityId(run.state, run.identity, run.config)
    run.signal?.throwIfAborted()
    return memoryPage(input, { state: run.state, config: run.config, identityId: selected.id, workspaceDir: run.paths?.workspaceDir })
  })
}
