import { realpathSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveDevaRoot } from './deva-fs.mjs'

/** The machine-wide Desktop config is not a namespace for arbitrary Studio accounts. */
export function sharedDevaPath(run) {
  const owner = run.config?.sharedDevaUserId
  if (!Number.isSafeInteger(owner) || owner < 1 || run.identity?.userId !== owner) return null
  return resolveDevaRoot(run.config)
}

/** Local write fallback is bound to the host activation account, never a caller-supplied ID.
 * Explicit owner configuration always wins; runtime network authorization stays separate.
 */
export function sharedDevaWritePath(run) {
  if (run.config?.sharedDevaUserId != null) return sharedDevaPath(run)
  const userId = run.identity?.userId
  if (!Number.isSafeInteger(userId) || userId < 1 || userId !== run.desktopActivationUserId) return null
  const root = resolveDevaRoot(run.config)
  const expected = resolve(homedir(), '.deva')
  if (root !== expected) return null
  try {
    if (lstatSync(root).isSymbolicLink()) return null
    if (realpathSync(root) !== join(realpathSync(homedir()), '.deva')) return null
    const file = join(root, 'config.json')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return null
  } catch { return null }
  return root
}

export function desktopWriteDenial(run) {
  const current = run.identity?.userId ?? 'unavailable (host RunContext.identity.userId missing)'
  const configured = run.config?.sharedDevaUserId ?? 'unset'
  const activation = run.desktopActivationUserId ?? 'unavailable (host PluginContext.identity.userId missing)'
  return `只读 / Read-only: Studio userId=${current}; sharedDevaUserId=${configured}; activationUserId=${activation}. 本机账号或 profile 路径不匹配。管理员核对目录后设置插件 sharedDevaUserId=${current}，保存配置后关闭并重新打开模型页 / verify the directory, set sharedDevaUserId, then reopen Model settings.`
}
