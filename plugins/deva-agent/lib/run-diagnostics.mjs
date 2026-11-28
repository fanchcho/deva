/** Terminal diagnostics are independent of client output and contain no message bodies. */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { validateStoredModel } from './storage-contracts.mjs'
const active = new Set()
const handlers = new Map()
const LIMIT = 20
const now = () => new Date().toISOString()
export function redact(value) {
  return String(value ?? '').replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [REDACTED]')
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|credential|cookie)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}\n]+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[\w-]+/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\/(home|Users)\/[^/\s:]+/g, '/$1/[USER]')
    .replace(/([A-Z]:[\\/]Users[\\/])[^\\/\s:]+/gi, '$1[USER]')
    .slice(0, 1800)
}
export function errorRecord(error, depth = 0) {
  if (error == null) return {}
  return { name: redact(error.name || 'Error'), message: redact(error.message ?? error),
    stack: redact(String(error.stack || '').split('\n').slice(0, 7).join('\n')),
    cause: depth < 2 && error.cause != null ? errorRecord(error.cause, depth + 1) : {} }
}
export function abortState(reason, deadlineAt) {
  const code = reason?.code
  if (reason?.name === 'TimeoutError' || code === 'DEADLINE_EXCEEDED' || (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt)) return 'timeout'
  if (['USER_STOP', 'USER_ABORT'].includes(code)) return 'user_abort'
  if (code === 'HOST_SHUTDOWN') return 'host_shutdown'
  if (code === 'PLUGIN_DISPOSE') return 'plugin_dispose'
  return 'abort_unknown'
}
function observeProcess() {
  if (handlers.size) return
  // Never suppress Node's default signal termination by installing its first handler.
  const signals = /** @type {const} */ (['SIGTERM', 'SIGINT'])
  for (const signal of signals) {
    if (!process.listenerCount(signal)) continue
    const fn = () => { for (const entry of active) entry.finish('host_shutdown', signal, new Error(signal)) }
    process.prependListener(signal, fn); handlers.set(signal, fn)
  }
  const fn = error => { for (const entry of active) entry.finish('uncaught_exception', 'uncaughtExceptionMonitor', error) }
  process.on('uncaughtExceptionMonitor', fn); handlers.set('uncaughtExceptionMonitor', fn)
}
function unobserveProcess() {
  if (active.size) return
  for (const [event, fn] of handlers) process.removeListener(event, fn)
  handlers.clear()
}
export const diagnosticsStore = run => run.state?.session?.namespace?.('run-diagnostics')
export async function readRunDiagnostics(run) {
  if (!run.identity?.sessionId) return { records: [] }
  const records = await diagnosticsStore(run)?.get('records') || []
  for (const record of records) validateStoredModel('runTerminal', record)
  return { records }
}
export function createRunDiagnostics(session, checkpoint) {
  let current
  return {
    dispose() { current?.finish('plugin_dispose', 'session.dispose', new Error('PLUGIN_DISPOSE')) },
    async execute(run, action) {
      run = { ...run, identity: { profile: 'unknown', sessionId: 'unknown', ...session.identity, ...run.identity, runId: run.identity?.runId || randomUUID() } }
      const store = diagnosticsStore(run)
      let records = (await store?.get('records')) || []
      const file = session.paths?.runtimeDir && join(session.paths.runtimeDir, 'run-terminals.json')
      if (file) {
        try { const saved = JSON.parse(readFileSync(file, 'utf8')); if (saved.owner === JSON.stringify(session.identity)) records = saved.records } catch (e) { if (e.code !== 'ENOENT') run.log?.warn?.('deva.run_terminal recovery_failed') }
      }
      records = records.slice(-LIMIT)
      let phase = 'run.start', finished = false, pending = Promise.resolve()
      const base = { run_id: run.identity.runId, session_id: run.identity.sessionId, plugin_id: 'deva', profile: run.identity.profile, started_at: now() }
      const entry = { finish(state, origin, error) {
        if (finished) return
        finished = true
        const record = { ...base, finished_at: now(), terminal_state: state, phase, trigger: { entry: origin, at: now() }, error: errorRecord(error) }
        // Replace known proxy secrets even if the upstream echoes an unlabeled value.
        if (run.model?.token) {
          const clean = JSON.stringify(record.error).split(run.model.token).join('[REDACTED]')
          record.error = JSON.parse(clean)
        }
        validateStoredModel('runTerminal', record)
        records = [...records.filter(x => x.run_id !== record.run_id), record].slice(-LIMIT)
        while (Buffer.byteLength(JSON.stringify(records)) > 128 * 1024) records.shift()
        // Synchronous bounded fallback: no async work is awaited by signal handlers.
        try {
          if (file) { mkdirSync(session.paths.runtimeDir, { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify({ owner: JSON.stringify(session.identity), records }), { mode: 0o600 }); renameSync(file + '.tmp', file) }
        } catch { run.log?.error?.('deva.run_terminal sync_write_failed') }
        try { (state === 'completed' ? run.log?.info : run.log?.error)?.call(run.log, 'deva.run_terminal ' + JSON.stringify(record)) } catch { /* A failed logger must not replace the original error. */ }
        pending = Promise.all([store?.set('records', records), checkpoint.recordTerminals(run, records)]).then(() => {}).catch(() => { run.log?.error?.('deva.run_terminal async_write_failed') })
      } }
      current = entry; active.add(entry); observeProcess()
      const abort = () => entry.finish(abortState(run.signal.reason, run.deadlineAt), 'run.signal', run.signal.reason)
      run.signal?.addEventListener('abort', abort, { once: true })
      try {
        if (run.signal?.aborted) { abort(); run.signal.throwIfAborted() }
        const output = { ...run.output, emit: async event => { phase = redact(event.type + (event.name ? ':' + event.name : '')); return run.output.emit(event) } }
        const result = await action({ ...run, output })
        entry.finish(result.finishReason === 'tool_limit' ? 'tool_limit' : 'completed', 'run.return', null)
        return result
      } catch (error) {
        entry.finish(run.signal?.aborted ? abortState(run.signal.reason, run.deadlineAt) : error?.name === 'TimeoutError' ? 'timeout' : 'plugin_exception', 'run.catch', error)
        throw error
      } finally {
        run.signal?.removeEventListener('abort', abort); active.delete(entry); unobserveProcess(); current = null
        await pending
      }
    },
  }
}
