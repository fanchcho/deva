import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 每个测试进程一个隔离的 Deva 根：测试绝不能读写真实用户目录 `~/.deva`。
 * 设 `DEVA_HOME` 后，`resolveDevaRoot()` 在调用时读到它；进程退出时清理。
 */
export function isolatedDevaHome(prefix = 'deva-test-home-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  process.env.DEVA_HOME = dir
  process.on('exit', () => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 测试清理失败不影响结论 */ }
  })
  return dir
}
