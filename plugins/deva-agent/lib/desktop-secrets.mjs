/**
 * 桌面端密钥（`<Deva 根>/secrets.json`）的**只读**访问。
 *
 * 桌面端（apps/desktop/src/main/services/secrets.ts）用 Electron safeStorage 加密：
 *  · 落盘位置：`join(getDevaHome(), 'secrets.json')`，与 config.json 同一根目录（可被 DEVA_HOME 覆盖）；
 *    旧位置是 `app.getPath('userData')/secrets.json`，桌面首次读不到新位置时会一次性搬运密文；
 *  · 键名：providerId（MCP 用 `mcp:<serverId>:<field>`）；
 *  · 值：`safeStorage.encryptString(value).toString('base64')`——Windows 上是 DPAPI 密文的 base64。
 *
 * 这里只做两件事：读这个文件、按需解密某一条。**不写回桌面文件、不写插件状态、不进日志、不回前端**；
 * 解密结果的明文只存在于本模块的短时内存缓存（有上限、有失效）。
 *
 * 解密实现可注入（`decrypt`），便于单测与后续换实现；默认实现是 Windows DPAPI：
 * 调 `powershell.exe` 的 `ProtectedData::Unprotect`，密文走 **stdin**，绝不放进命令行参数或环境变量
 * （那会把密钥暴露在进程列表/系统审计里）。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, lstatSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDevaRoot } from './deva-fs.mjs'
import { MAC_CODES, collectKeychainEntries, createMacKeychainDecoder, isMacToolchainFailure } from './macos-keychain.mjs'
import { createWindowsSafeStorageDecoder, WIN_CODES } from './windows-safe-storage.mjs'
import { classifyOwnership, describeValuePrefix, likelyV10Format, normalizeAccount } from './safe-storage.mjs'
import { hostname, userInfo } from 'node:os'

export const DESKTOP_SECRETS_MAX_BYTES = 1024 * 1024

/**
 * 解密失败的原因码：页面与报错只用这些稳定值，不拼底层异常文本。
 *
 * 关键是**把「工具链坏了」与「这份密文不属于这个进程的用户/机器」分开**：
 *  · TOOL_* / ASSEMBLY / LANGUAGE_MODE / OUTPUT_INVALID / ROUNDTRIP_FAILED → 这套环境解不了任何 DPAPI 密文；
 *  · FOREIGN_BLOB → 本环境能解 DPAPI（自检往返成功），但这一个 blob 属于别的用户/机器，
 *    **密码学上不可解，插件内部无法绕过**，唯一出路是该页填一次或桌面端显式交接。
 */
export const DESKTOP_DECRYPT_CODES = Object.freeze({
  OK: 'ok',
  NOT_WINDOWS: 'platform-unsupported',
  TOOL_MISSING: 'decrypt-tool-missing',
  ASSEMBLY: 'decrypt-assembly-unavailable',
  LANGUAGE_MODE: 'decrypt-language-mode-restricted',
  OUTPUT_INVALID: 'decrypt-output-invalid',
  ROUNDTRIP_FAILED: 'decrypt-roundtrip-failed',
  CIPHERTEXT_INVALID: 'ciphertext-invalid',
  FOREIGN_BLOB: 'dpapi-foreign-blob',
  DPAPI_FAILED: 'dpapi-failed',
  TIMEOUT: 'decrypt-timeout',
  EMPTY: 'plaintext-empty',
})

/** 需要「工具链」而不是「密文归属」来背锅的码：用来决定页面给哪一种下一步。 */
export const TOOLCHAIN_CODES = Object.freeze([
  DESKTOP_DECRYPT_CODES.TOOL_MISSING,
  DESKTOP_DECRYPT_CODES.ASSEMBLY,
  DESKTOP_DECRYPT_CODES.LANGUAGE_MODE,
  DESKTOP_DECRYPT_CODES.OUTPUT_INVALID,
  DESKTOP_DECRYPT_CODES.ROUNDTRIP_FAILED,
  DESKTOP_DECRYPT_CODES.TIMEOUT,
])

export function isToolchainFailure(code) {
  return TOOLCHAIN_CODES.includes(code) || isMacToolchainFailure(code)
}

/** macOS 钥匙串专属原因码（与 DPAPI 那套并列，页面按平台给下一步）。 */
export { MAC_CODES, WIN_CODES }

/** Windows DPAPI 的 HRESULT → 原因码。只映射少数能区分「归属」的值，其它一律 DPAPI_FAILED。 */
const HRESULT_CODES = Object.freeze({
  '0x8009000b': DESKTOP_DECRYPT_CODES.FOREIGN_BLOB, // NTE_BAD_KEY_STATE：Key not valid for use in specified state
  '0x8009000a': DESKTOP_DECRYPT_CODES.FOREIGN_BLOB, // NTE_BAD_KEY
  '0x8009000d': DESKTOP_DECRYPT_CODES.FOREIGN_BLOB, // NTE_NO_KEY（该用户根本没有这把 DPAPI 主密钥）
  '0x80090005': DESKTOP_DECRYPT_CODES.DPAPI_FAILED, // NTE_BAD_DATA
  '-2146893813': DESKTOP_DECRYPT_CODES.FOREIGN_BLOB,
})

