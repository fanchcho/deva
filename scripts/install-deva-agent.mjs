#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url))
const plugin = 'plugins/deva-agent'
const registryPath = '/api/studio/plugins'
const defaults = { ref: 'HEAD', studio: process.env.STUDIO_URL, 'token-env': 'STUDIO_API_TOKEN' }
const help = `用法：node scripts/install-deva-agent.mjs [--ref REF | --package 绝对解包目录]
       [--studio URL] [--token-env VAR | --username USER --password-env VAR]
       [--dry-run | --check | --rollback]
默认从本地 Git HEAD 打包并安装；--ref 可用已 fetch 的分支、tag 或提交。
--dry-run 仅构建和读注册表，不变更插件；--check 只比对目标版本与启用状态。
--rollback 恢复 Studio 保留的上一版，须用 --ref 或 --package 指定预期旧版本。
--package 跳过构建，使用已解包的成品。
环境变量默认：STUDIO_URL、STUDIO_API_TOKEN。成品保留在仓库 .tmp/。`

function parseArgs(args) {
  const options = { ...defaults }
  const values = ['ref', 'package', 'studio', 'token-env', 'username', 'password-env']
  const modes = ['dry-run', 'check', 'rollback']
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const key = flag.slice(2)
    if (!flag.startsWith('--') || seen.has(key)) throw new Error('未知或重复参数；请运行 --help')
    seen.add(key)
    if (modes.includes(key)) options[key] = true
    else if (values.includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i]
    else throw new Error('未知参数或缺少参数值；请运行 --help')
  }
  if (modes.filter(key => options[key]).length > 1 ||
      (seen.has('ref') && options.package) ||
      (options.rollback && !seen.has('ref') && !options.package) ||
      Boolean(options.username) !== Boolean(options['password-env']) ||
      (options.username && seen.has('token-env'))) throw new Error('参数组合无效；请运行 --help')
  for (const key of ['token-env', 'password-env']) {
    if (options[key] && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options[key])) throw new Error('凭据来源必须是环境变量名')
  }
  if (options.package && !isAbsolute(options.package)) throw new Error('--package 必须指定绝对解包目录')
  if (!options.studio && !options['dry-run']) throw new Error('请用 --studio 或 STUDIO_URL 指定目标 Studio')
  return options
}

