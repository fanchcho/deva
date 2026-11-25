/**
 * 技能（Skills）：走 Studio 自己的技能通道，不读宿主目录、不猜文件路径。
 *
 * 渐进式披露（与桌面端一致）：
 *  · 每轮只把「已启用」技能的 name + description 注入系统提示词（便宜的清单段）；
 *  · 模型判断任务匹配某个技能后，用 skill_view 读取完整 SKILL.md 正文，再照做；
 *  · 支持文件（references/templates/scripts/assets）按需用 skill_view 的 file 参数读取。
 *
 * 数据面（已按真实接口核实，见 docs/CONTRACTS.md）：
 *  GET    /api/ekko/skills                     清单
 *  GET    /api/ekko/skills/{name}              详情（含 SKILL.md 正文）
 *  GET    /api/ekko/skills/{name}/files        支持文件清单
 *  GET    /api/ekko/skills/{name}/file?path=…  读单个支持文件
 *  POST   /api/ekko/skills                     新建（name + 完整 SKILL.md 内容）
 *  PUT    /api/ekko/skills/{name}              覆盖 SKILL.md 正文
 *  PUT    /api/ekko/skills/{name}/toggle       启停
 *  DELETE /api/ekko/skills/{name}              删除（内置技能由宿主拒绝）
 *
 * 限制如实暴露：这个通道没有「写支持文件」的接口，内置技能不可编辑；失败时把宿主原始报错
 * 交给模型，不静默降级成「假设成功」。
 */

const NAME_PATTERN = /^[a-z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/
const MAX_CONTENT_CHARS = 100000

export class SkillError extends Error {}

function hostOf(ctx) {
  const host = ctx?.host
  if (!host || typeof host.request !== 'function') {
    throw new SkillError('当前运行环境没有 Studio 宿主通道（run.host.request），无法使用技能')
  }
  return host
}

/** 宿主失败时抛出的是 HTTP 包装错误；把服务端 {ok:false,error} 的说明并入消息。 */
async function request(host, path, options = {}) {
  try {
    const payload = await host.request(path, options)
    if (payload?.ok === false) throw Object.assign(new Error('Studio rejected the request'), { body: payload })
    return payload
  } catch (error) {
    const detail = error?.body?.error?.message || error?.body?.error || error?.message || String(error)
    throw new SkillError(`技能接口调用失败（${path}）：${detail}`)
  }
}

function normalizeName(raw, { required = true } = {}) {
  const name = String(raw ?? '').trim()
  if (!name) {
    if (required) throw new SkillError('name 不能为空')
    return ''
  }
  if (!NAME_PATTERN.test(name)) {
    throw new SkillError(`技能名不合法：${name}（最多 64 个字符，只能用字母、数字、下划线、短横线，且首尾为字母或数字）`)
  }
  return name
}

function normalizeContent(raw) {
  const content = String(raw ?? '')
  if (!content.trim()) throw new SkillError('content 不能为空：需要完整的 SKILL.md（含 frontmatter 与正文）')
  if (content.length > MAX_CONTENT_CHARS) throw new SkillError(`技能正文过长（${content.length} 字符，上限 ${MAX_CONTENT_CHARS}）`)
  if (!content.startsWith('---')) throw new SkillError('SKILL.md 必须以 YAML frontmatter 开头（第一行是 ---，并在其后声明 name 与 description）')
  return content
}

function pickSkill(payload) {
  const skill = payload?.skill
  if (!skill || typeof skill !== 'object' || typeof skill.name !== 'string') {
    throw new SkillError('技能接口返回了无法识别的结构（缺少 skill.name）')
  }
  return skill
}

/** 全部技能（含未启用）。只做形状校验，扩展字段原样保留给调用方。 */
export async function listSkills(host, { query } = {}) {
  const payload = await request(hostOf({ host }), '/api/ekko/skills', {
    ...(query ? { query: { query } } : {}),
  })
  if (!Array.isArray(payload?.skills)) throw new SkillError('技能接口返回了无法识别的结构（缺少 skills 数组）')
  const skills = payload.skills
  return skills.filter(item => item && typeof item.name === 'string')
}

/** 单个技能详情：含 SKILL.md 正文。 */
export async function readSkill(host, name) {
  const target = normalizeName(name)
  const skill = pickSkill(await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}`))
  if (skill.validationStatus === 'invalid') throw new SkillError(`技能无效：${skill.validationError || skill.error || target}`)
  if (typeof skill.content !== 'string' || !skill.content.trim()) throw new SkillError(`技能接口返回了无法识别的结构（${target} 缺少 content）`)
  return skill
}

/** 技能的支持文件清单。 */
export async function listSkillFiles(host, name) {
  const target = normalizeName(name)
  const payload = await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}/files`)
  if (!Array.isArray(payload?.files)) throw new SkillError('技能接口返回了无法识别的结构（缺少 files 数组）')
  return payload.files
}