/** 桌面端历史上可能用过的 userData 目录名（package.json name 与产物 productName）。 */
const LEGACY_USERDATA_NAMES = ['@deva/desktop', 'Deva', 'deva']

function appDataRoot(env = process.env) {
  const roaming = env.APPDATA?.trim()
  return roaming || ''
}

/**
 * 候选路径：主位置（与 config.json 同根）优先，其次才是桌面的旧 userData 位置。
 * 旧位置只在主位置不存在时尝试，且只在 Windows 上枚举。
 */
export function desktopSecretsPaths(config = {}, env = process.env) {
  const root = resolveDevaRoot(config)
  const primary = join(root, 'secrets.json')
  const legacy = []
  if (process.platform === 'win32') {
    const appData = appDataRoot(env)
    if (appData) for (const name of LEGACY_USERDATA_NAMES) legacy.push(join(appData, name, 'secrets.json'))
  }
  return { primary, legacy }
}

function statOf(path) {
  try {
    const stat = lstatSync(path)
    return { exists: true, size: stat.size, file: stat.isFile(), symlink: stat.isSymbolicLink(), mtime: stat.mtime.toISOString() }
  } catch (error) {
    return { exists: false, code: error.code || 'unknown' }
  }
}

function readOne(path) {
  const stat = statOf(path)
  if (!stat.exists) return { path, ...stat, entries: {}, structure: 'missing', code: 'missing' }
  if (stat.symlink) return { path, ...stat, entries: {}, structure: 'invalid', code: 'symlink' }
  if (!stat.file) return { path, ...stat, entries: {}, structure: 'invalid', code: 'not-file' }
  if (stat.size > DESKTOP_SECRETS_MAX_BYTES) return { path, ...stat, structure: 'invalid', code: 'too-large' }
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return { path, ...stat, entries: {}, structure: 'invalid', code: error.code || 'unreadable' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { path, ...stat, entries: {}, structure: 'invalid', code: 'parse-error' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { path, ...stat, entries: {}, structure: 'invalid', code: 'not-object' }
  }
  const entries = {}
  for (const [key, value] of Object.entries(parsed)) {
    // 桌面只存字符串密文；其它形状说明文件被改过，保留线索但不当密钥用。
    if (typeof value === 'string' && value) entries[key] = value
  }
  return { path, ...stat, entries, structure: 'ok', code: 'ok', malformed: Object.keys(parsed).length - Object.keys(entries).length }
}

/**
 * 读取桌面密钥文件（主位置 → 旧位置）。**只返回元数据与密文，不解密**；
 * 页面诊断只用这里的字段（路径、是否存在、大小、结构、条目数），不含任何值。
 */
export function readDesktopSecrets(config = {}) {
  const { primary, legacy } = desktopSecretsPaths(config)
  const first = readOne(primary)
  if (first.exists || first.code !== 'missing' || !legacy.length) return { ...first, source: 'primary', tried: [primary] }
  for (const candidate of legacy) {
    const next = readOne(candidate)
    if (next.exists || next.code !== 'missing') return { ...next, source: 'legacy', tried: [primary, candidate] }
  }
  return { ...first, source: 'primary', tried: [primary, ...legacy] }
}

/**
 * 只描述 secrets.json 的**结构**，用于诊断「这 182 字节到底是什么」：
 * 每条只给 key 名、key 长度、value 的 base64 字符数、解码字节数、前 3 字节前缀（v10/v11/other）。
 * **绝不输出 value 或解码后的内容**。macOS 的 v10 密文通常每条 40~90 个 base64 字符；
 * 若 value 很短（<20）或前缀不是 v10/v11，则更像 Keychain 引用/别的东西，而不是 safeStorage 密文。
 */
export function desktopSecretsStructure(file) {
  if (!file || file.structure !== 'ok') return null
  return {
    entryCount: Object.keys(file.entries).length,
    entries: Object.entries(file.entries).map(([key, value]) => {
      const described = describeValuePrefix(value)
      return {
        key,
        keyLength: key.length,
        valueChars: value.length,
        decodedBytes: described.bytes,
        prefix: described.kind === 'v10' ? 'v10' : described.kind,
        likelyFormat: described.kind === 'v10' ? likelyV10Format(described.bytes) : 'invalid'
      }
    })
  }
}

/** 某一 provider 的密文（桌面按 providerId 存；没有 provider 级前缀）。 */
export function desktopCiphertext(file, providerId) {
  if (!file || file.structure !== 'ok' || !providerId) return ''
  return file.entries[providerId] || ''
}

/**
 * PowerShell 脚本：**按运行时自适应程序集**。
 *  · Windows PowerShell 5.1（powershell.exe）：`Add-Type -AssemblyName System.Security` 里有 ProtectedData；
 *  · PowerShell 7（pwsh.exe）：该程序集不存在，要装 `System.Security.Cryptography.ProtectedData`；
 *  · 两种都失败时（Constrained Language 等）再按类型名探测一次，并给出稳定原因码。
 *
 * 输出协议：**前导行 `DEVADPAPI <code>`**（或 `DEVADPAPI ok`）标明本环节结论，
 * 之后的输出才是载荷。这样「程序集缺失」「语言模式受限」「解不开」三者不会混成同一个失败。
 */
const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'function Fail([string]$code, [string]$detail) {',
  "  if ($detail) { [Console]::Error.WriteLine(($detail -replace '\\r',' ').Substring(0, [Math]::Min(300, $detail.Length))) }",
  "  [Console]::Out.WriteLine(\"DEVADPAPI $code\")",
  '  exit 3',
  '}',
  'function Load-ProtectedData {',
  '  if ($null -ne ("System.Security.Cryptography.ProtectedData" -as [type])) { return $true }',
  '  foreach ($name in @("System.Security.Cryptography.ProtectedData", "System.Security")) {',
  '    try { Add-Type -AssemblyName $name; continue } catch { }',
  '  }',
  '  try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { }',
  '  return ($null -ne ("System.Security.Cryptography.ProtectedData" -as [type]))',
  '}',
  'if (-not (Load-ProtectedData)) {',
  '  $lang = ""',
  '  try { $lang = [string]($PSStyle -ne $null) } catch { }',
  '  try { $mode = [string]((Get-Command -Name Add-Type).ScriptBlock) ; } catch { $mode = "unknown" }',
  '  Fail "assembly" "ProtectedData type is unavailable under this PowerShell runtime; Add-Type is blocked or the assembly is missing (language mode may be Constrained)."',
  '}',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  'if (-not $b64) { Fail "input" "No ciphertext on stdin" }',
  'try { $bytes=[Convert]::FromBase64String($b64) } catch { Fail "input" "Ciphertext is not valid base64" }',
  'try {',
  '  $plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '} catch {',
  '  $hr = ""',
  '  try { $hr = $_.Exception.HResult.ToString("x8") } catch { }',
  '  Fail "unprotect" ("Unprotect failed; HResult=0x" + $hr + " " + $_.Exception.GetType().Name + ": " + $_.Exception.Message)',
  '}',
  '[Console]::Out.WriteLine("DEVADPAPI ok")',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('\n')

/**
 * 自检脚本：用固定假字符串做 protect→unprotect 往返（**不碰用户密文**），同时采集环境事实。
 * 输出同样是前导行 + JSON，便于稳定解析；不含任何用户数据。
 */
const SELFCHECK_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'function Emit([string]$text) { [Console]::Out.Write($text) }',
  'function Load-ProtectedData {',
  '  if ($null -ne ("System.Security.Cryptography.ProtectedData" -as [type])) { return $true }',
  '  foreach ($name in @("System.Security.Cryptography.ProtectedData", "System.Security")) {',
  '    try { Add-Type -AssemblyName $name; continue } catch { }',
  '  }',
  '  return ($null -ne ("System.Security.Cryptography.ProtectedData" -as [type]))',
  '}',
  '$info = [ordered]@{ runtime="unknown"; version=""; user=""; machine=$env:COMPUTERNAME; session=""; assembly=$false; roundtrip=$false; languageMode="" }',
  'try { $info.runtime = if ($PSVersionTable.PSEdition -eq "Core") { "pwsh" } else { "windows-powershell" } } catch { }',
  'try { $info.version = [string]$PSVersionTable.PSVersion } catch { }',
  'try { $info.user = [string](whoami.exe 2>$null) } catch { }',
  'try { $info.languageMode = [string]$ExecutionContext.SessionState.LanguageMode } catch { }',
  '$info.assembly = [bool](Load-ProtectedData)',
  'if ($info.assembly) {',
  '  try {',
  '    $probe = [System.Text.Encoding]::UTF8.GetBytes("devadpapi-selfcheck-fixture")',
  '    $enc = [System.Security.Cryptography.ProtectedData]::Protect($probe,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '    $ok = [System.Text.Encoding]::UTF8.GetString($dec) -eq "devadpapi-selfcheck-fixture"',
  '    $info.roundtrip = [bool]$ok',
  '  } catch { $info.roundtrip = $false }',
  '}',
  'Emit ("DEVADPAPI selfcheck")',
  'Emit ("`n" + (($info | ConvertTo-Json -Compress)))',
].join('\n')

