import { appendFileSync, mkdirSync, statSync, renameSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const tracePath = fileURLToPath(new URL('../diagnostics/model-ui.jsonl', import.meta.url))
const directory = fileURLToPath(new URL('../diagnostics/', import.meta.url))
// Only bounded, allowlisted metadata. No RPC inputs, credentials, configuration or arbitrary error messages.
export function writeUiTrace(event) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const row = { time: new Date().toISOString(), version: '0.8.37' }
  for (const key of ['userId', 'profile', 'endpoint', 'clientVersion', 'clientSha256', 'side', 'phase', 'method', 'version', 'revision', 'route', 'readyState', 'errorType', 'http', 'elapsedMs', 'count', 'attempt', 'present', 'top', 'left', 'width', 'height', 'offsetHeight', 'clientHeight', 'viewportHeight', 'documentHeight', 'inViewport', 'scrollHeight', 'x', 'y', 'element', 'display', 'visibility', 'opacity', 'overflow', 'scope', 'tag', 'label', 'hitTag', 'hitLabel']) {
    const value = event[key]
    if (typeof value === 'number' && Number.isFinite(value)) row[key] = value
    else if (typeof value === 'string') row[key] = value.replace(/[^a-zA-Z0-9_./:# \u4e00-\u9fff-]/g, '').slice(0, 180)
  }
  try { if (statSync(tracePath).size > 262144) renameSync(tracePath, tracePath + '.1') } catch (error) { if (error.code !== 'ENOENT') throw error }
  appendFileSync(tracePath, JSON.stringify(row) + '\n', { mode: 0o600 })
  chmodSync(tracePath, 0o600)
  return { ok: true, logPath: tracePath }
}
function safeTrace(event) { try { writeUiTrace(event) } catch { /* Logging failure must not block model reads. */ } }
export function tracedModelRpc(method, handler) {
  return async (input, run) => {
    const started = Date.now()
    safeTrace({ side: 'server', method, phase: 'started', http: 'not-observed' })
    try {
      const result = await handler(input, run)
      safeTrace({ side: 'server', method, phase: result?.error ? 'returned-error' : 'resolved', http: 'host-owned', elapsedMs: Date.now() - started, count: result?.desktopModels?.length ?? result?.models?.length ?? 0 })
      return result
    } catch (error) {
      safeTrace({ side: 'server', method, phase: 'rejected', http: error?.status || 'host-owned', elapsedMs: Date.now() - started, errorType: error?.name || 'Error' })
      throw error
    }
  }
}
