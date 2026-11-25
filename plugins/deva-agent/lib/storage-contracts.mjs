import { readFileSync } from 'node:fs'
import { assertContracts, validateModel } from '../sdk/harness/contracts.mjs'

const contract = assertContracts(JSON.parse(readFileSync(new URL('../contracts/plugin.json', import.meta.url), 'utf8')))
export const validateStoredModel = (name, value) => validateModel(contract, name, value)
export function validateStored(name, value) {
  validateModel(contract, contract.storage[name].model, value)
  if (name === 'subagents') for (const [id, record] of Object.entries(value)) {
    validateModel(contract, 'subagentRecord', record)
    if (record.id !== id) throw new Error('subagents: 存储键与记录 ID 不一致')
  }
  if (name === 'attachments') for (const entry of Object.values(value.entries)) validateModel(contract, 'attachmentEntry', entry)
  return value
}
export function normalizeStoredTodos(raw) {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new Error('todos: 存储应为数组')
  return validateStored('todos', raw.map(item => ({ ...item, status: item.status ?? 'pending' })))
}
export function normalizeSubagents(raw) {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('subagents: 存储应为对象')
  const records = Object.fromEntries(Object.entries(raw).map(([id, item]) => [id, {
    ...item, id: item.id ?? id, agent: item.agent ?? 'General', description: item.description ?? '',
    system: item.system ?? '', messages: item.messages ?? [], createdAt: item.createdAt ?? 0,
    updatedAt: item.updatedAt ?? item.createdAt ?? 0,
  }]))
  return validateStored('subagents', records)
}