/**
 * 服务端到底在哪台机器/哪个身份里跑？决定「DPAPI 能否解」的**首要观测点**：
 * 容器内、WSL、或与桌面不同 OS 用户时，桌面写出的 CurrentUser 密文在这台进程里不可解。
 * 只读环境变量与少量文件特征，不产生任何外部命令副作用。
 */
export function detectContainer(env = process.env) {
  const flags = []
  if (env.KUBERNETES_SERVICE_HOST) flags.push('kubernetes')
  if (env.container || env.CONTAINER) flags.push('container-env')
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) flags.push('wsl')
  try {
    if (readFileSync('/proc/1/cgroup', 'utf8').includes('docker')) flags.push('docker-cgroup')
  } catch { /* 非 Linux 或不可读：不是判定依据 */ }
  try {
    if (readFileSync('/proc/sys/kernel/osrelease', 'utf8').toLowerCase().includes('microsoft')) flags.push('wsl-kernel')
  } catch { /* 同上 */ }
  return flags.length ? flags.join(',') : ''
}

/**
 * 读桌面 secrets.json 的**所有者**与 ACL 是否可读（Windows）。
 * 归属是判断「这份 DPAPI 密文是不是这个进程的用户存的」最直接的外部证据；
 * 只输出 `DOMAIN\user` 与 bool，不含文件内容。
 */
