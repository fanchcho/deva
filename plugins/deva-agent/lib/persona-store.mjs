/**
 * 桌面端 persona 存储：**身份内容的唯一真源**。
 *
 * 位置（与 Deva 桌面端 / py_upper 完全一致）：
 *  · `<root>/personas/<id>.md` —— frontmatter `name/description/avatar/model/workspace` + 正文提示词；
 *  · `<root>/config.json → personas.enabled[id]`、`personas.order[]` —— 启用位与手动排序。
 *
 * 插件不再保存第二份身份正文（0.8.4 的 `deva-agent/identity.json.identities` 就是那份副本，已在 0.8.5 迁移掉），
 * 只在 config.json 留「用哪个身份」的选择。这样桌面端改角色 = 插件下一轮读到的就是同一份文件，
 * 不存在定时同步或覆盖先后的问题。
 *
 * 新增登记启用和排序；编辑仅修改名称、描述和正文；`config.json` 用读-合并-比对-原子写，
 * 保留其它顶层键（models 等）与未知字段。
 */

import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  DevaIdentityError, ensurePrivateDirectory, readStrictText, resolveDevaRoot, statOrNull, writeAtomic,
} from './deva-fs.mjs'
import { composePersonaFile, editPersonaFile, isPersonaId, parseFrontmatter } from './persona-file.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function personasDir(config = {}) {
  return join(resolveDevaRoot(config), 'personas')
}

export function devaConfigPath(config = {}) {
  return join(resolveDevaRoot(config), 'config.json')
}

/** 读 `config.json`：不存在返回空对象；坏 JSON/非对象明确报错（不静默当空配置覆盖用户文件）。 */
export function readDevaConfig(config = {}) {
  const path = devaConfigPath(config)
  const file = readStrictText(path)
  if (!file) return { raw: null, value: {}, exists: false, path, repaired: false }
  let value
  try {
    value = JSON.parse(file.raw)
  } catch {
    throw new DevaIdentityError('DEVA_CONFIG_INVALID_JSON', `Deva config.json 不是合法 JSON：${path}；没有覆盖，请修正或先备份`, { path })
  }
  if (!object(value)) throw new DevaIdentityError('DEVA_CONFIG_INVALID_SHAPE', `Deva config.json 顶层应为对象：${path}`, { path })
  return { raw: file.raw, value, exists: true, path, repaired: file.repaired }
}

function parsePersona(id, raw, enabled) {
  const { data, body } = parseFrontmatter(raw)
  const prompt = body.trim()
  return {
    id,
    name: (data.name || '').trim() || id,
    description: data.description || '',
    avatar: data.avatar || '',
    model: data.model || '',
    workspace: data.workspace || '',
    prompt,
    enabled,
  }
}

/**
 * 列出身份内容。排序与桌面一致：`personas.order` 中出现的 id 按其位置在前，其余按名称排序。
 * 读不了/正文为空的文件不参与身份选择，但会记进 `problems`（不静默吞掉）。
 */
export function listPersonas(config = {}, { includeEmpty = false } = {}) {
  const root = resolveDevaRoot(config)
  const dir = join(root, 'personas')
  const cfg = readDevaConfig(config)
  const section = object(cfg.value.personas) ? cfg.value.personas : {}
  const enabled = object(section.enabled) ? section.enabled : {}
  const order = Array.isArray(section.order) ? section.order.filter(item => typeof item === 'string') : []
  const list = []
  const problems = []
  const stat = statOrNull(dir)
  if (stat) {
    if (stat.isSymbolicLink()) throw new DevaIdentityError('DEVA_PERSONAS_SYMLINK', `personas 目录不能是符号链接：${dir}`, { path: dir })
    if (!stat.isDirectory()) throw new DevaIdentityError('DEVA_PERSONAS_NOT_DIRECTORY', `personas 路径不是目录：${dir}`, { path: dir })
    for (const entry of readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith('.md')) continue
      const id = entry.slice(0, -3)
      if (!isPersonaId(id)) { problems.push({ id, reason: 'invalid-id' }); continue }
      try {
        const file = readStrictText(join(dir, entry))
        const persona = parsePersona(id, file.raw, enabled[id] === true)
        if (!persona.prompt) {
          problems.push({ id, reason: 'empty-prompt' })
          if (!includeEmpty) continue
        }
        list.push(persona)
      } catch (error) {
        problems.push({ id, reason: 'unreadable', message: error?.message ?? String(error) })
      }
    }
  }
  const rank = new Map(order.map((id, index) => [id, index]))
  list.sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  })
  return {
    list, dir, problems,
    order,
    config: cfg,
    getPersona: id => list.find(item => item.id === id) ?? null,
  }
}

/** 读一条身份内容；不存在或非法 id 返回 null。 */
export function getPersona(config, id) {
  if (!isPersonaId(id)) return null
  const path = join(personasDir(config), `${id}.md`)
  const file = readStrictText(path)
  if (!file) return null
  const cfg = readDevaConfig(config)
  const section = object(cfg.value.personas) ? cfg.value.personas : {}
  const enabled = object(section.enabled) ? section.enabled : {}
  return parsePersona(id, file.raw, enabled[id] === true)
}

/** 新建 persona 文件；**已存在则报错**，不覆盖用户/桌面已有内容。 */
export function createPersona(config, { id, name, description = '', avatar = '', model = '', workspace = '', prompt }) {
  if (!isPersonaId(id)) throw new DevaIdentityError('DEVA_PERSONA_BAD_ID', `身份 id 不合法：${String(id)}`)
  if (typeof prompt !== 'string' || !prompt.trim()) throw new DevaIdentityError('DEVA_PERSONA_EMPTY', `身份正文为空：${id}`)
  const dir = personasDir(config)
  ensurePrivateDirectory(dir)
  const path = join(dir, `${id}.md`)
  if (statOrNull(path)) throw new DevaIdentityError('DEVA_PERSONA_EXISTS', `身份文件已存在，未覆盖：${path}`, { path })
  writeAtomic(path, composePersonaFile({ name, description, avatar, model, workspace, prompt }), { expectedRaw: null })
  return { id, name, description, avatar, model, workspace, prompt: prompt.trim(), enabled: false, path }
}

