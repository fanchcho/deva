/**
 * 超长工具输出：全文落盘，只把开头与结尾的预览交给模型。
 *
 * 与桌面端 apps/desktop/src/main/services/tool-results.ts 的 spillLongOutput 同一做法：
 *  · 只留开头会把结尾的报错、汇总、退出信息截掉——两头都留才能真正看懂一次失败的命令；
 *  · 全文写进本轮运行目录（run.paths.runtimeDir），需要细节时用 read_file 分段读、或用 grep 搜；
 *  · 运行目录不可写时退回「开头 + 结尾」预览并写明中间被丢弃，不假装已保存。
 *
 * 落盘位置在运行目录而非工作区：工具结果不是项目文件，不该混进用户的代码目录；
 * read_file 已额外接受运行目录（见 lib/tools.mjs 的 resolveReadable），所以给出的路径读得回来。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 预览的开头 / 结尾各取多少字符（结尾常是报错与汇总）。 */
const PREVIEW_HEAD = 1500
const PREVIEW_TAIL = 1500

/** 取开头约 n 个字符，尽量断在换行处。 */
function headOf(s, n) {
  if (s.length <= n) return s
  const cut = s.lastIndexOf('\n', n)
  return s.slice(0, cut > n / 2 ? cut : n)
}

/** 取结尾约 n 个字符，尽量从换行处开始。 */
function tailOf(s, n) {
  if (s.length <= n) return s
  const from = s.length - n
  const nl = s.indexOf('\n', from)
  return s.slice(nl >= 0 && nl < from + n / 2 ? nl + 1 : from)
}

function safeLabel(label) {
  return String(label ?? 'output').replace(/[^A-Za-z0-9_-]/g, '') || 'output'
}

/** 写入一份结果文件，返回绝对路径；写不进返回 null。 */
async function writeSpill(text, runtimeDir, label) {
  if (!runtimeDir) return null
  try {
    const name = `${safeLabel(label)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.txt`
    const dir = join(runtimeDir, 'tool-results')
    await mkdir(dir, { recursive: true })
    const full = join(dir, name)
    await writeFile(full, text, 'utf8')
    return full
  } catch {
    return null
  }
}

/**
 * 超过 limit 字符时落盘并返回「说明 + 路径 + 首尾预览」；没超过原样返回。
 * label 用作文件名前缀（command / mcp / web），便于在运行目录里分辨。
 */
export async function spillText(text, limit, { runtimeDir, label = 'output' } = {}) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  const file = await writeSpill(value, runtimeDir, label)
  if (!file) {
    const head = headOf(value, Math.floor(limit / 2))
    const tail = tailOf(value, Math.floor(limit / 2))
    const omitted = value.length - head.length - tail.length
    return `输出过长（共 ${value.length} 字符），且未能保存完整内容，以下只保留开头和结尾，其余已丢弃。如果工具能筛选或分页，请重新执行取需要的部分。\n\n${head}\n[……中间省略 ${omitted} 字符……]\n${tail}`
  }
  const head = headOf(value, PREVIEW_HEAD)
  const tail = tailOf(value, PREVIEW_TAIL)
  const omitted = value.length - head.length - tail.length
  return `输出过长（共 ${value.length} 字符），完整内容已保存到：${file}\n需要细看时用 read_file 分段读取，或用 grep 搜索。\n\n预览（开头和结尾）：\n${head}\n[……中间省略 ${omitted} 字符……]\n${tail}`
}
