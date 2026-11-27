import { writeUiTrace } from './ui-trace.mjs'
import { callModel } from './model.mjs'
import { ModelInputError, requestCustomModel } from './custom-model-network.mjs'
import { DESKTOP_DECRYPT_CODES, MAC_CODES, WIN_CODES, isToolchainFailure } from './desktop-secrets.mjs'
import { isMacToolchainFailure } from './macos-keychain.mjs'
import { resolveCustomEndpoint } from './model-selection.mjs'

const noop = async () => {}
const reflectedKeyError = () => new Error('自定义模型 API 响应回显了密钥；已拦截，未回退')

// Do not expose an echoed key in displayed deltas, even when split across SSE frames.
function protectDelta(callback, key) {
  let tail = ''
  return {
    async emit(text) {
      const value = tail + text
      if (value.includes(key)) throw reflectedKeyError()
      let keep = Math.min(value.length, key.length - 1)
      while (keep && !key.startsWith(value.slice(-keep))) keep--
      tail = keep ? value.slice(-keep) : ''
      if (value.length > keep) await callback(value.slice(0, value.length - keep))
    },
    async flush() { if (tail) await callback(tail) },
  }
}

// 上游以 400/422 拒绝且本轮带了强度：指明是哪个参数、去哪里改；不去掉参数重试。
function effortRejected(error, reasoningEffort) {
  if (!reasoningEffort || !/HTTP (400|422)；/.test(error.message)) return error
  return new Error(`${error.message}；本轮请求带了模型强度 reasoning_effort=${reasoningEffort}，上游可能不支持该档位，请在 Deva 模型设置页把「模型强度」改为默认或其它档位后重试`)
}

/**
 * 直连前的审批提示：把「哪个地址、为什么被拦、到哪里批」写在报错里。
 *
 * 这里的门槛只管**发请求**；读页面、镜像桌面已有选择不受它约束（见 model-selection 的说明）。
 * 抛原始 `ModelInputError`，只补一句可操作下一步；不吞掉 code，方便上层与页面复用。
 */
function approvalHint(error, baseUrl) {
  if (!(error instanceof ModelInputError) || error.code !== 'confirmation-required') return error
  const hint = `${baseUrl} 是本机、内网或 HTTP 地址，Deva 直连前需要 Studio 管理员批准：请把完整地址 ${baseUrl} 加入插件配置 modelTrustedBases 后重试。这是安全策略，页面不能自行批准。管理员入口：管理插件 → Deva 详情 → 配置 → modelTrustedBases（JSON 数组追加，保留原地址）→ 保存。`
  const wrapped = new ModelInputError(error.field, error.code, hint)
  wrapped.cause = error
  return wrapped
}

