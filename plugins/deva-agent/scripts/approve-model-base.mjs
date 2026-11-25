#!/usr/bin/env node
// Explicit administrator operation through the official Studio API; never run on page load.
import { normalizeBaseUrl } from '../lib/custom-model-network.mjs'

export async function approveModelBase({ studio, base, token, request = fetch }) {
  if (!token) throw new Error('Set STUDIO_API_TOKEN to a Studio administrator token')
  if (typeof base !== 'string' || base.includes('*')) throw new Error('Provide one exact Base URL; wildcards are forbidden')
  const normalized = normalizeBaseUrl(base)
  const origin = new URL(studio)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Invalid Studio URL')
  const api = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin), { method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new Error(`Studio ${method} ${path}: HTTP ${response.status}; approval not confirmed`)
    return response.json()
  }
  const before = await api('/api/studio/plugins')
  const plugin = before.plugins.find(p => p.manifest.id === 'deva')
  if (!plugin) throw new Error('Deva is not installed')
  const config = plugin.config || {}
  const bases = [...new Set([...(config.modelTrustedBases || []).map(normalizeBaseUrl), normalized])]
  if (!(config.modelTrustedBases || []).includes(normalized)) {
    await api('/api/studio/plugins/deva', 'PATCH', { revision: before.revision, config: { ...config, modelTrustedBases: bases } })
  }
  const after = await api('/api/studio/plugins')
  if (!after.plugins.find(p => p.manifest.id === 'deva')?.config?.modelTrustedBases?.includes(normalized)) throw new Error('Approval readback mismatch')
  return { approvedBase: normalized, revisionBefore: before.revision, revisionAfter: after.revision }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    const [studio, base] = process.argv.slice(2)
    console.log(JSON.stringify(await approveModelBase({ studio, base, token: process.env.STUDIO_API_TOKEN }), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
