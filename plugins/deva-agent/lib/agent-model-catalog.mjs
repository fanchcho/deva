/** Studio's session selector reads this catalog, independently of the settings iframe. */
import { desktopModelState } from './desktop-models.mjs'
import { discoverModels } from './model-discovery.mjs'
import { listConfiguredModels, readCredential, REASONING_EFFORTS } from './model-selection.mjs'
import { agentModelId } from './agent-model-ref.mjs'
import { normalizeBaseUrl } from './custom-model-network.mjs'

export async function listAgentModels(run) {
  const desktop = desktopModelState(run.config)
  const configured = await listConfiguredModels(run)
  const choices = new Map(desktop.choices.map(route => [route.ref, route]))
  const problems = []
  await Promise.all(desktop.providers.filter(p => p.enabled && (p.purpose ?? 'llm') === 'llm').map(async provider => {
    let apiKey = ''
    try {
      if (provider.adapter !== 'openai') throw new Error('远端目录仅支持 OpenAI /models；本地模型已保留')
      const baseUrl = normalizeBaseUrl(provider.apiHost)
      apiKey = await readCredential(run, { providerId: provider.id, baseUrl })
      const result = await discoverModels(run, { baseUrl, apiKey })
      for (const model of result.models) {
        // Explicitly disabled Desktop entries must not reappear through discovery.
        if (provider.models.some(item => item.id === model.id && !item.enabled)) continue
        const ref = `${provider.id}:${model.id}`
        if (!choices.has(ref)) choices.set(ref, { ...model, ref, providerId: provider.id, modelName: model.id })
      }
    } catch (error) {
      let message = String(error?.message || error)
      if (apiKey) message = message.split(apiKey).join('[REDACTED]')
      message = message.replace(/(Bearer\s+|(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
      problems.push(`${provider.name || provider.id}：${message}`)
    }
  }))
  const models = [...choices.values()].map(route => ({
    id: agentModelId(route.ref), name: route.modelName, resolvedModel: route.modelName,
    reasoningEfforts: REASONING_EFFORTS,
    ...(route.contextWindow ? { contextWindow: route.contextWindow } : {}),
    ...(route.maxOutput ? { maxOutputTokens: route.maxOutput } : {}),
  }))
  const defaultModel = configured.models[0]
  if (defaultModel) {
    // Studio adds its own empty-id "Agent default" row and deduplicates id=default.
    // Keep the legacy id valid for persisted sessions, but don't render it twice.
    models.unshift({ ...defaultModel, id: 'default' }, { ...defaultModel, isDefault: false, hidden: true })
  }
  return {
    status: models.length ? 'ready' : problems.length ? 'error' : 'empty',
    source: 'deva-desktop-and-remote', scope: 'available', models,
    ...(problems.length ? { message: `远端目录未完整获取；已保留本地候选。${problems.join('；')}` } : !models.length ? { message: configured.message } : {}),
  }
}
