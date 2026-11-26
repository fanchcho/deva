#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readModels } from '../lib/desktop-model-schema.mjs'
import { resolveDevaRootSource } from '../lib/deva-fs.mjs'

const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
if (args.includes('--help')) {
  console.log('Read-only: node scripts/list-desktop-models.mjs [--config /absolute/config.json] (--studio http://127.0.0.1:8648 | --rpc-stdin)\n--studio uses STUDIO_TOKEN and optional STUDIO_PROFILE; --rpc-stdin consumes the fresh authenticated get-model-selection JSON response from your transport. No keys or raw responses are printed.')
} else {
  try {
    const path = option('--config') || join(resolveDevaRootSource().path, 'config.json')
    const local = readModels(JSON.parse(readFileSync(path, 'utf8')))
    let envelope
    if (args.includes('--rpc-stdin')) {
      envelope = JSON.parse(readFileSync(0, 'utf8'))
      if (envelope.content?.[0]?.text) envelope = JSON.parse(envelope.content[0].text)
      if (envelope.status && envelope.status !== 200) throw Error('RPC_HTTP_' + envelope.status)
      envelope = envelope.body ?? envelope
    } else {
      const url = new URL(option('--studio'))
      if (url.username || url.password || url.search || url.hash) throw Error('STUDIO_URL_INVALID')
      if (!process.env.STUDIO_TOKEN) throw Error('STUDIO_TOKEN_REQUIRED')
      url.pathname = '/api/studio/plugins/deva/invoke'
      if (process.env.STUDIO_PROFILE) url.searchParams.set('profile', process.env.STUDIO_PROFILE)
      const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.STUDIO_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'rpc', name: 'get-model-selection' }), signal: AbortSignal.timeout(25000) })
      if (!response.ok) throw Error('RPC_HTTP_' + response.status)
      envelope = await response.json()
    }
    const rpc = envelope.result ?? envelope
    if (!Array.isArray(rpc.desktopProviders)) throw Error('RPC_SHAPE')
    const safeUrl = value => { try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch { return '[invalid URL]' } }
    const rows = providers => providers.map(p => ({ id: p.id, name: p.name, baseUrl: safeUrl(p.apiHost ?? p.baseUrl), models: (p.models || []).map(m => ({ id: m.id, ref: `${p.id}:${m.id}` })) }))
    console.log(JSON.stringify({ path, local: { defaultModel: local.models.activeModelId ?? null, providers: rows(local.providers) }, rpc: { path: rpc.desktopConfigPath, defaultModel: rpc.modelRef, providers: rows(rpc.desktopProviders) } }, null, 2))
  } catch (error) {
    // Never echo JSON parse context, raw server errors, tokens, or configuration contents.
    console.error('Model inventory failed: ' + (/^RPC_|^STUDIO_/.test(error.message) ? error.message : error.code || error.name))
    process.exitCode = 1
  }
}
