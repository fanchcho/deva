import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILL_TOOLS, SkillError, listSkills, readSkill, readSkillFile, listSkillFiles,
  createSkill, updateSkill, toggleSkill, deleteSkill, formatSkillListing, executeSkillTool,
} from '../lib/skills.mjs'
import { TOOL_DEFINITIONS, executeTool } from '../lib/tools.mjs'
import { buildSystemPrompt } from '../lib/prompt.mjs'

const SKILL_MD = `---
name: release-notes
description: 把未提交改动整理成发布说明
---

# 发布说明

1. 跑 git log
`

/** 假宿主：按路径表回放，记录每次调用的 method/query/body。 */
function fakeHost(handler) {
  const calls = []
  return {
    calls,
    async request(path, options = {}) {
      calls.push({ path, method: options.method || 'GET', query: options.query, body: options.body })
      return handler(path, options, calls)
    },
  }
}

function catalog() {
  return {
    skills: [
      { name: 'release-notes', description: '把未提交改动整理成发布说明', enabled: true, builtIn: false, validationStatus: 'valid' },
      { name: 'skill-creator', description: '创建技能', enabled: true, builtIn: true, validationStatus: 'valid' },
      { name: 'off', description: '已停用', enabled: false, builtIn: false, validationStatus: 'valid' },
      { name: 'broken', description: '损坏', enabled: true, builtIn: false, validationStatus: 'invalid' },
    ],
  }
}

test('skill listing injects only enabled, valid skills as name + description', async () => {
  const host = fakeHost(() => catalog())
  const listing = await formatSkillListing({ host })
  assert.equal(listing, ['- release-notes：把未提交改动整理成发布说明', '- skill-creator：创建技能'].join('\n'))
  assert.deepEqual(host.calls, [{ path: '/api/ekko/skills', method: 'GET', query: undefined, body: undefined }])
})

test('skill listing is empty without a host channel and honest when the listing fails', async () => {
  assert.equal(await formatSkillListing({}), '')
  assert.equal(await formatSkillListing(), '')
  const host = fakeHost(() => { throw Object.assign(new Error('boom'), { body: { error: 'permission denied' } }) })
  const warnings = []
  const listing = await formatSkillListing({ host, log: { warn: message => warnings.push(message) } })
  assert.match(listing, /技能清单本轮读取失败/)
  assert.match(listing, /permission denied/)
  assert.equal(warnings.length, 1)
})