const ACL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'try {',
  '  $p=[Console]::In.ReadToEnd().Trim()',
  '  $o=(Get-Acl -LiteralPath $p).Owner',
  '  [Console]::Out.WriteLine("DEVADPAPI aclok")',
  '  [Console]::Out.Write($o)',
  '} catch {',
  '  [Console]::Out.WriteLine("DEVADPAPI aclfail")',
  '}',
].join('\n')

const ownerCache = new Map()

export function probeFileOwner(path, { platform = process.platform, spawn = runPowerShell, binary = 'powershell.exe', timeoutMs = 8000 } = {}) {
  if (!path) return { ok: false, code: 'no-path', owner: '' }
  // POSIX（macOS/Linux）：直接看“当前进程能不能读”，再看属主 uid；不要拿 Windows ACL 去判。
  // 之前这里对非 Windows 一律返回 platform-unsupported，导致 macOS 上明明能读的文件被标成
  // aclReadable=false（用户在 /Users/fanchunchun/.deva/config.json 上已证明可读）。
  if (platform !== 'win32') {
    const cachedPosix = ownerCache.get(path)
    if (cachedPosix) return cachedPosix
    let outcome
    try {
      const stat = statSync(path)
      const uid = typeof process.getuid === 'function' ? process.getuid() : null
      let readable = false
      try { accessSync(path, constants.R_OK); readable = true } catch { readable = false }
      outcome = { ok: readable, readable, owner: `uid:${stat.uid}`, uid: stat.uid, mode: stat.mode & 0o777, self: uid === null ? null : stat.uid === uid }
    } catch (error) {
      outcome = { ok: false, readable: false, owner: '', code: error?.code || 'stat-failed' }
    }
    ownerCache.set(path, outcome)
    return outcome
  }
  const cached = ownerCache.get(path)
  if (cached) return cached
  const result = spawn(binary, ACL_SCRIPT, String(path), timeoutMs)
  let outcome
  if (!result || result.error) outcome = { ok: false, code: result?.error?.code === 'ENOENT' ? DESKTOP_DECRYPT_CODES.TOOL_MISSING : DESKTOP_DECRYPT_CODES.DPAPI_FAILED, owner: '' }
  else {
    const split = splitScriptOutput(result.stdout)
    outcome = split.marker === 'aclok'
      ? { ok: true, owner: String(split.rest || '').trim().slice(0, 200) }
      : { ok: false, code: DESKTOP_DECRYPT_CODES.DPAPI_FAILED, owner: '' }
  }
  ownerCache.set(path, outcome)
  return outcome
}

export function clearDesktopAclCache() {
  ownerCache.clear()
}

function runPowerShell(binary, script, input, timeoutMs) {
  return spawnSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024,
  })
}

/** 去掉 BOM、CR、空白与 PowerShell 常见噪声行，只留可校验的纯 base64。 */
export function cleanPowerShellStdout(raw) {
  const text = String(raw || '').replace(/\uFEFF/g, '').replace(/\r/g, '')
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const kept = lines.filter(line => /^[A-Za-z0-9+/]+=*$/.test(line) && line.length % 4 === 0 && line.length > 8)
  return kept.length ? kept[kept.length - 1] : ''
}

/** 脱敏 stderr：截断、去路径细节、绝不带密文/明文/Key 片段。 */
export function redactStderr(raw, secrets = []) {
  let text = String(raw || '').replace(/\uFEFF/g, '').trim()
  if (!text) return ''
  for (const secret of secrets) {
    if (secret && text.includes(secret)) text = text.split(secret).join('[redacted]')
  }
  return text
    .replace(/(?:api[_-]?key|token|secret|password|Bearer)[^\s,;}]*/gi, '[redacted]')
    .replace(/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]')
    .split('\n').map(line => line.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300)
}

/** 从脚本输出里取 `DEVADPAPI <code>` 协议行与载荷。 */
export function splitScriptOutput(raw) {
  const text = String(raw || '').replace(/\uFEFF/g, '').replace(/\r/g, '')
  const marker = text.lastIndexOf('DEVADPAPI')
  if (marker < 0) return { marker: '', rest: '', raw: '' }
  const rest = text.slice(marker + 'DEVADPAPI'.length)
  const newline = rest.indexOf('\n')
  if (newline < 0) return { marker: rest.trim().split(/\s+/)[0] || '', rest: '', raw: '' }
  const line = rest.slice(0, newline).trim()
  return { marker: line.split(/\s+/)[0] || '', rest: rest.slice(newline + 1).trim(), raw: line }
}

