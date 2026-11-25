/** Opt-in only. The model/input.options cannot disable an administrator's configured policy. */
const risky = new Set(['run_command', 'write_file', 'edit_file', 'memory_write', 'memory_delete', 'skill_manage', 'browser'])
export async function approveTool(run, call) {
  if (run.config?.approvalEnabled !== true) return
  const extra = new Set(run.config.approvalTools || [])
  if (!risky.has(call.name) && !call.name.startsWith('mcp__') && !extra.has(call.name)) return
  if (run.signal?.aborted) throw new Error('本轮已被取消')
  if (!run.interactions?.approve) throw new Error('审批策略已启用，但宿主不支持 interactions.approve；未执行')
  let args = {}
  try { args = JSON.parse(call.arguments || '{}') } catch { /* The loop validates before approval. */ }
  const preview = { tool: call.name }
  for (const field of ['path', 'cwd', 'command', 'url', 'action']) if (typeof args[field] === 'string') preview[field] = args[field].slice(0, 2000)
  const result = await run.interactions.approve({ operationId: call.id, title: `Deva: ${call.name}`, details: '允许执行这次高风险工具调用？参数可能涉及命令、文件写入或远程服务；拒绝不会执行。', input: preview })
  if (run.signal?.aborted) throw new Error('本轮已被取消')
  if (result?.outcome !== 'approved') throw new Error(`审批未通过：${['denied', 'cancelled', 'timeout'].includes(result?.outcome) ? result.outcome : 'invalid'}；未执行`)
}
