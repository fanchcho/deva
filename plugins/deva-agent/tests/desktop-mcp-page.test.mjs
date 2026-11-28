import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isolatedDevaHome } from './support/deva-home.mjs'
import { readDesktopMcpCompatibility } from '../lib/mcp-store.mjs'
const root = isolatedDevaHome()
const config = { sharedDevaHome: root }
test('desktop compatibility preserves bytes, modes, secretRef, unknown fields and enabled state', () => {
  const input = { extra: 7, mcpServers: { same: { command: 'node', env: { TOKEN: { secretRef: 'token' } }, future: { keep: true } }, other: { url: 'https://example.com' } } }
  writeFileSync(join(root, 'mcp.json'), JSON.stringify(input), { mode: 0o644 })
  writeFileSync(join(root, 'config.json'), JSON.stringify({ mcp: { enabled: { same: true, other: false }, extra: 9 } }))
  const before = ['mcp.json', 'config.json'].map(name => [readFileSync(join(root, name), 'utf8'), statSync(join(root, name)).mode])
  const result = readDesktopMcpCompatibility(config, { studioNames: ['same'] })
  assert.deepEqual(result.entries, [{ name: 'same', transport: 'stdio', enabled: true }, { name: 'other', transport: 'http', enabled: false }])
  assert.doesNotMatch(JSON.stringify(result), /secretRef|token|future/)
  assert.deepEqual(readDesktopMcpCompatibility(config, { studioNames: ['same'] }), result)
  assert.deepEqual(['mcp.json', 'config.json'].map(name => [readFileSync(join(root, name), 'utf8'), statSync(join(root, name)).mode]), before)
  mkdirSync(join(root, 'deva-agent'))
  writeFileSync(join(root, 'deva-agent', 'mcp-servers.json'), '{"servers":{}}')
  readDesktopMcpCompatibility(config)
  assert.equal(existsSync(join(root, 'deva-agent', 'mcp-servers.json')), true)
})
for (const [file, content] of [['mcp.json', '{bad'], ['mcp.json', '{"mcpServers":[]}'], ['config.json', '{bad']]) {
  test(`invalid ${file} returns an explicit read error without writing`, () => {
    writeFileSync(join(root, 'mcp.json'), '{"mcpServers":{"ok":{"command":"node"}}}')
    writeFileSync(join(root, 'config.json'), '{}')
    writeFileSync(join(root, file), content)
    assert.ok(readDesktopMcpCompatibility(config).error)
    assert.equal(readFileSync(join(root, file), 'utf8'), content)
  })
}
