import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

const nonPublic = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) nonPublic.addSubnet(address, prefix)
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  nonPublic.addSubnet(address, prefix, 'ipv6')
}
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

/** 用户可自行修正的输入错误：设置 RPC 把它作为字段级结果返回，不当作插件异常。 */
export class ModelInputError extends Error {
  constructor(field, code, message) {
    super(message)
    this.field = field
    this.code = code
  }
}

export function normalizeBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('模型 API 地址必须是以 https:// 或 http:// 开头的完整 URL，例如 https://api.example.com/v1') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#') ||
      !/^https?:\/\/[^/\\\s]+/i.test(value) || /[\\\s]/.test(value) || url.pathname.replace(/\/+$/, '').endsWith('/chat/completions')) {
    throw new Error('模型 API 地址不得包含用户信息、查询、片段或 /chat/completions；请填写 Base URL')
  }
  return url.href.replace(/\/+$/, '')
}

function publicAddress({ address, family }) {
  if (family === 4) return !nonPublic.check(address)
  return family === 6 && globalV6.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6')
}

/**
 * Approval is exact: only that normalized base, not an origin or arbitrary path.
 * `trustedBases` holds the user's confirmed base for this user + Profile and any administrator-approved bases.
 */
export function customModelEndpoint(baseUrl, trustedBases = []) {
  const base = normalizeBaseUrl(baseUrl)
  const trusted = trustedBases.includes(base)
  const url = new URL(`${base}/chat/completions`)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  if (!trusted && (url.protocol !== 'https:' || (family && !publicAddress({ address: hostname, family })))) {
    throw new ModelInputError('allowNonPublic', 'confirmation-required',
      `${base} 是本机、内网或 HTTP 地址，尚未确认放行；请联系 Studio 管理员将此完整地址加入 modelTrustedBases，或改用公网 HTTPS 地址`)
  }
  return { url, trusted, hostname, family }
}

// Direct requests only. Pin DNS for this connection so it cannot change between validation and connect.
export async function requestCustomModel({ url, trusted, hostname, family }, { headers, body, signal, method = 'POST', json = false }) {
  signal?.throwIfAborted()
  let addresses
  try { addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true }) }
  catch { throw new Error('自定义模型 API DNS 解析失败；未回退') }
  signal?.throwIfAborted()
  if (!addresses.length || (!trusted && addresses.some(address => !publicAddress(address)))) {
    throw new Error('自定义模型 API 的域名未解析到公网地址；如确属本机/内网服务，请联系 Studio 管理员批准该 Base URL；未回退')
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const request = send(url, {
      method, agent: false, signal,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }) },
      lookup: (_hostname, options, done) => {
        const results = addresses.filter(item => !options.family || item.family === options.family)
        if (!results.length) return done(new Error('No approved address for this family'))
        if (options.all) return done(null, results)
        return done(null, results[0].address, results[0].family)
      },
    }, response => {
      const status = response.statusCode
      if (status < 200 || status >= 300) {
        response.destroy()
        reject(new Error(`自定义模型 API 返回 HTTP ${status}；未回退`))
      } else if (json) {
        let raw = '', bytes = 0
        response.setEncoding('utf8')
        response.on('data', chunk => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > 2 * 1024 * 1024) { response.destroy(); reject(new Error('模型列表超过 2 MiB 限制')) }
          else raw += chunk
        })
        response.on('error', () => reject(new Error('模型列表读取中断')))
        response.on('end', () => {
          try { resolve(JSON.parse(raw)) } catch { reject(new Error('模型列表接口返回非 JSON')) }
        })
      } else if (!/^text\/event-stream(?:\s*;|$)/i.test(response.headers['content-type'] || '')) {
        response.destroy()
        reject(new Error('自定义模型 API 未返回 Chat Completions SSE；未回退'))
      } else resolve({ ok: true, body: Readable.toWeb(response) })
    })
    request.on('error', () => reject(new Error('无法连接自定义模型 API；未回退')))
    request.end(body)
  })
}
