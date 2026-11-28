# 附录：构建 / 发布脚本（apps/desktop/scripts、.github/scripts、根目录配置） 函数级说明

本附录由主文档 `PROJECT-MAP.md` §3 引用，收录 **7** 个源码文件中的 **11** 个函数 / 方法 / IPC 处理器，逐条给出位置、签名、说明与调用方。

列说明：

- **位置**：`文件:行号`，行号为声明（`function` / `const x =` / `ipcMain.handle` 等）所在行。
- **类型**：TypeScript 编译器 API 判定 —— 函数声明、箭头函数、类方法、对象字面量方法、构造器、`ipcMain.handle/on` 处理器。
- **导出**：是否带 `export`。Web 版经 `__listChannels()` 暴露的通道不算 `export`，以 IPC 处理器条目体现。
- **签名**：参数与返回类型（`async` 前缀表示异步）。
- **说明**：优先取源码 JSDoc / 行上注释；无注释时给出函数体摘要（以「代码：」开头）；仍无法概括时如实写明。
- **被调用处**：对整个工作区（主进程、渲染层、preload、Web 版、脚本）做静态调用扫描，再逐条回到该行校验名字确实以调用形式出现；`get` / `start` / `listener` 这类高频短名仅保留同文件引用，以避开同名误匹配。空着表示静态扫描未发现调用，不等于运行时不执行 —— IPC 处理器、事件回调、成员方法天然经框架或接口间接调用。

| # | 位置 | 名字 | 类型 | 导出 | 签名 | 说明 | 被调用处 |
|---:|---|---|---|---|---|---|---|

### `.github/scripts/release-notes.mjs`（68 行，2 个条目）

| 1 | `.github/scripts/release-notes.mjs:30` | `git` | 箭头函数 | 否 | `git(args)` | stderr 收进异常而不是直接打到终端：「找不到上一个 tag」属正常情况，不该在日志里冒 fatal | .github/scripts/release-notes.mjs:37、.github/scripts/release-notes.mjs:44 |
| 2 | `.github/scripts/release-notes.mjs:33` | `previousTag` | 函数 | 否 | `previousTag()` | 用 git describe 找当前 ref 之前最近的 v* 标签，正式版排除预发布标签，找不到时返回 null。 | .github/scripts/release-notes.mjs:43 |

### `apps/desktop/electron.vite.config.ts`（52 行，0 个条目）


### `apps/desktop/scripts/adhoc-sign.cjs`（29 行，0 个条目）


### `apps/desktop/scripts/after-pack.cjs`（10 行，0 个条目）


### `apps/desktop/scripts/gen-icon.mjs`（153 行，8 个条目）

| 3 | `apps/desktop/scripts/gen-icon.mjs:28` | `inBg` | 函数 | 否 | `inBg(x, y, r=BG_R)` | 代码：`{ const cx = Math.min(Math.max(x, r), 1024 - r) const cy = Math.min(Math.max(y, r), 1024 - r) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r }` | apps/desktop/scripts/gen-icon.mjs:70 |
| 4 | `apps/desktop/scripts/gen-icon.mjs:34` | `inShape` | 函数 | 否 | `inShape(x, y)` | 判断 1024 画布坐标是否落在标志图形内：由感叹号竖线、圆点、两端短横和右半圆环组成。 | apps/desktop/src/main/services/tray-icon.ts:118、apps/desktop/src/main/services/tray-icon.ts:182、apps/desktop/scripts/gen-icon.mjs:72 |
| 5 | `apps/desktop/scripts/gen-icon.mjs:55` | `render` | 函数 | 否 | `render(size, ss=4, { pad = 0, r = BG_R }={})` | pad：四周透明边距（1024 画布坐标），标志整体以画布中心等比缩小；r：缩小后的底板圆角。 默认满幅（pad 0、圆角 224）。 | apps/desktop/scripts/gen-icon.mjs:146、apps/desktop/scripts/gen-icon.mjs:149、apps/desktop/scripts/gen-icon.mjs:152 |
| 6 | `apps/desktop/scripts/gen-icon.mjs:60` | `toLogo` | 箭头函数 | 否 | `toLogo(v)` | 代码：`(v * k - pad) / s` | apps/desktop/scripts/gen-icon.mjs:68、apps/desktop/scripts/gen-icon.mjs:69、apps/desktop/scripts/gen-icon.mjs:78 |
| 7 | `apps/desktop/scripts/gen-icon.mjs:97` | `crc32` | 函数 | 否 | `crc32(buf)` | 代码：`{ let c = 0xffffffff for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8) return (c ^ 0xffffffff) >>> 0 }` | apps/desktop/scripts/gen-icon.mjs:107 |
| 8 | `apps/desktop/scripts/gen-icon.mjs:102` | `chunk` | 函数 | 否 | `chunk(type, data)` | 按 PNG 规范组装单个数据块：写入数据长度、块类型与数据本身，并追加 CRC32 校验值。 | apps/desktop/scripts/gen-icon.mjs:121、apps/desktop/scripts/gen-icon.mjs:122、apps/desktop/scripts/gen-icon.mjs:123 |
| 9 | `apps/desktop/scripts/gen-icon.mjs:110` | `png` | 函数 | 否 | `png(size, rgba)` | 把 RGBA 像素编码成 PNG 文件：生成 IHDR、经 deflate 压缩的 IDAT 与 IEND 后拼接返回。 | apps/desktop/scripts/gen-icon.mjs:146、apps/desktop/scripts/gen-icon.mjs:149、apps/desktop/scripts/gen-icon.mjs:152 |
| 10 | `apps/desktop/scripts/gen-icon.mjs:126` | `ico` | 函数 | 否 | `ico(frames)` | 把多张 PNG 帧组装成 ICO：写入含尺寸、位深与数据偏移的目录头，再依次拼接各帧数据。 | apps/desktop/scripts/gen-icon.mjs:151 |

### `apps/desktop/scripts/linux-launcher.cjs`（33 行，0 个条目）


### `apps/desktop/scripts/portable-zip.cjs`（55 行，1 个条目）

| 11 | `apps/desktop/scripts/portable-zip.cjs:18` | `rename` | 函数 | 否 | `async rename(from, to)` | 刚生成的文件可能正被杀毒软件扫描，Windows 上改名偶尔 EPERM / EBUSY：稍等重试。 | apps/desktop/scripts/portable-zip.cjs:43、apps/desktop/scripts/portable-zip.cjs:52 |

合计：7 个文件，11 个条目。