function codeFromMarker(marker, stderr, selfCheckPassed) {
  if (marker === 'ok' || marker === 'selfcheck') return DESKTOP_DECRYPT_CODES.OK
  if (marker === 'assembly') return DESKTOP_DECRYPT_CODES.ASSEMBLY
  if (marker === 'input') return DESKTOP_DECRYPT_CODES.CIPHERTEXT_INVALID
  if (marker === 'unprotect') {
    const text = String(stderr || '')
    if (/ConstrainedLanguage|Constrained Language|language mode/i.test(text)) return DESKTOP_DECRYPT_CODES.LANGUAGE_MODE
    for (const [hresult, code] of Object.entries(HRESULT_CODES)) {
      if (text.toLowerCase().includes(hresult.toLowerCase())) return code
    }
    // 自检已证明本环境能解 DPAPI：此时解不开只能是归属问题。
    return selfCheckPassed ? DESKTOP_DECRYPT_CODES.FOREIGN_BLOB : DESKTOP_DECRYPT_CODES.DPAPI_FAILED
  }
  return DESKTOP_DECRYPT_CODES.DPAPI_FAILED
}

/**
 * 默认解密器：Windows DPAPI（CurrentUser）。密文经 stdin 传入，参数里只有脚本。
 *
 * 与 0.8.46 的关键差别：
 *  · **两个变体都真的试到**——只有「程序不存在」才换下一个（0.8.46 遇到第一个非 ENOENT 失败就 break，
 *    powershell.exe 一报错就再也轮不到 pwsh.exe）；
 *  · 脚本按运行时自适应程序集，所以 PS5.1 / PS7 都能落到自己的可用路径；
 *  · stdout 只取可校验的 base64（去 BOM/CR/噪声行），解析失败是**独立原因码**，不会被当成「解不开」；
 *  · 自带一次 protect→unprotect 往返自检，成功后再解不开就判定 `dpapi-foreign-blob`（归属问题）。
 *
 * 返回 `{ ok, plaintext, code, tries, selfCheck, stderr }`；失败路径**不含**任何密文或明文片段。
 */
