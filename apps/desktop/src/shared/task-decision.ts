export const DEFAULT_DECISION_THRESHOLD = 0.6

/** 缺省或 enabled=false 时完全沿用原执行路径。 */
export interface TaskDecision {
  enabled: boolean
  providerId: string
  /** 覆盖供应商默认阈值；confidence >= threshold 才执行。 */
  threshold?: number
}

export interface TaskDecisionResult {
  status: 'allowed' | 'denied' | 'timeout' | 'error'
  providerId: string
  threshold?: number
  confidence?: number
  message?: string
}
