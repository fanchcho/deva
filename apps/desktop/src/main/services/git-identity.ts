/** 身份保存独立于提交：每条 git 命令均检查退出码，写后校验目标作用域和仓库实际生效值。 */
interface GitResult {
  code: number
  stdout: string
  stderr: string
}

type RunGit = (dir: string, args: string[]) => Promise<GitResult>

type IdentityResult = { ok: true } | { ok: false; reason: 'identity-needed'; message: string }

export async function saveGitIdentity(
  runGit: RunGit,
  dir: string,
  name: string,
  email: string,
  global: boolean
): Promise<IdentityResult> {
  if (typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !email.trim())
    return { ok: false, reason: 'identity-needed', message: 'user.name and user.email are required' }
  const scope = global ? '--global' : '--local'
  const values = [['user.name', name.trim()], ['user.email', email.trim()]]
  for (const [key, value] of values) {
    const written = await runGit(dir, ['config', scope, key, value])
    if (written.code !== 0)
      return { ok: false, reason: 'identity-needed', message: written.stderr.trim() || `Cannot write ${key}` }
  }
  for (const [key, value] of values) {
    for (const args of [['config', scope, '--get', key], ['config', '--get', key]]) {
      const actual = await runGit(dir, args)
      if (actual.code !== 0 || actual.stdout.trim() !== value)
        return {
          ok: false, reason: 'identity-needed',
          message: actual.stderr.trim() || `${key}: saved identity is not effective in this repository; check repository overrides`
        }
    }
  }
  return { ok: true }
}