export function createDpapiDecoder({ platform = process.platform, spawn = runPowerShell, binaries = ['powershell.exe', 'pwsh.exe'], timeoutMs = 15000, env = process.env } = {}) {
  let selfCheckState = null
  const decrypt = async ciphertextBase64 => decryptWithState(ciphertextBase64)
  decrypt.selfCheck = selfCheck
  return decrypt

  /** 自检：环境事实 + 往返是否成功；结果在进程内缓存（同一进程环境不变）。 */
  async function selfCheck(force = false) {
    if (selfCheckState && !force) return selfCheckState
    const base = { platform, container: detectContainer(env), attempts: [] }
    if (platform !== 'win32') {
      selfCheckState = { ...base, ok: false, roundsOk: false, code: DESKTOP_DECRYPT_CODES.NOT_WINDOWS, variants: [] }
      return selfCheckState
    }
    const variants = []
    let roundTripOk = false
    let roundTripRuntime = ''
    for (const binary of binaries) {
      const result = spawn(binary, SELFCHECK_SCRIPT, '', timeoutMs)
      const entry = { binary, status: result?.status ?? null, error: result?.error?.code || '' }
      if (!result || result.error) { variants.push({ ...entry, ok: false, code: result?.error?.code === 'ENOENT' ? DESKTOP_DECRYPT_CODES.TOOL_MISSING : DESKTOP_DECRYPT_CODES.DPAPI_FAILED }); continue }
      const split = splitScriptOutput(result.stdout)
      let info = null
      try { info = JSON.parse(split.rest || 'null') } catch { info = null }
      const ok = Boolean(info?.roundtrip) && Boolean(info?.assembly)
      variants.push({ ...entry, ok, runtime: info?.runtime || '', version: info?.version || '', user: info?.user || '', machine: info?.machine || '', languageMode: info?.languageMode || '', assembly: Boolean(info?.assembly), roundtrip: Boolean(info?.roundtrip) })
      if (ok) { roundTripOk = true; roundTripRuntime = info?.runtime || binary; break }
    }
    const code = roundTripOk ? DESKTOP_DECRYPT_CODES.OK
      : variants.some(v => v.error === '') && variants.length
        ? (variants.every(v => v.assembly === false) ? DESKTOP_DECRYPT_CODES.ASSEMBLY : DESKTOP_DECRYPT_CODES.ROUNDTRIP_FAILED)
        : DESKTOP_DECRYPT_CODES.TOOL_MISSING
    selfCheckState = { ...base, ok: roundTripOk, roundsOk: roundTripOk, code, runtime: roundTripRuntime, variants }
    return selfCheckState
  }

  /** 只试一次运行时的解：供内部与测试直接调用。 */
  async function decryptOnce(candidateBuffer, selfCheckResult) {
    const tries = []
    const input = Buffer.from(candidateBuffer).toString('base64')
    let sawRuntime = false
    for (const binary of binaries) {
      const result = spawn(binary, POWERSHELL_SCRIPT, input, timeoutMs)
      if (!result || result.error) {
        // 只有「这个程序不存在」才换下一个；超时是环境问题，直接回报。
        if (result?.error?.code === 'ENOENT') { tries.push({ binary, code: DESKTOP_DECRYPT_CODES.TOOL_MISSING }); continue }
        const code = result?.error?.code === 'ETIMEDOUT' ? DESKTOP_DECRYPT_CODES.TIMEOUT : DESKTOP_DECRYPT_CODES.DPAPI_FAILED
        tries.push({ binary, code })
        return { ok: false, code, tries }
      }
      sawRuntime = true
      const split = splitScriptOutput(result.stdout)
      if (split.marker === 'ok') {
        const payload = cleanPowerShellStdout(split.rest)
        if (!payload) { tries.push({ binary, code: DESKTOP_DECRYPT_CODES.OUTPUT_INVALID }); continue }
        let plaintext = ''
        try { plaintext = Buffer.from(payload, 'base64').toString('utf8') } catch { plaintext = '' }
        if (!plaintext) { tries.push({ binary, code: DESKTOP_DECRYPT_CODES.EMPTY }); continue }
        tries.push({ binary, code: DESKTOP_DECRYPT_CODES.OK })
        return { ok: true, plaintext, tries, stderr: redactStderr(result.stderr, [input, payload, plaintext]) }
      }
      if (split.marker && split.marker !== 'ok' && /^[a-z]+$/i.test(split.marker)) {
        const code = codeFromMarker(split.marker.toLowerCase(), result.stderr, selfCheckResult?.ok)
        tries.push({ binary, code, stderr: redactStderr(result.stderr, [input, plaintextOf(split), payloadOf(split)]) })
        // 程序集 / 语言模式：换下一个变体有意义（PS7 有另一条装配路径）；其余是本密文的结论，换变体也一样。
        if ([DESKTOP_DECRYPT_CODES.ASSEMBLY, DESKTOP_DECRYPT_CODES.LANGUAGE_MODE].includes(code)) continue
        return { ok: false, code, tries, stderr: tries.at(-1).stderr }
      }
      if (result.status !== 0) {
        const code = /ConstrainedLanguage|Constrained Language/i.test(String(result.stderr || '')) ? DESKTOP_DECRYPT_CODES.LANGUAGE_MODE : DESKTOP_DECRYPT_CODES.DPAPI_FAILED
        tries.push({ binary, code, stderr: redactStderr(result.stderr, [input]) })
        if (code === DESKTOP_DECRYPT_CODES.LANGUAGE_MODE) continue
        return { ok: false, code, tries, stderr: tries.at(-1).stderr }
      }
      // 退出码 0 但没有协议行：输出被噪声污染，不能当成功。
      tries.push({ binary, code: DESKTOP_DECRYPT_CODES.OUTPUT_INVALID })
      continue
    }
    const code = tries.some(t => t.code !== DESKTOP_DECRYPT_CODES.TOOL_MISSING) ? tries.at(-1).code : (sawRuntime ? DESKTOP_DECRYPT_CODES.OUTPUT_INVALID : DESKTOP_DECRYPT_CODES.TOOL_MISSING)
    return { ok: false, code, tries }
  }

  async function decryptWithState(ciphertextBase64) {
    if (platform !== 'win32') return { ok: false, code: DESKTOP_DECRYPT_CODES.NOT_WINDOWS, tries: [], selfCheck: await selfCheck() }
    let buffer
    try { buffer = Buffer.from(String(ciphertextBase64 || ''), 'base64') } catch { buffer = Buffer.alloc(0) }
    if (!buffer.length) return { ok: false, code: DESKTOP_DECRYPT_CODES.CIPHERTEXT_INVALID, tries: [], selfCheck: await selfCheck() }
    const head = buffer.subarray(0, 3).toString('ascii')
    const candidates = [buffer]
    if (head === 'v10' || head === 'v11' || head === 'v20') candidates.push(buffer.subarray(3))
    const status = await selfCheck()
    let last = { ok: false, code: DESKTOP_DECRYPT_CODES.DPAPI_FAILED, tries: [] }
    for (const candidate of candidates) {
      last = await decryptOnce(candidate, status)
      if (last.ok) return { ...last, prefix: ['v10', 'v11', 'v20'].includes(head) && candidate !== buffer ? head : '', selfCheck: status }
      // 工具链坏了：再换前缀也没用，直接回报。
      if (isToolchainFailure(last.code)) return { ...last, selfCheck: status }
    }
    // 归因只有两种，必须分开：
    //  · 自检成功 → 本环境能解 DPAPI，这一个 blob 解不开只能是归属问题（别的用户/机器）；
    //  · 自检失败 → 是本环境的工具链坏了，报自检自己的原因码，不让人去查密钥。
    if (status.ok) last.code = DESKTOP_DECRYPT_CODES.FOREIGN_BLOB
    else if ([DESKTOP_DECRYPT_CODES.DPAPI_FAILED, DESKTOP_DECRYPT_CODES.FOREIGN_BLOB].includes(last.code)) {
      last.code = status.code || DESKTOP_DECRYPT_CODES.ROUNDTRIP_FAILED
    }
    return { ...last, selfCheck: status }
  }
}

/** 从 split 结果里取明文/载荷的安全占位（只用于脱敏，不落盘）。 */
function payloadOf(split) { return cleanPowerShellStdout(split?.rest) }
function plaintextOf(split) {
  try { return Buffer.from(payloadOf(split), 'base64').toString('utf8') } catch { return '' }
}

