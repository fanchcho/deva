import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
for (const file of ['shim.js', 'backend.cjs', 'pty-host.js', 'manifest.json', 'build-info.json']) {
  const info = await fs.stat(path.join(repo, 'apps/web/dist', file))
  assert.ok(info.isFile() && info.size > 0, file)
}
const tempRoot = path.join(repo, '.tmp')
await fs.mkdir(tempRoot, { recursive: true })
const data = await fs.mkdtemp(path.join(tempRoot, 'web-build-smoke-'))
const password = crypto.randomBytes(24).toString('hex')
const server = spawn(process.execPath, ['apps/web/server.mjs'], {
  cwd: repo,
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DEVA_WEB_DATA: data,
    DEVA_WEB_ADMIN_PASSWORD: password },
  stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })
try {
  const deadline = Date.now() + 20000
  while (!output.includes('[deva-web] http://') && server.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const base = /\[deva-web\] (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]
  assert.ok(base, output)
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password }) })
  assert.equal(login.status, 302)
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  const get = async (url) => {
    const response = await fetch(base + url, { headers: { cookie }, redirect: 'manual' })
    assert.equal(response.status, 200, url)
    const text = await response.text()
    assert.ok(text.length, url)
    console.log('200', url)
    return text
  }
  await get('/healthz')
  const html = await get('/')
  const assets = [...html.matchAll(/(?:src|href)="((?:\.\/|\/)[^"?#]+\.(?:js|css))"/g)].map((m) => new URL(m[1], base).pathname)
  assert.ok(assets.some((asset) => asset.startsWith('/assets/')), 'renderer assets present')
  for (const asset of new Set([...assets, '/favicon.svg', '/favicon.ico'])) await get(asset)
  assert.equal(await get('/favicon.svg'), await fs.readFile(path.join(repo, 'apps/desktop/src/mobile/public/favicon.svg'), 'utf8'))
  console.log('PASS built homepage, renderer assets, shim, shared favicon')
} finally {
  if (server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  await fs.writeFile(path.join(data, 'server.log'), output)
}
