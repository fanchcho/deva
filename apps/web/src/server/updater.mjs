/**
 * 上游 Git 提交检查：只提示，不自动更新。
 *
 * 场景是 Docker 部署：镜像里的代码在 build 时固化，运行期改不了。
 * 所以这里只做三件事：查 GitHub 上目标 ref 的最新提交、和当前构建的
 * commit 比对、把结果交给管理页 / 主界面角标 / 可选 webhook。
 *
 * 任何网络/解析错误都只写进 state.error，不允许把服务搞崩。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_API = 'https://api.github.com'
const KINDS = new Set(['json', 'slack', 'discord', 'telegram'])

export function shortSha(value) {
  const raw = String(value ?? '')
  return raw.length >= 7 ? raw.slice(0, 7) : raw
}

function sameCommit(a, b) {
  if (!a || !b) return false
  const x = String(a).toLowerCase()
  const y = String(b).toLowerCase()
  return x === y || x.startsWith(y) || y.startsWith(x)
}

export class UpdateChecker {
  constructor({
    repo,
    ref = 'main',
    current = '',
    apiBase = DEFAULT_API,
    token = '',
    webhook = '',
    webhookKind = 'json',
    telegramChatId = '',
    intervalMs = 30 * 60_000,
    stateFile = '',
    onLog = () => {},
    onWarn = () => {}
  } = {}) {
    this.repo = repo
    this.ref = ref
    this.current = current
    this.apiBase = String(apiBase).replace(/\/+$/, '')
    this.token = token
    this.webhook = webhook
    this.webhookKind = KINDS.has(webhookKind) ? webhookKind : 'json'
    this.telegramChatId = telegramChatId
    this.intervalMs = intervalMs
    this.stateFile = stateFile
    this.onLog = onLog
    this.onWarn = onWarn
    this.timer = null
    this.inFlight = null
    this.lastNotified = this.#loadState()
    this.state = {
      repo,
      ref,
      current,
      currentShort: shortSha(current),
      latest: '',
      latestShort: '',
      updateAvailable: false,
      aheadBy: 0,
      relation: 'unknown', // unknown | current | behind | diverged
      checkedAt: '',
      error: '',
      latestMessage: '',
      latestDate: '',
      commitUrl: '',
      compareUrl: `https://github.com/${repo}/compare/`,
      intervalMinutes: Math.round(intervalMs / 60_000),
      webhookEnabled: Boolean(webhook)
    }
  }

  snapshot() {
    return { ...this.state }
  }

  start() {
    if (this.timer) return
    const tick = () => {
      this.check().catch(() => {})
    }
    tick()
    if (this.intervalMs > 0) {
      this.timer = setInterval(tick, this.intervalMs)
      this.timer.unref?.()
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 手动或定时触发；并发调用共享同一个请求。 */
  check() {
    if (!this.inFlight) {
      this.inFlight = this.#run().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  async #run() {
    const checkedAt = new Date().toISOString()
    try {
      const latest = await this.#request(`${this.apiBase}/repos/${this.repo}/commits/${encodeURIComponent(this.ref)}`)
      const sha = String(latest?.sha ?? '')
      if (!sha) throw new Error('上游响应缺少 sha')

      this.state.latest = sha
      this.state.latestShort = shortSha(sha)
      this.state.latestMessage = String(latest?.commit?.message ?? '').split('\n')[0].slice(0, 200)
      this.state.latestDate = String(latest?.commit?.author?.date ?? latest?.commit?.committer?.date ?? '')
      this.state.commitUrl = String(latest?.html_url ?? `https://github.com/${this.repo}/commit/${sha}`)
      this.state.compareUrl = `https://github.com/${this.repo}/compare/${this.current || sha}...${sha}`
      this.state.error = ''

      if (!this.current) {
        this.state.relation = 'unknown'
        this.state.updateAvailable = false
        this.state.aheadBy = 0
      } else if (sameCommit(this.current, sha)) {
        this.state.relation = 'current'
        this.state.updateAvailable = false
        this.state.aheadBy = 0
      } else {
        await this.#compare(sha)
      }

      this.state.checkedAt = checkedAt
      if (this.state.updateAvailable && this.state.latest !== this.lastNotified) {
        await this.#notify().catch((error) => this.onWarn(`[update] webhook 失败: ${error?.message ?? error}`))
        this.lastNotified = this.state.latest
        this.#saveState()
      }
      this.onLog(
        this.state.updateAvailable
          ? `[update] new commit ${this.state.latestShort} (current ${this.state.currentShort || 'unknown'}${this.state.aheadBy ? `, +${this.state.aheadBy}` : ''})`
          : `[update] up to date at ${this.state.latestShort}`
      )
    } catch (error) {
      this.state.checkedAt = checkedAt
      this.state.error = String(error?.message ?? error).slice(0, 300)
      this.onWarn(`[update] 检查失败: ${this.state.error}`)
    }
    return this.snapshot()
  }

  /**
   * 用 compare API 判断当前 commit 是不是落后于目标 ref。
   * 这一步是为了正确处理「镜像固定在某个旧 commit」：只比 sha 是否相等
   * 会让旧构建永远显示有更新，无法区分「落后」和「分叉」。
   * compare 拿不到时退化成 sha 不等即有更新。
   */
  async #compare(latest) {
    const url = `${this.apiBase}/repos/${this.repo}/compare/${encodeURIComponent(this.current)}...${encodeURIComponent(this.ref)}`
    try {
      const data = await this.#request(url)
      const status = String(data?.status ?? '')
      if (data?.html_url) this.state.compareUrl = String(data.html_url)
      if (status === 'identical' || status === 'behind') {
        // behind：base 在 head 之后，说明镜像里的代码比上游还新
        this.state.relation = 'current'
        this.state.updateAvailable = false
        this.state.aheadBy = 0
        return
      }
      if (status === 'ahead' || status === 'diverged') {
        this.state.relation = status === 'diverged' ? 'diverged' : 'behind'
        this.state.updateAvailable = true
        this.state.aheadBy = Number(data?.ahead_by ?? data?.commits?.length ?? 0) || 0
        return
      }
      throw new Error(`compare 返回未知状态 ${status || '(empty)'}`)
    } catch (error) {
      this.state.relation = 'behind'
      this.state.updateAvailable = !sameCommit(this.current, latest)
      this.state.aheadBy = 0
      this.onWarn(`[update] compare 回退到 sha 比较: ${error?.message ?? error}`)
    }
  }

  async #request(url) {
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'deva-web-update-checker'
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub ${res.status} ${res.statusText}${body ? `: ${body.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
    }
    return res.json()
  }

  #text() {
    const lines = [
      'Deva Web 有新版本可更新',
      `仓库: ${this.repo} (${this.ref})`,
      `当前: ${this.state.currentShort || 'unknown'}`,
      `最新: ${this.state.latestShort}${this.state.aheadBy ? ` (+${this.state.aheadBy})` : ''}`,
      this.state.latestMessage ? `提交: ${this.state.latestMessage}` : '',
      `对比: ${this.state.compareUrl}`,
      `更新: docker compose pull deva-web && docker compose up -d`
    ]
    return lines.filter(Boolean).join('\n')
  }

  async #notify() {
    if (!this.webhook) return
    const text = this.#text()
    let payload
    if (this.webhookKind === 'slack') payload = { text }
    else if (this.webhookKind === 'discord') payload = { content: text }
    else if (this.webhookKind === 'telegram') payload = { chat_id: this.telegramChatId, text }
    else {
      payload = {
        text,
        repo: this.repo,
        ref: this.ref,
        current: this.state.current,
        latest: this.state.latest,
        compareUrl: this.state.compareUrl,
        message: this.state.latestMessage
      }
    }
    const res = await fetch(this.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    this.onLog(`[update] webhook 已推送 ${this.webhookKind}`)
  }

  #loadState() {
    if (!this.stateFile) return ''
    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      return String(data?.lastNotified ?? '')
    } catch {
      return ''
    }
  }

  #saveState() {
    if (!this.stateFile) return
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 })
      fs.writeFileSync(this.stateFile, JSON.stringify({ lastNotified: this.lastNotified }, null, 2), { mode: 0o600 })
    } catch (error) {
      this.onWarn(`[update] 状态写入失败: ${error?.message ?? error}`)
    }
  }
}
