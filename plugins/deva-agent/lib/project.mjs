/**
 * Deva 项目事实：给 Agent 的项目背景知识来源。
 *
 * 为什么每个 Agent 会话都重新读一遍而不是写死在提示词里：
 * 版本号、脚本、文档入口、当前分支都会变，写死就会立刻过期。这里只读少量固定文件
 * （package.json / docs/PROJECT-MAP.md 首段 / git HEAD），失败一律降级为空，
 * 不让"读不到"变成"启动失败"。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

const MAX_DOC_CHARS = 1400

async function readText(file, limit) {
  try {
    const text = await readFile(file, 'utf8')
    return limit ? text.slice(0, limit) : text
  } catch {
    return ''
  }
}

function run(command, args, cwd, timeout = 2500) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, maxBuffer: 1 << 20 }, (error, stdout) => {
      resolve(error ? '' : String(stdout).trim())
    })
  })
}

/** 读仓库可验证的事实；任何一项缺失都只是少一行提示，不影响运行。 */
export async function projectFacts(workspaceDir) {
  if (!workspaceDir) return { root: '', version: '', scripts: [], branch: '', commit: '', hasMap: false, summary: '' }
  const root = workspaceDir
  const pkgText = await readText(join(root, 'package.json'))
  let pkg = {}
  try { pkg = JSON.parse(pkgText) } catch { pkg = {} }
  const desktopText = await readText(join(root, 'apps/desktop/package.json'))
  let desktop = {}
  try { desktop = JSON.parse(desktopText) } catch { desktop = {} }
  const mapText = await readText(join(root, 'docs/PROJECT-MAP.md'), 4000)
  const summaryLine = mapText.split('\n').find(line => line.startsWith('- 梳理对象')) || ''
  const [branch, commit] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root),
    run('git', ['rev-parse', '--short', 'HEAD'], root),
  ])
  const scripts = Object.entries({ ...(pkg.scripts || {}), ...prefix(desktop.scripts || {}) })
    .filter(([name]) => ['dev', 'build', 'build:web', 'start', 'start:web', 'typecheck', 'package:win', 'package:mac', 'package:linux'].includes(name))
    .map(([name, body]) => `${name}: ${String(body).slice(0, 160)}`)
  return {
    root,
    name: pkg.name || '',
    version: pkg.version || '',
    desktopVersion: desktop.version || '',
    description: pkg.description || '',
    scripts,
    branch,
    commit,
    hasMap: existsSync(join(root, 'docs/PROJECT-MAP.md')),
    summary: summaryLine.slice(0, 400) || '',
    docs: ['docs/PROJECT-MAP.md', 'docs/FUNCTION-INDEX.md', 'AGENTS.md', 'README.md']
      .filter(file => existsSync(join(root, file))),
  }
}

function prefix(scripts) {
  return Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, `(apps/desktop) ${String(value)}`]))
}

/** 把事实压成提示词里的一段（有界长度，避免每轮塞几千字）。 */
export function formatFacts(facts) {
  if (!facts.root) return '未检测到工作区：先让用户为这个会话选择一个工作区（仓库根目录）。'
  const lines = [
    `工作区：${facts.root}`,
    facts.name ? `包名：${facts.name}（workspace 版本 ${facts.version || '未知'}）` : '',
    facts.desktopVersion ? `桌面端版本：${facts.desktopVersion}` : '',
    facts.description ? `定位：${facts.description}` : '',
    facts.branch ? `git：${facts.branch}${facts.commit ? ` @ ${facts.commit}` : ''}` : '',
    facts.scripts.length ? `常用脚本：\n${facts.scripts.map(script => `  - ${script}`).join('\n')}` : '',
    facts.hasMap ? '工程全量梳理：docs/PROJECT-MAP.md（文件清单/函数说明/运行机制）、docs/FUNCTION-INDEX.md（2505 条函数索引）' : '',
    facts.docs.length ? `可读文档：${facts.docs.join('、')}` : '',
    facts.summary ? `梳理口径：${facts.summary}` : '',
  ]
  return lines.filter(Boolean).join('\n').slice(0, MAX_DOC_CHARS * 2)
}