/** 读一个支持文件；path 由宿主校验（只允许技能文件夹内的相对路径）。 */
export async function readSkillFile(host, name, path) {
  const target = normalizeName(name)
  const filePath = String(path ?? '').trim()
  if (!filePath) throw new SkillError('file 不能为空（相对技能文件夹的路径，例如 references/forms.md）')
  const payload = await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}/file`, {
    query: { path: filePath },
  })
  if (typeof payload?.content !== 'string') throw new SkillError(`没有读到文件内容：${filePath}`)
  return payload.content
}

/** 新建技能：content 是完整 SKILL.md，由宿主校验 frontmatter、name 与 keywords。 */
export async function createSkill(host, { name, content, category }) {
  const target = normalizeName(name)
  const body = { name: target, content: normalizeContent(content) }
  if (category) body.category = String(category).trim()
  return pickSkill(await request(hostOf({ host }), '/api/ekko/skills', { method: 'POST', body }))
}

/** 覆盖已有技能的 SKILL.md 正文（内置技能会被宿主拒绝）。 */
export async function updateSkill(host, name, content) {
  const target = normalizeName(name)
  return pickSkill(await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}`, {
    method: 'PUT',
    body: { content: normalizeContent(content) },
  }))
}

export async function toggleSkill(host, name, enabled) {
  const target = normalizeName(name)
  if (typeof enabled !== 'boolean') throw new SkillError('enabled 必须是布尔值')
  const payload = await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}/toggle`, {
    method: 'PUT',
    body: { enabled },
  })
  if (payload?.ok !== true) throw new SkillError('技能启停接口缺少 ok=true 回执')
  return { name: target, enabled }
}

export async function deleteSkill(host, name) {
  const target = normalizeName(name)
  const payload = await request(hostOf({ host }), `/api/ekko/skills/${encodeURIComponent(target)}`, { method: 'DELETE' })
  if (payload?.ok !== true) throw new SkillError('技能删除接口缺少 ok=true 回执')
  return { name: target }
}

/**
 * 系统提示词里的技能清单：只列已启用项，name + description。
 * 读不到时返回说明而不是空字符串——模型要能如实告诉用户「清单没读到」，而不是假装没有技能。
 */
export async function formatSkillListing({ host, log, loadSkills = listSkills } = {}) {
  let skills
  try {
    skills = await loadSkills(host)
  } catch (error) {
    log?.warn?.(`deva: 读取技能清单失败：${error.message}`)
    return `（技能清单本轮读取失败：${error.message}。涉及技能的任务请如实告知用户。）`
  }
  const enabled = skills.filter(item => item.enabled !== false && item.validationStatus !== 'invalid')
  if (!enabled.length) return ''
  return enabled
    .map(item => `- ${item.name}：${String(item.description || '').trim() || '（无描述）'}`)
    .join('\n')
}

const DESCRIPTION_MAX = 240

export const SKILL_TOOLS = [
  {
    name: 'skill_view',
    description: '读取一个技能的完整内容：在「可用技能」清单命中任务时调用，取回 SKILL.md 正文后严格照做。传 file 可读取该技能文件夹内的支持文件（references/、templates/、scripts/、assets/ 下的相对路径）。不传 name 时返回全部技能及其描述。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名（清单里给出的 name）；省略则列出全部技能', maxLength: 64 },
        file: { type: 'string', description: '可选：读取该技能的支持文件，相对技能文件夹的路径，例如 references/forms.md', maxLength: 300 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_manage',
    description: '创建、更新、启停或删除 Studio 里的技能。create 需要 name 与完整的 SKILL.md 内容（第一行 --- 开头的 frontmatter，含 name、description，建议带 metadata.keywords）；update 覆盖已有技能的 SKILL.md；toggle 启停；delete 删除（内置技能不可改、不可删，宿主会拒绝）。该通道不支持写入支持文件；需要附带参考文档时，如实告诉用户要到 Studio 技能页面添加。仅在用户明确要求创建或修改技能时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '要执行的操作', enum: ['create', 'update', 'toggle', 'delete'] },
        name: { type: 'string', description: '技能名：小写字母、数字、下划线或短横线，最长 64 个字符', maxLength: 64 },
        content: { type: 'string', description: 'create/update 必填：完整的 SKILL.md 文本（frontmatter + 正文）', maxLength: MAX_CONTENT_CHARS },
        enabled: { type: 'boolean', description: 'toggle 必填：true 启用、false 停用' },
        category: { type: 'string', description: 'create 可选：单层分类名', maxLength: 40 },
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
  },
]

function summarizeSkill(skill, { includeContent = false } = {}) {
  const lines = [
    `技能：${skill.name}`,
    skill.description ? `描述：${String(skill.description).slice(0, DESCRIPTION_MAX)}` : '',
    `状态：${skill.enabled === false ? '已停用' : '已启用'}${skill.builtIn ? '（内置）' : ''}${skill.category ? ` · 分类 ${skill.category}` : ''}`,
  ].filter(Boolean)
  if (includeContent && typeof skill.content === 'string') lines.push('', skill.content)
  return lines.join('\n')
}

/** 执行技能相关工具。ctx = { host, signal, log } */
export async function executeSkillTool(name, input, ctx = {}) {
  if (ctx.signal?.aborted) throw new SkillError('本轮已被取消')
  const host = hostOf(ctx)
  const args = input && typeof input === 'object' ? input : {}

  if (name === 'skill_view') {
    const target = normalizeName(args.name, { required: false })
    if (!target) {
      const skills = await listSkills(host)
      if (!skills.length) return '（Studio 里还没有任何技能）'
      return ['可用技能：', ...skills.map(item => `- ${item.name}${item.enabled === false ? '（已停用）' : ''}：${String(item.description || '').trim() || '（无描述）'}`)].join('\n')
    }
    if (args.file) {
      const content = await readSkillFile(host, target, args.file)
      return `技能「${target}」的文件 ${args.file}：\n\n${content}`
    }
    const skill = await readSkill(host, target)
    return summarizeSkill(skill, { includeContent: true })
  }

  if (name === 'skill_manage') {
    const action = String(args.action ?? '').trim()
    const target = normalizeName(args.name)
    if (action === 'create') {
      const skill = await createSkill(host, { name: target, content: args.content, category: args.category })
      return `已创建技能「${skill.name}」。\n${summarizeSkill(skill)}`
    }
    if (action === 'update') {
      const skill = await updateSkill(host, target, args.content)
      return `已更新技能「${skill.name}」的 SKILL.md。\n${summarizeSkill(skill)}`
    }
    if (action === 'toggle') {
      if (typeof args.enabled !== 'boolean') throw new SkillError('toggle 需要 enabled（true 启用、false 停用）')
      const result = await toggleSkill(host, target, args.enabled)
      return `技能「${result.name}」已${result.enabled ? '启用' : '停用'}`
    }
    if (action === 'delete') {
      const result = await deleteSkill(host, target)
      return `已删除技能「${result.name}」`
    }
    throw new SkillError(`未知操作：${action || '（空）'}（只能是 create、update、toggle、delete）`)
  }

  throw new SkillError(`未知技能工具：${name}`)
}