const stamp = raw => createHash('sha256').update(raw).digest('hex')
const nameKey = name => name.normalize('NFKC').trim().toLowerCase()

function editableFields(config, input) {
  const { id } = input
  const name = input.name.trim()
  const description = input.description.trim()
  const prompt = input.prompt.trim()
  if (!name || !prompt) throw new DevaIdentityError('DEVA_PERSONA_FIELDS', '请填写身份名称和提示词正文')
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(input.name + input.description) || prompt.includes('\0')) {
    throw new DevaIdentityError('DEVA_PERSONA_CHARACTERS', '名称和描述必须是单行且不含控制字符；提示词不可含 NUL')
  }
  const { list } = listPersonas(config, { includeEmpty: true })
  const key = nameKey(name)
  if (list.find(persona => persona.id === id && nameKey(persona.name) === key) === undefined
    && list.some(persona => persona.id !== id && nameKey(persona.name) === key)) {
    throw new DevaIdentityError('DEVA_PERSONA_NAME_EXISTS', '已有同名身份；请输入不同的名称（不区分大小写和全角）')
  }
  return { name, description, prompt }
}

/** Desktop slug + 8 random hex digits; no user-provided path is accepted. */
export function addStudioPersona(config, input) {
  const fields = editableFields(config, input)
  const slug = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'persona'
  const dir = personasDir(config)
  let id
  do { id = `${slug}-${randomBytes(4).toString('hex')}` } while (statOrNull(join(dir, `${id}.md`)))
  const { path } = createPersona(config, { id, ...fields })
  const written = composePersonaFile(fields)
  try {
    updatePersonasSection(config, section => ({
      ...section,
      order: [...(Array.isArray(section.order) ? section.order.filter(item => item !== id) : []), id],
      enabled: { ...(object(section.enabled) ? section.enabled : {}), [id]: true },
    }))
  } catch (error) {
    try {
      if (readStrictText(path)?.raw !== written) throw new Error('persona changed')
      unlinkSync(path)
    } catch {
      throw new DevaIdentityError('DEVA_PERSONA_PARTIAL', `身份文件 ${id}.md 已写入，但登记和自动撤销失败；请检查 personas 目录和 config.json 后再试`)
    }
    throw error
  }
  return { id }
}

function readPersonaForEdit(config, id) {
  if (!isPersonaId(id)) throw new DevaIdentityError('DEVA_PERSONA_BAD_ID', '身份 ID 不合法：仅允许字母、数字、点、下划线、连字符（最多 64 字符）')
  const dir = personasDir(config)
  const info = statOrNull(dir)
  if (info && !info.isDirectory()) throw new DevaIdentityError('DEVA_PERSONAS_NOT_DIRECTORY', 'personas 必须是普通目录，不能是符号链接')
  const path = join(dir, `${id}.md`)
  const file = readStrictText(path)
  if (!file) throw new DevaIdentityError('DEVA_PERSONA_NOT_FOUND', '身份不存在；请刷新列表')
  return { path, raw: file.raw, revision: stamp(file.raw) }
}

export function readStudioPersona(config, id) {
  const { raw, revision } = readPersonaForEdit(config, id)
  const { name, description, prompt } = parsePersona(id, raw, false)
  return { id, name, description, prompt, revision }
}

export function updateStudioPersona(config, input) {
  const { path, raw, revision } = readPersonaForEdit(config, input.id)
  if (revision !== input.revision) throw new DevaIdentityError('DEVA_PERSONA_STALE', '身份已被另一处修改；请重新打开编辑，避免覆盖')
  const fields = editableFields(config, input)
  ensurePrivateDirectory(personasDir(config))
  writeAtomic(path, editPersonaFile(raw, fields), { expectedRaw: raw })
  return { id: input.id }
}

/**
 * 读-合并 personas 段并原子写回；保留 config.json 的其它顶层键与段内未知字段。
 * `mutate(section)` 返回新的 section（或修改传入对象）；写前比对原文，冲突则拒绝覆盖。
 * 返回 `{ config, written }`。
 */
/** 通用 config.json 段更新：保留其它顶层键与段内未知字段，写前比对原文。 */
export function updateConfigSection(config, name, mutate) {
  if (typeof name !== 'string' || !name.trim()) throw new DevaIdentityError('DEVA_CONFIG_SECTION_INVALID', 'config 段名不能为空')
  const cfg = readDevaConfig(config)
  const current = object(cfg.value[name]) ? { ...cfg.value[name] } : {}
  const next = mutate(current) ?? current
  if (!object(next)) throw new DevaIdentityError('DEVA_CONFIG_SECTION_INVALID', `${name} 段必须是对象`)
  const value = { ...cfg.value, [name]: next }
  const raw = `${JSON.stringify(value, null, 2)}\n`
  if (cfg.exists) writeAtomic(cfg.path, raw, { expectedRaw: cfg.raw })
  else { ensurePrivateDirectory(resolveDevaRoot(config)); writeAtomic(cfg.path, raw, { expectedRaw: null }) }
  return { config: value, written: true }
}

export function updatePersonasSection(config, mutate, { backup = null } = {}) {
  const cfg = readDevaConfig(config)
  if (backup && cfg.exists) backup(config, cfg.raw)
  return updateConfigSection(config, 'personas', mutate)
}
