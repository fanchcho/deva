import { getConfig } from './config'
import { decide } from './decision'
import { DEFAULT_DECISION_THRESHOLD, type TaskDecisionResult } from '../../shared/task-decision'
import type { TaskRecord } from './tasks-types'

/** 只读取已保存配置；默认关闭时不访问模型、不改变原来的执行行为。 */
export async function evaluateTaskDecision(task: TaskRecord): Promise<TaskDecisionResult | undefined> {
  const gate = task.decision
  if (!gate?.enabled) return undefined
  try {
    const models = getConfig().models as { providers?: Array<{
      id: string; purpose?: string; enabled?: boolean; adapter?: string; apiHost?: string; threshold?: number
    }> } | undefined
    const provider = models?.providers?.find((p) => p.id === gate.providerId)
    if (!provider || !provider.enabled || provider.purpose !== 'decision' || provider.adapter !== 'jev')
      throw new Error('决策供应商不存在、未启用或协议不受支持')
    const threshold = gate.threshold ?? provider.threshold ?? DEFAULT_DECISION_THRESHOLD
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      throw new Error('决策阈值必须在 0 到 1 之间')
    const result = await decide({
      adapter: 'jev', providerId: provider.id, baseURL: provider.apiHost ?? '', threshold
    }, {
      context: task.prompt,
      signals: { taskId: task.id, title: task.title, scheduledAt: task.nextRunAt,
        lastRunAt: task.lastRunAt, now: Date.now() }
    }, [{ id: 'execute', prompt: '根据任务指令与当前状态，现在是否应该执行这项任务？' }])
    if (!result.ok) return {
      status: result.timedOut ? 'timeout' : 'error', providerId: provider.id, threshold,
      message: result.message ?? '决策请求失败'
    }
    const outcome = result.outcomes.find((o) => o.id === 'execute')
    if (!outcome) throw new Error('决策响应缺少 execute 结果')
    return { status: outcome.decide ? 'allowed' : 'denied', providerId: provider.id,
      threshold, confidence: outcome.confidence, message: outcome.reason }
  } catch (e) {
    return { status: 'error', providerId: gate.providerId, message: (e as Error).message ?? String(e) }
  }
}
