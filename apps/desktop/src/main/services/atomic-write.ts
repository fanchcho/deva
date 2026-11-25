import { renameSync, rmSync, writeFileSync } from 'fs'

/**
 * 原子写：先写同目录 `<file>.tmp` 再 rename 覆盖。进程在写到一半时被杀（强退 / 断电 / 崩溃）
 * 最多丢掉这一次的新内容，**绝不会把旧文件截成半截**——否则读的一方解析失败即当作「不存在 / 空」：
 * 对话凭空消失、config.json 回落成空配置、secrets.json 里的密钥全部丢失。
 * rename 失败时保留旧目标并原样抛错，绝不回退直接覆盖。临时文件尽力清理。
 * `.tmp` 后缀让按扩展名扫描目录的地方天然跳过它。
 */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf8')
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 清理失败无害：下次写入会覆盖 */
    }
    throw error
  }
}
