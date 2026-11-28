import { registerRpc } from './rpc-admission.mjs'
import { listDevamcpServers, getDevamcpServer, createDevamcpServer, updateDevamcpServer, deleteDevamcpServer, setDevamcpServerEnabled } from './mcp-store.mjs'
import { maskMcpConfig } from './mcp-secrets.mjs'

export function desktopMcpPage(input, run, owner) {
  if (!Number.isSafeInteger(owner) || owner !== run.identity?.userId) throw new Error('DEVA_MCP_OWNER_REQUIRED')
  run.signal?.throwIfAborted()
  const config = run.config || {}
  if (input.action === 'create') createDevamcpServer(config, input)
  if (input.action === 'update') updateDevamcpServer(config, input)
  if (input.action === 'delete') deleteDevamcpServer(config, input)
  if (input.action === 'toggle') setDevamcpServerEnabled(config, input)
  if (input.action === 'get') return { servers: [], config: maskMcpConfig(getDevamcpServer(config, input.name).config) }
  return { servers: listDevamcpServers(config).map(server => ({ ...server, source: 'desktop' })) }
}
export function registerDesktopMcp(ctx, contract) {
  registerRpc(ctx, contract, 'desktop-mcp-page', (input, run) => desktopMcpPage(input, run, run.config?.sharedDevaUserId ?? ctx.identity?.userId))
}