/** Uses only the selected endpoint and its own key, never the scoped lease or Studio Model API. */
export function createCustomModel(run, { baseUrl, modelName, apiKey, reasoningEffort = '', credentialSource = '', credentialDiagnostics = null }) {
  let endpoint
  try { endpoint = resolveCustomEndpoint(run, baseUrl) } catch (error) { throw approvalHint(error, baseUrl) }
  // 401 报错要说清「Key 从哪来」：插件侧、桌面只读、还是根本没有——三者的下一步完全不同。
  const authHint = () => {
    if (!apiKey) {
      const desktop = credentialDiagnostics?.desktop
      const code = credentialDiagnostics?.decryptCode || desktop?.decryptCode || ''
      const where = desktop?.path ? `桌面 secrets.json 已读取（${desktop.path}，条目=${desktop.entryCount ?? 0}）` : '桌面 secrets.json 未读取到'
      let why = '插件侧与桌面端都没有该提供方的密钥'
      if (credentialDiagnostics?.reason === 'decrypt-failed') {
        if (code === DESKTOP_DECRYPT_CODES.FOREIGN_BLOB) {
          why = `桌面有该提供方密文，但这份密文不是当前 Studio 进程这个 Windows 用户/这台机器存的（本机 DPAPI 自检通过；该 blob 解不开）`
        } else if (WIN_CODES.LOCAL_STATE_MISSING === code) {
          why = '桌面有该提供方密文，但没找到桌面端的 Local State（无法取得 safeStorage 的 AES 密钥）'
        } else if (WIN_CODES.ENCRYPTED_KEY_INVALID === code) {
          why = '桌面有该提供方密文，但 Local State 的 os_crypt.encrypted_key 缺失或不是 DPAPI 格式'
        } else if (WIN_CODES.KEY_UNPROTECT_FAILED === code) {
          why = '桌面有该提供方密文，但 Local State 的 DPAPI 密钥解不开（当前 Windows 用户/机器与桌面端不一致或文件损坏）'
        } else if (WIN_CODES.GCM_AUTH_FAILED === code) {
          why = '桌面有该提供方密文，但 v10 载荷的 AES-GCM 校验失败（Local State 密钥与密文不匹配）'
        } else if (WIN_CODES.BLOB_NOT_DPAPI === code || code === 'foreign-blob-proven') {
          why = code === 'foreign-blob-proven'
            ? '桌面有该提供方密文，且已确认是同一台机器上另一个 Windows 用户存的密文（DPAPI 无法跨用户解密）'
            : '桌面有该提供方密文，但它既不是 v10（safeStorage）也不是合法 DPAPI blob（参数无效）；归属未确认'
        } else if (MAC_CODES.ITEM_MISSING === code) {
          why = '桌面有该提供方密文，但 macOS 钥匙串里没有对应的 Safe Storage 条目'
        } else if (MAC_CODES.DENIED === code || MAC_CODES.NO_SESSION === code || MAC_CODES.TIMEOUT === code) {
          why = `桌面有该提供方密文，但读取 macOS 钥匙串需要授权而本次未获允许（${code}）`
        } else if (MAC_CODES.SECURITY_MISSING === code || MAC_CODES.KEYCHAIN_ERROR === code) {
          why = `桌面有该提供方密文，但本机 macOS 钥匙串工具不可用（${code}）`
        } else if (MAC_CODES.KEY_MISMATCH === code) {
          why = '桌面有该提供方密文，但钥匙串里的 Safe Storage 密钥与它不匹配（桌面端可能重装/换签名后生成了新密钥）'
        } else if (isMacToolchainFailure(code)) {
          why = `桌面有该提供方密文，但当前平台无法解密（${code}）`
        } else if (isToolchainFailure(code) || code === DESKTOP_DECRYPT_CODES.NOT_WINDOWS) {
          why = `桌面有该提供方密文，但本机没有可用的解密工具链（${code}）${credentialDiagnostics?.selfCheck?.container ? `；运行环境 ${credentialDiagnostics.selfCheck.container}` : ''}`
        } else {
          why = `桌面有该提供方密文但解不开（${code || '未知原因'}）`
        }
      } else if (credentialDiagnostics?.reason === 'desktop-unreadable') {
        why = `桌面 secrets.json 不可用（${desktop?.code || '未知'}）`
      }
      return `${why}；${where}。请在 Deva → 模型填写该提供方的 API Key（会保存到 Studio 账号级，换 Profile/重启都保留）`
    }
    if (credentialSource === 'desktop') {
      return '本次使用的 Key 来自桌面端 secrets.json（只读、未复制进 Studio），上游拒绝了它：请在桌面端更新该提供方的 Key，或在此处手动覆盖'
    }
    return '本次使用的 Key 由 Studio 侧保存，上游拒绝了它：请在 Deva → 模型更新该提供方的 Key'
  }
  return async ({ onDelta = noop, onReasoning = noop, ...options }) => {
    const text = apiKey ? protectDelta(onDelta, apiKey) : null
    const reasoning = apiKey ? protectDelta(onReasoning, apiKey) : null
    const result = await callModel({
      ...options, apiMode: 'chat_completions', model: { model: modelName, ...(reasoningEffort ? { reasoningEffort } : {}) }, baseUrl, token: apiKey,
      chatRequest: request => {
        // Observe only routing metadata from the actual serialized request, never headers or messages.
        try {
          const body = JSON.parse(request.body)
          writeUiTrace({ side: 'server', phase: 'model-request', method: 'chat-completions',
            modelName: body.model, reasoningEffort: body.reasoning_effort || 'omitted',
            userId: run.identity?.userId, profile: run.identity?.profile })
        } catch { /* Diagnostics must not prevent inference. */ }
        return requestCustomModel(endpoint, request).catch(error => { throw /HTTP (401|403)；/.test(error.message)
        ? new Error(`${error.message}；${authHint()}`)
        : effortRejected(error, reasoningEffort) })
      },
      onDelta: text?.emit ?? onDelta,
      onReasoning: reasoning?.emit ?? onReasoning,
    })
    if (apiKey && (result.text.includes(apiKey) || JSON.stringify(result.toolCalls).includes(apiKey))) throw reflectedKeyError()
    await text?.flush()
    await reasoning?.flush()
    return result
  }
}
