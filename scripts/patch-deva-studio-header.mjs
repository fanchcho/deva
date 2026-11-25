#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

// Optional host patch for the one verified Studio 0.8.30 build, never a plugin asset.
const originalHash = 'cc501c0899425381a90b0c4ae680b88ed132cf9fd92a39cb1b938bdffe8506ff'
const patchedHash = 'e3fde64db9d275042a01434deb1ed41003ed4436e06362d3fd1bd5ac0c1e9b02'
const edits = [
  [
    'const c=g(()=>t.name==="studio.pluginAgentSettings"),h=g(',
    'const c=g(()=>t.name==="studio.pluginAgentSettings"),devaHeader=g(()=>c.value&&t.params.pluginId==="deva"),h=g('
  ],
  [
    'v(ae,{to:{name:c.value?"hermes.agentManager":"studio.plugins"},class:"back-link"},{default:u(()=>[_(r(e(l)(c.value?"sidebar.agentManager":"studioPlugins.title")),1)]),_:1},8,["to"]),s[3]||(s[3]=m("span",{"aria-hidden":"true"},"/",-1))',
    'v(ae,{to:{name:c.value?"hermes.agentManager":"studio.plugins"},class:"back-link","aria-label":devaHeader.value?e(l)("ekkoConfig.back"):void 0},{default:u(()=>[devaHeader.value?m("svg",{viewBox:"0 0 24 24",width:16,height:16,fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",focusable:"false"},[m("path",{d:"M19 12H5m7 7-7-7 7-7"})]):_(r(e(l)(c.value?"sidebar.agentManager":"studioPlugins.title")),1)]),_:1},8,["to","aria-label"]),devaHeader.value?null:s[3]||(s[3]=m("span",{"aria-hidden":"true"},"/",-1))'
  ]
]
const digest = data => createHash('sha256').update(data).digest('hex')
const usage = '用法：node scripts/patch-deva-studio-header.mjs /绝对路径/PluginPageView-Bsu_7XTl.js [--apply | --rollback]（默认 dry-run）'

function checkAndPatch(path, action) {
  const meta = lstatSync(path)
  if (!meta.isFile()) throw new Error('目标须是普通文件，不能是 symlink')
  const before = readFileSync(path)
  const hash = digest(before)
  if (![originalHash, patchedHash].includes(hash)) throw new Error(`未知宿主构建（SHA-256 ${hash}）；已停止，不要覆盖`)
  const output = edits.reduce((text, [from, to]) => {
    if (text.split(from).length !== 2) throw new Error('定位特征不唯一')
    return text.replace(from, to)
  }, hash === originalHash ? before.toString('utf8') : reverse(before.toString('utf8')))
  if (digest(output) !== patchedHash) throw new Error('候选文件 SHA-256 不符')
  const rollback = action === '--rollback'
  const desired = rollback ? originalHash : patchedHash
  if (!action || hash === desired) {
    console.log(`${action ? '无需变更' : 'Dry-run，未写文件'}：${hash === originalHash ? '原版' : '已打补丁'}；SHA-256 ${hash}`)
    return
  }
  const temp = join(dirname(path), '.tmp')
  if (!existsSync(temp)) mkdirSync(temp, { mode: 0o700 })
  if (!lstatSync(temp).isDirectory()) throw new Error('备份目录须为普通目录')
  const backup = join(temp, `${basename(path)}.deva-original`)
  if (!rollback && !existsSync(backup)) writeFileSync(backup, before, { mode: 0o600, flag: 'wx' })
  if (!lstatSync(backup).isFile()) throw new Error('备份须为普通文件')
  const original = readFileSync(backup)
  if (digest(original) !== originalHash) throw new Error('备份 SHA-256 不符')
  const staging = mkdtempSync(join(temp, 'deva-header-'))
  try {
    const candidate = join(staging, 'candidate.js')
    writeFileSync(candidate, rollback ? original : output)
    const copied = statSync(candidate)
    if (copied.uid !== meta.uid || copied.gid !== meta.gid) chownSync(candidate, meta.uid, meta.gid)
    chmodSync(candidate, meta.mode & 0o777)
    if (digest(readFileSync(candidate)) !== desired || digest(readFileSync(path)) !== hash) throw new Error('候选或目标文件在操作中变化')
    // Same filesystem: no partially written asset is visible to Studio.
    renameSync(candidate, path)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  console.log(`${rollback ? '已回滚' : '已应用'}：SHA-256 ${desired}；原始备份：${backup}`)
}

function reverse(text) {
  const old = edits.reduceRight((current, [from, to]) => current.replace(to, from), text)
  if (digest(old) !== originalHash) throw new Error('反向补丁 SHA-256 不符')
  return old
}

try {
  const [, , path, action, extra] = process.argv
  if (path === '--help') console.log(usage)
  else {
    if (!path || !isAbsolute(path) || extra || (action && !['--apply', '--rollback'].includes(action))) throw new Error(usage)
    checkAndPatch(path, action)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