/**
 * 默认解码器的进程级单例（按平台选实现）：
 *  · win32 → DPAPI（PowerShell）
 *  · darwin → macOS Keychain + Chromium OSCrypt v10（纯 Node：security CLI + PBKDF2 + AES-128-CBC）
 *  · 其它（Linux）→ 明确的 platform-unsupported（Linux 桌面用 libsecret/kwallet，不在本插件范围）
 * 自检与 ACL 探测结果在进程内复用，避免每次解析都重跑外部命令。
 */
let defaultDecoder = null
export function defaultDpapiDecoder() {
  if (!defaultDecoder) defaultDecoder = createDefaultDesktopDecoder()
  return defaultDecoder
}

export function createDefaultDesktopDecoder({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') return createMacKeychainDecoder({ platform })
  if (platform === 'win32') {
    const dpapi = createDpapiDecoder({ platform })
    // Windows 的 safeStorage 是 v10 AES-256-GCM + Local State 里的 DPAPI 密钥；
    // createDpapiDecoder 只保留为 DPAPI 工具链自检与 legacy 裸 blob 的底层实现。
    return createWindowsSafeStorageDecoder({ platform, env, dpapiSelfCheck: dpapi.selfCheck })
  }
  return createDpapiDecoder({ platform })
}

/** 明文只在内存里放一小会儿：按密文摘要缓存，有上限、有失效；进程退出即消失。 */
const cache = new Map()

export function clearDesktopKeyCache() {
  cache.clear()
}

function cacheKey(path, ciphertext) {
  return createHash('sha256').update(path).update('\0').update(ciphertext).digest('hex')
}

function lookupCache(key, now) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires <= now) { cache.delete(key); return null }
  // 触碰即刷新 LRU 顺序（Map 保持插入顺序）。
  cache.delete(key); cache.set(key, hit)
  return hit.plaintext
}

function storeCache(key, plaintext, now, ttlMs, maxEntries) {
  cache.set(key, { plaintext, expires: now + ttlMs })
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
}

/**
 * 解析某 provider 在桌面端保存的密钥。
 * 返回元数据 + 可选明文；明文只用于当前这一次请求，**调用方不得持久化**。
 *
 * @param {{ config?: object, providerId?: string, decrypt?: Function, now?: Function, ttlMs?: number, maxEntries?: number }} options
 */
export async function resolveDesktopCredential({ config = {}, providerId, decrypt = defaultDpapiDecoder(), now = Date.now, ttlMs = 5 * 60_000, maxEntries = 8 } = {}) {
  let file
  try {
    file = readDesktopSecrets(config)
  } catch (error) {
    return { status: 'error', code: (error?.code || 'root-unavailable'), path: '', exists: null, entryCount: null, present: false, plaintext: '' }
  }
  const base = {
    path: file.path,
    source: file.source,
    exists: file.exists,
    size: file.size ?? null,
    structure: file.structure,
    code: file.code,
    entryCount: file.structure === 'ok' ? Object.keys(file.entries).length : null,
    ...(file.structure === 'ok' ? { structureDetail: desktopSecretsStructure(file) } : {}),
  }
  if (!file.exists) return { status: 'missing-file', ...base, present: false, plaintext: '' }
  const acl = probeFileOwner(file.path)
  base.fileOwner = acl.ok ? acl.owner : ''
  base.aclReadable = acl.ok
  if (file.structure !== 'ok') return { status: 'unreadable', ...base, present: false, plaintext: '' }
  const ciphertext = desktopCiphertext(file, providerId)
  if (!ciphertext) return { status: 'missing', ...base, present: false, plaintext: '' }
  const key = cacheKey(file.path, ciphertext)
  const cached = lookupCache(key, now())
  if (cached) return { status: 'decrypted', ...base, present: true, cached: true, plaintext: cached }
  let result
  try {
    result = await decrypt(ciphertext)
  } catch {
    result = { ok: false, code: DESKTOP_DECRYPT_CODES.DPAPI_FAILED }
  }
  const health = credentialHealth(result?.selfCheck)
  const processUser = health?.user || (() => { try { return userInfo().username } catch { return '' } })()
  const processMachine = health?.machine || hostname()
  // `DOMAIN\user` 里的前缀只有等于本机名时才能当 machine 用；域账号不能拿域名当机器名。
  const ownerMachine = acl.owner?.includes('\\') ? acl.owner.split('\\')[0] : ''
  const fileMachine = ownerMachine && normalizeAccount(ownerMachine) === normalizeAccount(processMachine) ? ownerMachine : ''
  const ownership = classifyOwnership({ fileOwner: acl.owner, processUser, fileMachine, processMachine })
  base.selfCheck = health
  base.ownership = ownership
  base.localStateTried = health?.localStateTried || []
  if (!result?.ok) {
    const finalCode = ownership.sameMachine && ownership.sameUser === false ? 'foreign-blob-proven' : (result?.code || DESKTOP_DECRYPT_CODES.DPAPI_FAILED)
    return {
      status: 'undecryptable', ...base, present: true, cached: false, plaintext: '',
      decryptCode: finalCode,
      toolchainBroken: isToolchainFailure(result?.code),
      ...(result?.localState ? { localState: result.localState } : {}),
      ...(result?.v10 !== undefined ? { v10: Boolean(result.v10) } : {}),
      ...(ownership.sameMachine && ownership.sameUser === false ? { foreignProven: true } : {}),
      selfCheck: credentialHealth(result?.selfCheck),
      stderr: result?.stderr || '',
    }
  }
  storeCache(key, result.plaintext, now(), ttlMs, maxEntries)
  return { status: 'decrypted', ...base, present: true, cached: false, prefix: result.prefix || '', plaintext: result.plaintext, selfCheck: credentialHealth(result?.selfCheck) }
}

