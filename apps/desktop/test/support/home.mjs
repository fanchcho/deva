/**
 * 把 DEVA_HOME 指到一次性临时目录。
 *
 * 单测绝不能写用户真实的 ~/.deva：config.ts 的 getDevaHome() 会优先读 DEVA_HOME，且它在
 * **首次调用时**才缓存（模块加载时不读），所以只要在被测代码真正读写配置之前执行本文件即可。
 * 每个测试文件在 node --test 里是独立子进程，因此各文件的临时目录互不影响。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.DEVA_HOME) {
  const dir = mkdtempSync(join(tmpdir(), 'deva-test-home-'))
  process.env.DEVA_HOME = dir
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响测试结论 */
    }
  })
}
