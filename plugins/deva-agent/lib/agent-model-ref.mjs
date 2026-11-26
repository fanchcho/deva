import { normalizeBaseUrl } from './custom-model-network.mjs'

const PREFIX = 'deva-model:'
export const agentModelId = ref => PREFIX + encodeURIComponent(ref)

/** A session selection names a provider, never an arbitrary URL or credential. */
export function resolveAgentModel(desktop, id) {
  if (!id || id === 'default' || id === 'deva-direct') return null
  if (!id.startsWith(PREFIX)) throw new Error('会话模型 ID 无效；请重新打开模型选择器选择')
  let ref
  try { ref = decodeURIComponent(id.slice(PREFIX.length)) } catch { throw new Error('会话模型引用编码无效；请重新选择') }
  const colon = ref.indexOf(':')
  const providerId = ref.slice(0, colon), modelName = ref.slice(colon + 1)
  if (colon <= 0 || !modelName.trim() || modelName.length > 256 || /\p{Cc}/u.test(modelName)) throw new Error('会话模型引用格式无效；请重新选择')
  const provider = desktop.providers.find(p => p.id === providerId && p.enabled && (p.purpose ?? 'llm') === 'llm')
  if (!provider) throw new Error('会话模型的提供商已移除或禁用；请重新选择，未回退到默认模型')
  if (provider.models.some(model => model.id === modelName && !model.enabled)) throw new Error('会话模型已禁用；请重新选择，未回退到默认模型')
  return desktop.resolve(ref) || { ref, providerId, modelName, adapter: provider.adapter, baseUrl: normalizeBaseUrl(provider.apiHost) }
}
