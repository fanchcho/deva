import { createHash } from 'node:crypto'
import { writeUiTrace } from './ui-trace.mjs'

// Response-phase identity is assigned by host authentication, never by client input.
export function clientDeliveryInterceptor(write = writeUiTrace) {
  return {
    name: 'client-delivery',
    onResponse(response, http) {
      if (http.request.method !== 'GET' || http.originalUrl.split('?')[0] !== '/api/studio/plugins/deva/client') return
      try {
        const source = response.body?.source
        const endpoint = new URL('http://' + (http.request.headers.host || 'unknown'))
        write({ side: 'server', phase: 'client-delivery', userId: http.identity?.userId ?? 0,
          profile: http.identity?.profile || 'unauthenticated', endpoint: endpoint.host,
          http: response.status, count: typeof source === 'string' ? Buffer.byteLength(source) : 0,
          clientVersion: typeof source === 'string' ? source.match(/Deva (\d+\.\d+\.\d+)/)?.[1] || 'unknown' : 'unavailable',
          clientSha256: typeof source === 'string' ? createHash('sha256').update(source).digest('hex') : 'unavailable' })
      } catch { /* Observation cannot change client delivery or authentication. */ }
    },
  }
}
