/**
 * 身份目录：同一个 Agent 可以按所选身份说话。
 *
 * 身份来自这个仓库自己的角色定义（apps/desktop/src/main/services/*-personas.ts）：
 *  · deva —— deva-personas.ts 的 PROMPT（项目开发身份，默认）
 *  · xiaomajiang —— xiaomajiang-personas.ts 的 PROMPT（红队/逆向身份）
 * 提示词正文放在 identities/*.md，逐字取自上面两个文件，方便直接改、也方便用测试核对是否漂移。
 *
 * 选择存在 user+profile 作用域（见 lib/selection.mjs），每轮运行前读一次，所以切换身份不用重启。
 */
import { readFile } from 'node:fs/promises'

export const DEFAULT_IDENTITY = 'deva'

export const IDENTITIES = [
  {
    id: 'deva',
    name: 'Deva',
    description: '项目开发身份：改代码、跑检查、写文档，语气克制、先给结论。',
    file: 'identities/deva.md',
  },
  {
    id: 'xiaomajiang',
    name: '小码酱',
    description: '仓库自带的安全研究/逆向身份：执行更硬、更贴操作细节，适合红队与逆向任务。',
    file: 'identities/xiaomajiang.md',
  },
]

/** id → {id,name,description}，给「一个身份一个 Agent」用。 */
export const IDENTITY_META = Object.fromEntries(IDENTITIES.map(({ id, name, description }) => [id, { id, name, description }]))

const cache = new Map()

export function listIdentities() {
  return IDENTITIES.map(({ id, name, description }) => ({ id, name, description }))
}

export function isIdentity(id) {
  return IDENTITIES.some(identity => identity.id === id)
}

/** 读一个身份的提示词正文；未知 id 回退到默认身份，不回退到空提示词。 */
export async function loadIdentity(id) {
  const chosen = IDENTITIES.find(identity => identity.id === id) || IDENTITIES.find(identity => identity.id === DEFAULT_IDENTITY)
  if (cache.has(chosen.id)) return cache.get(chosen.id)
  const persona = await readFile(new URL(`../${chosen.file}`, import.meta.url), 'utf8')
  const value = { id: chosen.id, name: chosen.name, description: chosen.description, persona: persona.trim() }
  cache.set(chosen.id, value)
  return value
}