test('skill tools join the agent tool set and the system prompt carries the listing', () => {
  const names = TOOL_DEFINITIONS.map(tool => tool.name)
  assert.ok(names.includes('skill_view'))
  assert.ok(names.includes('skill_manage'))
  assert.deepEqual(SKILL_TOOLS.map(tool => tool.name), ['skill_view', 'skill_manage'])
  const prompt = buildSystemPrompt({
    identity: { id: 'deva', name: 'Deva', persona: '你是 Deva。' },
    skillsText: '- release-notes：整理发布说明',
  })
  assert.match(prompt, /## 可用技能/)
  assert.match(prompt, /- release-notes：整理发布说明/)
  assert.doesNotMatch(buildSystemPrompt({ identity: { id: 'deva', name: 'Deva', persona: '你是 Deva。' } }), /## 可用技能/)
})

test('skill_view lists skills when name is omitted and loads full content by name', async () => {
  const host = fakeHost((path, options) => {
    if (path === '/api/ekko/skills') return catalog()
    if (path === '/api/ekko/skills/release-notes') return { skill: { name: 'release-notes', description: '整理发布说明', enabled: true, content: SKILL_MD } }
    throw new Error(`unexpected ${path}`)
  })
  const listed = await executeSkillTool('skill_view', {}, { host })
  assert.match(listed, /release-notes/)
  assert.match(listed, /off（已停用）/)

  const detail = await executeSkillTool('skill_view', { name: 'release-notes' }, { host })
  assert.match(detail, /技能：release-notes/)
  assert.match(detail, /1\. 跑 git log/)
  assert.equal(host.calls.at(-1).path, '/api/ekko/skills/release-notes')
})

test('skill_view reads a support file through the documented file endpoint', async () => {
  const host = fakeHost(path => {
    if (path === '/api/ekko/skills/release-notes/file') return { content: '# 模板' }
    throw new Error(`unexpected ${path}`)
  })
  const text = await executeSkillTool('skill_view', { name: 'release-notes', file: 'references/templates.md' }, { host })
  assert.match(text, /# 模板/)
  assert.deepEqual(host.calls[0].query, { path: 'references/templates.md' })
  await assert.rejects(executeSkillTool('skill_view', { name: 'release-notes', file: ' ' }, { host }), /file 不能为空/)
})

test('skill_manage maps each action onto the documented endpoint', async () => {
  const host = fakeHost((path, options) => {
    const body = options.body || {}
    return { skill: { name: path.split('/')[4] || body.name, description: '新技能', enabled: true } }
  })
  const created = await executeSkillTool('skill_manage', { action: 'create', name: 'weekly-report', content: SKILL_MD }, { host })
  assert.match(created, /已创建技能「weekly-report」/)
  assert.deepEqual(host.calls.at(-1), { path: '/api/ekko/skills', method: 'POST', query: undefined, body: { name: 'weekly-report', content: SKILL_MD } })

  await executeSkillTool('skill_manage', { action: 'update', name: 'weekly-report', content: SKILL_MD }, { host })
  assert.deepEqual(host.calls.at(-1), { path: '/api/ekko/skills/weekly-report', method: 'PUT', query: undefined, body: { content: SKILL_MD } })

  const toggled = await executeSkillTool('skill_manage', { action: 'toggle', name: 'weekly-report', enabled: false }, { host })
  assert.match(toggled, /已停用/)
  assert.deepEqual(host.calls.at(-1), { path: '/api/ekko/skills/weekly-report/toggle', method: 'PUT', query: undefined, body: { enabled: false } })

  const removed = await executeSkillTool('skill_manage', { action: 'delete', name: 'weekly-report' }, { host })
  assert.match(removed, /已删除技能「weekly-report」/)
  assert.equal(host.calls.at(-1).method, 'DELETE')
})

test('skill validation rejects bad names, missing frontmatter and unknown actions before hitting the host', async () => {
  const host = fakeHost(() => ({ skill: { name: 'x' } }))
  await assert.rejects(executeSkillTool('skill_manage', { action: 'create', name: 'Bad Name', content: SKILL_MD }, { host }), /技能名不合法/)
  await assert.rejects(executeSkillTool('skill_manage', { action: 'create', name: '-bad', content: SKILL_MD }, { host }), /技能名不合法/)
  await assert.rejects(executeSkillTool('skill_manage', { action: 'create', name: 'ok-name', content: '# 没有 frontmatter' }, { host }), /frontmatter/)
  await assert.rejects(executeSkillTool('skill_manage', { action: 'create', name: 'ok-name', content: '  ' }, { host }), /content 不能为空/)
  await assert.rejects(executeSkillTool('skill_manage', { action: 'toggle', name: 'ok-name' }, { host }), /enabled/)
  await assert.rejects(executeSkillTool('skill_manage', { action: 'explode', name: 'ok-name' }, { host }), /未知操作/)
  assert.deepEqual(host.calls, [])
})

test('skill errors surface the host message and require a host channel', async () => {
  const host = fakeHost(() => { throw Object.assign(new Error('Request failed with status 400'), { body: { error: 'Built-in skill cannot be edited: skill-creator.' } }) })
  await assert.rejects(
    executeSkillTool('skill_manage', { action: 'update', name: 'skill-creator', content: SKILL_MD }, { host }),
    /Built-in skill cannot be edited: skill-creator/,
  )
  await assert.rejects(executeSkillTool('skill_view', { name: 'release-notes' }, {}), SkillError)
  await assert.rejects(executeSkillTool('skill_view', { name: 'release-notes' }, {}), /没有 Studio 宿主通道/)
  await assert.rejects(executeSkillTool('skill_view', { name: 'release-notes' }, { host, signal: { aborted: true } }), /已被取消/)
})

test('executeTool routes skill tools without a workspace and rejects them without a host', async () => {
  const host = fakeHost(() => catalog())
  const listed = await executeTool('skill_view', {}, { host })
  assert.match(listed, /release-notes/)
  await assert.rejects(executeTool('skill_view', { name: 'release-notes' }, {}), /没有 Studio 宿主通道/)
  await assert.rejects(executeTool('skill_manage', { action: 'delete', name: 'release-notes' }, {}), /没有 Studio 宿主通道/)
})

test('low-level helpers keep request shapes and reject unusable payloads', async () => {
  const host = fakeHost(path => {
    if (path.endsWith('/files')) return { files: ['references/a.md'] }
    if (path.endsWith('/file')) return { content: SKILL_MD }
    if (path === '/api/ekko/skills') return catalog()
    if (path.includes('/skills/')) return { skill: { name: 'release-notes', content: SKILL_MD, enabled: true } }
    return {}
  })
  assert.equal((await listSkills(host)).length, 4)
  assert.equal((await readSkill(host, 'release-notes')).name, 'release-notes')
  assert.deepEqual(await listSkillFiles(host, 'release-notes'), ['references/a.md'])
  assert.equal(await readSkillFile(host, 'release-notes', 'references/a.md'), SKILL_MD)
  await assert.rejects(readSkillFile(host, 'release-notes', ''), /file 不能为空/)
  await assert.rejects(toggleSkill(host, 'release-notes', 'yes'), /enabled 必须是布尔值/)
  // 宿主返回里没有 skill.name 时明确报错，而不是猜一个技能出来。
  await assert.rejects(createSkill(host, { name: 'ok-name', content: SKILL_MD }), /无法识别的结构/)
  const host2 = fakeHost((path, options) => ({ skill: { name: options.body?.name || 'ok-name' } }))
  await createSkill(host2, { name: 'ok-name', content: SKILL_MD, category: 'docs' })
  assert.deepEqual(host2.calls[0].body, { name: 'ok-name', content: SKILL_MD, category: 'docs' })
  await toggleSkill(host2, 'ok-name', true)
  await deleteSkill(host2, 'ok-name')
  assert.deepEqual(host2.calls.slice(1).map(call => [call.path, call.method]), [
    ['/api/ekko/skills/ok-name/toggle', 'PUT'],
    ['/api/ekko/skills/ok-name', 'DELETE'],
  ])
})
