/**
 * browser 工具的网址规范化：本机 / 内网地址补 http，其余补 https，本机路径转 file:，
 * 危险协议（javascript:、chrome: 等）一律拒绝。错放一个 javascript: 就是渲染层 XSS，
 * 所以这里逐条钉死允许与拒绝的边界。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeUrl } from '../src/main/services/browser/url.ts'

test('公网域名补 https，并规范成 URL.href', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeUrl('  example.com/a?b=1  '), 'https://example.com/a?b=1')
  assert.equal(normalizeUrl('https://example.com/x'), 'https://example.com/x')
  assert.equal(normalizeUrl('http://example.com/x'), 'http://example.com/x')
})

test('本机 / 内网地址补 http', () => {
  for (const host of ['localhost:7080', '127.0.0.1:7080', '0.0.0.0:7080', '[::1]:7080']) {
    assert.equal(normalizeUrl(host), `http://${host}/`, host)
  }
  for (const host of ['10.1.2.3', '192.168.1.10', '172.16.0.9', '172.31.255.1']) {
    assert.equal(normalizeUrl(host), `http://${host}/`, host)
  }
  // 172.32.x 不在私网段里，仍按公网补 https
  assert.equal(normalizeUrl('172.32.0.1'), 'https://172.32.0.1/')
})

test('危险协议一律拒绝', () => {
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'chrome://settings',
    'devtools://devtools/bundled',
    'about:blank',
    'view-source:https://example.com'
  ]) {
    assert.equal(normalizeUrl(bad), null, bad)
  }
})

test('其他自定义协议（foo://）拒绝，不猜它是不是安全的', () => {
  assert.equal(normalizeUrl('foo://bar'), null)
  assert.equal(normalizeUrl('ssh://host'), null)
})

test('本机绝对路径转 file: URL', () => {
  assert.equal(normalizeUrl('/tmp/a.txt'), pathToFileURL('/tmp/a.txt').href)
  assert.equal(normalizeUrl('/tmp/带中文/文件名.md'), pathToFileURL('/tmp/带中文/文件名.md').href)
})

test('~/ 展开到 home 目录', () => {
  assert.equal(normalizeUrl('~/notes.md'), pathToFileURL(join(homedir(), 'notes.md')).href)
  assert.equal(normalizeUrl('~'), pathToFileURL(homedir()).href)
})

test('空串 / 纯空白返回 null（不是 "https://" 这种垃圾 URL）', () => {
  assert.equal(normalizeUrl(''), null)
  assert.equal(normalizeUrl('   '), null)
  assert.equal(normalizeUrl('\n\t'), null)
})

test('畸形输入返回 null 而不是抛出', () => {
  assert.equal(normalizeUrl('https://'), null)
  assert.equal(normalizeUrl('http://'), null)
})
