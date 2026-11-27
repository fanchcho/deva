import { registerRpc as registerContractRpc } from '../sdk/harness/contracts.mjs'

export class RpcAdmission {
  constructor({ maxInflight = Number(process.env.DEVA_RPC_MAX_INFLIGHT ?? 32), maxQueue = Number(process.env.DEVA_RPC_MAX_QUEUE ?? 128), timeout = 600000 } = {}) {
    if (!Number.isSafeInteger(maxInflight) || maxInflight < 1 || !Number.isSafeInteger(maxQueue) || maxQueue < 0) throw new Error('Invalid RPC budget')
    this.maxInflight = maxInflight; this.maxQueue = maxQueue; this.timeout = timeout; this.users = new Map()
  }
  run(user, fn, signal) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('RPC_CANCELLED'), { code: 'RPC_CANCELLED' }))
    const state = this.users.get(user) ?? { active: 0, queue: [] }
    if (state.active >= this.maxInflight && state.queue.length >= this.maxQueue) return Promise.reject(Object.assign(new Error('RPC_OVERLOADED'), { code: 'RPC_OVERLOADED', retryAfterMs: 1000 }))
    this.users.set(user, state)
    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
        const index = state.queue.indexOf(task)
        if (index >= 0) state.queue.splice(index, 1)
        if (error) { controller.abort(); reject(error) } else resolve(value)
        if (!state.active && !state.queue.length) this.users.delete(user)
      }
      const abort = () => finish(Object.assign(new Error('RPC_CANCELLED'), { code: 'RPC_CANCELLED' }))
      const timer = setTimeout(() => finish(Object.assign(new Error('RPC_TIMEOUT'), { code: 'RPC_TIMEOUT' })), this.timeout)
      const task = () => {
        state.active++
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return fn(controller.signal) }).then(value => finish(null, value), finish).finally(() => {
          // A timed-out handler may still own a side effect: retain its lease until it actually settles.
          state.active--
          state.queue.shift()?.()
          if (!state.active && !state.queue.length) this.users.delete(user)
        })
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (state.active < this.maxInflight) task()
      else state.queue.push(task)
    })
  }
}
const gates = new WeakMap()
export function registerRpc(ctx, contract, name, handler) {
  let gate = gates.get(ctx)
  if (!gate) { gate = new RpcAdmission(); gates.set(ctx, gate) }
  return registerContractRpc(ctx, contract, name, (input, run) => gate.run(
    run.identity?.userId ?? 'host', signal => handler(input, { ...run, signal }), run.signal
  ))
}