/**
 * 页面可展示的自检摘要：只留「环境是否具备解密能力」与身份事实。
 * 不含任何密文/明文；stderr 单独脱敏后放在 credential.stderr。
 */
export function credentialHealth(selfCheck) {
  if (!selfCheck) return null
  const variants = (selfCheck.variants || []).map(item => ({
    binary: item.binary,
    ...(item.service ? { service: item.service } : {}),
    ...(item.account ? { account: item.account } : {}),
    ok: Boolean(item.ok),
    runtime: item.runtime || '',
    version: item.version || '',
    user: item.user || '',
    machine: item.machine || '',
    languageMode: item.languageMode || '',
    assembly: Boolean(item.assembly),
    roundtrip: Boolean(item.roundtrip),
    code: item.code || '',
  }))
  const usable = variants.find(item => item.ok) || variants[0] || {}
  return {
    platform: selfCheck.platform,
    container: selfCheck.container || '',
    ok: Boolean(selfCheck.ok),
    code: selfCheck.code || '',
    runtime: selfCheck.runtime || '',
    ...(selfCheck.localState ? { localState: selfCheck.localState } : {}),
    ...(selfCheck.keychain ? { keychain: selfCheck.keychain } : {}),
    ...(selfCheck.localStateTried ? { localStateTried: selfCheck.localStateTried } : {}),
    ...(selfCheck.dpapi ? { dpapi: selfCheck.dpapi } : {}),
    ...(selfCheck.service ? { service: selfCheck.service } : {}),
    ...(selfCheck.account ? { account: selfCheck.account } : {}),
    ...(selfCheck.roundtrip !== undefined ? { roundtrip: Boolean(selfCheck.roundtrip) } : {}),
    user: usable.user || '',
    machine: usable.machine || '',
    variants,
  }
}

/**
 * 一键钥匙串诊断：只读枚举 + 密文指纹，输出可复制文本。
 * 只包含路径、用户名、条目统计、service/account、长度与前缀类型；绝不读取/输出任何 Key 值或密文。
 */
export function readKeychainDiagnostics(config = {}, { platform = process.platform, runSecurity } = {}) {
  const file = readDesktopSecrets(config)
  const structure = desktopSecretsStructure(file)
  const lines = []
  let user = ''
  let machine = ''
  try { user = userInfo().username } catch { /* diagnostics only */ }
  try { machine = hostname() } catch { /* diagnostics only */ }
  lines.push(`platform: ${platform}`)
  lines.push(`user: ${user || 'unknown'}`)
  lines.push(`machine: ${machine || 'unknown'}`)
  lines.push(`secrets: ${file.path} (exists=${file.exists}, size=${file.size ?? 'unknown'}, structure=${file.structure}, entries=${structure?.entryCount ?? 'unknown'})`)
  if (structure) {
    for (const entry of structure.entries) {
      lines.push(`entry: key=${entry.key} keyLength=${entry.keyLength} valueChars=${entry.valueChars} decodedBytes=${entry.decodedBytes ?? 'unknown'} prefix=${entry.prefix} likelyFormat=${entry.likelyFormat}`)
    }
  }
  if (platform !== 'darwin') {
    lines.push('keychain: (not macOS; skipped)')
    return { text: lines.join('\n') }
  }
  const keychain = collectKeychainEntries({ ...(runSecurity ? { runSecurity } : {}) })
  lines.push(`keychains: ${keychain.paths.length ? keychain.paths.join(' | ') : '(none)'}`)
  lines.push(`defaultKeychain: ${keychain.defaultKeychain || '(unknown)'}`)
  lines.push(`genericPasswordsTotal: ${keychain.totalGenericPasswords}`)
  lines.push(`matchedDevaSafeStorage: ${keychain.matched}`)
  for (const entry of keychain.entries) lines.push(`keychainEntry: service=${entry.service || ''} account=${entry.account || ''} keychain=${entry.keychain}`)
  for (const error of keychain.errors) lines.push(`keychainError: ${error.keychain} code=${error.code}`)
  const formats = (structure?.entries || []).map(entry => entry.likelyFormat)
  if (formats.includes('win-gcm')) {
    lines.push('fingerprint: v10 payload looks like Windows AES-256-GCM; macOS cannot decrypt it (different cipher) — re-save on this Mac or fill once in the model page.')
  } else if (formats.length && formats.every(format => format === 'ambiguous')) {
    lines.push('fingerprint: v10 length is ambiguous (mac-cbc/win-gcm both possible); platform + keychain hit decides.')
  }
  return { text: lines.join('\n') }
}

/** 页面/诊断用的**脱敏**视图：只有元数据与结论，绝不含密文或明文。 */
export function publicDesktopCredential(credential) {
  if (!credential) return null
  const { plaintext, ...rest } = credential
  void plaintext
  return rest
}
