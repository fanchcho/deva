import { csrfOk } from './auth.mjs'
import { json, readJsonBody } from './util.mjs'
import { auditArgs } from './audit-policy.mjs'

export async function handleInvoke(req, res, user, session, { pool, audit, jailCheck }) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (!csrfOk(session, req.headers['x-deva-csrf'])) {
    json(res, 403, { ok: false, error: 'csrf token invalid' })
    return
  }
  const started = Date.now()
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    json(res, 400, { ok: false, error: 'bad json' })
    return
  }
  const channel = String(body.channel ?? '')
  const args = Array.isArray(body.args) ? body.args : []
  if (!channel) {
    json(res, 400, { ok: false, error: 'channel required' })
    return
  }

  const readOnly = READ_ONLY_CHANNELS.has(channel)
  const healthy = typeof audit.probe === 'function' ? audit.probe(user.id) : true
  if (!healthy && !readOnly) {
    json(res, 503, { ok: false, error: 'AUDIT_UNAVAILABLE' })
    return
  }
  let value, failure
  const controller = new AbortController()
  const disconnected = () => controller.abort()
  res.once?.('close', disconnected)
  try {
    await jailCheck(user, channel, args)
    value = body.fireAndForget ? await pool.send(user, channel, args, { signal: controller.signal }) : await pool.invoke(user, channel, args, { signal: controller.signal })
  } catch (error) { failure = error }
  finally { res.off?.('close', disconnected) }
  let degraded = !healthy
  if (healthy) {
    try {
      audit.append(user.id, { channel, args: auditArgs(channel, args), ok: !failure,
        ...(failure ? { error: 'RPC_FAILED' } : {}), ms: Date.now() - started })
    } catch {
      degraded = true
      audit.health?.set(user.id, false)
      console.warn('[audit] AUDIT_UNAVAILABLE: result preserved; no retry')
    }
  }
  const status = degraded ? { audit: 'degraded', warning: 'AUDIT_UNAVAILABLE' } : {}
  if (failure) json(res, 200, { ok: false, error: String(failure.message ?? failure),
    ...(failure.code ? { code: failure.code, retryAfterMs: failure.retryAfterMs } : {}), ...status })
  else if (body.fireAndForget && !degraded) res.writeHead(204).end()
  else json(res, 200, { ok: true, value: value ?? null, ...status })
}

// Deliberately conservative: unlisted channels require a healthy audit sink.
export const READ_ONLY_CHANNELS = new Set(['chat:list-sessions', 'chat:history-page', 'config:get'])
