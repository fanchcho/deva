/**
 * 只读 persona 头像：与桌面 `services/avatar-image.ts` / py_upper `avatar_image.py` 同一规则。
 *
 * 桌面把用户上传的头像图片放在 `<root>/personas/avatars/<id>.<ext>`，扩展名按 **webp → png → jpg**
 * 的顺序找第一张；MIME 与扩展名固定对应，解码后大小必须在 1..2MiB。`persona` frontmatter 里的
 * `avatar` 是 Humation 头像 spec（JSON 字符串），**不是图片文件**；没有自定义图片时桌面由 id 确定性生成。
 *
 * 本模块只用这些文件做只读展示，不写入、不创建、不改桌面字段；路径与文件都做安全校验：
 *  · 拒绝非法 persona id（`..` / 分隔符）；
 *  · 拒绝符号链接（目录与文件都拒），realpath 必须仍落在 `personas/avatars` 内；
 *  · 只接受 webp/png/jpg，且文件头魔数必须与扩展名一致；
 *  · 大小 1..2MiB，空文件/超大文件都拒绝。
 */

import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { DevaIdentityError, resolveDevaRoot } from './deva-fs.mjs'
import { isPersonaId } from './persona-file.mjs'

/** 扩展名 → MIME，顺序与桌面一致（先 webp，再 png，再 jpg）。 */
export const AVATAR_FORMATS = Object.freeze([['webp', 'image/webp'], ['png', 'image/png'], ['jpg', 'image/jpeg']])
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

function matchesMagic(buffer, mime) {
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

export function personaAvatarsDir(config = {}) {
  return join(resolveDevaRoot(config), 'personas', 'avatars')
}

/**
 * 读 persona 自定义头像。
 * @returns {{dataUri: string, mime: string, bytes: number, path: string} | null} 没有图片时返回 null。
 * @throws {DevaIdentityError} 路径/文件异常（非法 id、符号链接、越界、格式不符、大小异常）。
 */
export function readPersonaAvatar(config = {}, id) {
  if (!isPersonaId(id)) throw new DevaIdentityError('DEVA_AVATAR_BAD_ID', `非法身份 id：${String(id)}`)
  const dir = personaAvatarsDir(config)
  let dirStat
  try {
    dirStat = lstatSync(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new DevaIdentityError('DEVA_AVATAR_DIR_UNREADABLE', `头像目录不可读：${dir}（${error.code || '未知错误'}）`, { path: dir })
  }
  if (dirStat.isSymbolicLink()) throw new DevaIdentityError('DEVA_AVATAR_DIR_SYMLINK', `头像目录不能是符号链接：${dir}`, { path: dir })
  if (!dirStat.isDirectory()) throw new DevaIdentityError('DEVA_AVATAR_DIR_NOT_DIRECTORY', `头像路径不是目录：${dir}`, { path: dir })
  let dirReal
  try { dirReal = realpathSync(dir) } catch (error) { throw new DevaIdentityError('DEVA_AVATAR_DIR_UNREADABLE', `头像目录无法解析：${dir}`, { path: dir }) }

  for (const [ext, mime] of AVATAR_FORMATS) {
    const candidate = join(dir, `${id}.${ext}`)
    let stat
    try {
      stat = lstatSync(candidate)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw new DevaIdentityError('DEVA_AVATAR_UNREADABLE', `头像文件不可读：${candidate}（${error.code || '未知错误'}）`, { path: candidate })
    }
    if (stat.isSymbolicLink()) throw new DevaIdentityError('DEVA_AVATAR_SYMLINK', `头像文件不能是符号链接：${candidate}`, { path: candidate })
    if (!stat.isFile()) throw new DevaIdentityError('DEVA_AVATAR_NOT_FILE', `头像路径不是普通文件：${candidate}`, { path: candidate })
    if (stat.size < 1) throw new DevaIdentityError('DEVA_AVATAR_EMPTY', `头像文件为空：${candidate}`, { path: candidate })
    if (stat.size > AVATAR_MAX_BYTES) throw new DevaIdentityError('DEVA_AVATAR_TOO_LARGE', `头像文件超过 2MiB：${candidate}`, { path: candidate })
    let real
    try { real = realpathSync(candidate) } catch (error) { throw new DevaIdentityError('DEVA_AVATAR_UNREADABLE', `头像文件无法解析：${candidate}`, { path: candidate }) }
    if (real !== join(dirReal, `${id}.${ext}`) || !real.startsWith(dirReal + sep)) {
      throw new DevaIdentityError('DEVA_AVATAR_ESCAPE', `头像文件解析后超出 personas/avatars：${candidate}`, { path: candidate })
    }
    let buffer
    try { buffer = readFileSync(real) } catch (error) { throw new DevaIdentityError('DEVA_AVATAR_UNREADABLE', `头像文件不可读：${candidate}`, { path: candidate }) }
    if (!matchesMagic(buffer, mime)) throw new DevaIdentityError('DEVA_AVATAR_BAD_MAGIC', `头像文件头与扩展名不符（需要 ${mime}）：${candidate}`, { path: candidate })
    return { dataUri: `data:${mime};base64,${buffer.toString('base64')}`, mime, bytes: buffer.length, path: real }
  }
  return null
}
