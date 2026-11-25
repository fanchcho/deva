import { resolveDevaRoot } from './deva-fs.mjs'

/** The machine-wide Desktop config is not a namespace for arbitrary Studio accounts. */
export function sharedDevaPath(run) {
  const owner = run.config?.sharedDevaUserId
  if (!Number.isSafeInteger(owner) || owner < 1 || run.identity?.userId !== owner) return null
  return resolveDevaRoot(run.config)
}