function command(program, args, options = {}) {
  const { capture, ...rest } = options
  const result = spawnSync(program, args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
    ...rest
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} 退出：${result.status ?? result.signal}`)
  return result.stdout?.trim()
}

function readManifest(raw, directory) {
  const manifest = JSON.parse(raw)
  if (manifest.id !== 'deva' || manifest.apiVersion !== 1 ||
      !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(manifest.version) ||
      manifest.server !== 'server.mjs' || manifest.client !== 'client.mjs') {
    throw new Error('不是支持的 Deva Agent API v1 安装包')
  }
  if (directory) {
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (pkg.name !== 'studio-plugin-deva' || pkg.version !== manifest.version) throw new Error('包名或版本与清单不符')
    for (const entry of [manifest.server, manifest.client]) {
      if (!statSync(join(directory, entry)).isFile()) throw new Error(`缺少入口：${entry}`)
    }
  }
  return manifest
}

function targetFor(options, env) {
  if (options.package) {
    const source = resolve(options.package)
    return { source, version: readManifest(readFileSync(join(source, 'plugin.json')), source).version }
  }
  const commit = command('git', ['rev-parse', '--verify', '--end-of-options', `${options.ref}^{commit}`], { capture: true, env })
  const manifest = readManifest(command('git', ['show', `${commit}:${plugin}/plugin.json`], { capture: true, env }))
  console.log(`目标提交 ${commit}；Deva ${manifest.version}`)
  return { commit, version: manifest.version }
}

function build(target, env) {
  if (target.source) return target.source
  const tmpRoot = join(repo, '.tmp')
  mkdirSync(tmpRoot, { recursive: true })
  const run = mkdtempSync(join(tmpRoot, 'install-deva-agent-'))
  writeFileSync(join(run, '.gitignore'), '*\n')
  const sourceArchive = join(run, 'source.tar')
  const runtime = join(run, 'runtime')
  const unpacked = join(run, 'unpacked')
  mkdirSync(runtime)
  mkdirSync(unpacked)
  const buildEnv = {
    ...env, TMPDIR: runtime, TMP: runtime, TEMP: runtime,
    npm_config_cache: join(run, 'npm-cache')
  }
  command('git', ['archive', '--format=tar', '--output', sourceArchive, target.commit, plugin], { env })
  command('tar', ['-xf', sourceArchive, '-C', run], { env })
  const cwd = join(run, plugin)
  const npm = (args) => command('npm', args, { cwd, env: buildEnv })
  const locked = existsSync(join(cwd, 'package-lock.json'))
  npm([locked ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', ...(locked ? [] : ['--no-package-lock'])])
  npm(['pack', '--foreground-scripts', '--pack-destination', run])
  const archive = join(run, `studio-plugin-deva-${target.version}.tgz`)
  command('tar', ['-xzf', archive, '-C', unpacked], { env })
  const source = join(unpacked, 'package')
  if (readManifest(readFileSync(join(source, 'plugin.json')), source).version !== target.version) {
    throw new Error('解包后版本与 Git ref 不符')
  }
  console.log(`保留旧版回装用的成品：${archive}\nStudio 服务端安装源：${source}`)
  return source
}

function studioClient(value, secrets) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Studio 地址必须是无路径、无凭据的 HTTPS origin（仅 loopback 允许 HTTP）')
  }
  return async (method, path, { body, token } = {}) => {
    let response
    try {
      response = await fetch(new URL(path, url), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
        // The synchronous pack step can outlast a Studio keep-alive connection.
        headers: { accept: 'application/json', connection: 'close', ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
        body: body && JSON.stringify(body)
      })
    } catch (error) {
      throw new Error(`${method} ${path}：${error.message}${error.cause ? `：${error.cause.message}` : ''}`)
    }
    const raw = await response.text()
    if (!response.ok) throw new Error(`${method} ${path} HTTP ${response.status}\n${redact(raw, secrets)}`)
    try { return JSON.parse(raw) } catch { throw new Error(`${method} ${path} 未返回 JSON；请核对 Studio 地址和 API 版本`) }
  }
}

function redact(message, secrets) {
  return secrets.reduce((text, secret) => {
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
      text = text.replaceAll(form, '[REDACTED]')
    }
    return text
  }, String(message))
}

async function login(options, api, secrets) {
  const key = options.username ? options['password-env'] : options['token-env']
  const credential = process.env[key]
  if (!credential) throw new Error(`缺少环境变量 ${key}；必须使用目标 Studio 的登录凭据`)
  if (!options.username) return credential
  const { token } = await api('POST', '/api/auth/login', { body: { username: options.username, password: credential } })
  if (typeof token !== 'string' || !token) throw new Error('登录响应缺少 Studio token')
  secrets.push(token)
  return token
}

async function readRegistry(request) {
  const snapshot = await request('GET', registryPath)
  if (!Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.plugins)) throw new Error('插件注册表响应缺少 revision/plugins')
  return { revision: snapshot.revision, deva: snapshot.plugins.find(item => item.manifest?.id === 'deva') }
}

function show(state) {
  const p = state.deva
  console.log(p
    ? `Studio revision=${state.revision} Deva=${p.manifest.version} status=${p.status} enabled=${p.enabled} previous=${p.previousVersion ?? '-'}`
    : `Studio revision=${state.revision} 尚未安装 Deva`)
}

function verify(state, version) {
  if (state.deva?.manifest?.version !== version || state.deva.enabled !== true || state.deva.status !== 'active') {
    throw new Error(`验收失败：预期 Deva ${version} active / enabled=true；请查看插件日志`)
  }
}

async function reconcile(request, initial, { source, version, rollback }) {
  let result = initial
  const changedVersion = initial.deva?.manifest.version !== version
  if (changedVersion) {
    if (rollback) {
      if (initial.deva?.previousVersion !== version) throw new Error('Studio 保留的上一版与目标不符；请去掉 --rollback 并使用旧 ref/解包目录重装')
      await request('PATCH', `${registryPath}/deva`, { revision: result.revision, action: 'rollback' })
    } else {
      await request('POST', `${registryPath}/install`, {
        source, revision: result.revision, trusted: true, expectedVersion: version,
        ...(initial.deva && { pluginId: 'deva' })
      })
    }
    result = await readRegistry(request)
  }
  if (result.deva?.manifest.version !== version) {
    show(result)
    throw new Error(`验收失败：Studio 未返回目标版本 ${version}`)
  }
  if (result.deva.enabled !== true) {
    await request('PATCH', `${registryPath}/deva`, { revision: result.revision, enabled: true })
    result = await readRegistry(request)
  }
  show(result)
  verify(result, version)
  if ((changedVersion || initial.deva?.enabled !== true) && result.revision <= initial.revision) {
    throw new Error('验收失败：插件注册表 revision 未按预期递增')
  }
}

const secrets = []
try {
  if (process.argv.slice(2).includes('--help')) {
    console.log(help)
  } else {
    const options = parseArgs(process.argv.slice(2))
    const env = { ...process.env }
    for (const key of new Set(['STUDIO_API_TOKEN', 'STUDIO_ADMIN_PASSWORD', options['token-env'], options['password-env']])) {
      if (key && env[key]) {
        secrets.push(env[key])
        delete env[key]
      }
    }
    const target = targetFor(options, env)
    const api = options.studio && studioClient(options.studio, secrets)
    const token = api && await login(options, api, secrets)
    const request = (method, path, body) => api(method, path, { token, body })
    const initial = api && await readRegistry(request)
    if (initial) show(initial)
    if (options.check) verify(initial, target.version)
    else if (options['dry-run']) {
      build(target, env)
      console.log('Dry-run：未变更 Studio 插件注册表。')
    } else if (options.rollback) {
      await reconcile(request, initial, { ...target, rollback: true })
    } else {
      const source = initial.deva?.manifest.version === target.version ? undefined : build(target, env)
      if (source) {
        const latest = await readRegistry(request)
        if (latest.revision !== initial.revision) throw new Error('构建后 registry revision 已变化；请重新检查后再运行')
      }
      await reconcile(request, initial, { ...target, source })
    }
  }
} catch (error) {
  console.error(redact(error.message, secrets))
  process.exitCode = 1
}
