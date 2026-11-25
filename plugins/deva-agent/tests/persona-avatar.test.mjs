import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPersonaAvatar, personaAvatarsDir } from '../lib/persona-avatar.mjs'
import { createPersona } from '../lib/persona-store.mjs'
import { ensureIdentityState, listIdentityCatalog } from '../lib/deva-home.mjs'
import { isolatedDevaHome } from './support/deva-home.mjs'

isolatedDevaHome()

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
const configFor = dir => ({ sharedDevaHome: join(dir, '.deva') })
const avatarOf = (dir, id, ext = 'png') => join(dir, '.deva', 'personas', 'avatars', `${id}.${ext}`)

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'deva-avatar-'))
  await ensureIdentityState(configFor(dir))
  await mkdir(personaAvatarsDir(configFor(dir)), { recursive: true, mode: 0o700 })
  return dir
}

test('读取自定义头像：png → data URI，MIME/字节数正确；没有图片返回 null', async () => {
  const dir = await fixture()
  try {
    await writeFile(avatarOf(dir, 'general'), PNG_1X1)
    const image = readPersonaAvatar(configFor(dir), 'general')
    assert.equal(image.mime, 'image/png')
    assert.equal(image.bytes, PNG_1X1.length)
    assert.equal(image.dataUri, `data:image/png;base64,${PNG_1X1.toString('base64')}`)
    assert.equal(readPersonaAvatar(configFor(dir), 'xiaomajiang'), null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('头像安全校验：非法 id / 符号链接 / 目录链接 / 超大 / 伪图片都明确拒绝', async () => {
  const dir = await fixture()
  const config = configFor(dir)
  try {
    assert.throws(() => readPersonaAvatar(config, '../general'), error => error.code === 'DEVA_AVATAR_BAD_ID')
    // 文件符号链接
    const outside = join(dir, 'outside.png')
    await writeFile(outside, PNG_1X1)
    await symlink(outside, avatarOf(dir, 'general'))
    assert.throws(() => readPersonaAvatar(config, 'general'), error => error.code === 'DEVA_AVATAR_SYMLINK')
    await rm(avatarOf(dir, 'general'))
    // 头像目录本身是符号链接
    const real = personaAvatarsDir(config)
    const moved = `${real}-real`
    await rm(real, { recursive: true, force: true })
    await symlink(moved, real)
    assert.throws(() => readPersonaAvatar(config, 'general'), error => ['DEVA_AVATAR_DIR_SYMLINK', 'DEVA_AVATAR_DIR_UNREADABLE'].includes(error.code))
    await rm(real)
    await mkdir(real, { recursive: true, mode: 0o700 })
    // 超大文件（2MiB + 1，保留 png 头）
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1)
    PNG_1X1.copy(huge)
    await writeFile(avatarOf(dir, 'general'), huge)
    assert.throws(() => readPersonaAvatar(config, 'general'), error => error.code === 'DEVA_AVATAR_TOO_LARGE')
    // 扩展名 png 但内容不是图片
    await writeFile(avatarOf(dir, 'general'), 'plain text')
    assert.throws(() => readPersonaAvatar(config, 'general'), error => error.code === 'DEVA_AVATAR_BAD_MAGIC')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份目录带出头像 data URI；无图/坏图回退为空并带原因，不影响其它身份', async () => {
  const dir = await fixture()
  const config = configFor(dir)
  try {
    createPersona(config, { id: 'qa-avatar', name: 'QA Avatar', description: '测试', prompt: '# QA' })
    await writeFile(avatarOf(dir, 'qa-avatar'), PNG_1X1)
    await writeFile(avatarOf(dir, 'general'), 'not an image')
    const snap = await listIdentityCatalog(config)
    const qa = snap.identities.find(item => item.id === 'qa-avatar')
    assert.equal(qa.avatarImage, `data:image/png;base64,${PNG_1X1.toString('base64')}`)
    const general = snap.identities.find(item => item.id === 'general')
    assert.equal(general.avatarImage, '')
    assert.match(general.avatarError, /文件头与扩展名不符/)
    const xmj = snap.identities.find(item => item.id === 'xiaomajiang')
    assert.equal(xmj.avatarImage, '')
    assert.equal(xmj.avatarError, undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('avatar 是 frontmatter spec 而非图片；没有 avatars 目录时安全返回 null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deva-avatar-nodir-'))
  const config = configFor(dir)
  try {
    await ensureIdentityState(config)
    assert.equal(readPersonaAvatar(config, 'general'), null)
    const raw = await readFile(join(dir, '.deva', 'personas', 'general.md'), 'utf8')
    assert.doesNotMatch(raw.split('---').slice(0, 2).join('---'), /^avatar:/m)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
