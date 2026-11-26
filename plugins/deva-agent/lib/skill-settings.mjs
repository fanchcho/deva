import { join } from 'node:path'
import { resolveDevaRoot } from './deva-home.mjs'
import { registerRpc } from '../sdk/harness/contracts.mjs'
import { readSkill, createSkill, updateSkill, toggleSkill, deleteSkill, listSkillFiles, readSkillFile } from './skills.mjs'

export async function skillRequest(host, path, options = {}) {
  const result = await host.request(path, options)
  if (!result || typeof result !== 'object') throw new Error(`技能接口 ${path} 返回非 JSON 对象`)
  if (result.ok === false) throw new Error(String(result.error?.message || result.error || 'Studio 拒绝请求'))
  return result
}
export async function skillPage(host) {
  const payload = await skillRequest(host, '/api/ekko/skills')
  if (!Array.isArray(payload.skills)) throw new Error('技能接口缺少 skills 数组')
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : []
  const skills = payload.skills.filter(item => {
    if (item && typeof item.name === 'string') return true
    warnings.push('宿主返回一条缺少 name 的技能记录，已跳过')
    return false
  })
  return { skills, warnings, directory: typeof payload.directory === 'string' ? payload.directory : '' }
}
export async function skillDirectories(run) {
  const payload = await skillRequest(run.host, '/api/ekko/skills/external-directories')
  if (!Array.isArray(payload.directories)) throw new Error('外部目录接口缺少 directories 数组')
  const directories = payload.directories.map(item => {
    if (typeof item === 'string') return item
    if (typeof item?.raw === 'string') return item.raw
    throw new Error('外部目录条目缺少 raw 路径')
  })
  const warnings = payload.directories.filter(item => typeof item === 'object' && (!item.exists || !item.isDir)).map(item => `${item.raw}: exists=${item.exists}, isDir=${item.isDir}`)
  return { directories, warnings, devaDirectory: join(resolveDevaRoot(run.config), 'skills') }
}
export async function registerDevaSkills(run) {
  const before = await skillDirectories(run)
  const directories = [...new Set([...before.directories, before.devaDirectory])]
  await skillRequest(run.host, '/api/ekko/skills/external-directories', { method: 'PUT', body: { directories } })
  const after = await skillDirectories(run)
  if (!after.directories.includes(before.devaDirectory)) throw new Error('宿主未保留 Deva 外部目录；请检查目录权限或过滤规则')
  return after
}
export async function setSkillEnabled(host, input) {
  await toggleSkill(host, input.name, input.enabled)
  const actual = await readSkill(host, input.name)
  if (actual.enabled !== input.enabled) throw new Error(`宿主返回启停成功，但 ${input.name} 实际 enabled=${actual.enabled}；可能受全局过滤规则或权限限制，规则未被修改`)
  return actual
}
export function registerSkillSettings(ctx, contract) {
  registerRpc(ctx, contract, 'get-skills', (_input, run) => skillPage(run.host))
  registerRpc(ctx, contract, 'get-skill', (input, run) => readSkill(run.host, input.name))
  registerRpc(ctx, contract, 'save-skill', (input, run) => input.create ? createSkill(run.host, input) : updateSkill(run.host, input.name, input.content))
  registerRpc(ctx, contract, 'set-skill-enabled', (input, run) => setSkillEnabled(run.host, input))
  registerRpc(ctx, contract, 'delete-skill', (input, run) => deleteSkill(run.host, input.name))
  registerRpc(ctx, contract, 'get-skill-files', async (input, run) => ({ files: (await listSkillFiles(run.host, input.name)).map(file => typeof file === 'string' ? { path: file } : file) }))
  registerRpc(ctx, contract, 'read-skill-file', async (input, run) => ({ content: await readSkillFile(run.host, input.name, input.path) }))
  registerRpc(ctx, contract, 'get-skill-directories', (_input, run) => skillDirectories(run))
  registerRpc(ctx, contract, 'save-skill-directories', (_input, run) => registerDevaSkills(run))
}
