/** Write-ahead checkpoints. Uncertain side effects are never replayed automatically. */
import { createHash } from 'node:crypto'
import { validateStoredModel } from './storage-contracts.mjs'
const MAX_BYTES = 2 * 1024 * 1024
const identityOf = identity => ({ userId: identity.userId, profile: identity.profile, sessionId: identity.sessionId, agentId: identity.agentId })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const callKey = call => {
  let args = call.arguments || '{}'
  try { args = canonical(JSON.parse(args)) } catch { /* Broken arguments are rejected by the loop. */ }
  return createHash('sha256').update(JSON.stringify([call.name, args])).digest('hex')
}

export function closePendingTools(messages) {
  // Preserve all completed results; fill only unmatched calls with an explicit no-replay outcome.
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    const results = new Map()
    let end = i + 1
    while (end < messages.length && messages[end].role === 'tool') { results.set(messages[end].toolCallId, messages[end]); end++ }
    const closed = message.toolCalls.map(call => results.get(call.id) || { role: 'tool', toolCallId: call.id, name: call.name, text: JSON.stringify({ status: 'interrupted_unknown', executed: 'unknown', retry: false, reason: '中断时结果未知，未自动重试；先核对实际状态再决定新操作' }) })
    messages.splice(i + 1, end - i - 1, ...closed)
    i += closed.length
  }
  return messages
}

export function createCheckpointController(identity, resumeState) {
  const owner = identityOf(identity)
  let state = { schemaVersion: 1, data: { owner, active: false, messages: [], calls: {}, reply: '', revision: 0 } }
  let loaded = false, store
  let restoringSession = Boolean(resumeState)
  const recovered = new Map()
  const checked = value => {
    validateStoredModel('agentCheckpoint', value)
    for (const record of Object.values(value.data.calls)) {
      validateStoredModel('checkpointCall', record)
    }
    if (!same(value.data.owner, owner)) throw new Error('checkpoint 身份/会话不匹配，拒绝恢复')
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('checkpoint 超过 2 MiB，停止执行以保护恢复记录')
    return structuredClone(value)
  }
  if (resumeState) { state = checked(resumeState); loaded = true }
  let writes = Promise.resolve()
  const save = async () => {
    state.data.revision = (state.data.revision || 0) + 1
    const snapshot = checked(state)
    const task = writes.then(() => store?.set('checkpoint', snapshot))
    writes = task.catch(() => {})
    await task
  }
  return {
    async recordTerminals(run, records) {
      store = run.state?.agentSession
      state.data.runTerminals = structuredClone(records)
      state.data.lastRunTerminal = records.at(-1)
      await save()
    },
    async begin(run, freshMessages) {
      store = run.state?.agentSession
      const saved = await store?.get('checkpoint')
      if (saved != null) {
        const candidate = checked(saved)
        if (!loaded || (candidate.data.revision || 0) > (state.data.revision || 0)) state = candidate
      }
      loaded = true
      const inputKey = createHash('sha256').update(JSON.stringify(freshMessages)).digest('hex')
      if (restoringSession && !state.data.active && state.data.inputKey === inputKey) {
        restoringSession = false
        return { completed: true, messages: state.data.messages, reply: state.data.reply, finishReason: state.data.finishReason || 'stop' }
      }
      restoringSession = false
      const resumed = state.data.active
      recovered.clear()
      const revision = state.data.revision || 0
      if (!resumed) state.data = { owner, active: true, messages: structuredClone(freshMessages), calls: {}, reply: '', revision, inputKey, runTerminals: state.data.runTerminals || [], ...(state.data.lastRunTerminal ? { lastRunTerminal: state.data.lastRunTerminal } : {}) }
      else {
        // Persisted completed calls win, even if interruption happened before tool result insertion.
        const calls = state.data.calls
        for (const record of Object.values(calls)) recovered.set(record.key, structuredClone(record))
        for (let i = 0; i < state.data.messages.length; i++) {
          const message = state.data.messages[i]
          if (!message.toolCalls?.length) continue
          let end = i + 1
          while (end < state.data.messages.length && state.data.messages[end].role === 'tool') end++
          const existing = new Map(state.data.messages.slice(i + 1, end).map(m => [m.toolCallId, m]))
          const results = message.toolCalls.map(call => {
            const recorded = calls[call.id]
            if (recorded && ['completed', 'failed'].includes(recorded.status)) return { role: 'tool', toolCallId: call.id, name: call.name, text: recorded.text }
            return existing.get(call.id) || { role: 'tool', toolCallId: call.id, name: call.name, text: JSON.stringify({ status: recorded?.status === 'pending' ? 'not_executed' : 'interrupted_unknown', retry: false, reason: '恢复不自动执行未完成调用；请先核对实际状态' }) }
          })
          state.data.messages.splice(i + 1, end - i - 1, ...results); i += results.length
        }
        const latest = freshMessages.at(-1)
        if (latest?.role === 'user' && !same(latest, state.data.messages.at(-1))) state.data.messages.push(structuredClone(latest))
        state.data.messages.push({ role: 'user', text: '【恢复】已保留完成工具的结果；未知或未执行调用不自动重放。先核对状态，避免重复副作用。' })
      }
      await save()
      return { messages: state.data.messages, reply: state.data.reply, resumed }
    },
    replay(call) {
      const hit = recovered.get(callKey(call))
      if (!hit) return null
      return { text: ['completed', 'failed'].includes(hit.status) ? hit.text : JSON.stringify({ status: 'interrupted_unknown', retry: false, reason: '此前相同操作结果未知，拒绝自动重放' }), isError: hit.status !== 'completed' }
    },
    async stage(messages, reply, calls = []) {
      state.data.messages = structuredClone(messages); state.data.reply = reply
      for (const call of calls) {
        if (['__proto__', 'constructor', 'prototype'].includes(call.id)) throw new Error('checkpoint: 非法 callId')
        if (Object.hasOwn(state.data.calls, call.id)) {
          if (recovered.has(callKey(call)) && state.data.calls[call.id].key === callKey(call)) continue
          throw new Error('checkpoint: 工具 callId 已使用，拒绝重复执行')
        }
        state.data.calls[call.id] = { key: callKey(call), status: 'pending', text: '' }
      }
      await save()
    },
    async started(call) { state.data.calls[call.id].status = 'running'; await save() },
    async finished(call, text, isError) { Object.assign(state.data.calls[call.id], { status: isError ? 'failed' : 'completed', text: String(text) }); await save() },
    async complete(messages, reply, finishReason = 'stop') { state.data.messages = structuredClone(messages); state.data.reply = reply; state.data.finishReason = finishReason; state.data.active = false; await save() },
    async snapshot() { await writes; return checked(state) },
  }
}
