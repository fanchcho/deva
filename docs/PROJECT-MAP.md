# Deva 工程全量梳理（文件清单 · 函数级说明 · 运行机制）

- 梳理对象：`/home/agent/shared_workspace/deva`（pnpm monorepo：Electron 桌面端 + 纯 Web 服务，共享同一份主进程/渲染层代码）
- 生成方式：AST 全量扫描（TypeScript 编译器 API）+ 逐文件阅读；机械统计与人工判断的边界在 §3.1 写明
- 代码基线：`109937f`（`apps/desktop/package.json` 版本 `0.1.15`），工作区另有未提交改动（见 §0.3）
- 文档结构：主文档 `docs/PROJECT-MAP.md`（本文件）+ 全量索引 `docs/FUNCTION-INDEX.md` + 6 个函数级附录 `docs/PROJECT-MAP-FUNCTIONS-*.md`
- 全部结论来自逐文件读代码；行号均指该文件当前内容的行号，引用格式 `文件:行号`
- 凡属推断而非直接读数之处，正文显式标注「推测」

---

## 0. 怎么读这份文档

### 0.1 章节与「要回答的问题」对照

| 章节 | 回答什么 | 交付物 |
|---|---|---|
| §1 仓库总览 | 目录长什么样、用什么技术栈、有哪些命令、每条命令实际做什么 | 文件级目录树 + 技术栈表 + 命令链表 |
| §2 文件清单 | **每一个**纳入清单的文件是干什么的、属于哪一层、是不是生成物 | 225 行表 + `out/` 30 个证据文件逐条 |
| §3 函数级说明 | 有哪些函数、签名、作用、谁调用、边界与副作用 | 计数 + 469 条精选表 + `FUNCTION-INDEX.md`（2505 条全量索引）+ 6 个附录 |
| §4 运行机制（一） | 一次 Web 请求从 TCP 到 worker 再回到浏览器，数据怎么流动 | 启动、路由顺序、invoke 全链路、路径闸门、SSE、PTY、静态托管、关停 |
| §5 运行机制（二） | Electron 主进程 → preload → 渲染层 → IPC，以及 Web 如何复用同一套代码 | 启动序列、窗口创建、preload 桥、一次对话回合、三层替换、构建、数据落点 |
| §6 关键不变量与风险 | 哪些边界是硬约束、现有保护在哪、缺口在哪 | 每条附行号，缺口标注「未发现」或「设计如此」 |
| §7 阅读顺序 | 新人先读哪些文件能最快建立心智模型 | 三阶段阅读清单 + 反模式 |
| §8 交付自查 | 行号抽查、计数一致性、未覆盖条目 | 24 条抽查表 + 10 项计数核对 |

### 0.2 统计口径（重要，先对齐定义）

| 口径 | 定义 | 数值 |
|---|---|---|
| 「纳入清单的文件」 | 仓库内**实际存在**的、非依赖非构建产物的文件：`git ls-files` 的 198 个 + 工作区尚未提交的 27 个（`apps/web/**`、`.dockerignore` 与本次文档除外） | **225** |
| 「源码文件」 | 上述文件中含可解析函数体的脚本/组件文件（`.ts/.tsx/.mjs/.js/.cjs`，通过 TypeScript 编译器 API 解析） | **168** |
| 「函数 / 条目」 | 函数声明、箭头函数、类方法、对象字面量方法、构造器、`ipcMain.handle/on` 处理器；匿名的内联回调不计 | **2505** |
| 其中导出（`export`） | 带 `export` 关键字的条目 | **713** |
| 其中 IPC 处理器 | `ipcMain.handle()` / `ipcMain.on()` 注册处 | **164** |
| 代码行数（源码文件） | 上述 168 个文件的源码行合计（`wc -l` 口径） | **65 880** |
| 「说明」的来源 | 见 §3.2 五级来源表，**没有一条是空着的** | 2505/2505 |

> 统计脚本：`/tmp/mapgen/` 下的 AST 扫描结果 `extract5.json` 与生成脚本 `gen_appendices.py`、`gen_filetable.py`、`gen_tree.py`。它们是**临时脚本，未入库**（按任务要求只放 `/tmp`），本文档不依赖它们也能读懂。

### 0.3 工作区状态（写文档时的真实状态，勿误读为文档改动）

```
 M apps/desktop/src/main/services/git.ts     ← 本次梳理前既有的未提交改动
 M package.json                              ← 同上（新增 onlyBuiltDependencies 白名单）
 M pnpm-lock.yaml                            ← 同上
?? .dockerignore                             ← 未提交
?? apps/web/                                 ← 整个 Web 应用尚未提交
?? docs/PROJECT-MAP*.md                      ← 本次梳理产出的文档（7 个文件）
```

本次任务**没有改动任何产品代码**；新增文件只有 `docs/PROJECT-MAP.md` 与 6 个 `docs/PROJECT-MAP-FUNCTIONS-*.md`。`out/` 目录是**此前一次工程健康检查**留下的验证证据（见 §2.2），本次只读不写。

### 0.4 交付前自查结果（详见 §8）

- 抽查 **24** 条 `文件:行号` 引用，全部指向所述代码（清单见 §8.1）
- 文件数：§2 表 **225** 行 = 目录树 **225** 个叶子；`git ls-files` 198 + 未提交 27 = 225 ✓（复核命令：`(git ls-files; git ls-files --others --exclude-standard) \| grep -v '^docs/PROJECT-MAP' \| wc -l`）
- 函数数：§3 各附录合计 **1292+869+290+15+28+11 = 2505**，与 §3.1 一致 ✓
- 路径存在性：全文 **305** 条仓库相对路径（`apps/**`、`docs/**`、`.github/**`、`out/**`，去掉 `:行号` 后缀后）经 `os.path.exists` 校验，**304** 条存在；唯一例外 `out/main/index.js` 是 `package.json#main` 的原始写法，紧随其后已注明实际路径 ✓
- 行号有效性：全文 **248** 条 `文件:行号` 引用经脚本解析（含短名到全路径的映射）后逐条比对文件行数，**0** 条越界或指向不存在的文件 ✓
- 未说明条目：**无**；其中 723 条为函数体机械摘要，已显式标注来源（见 §8.4）

---

## 1. 仓库总览

### 1.1 定位与技术栈

一句话：**一个 Electron 桌面 AI 助手，外加一个把同一套前端与主进程业务代码搬进浏览器的 Web 服务**。Web 端不是重写，而是「换壳 + 换传输」——前端代码零改动，`window.deva` 由 HTTP/SSE 版 shim 提供，主进程业务逻辑跑在每个用户一个的 Node 子进程里。

| 层 | 技术 | 证据 |
|---|---|---|
| 桌面壳 | Electron 33.4.11、electron-vite 2.3.0、electron-builder 26.17.0 | `apps/desktop/package.json` devDependencies |
| 主进程语言 | TypeScript 5.7（CJS 产物），node-pty 走 `@lydell/node-pty` 1.2.0-beta.15 | 同上 dependencies |
| 渲染层 | React 18.3 + Lexical 0.52（输入框）+ lucide-react + react-markdown/rehype-highlight/remark-gfm + Humation 头像 | 同上 devDependencies |
| 终端 UI | `@xterm/xterm` 6.0 + `@xterm/addon-fit` | 同上 |
| 外部集成 | `@modelcontextprotocol/sdk`（MCP）、`@larksuiteoapi/node-sdk`（飞书）、`qrcode`（扫码建机器人）、`fflate`（Office 文档解压）、`ignore`（gitignore 语义） | 同上 |
| 构建 | electron-vite（桌面三进程）+ esbuild 0.21（Web 三产物） | `apps/desktop/electron.vite.config.ts:6`、`apps/web/build.mjs:35` |
| 包管理 | pnpm 10.8.0，`node-linker=hoisted`，Node ≥ 20 | `package.json` `packageManager`/`engines`、`.npmrc` |
| Web 服务端 | 纯 Node ESM，零框架（`node:http` 手写路由），仅 devDependency esbuild | `apps/web/package.json`、`apps/web/server.mjs:907` |

无明显框架层（无 Express/Nest/Next），路由、会话、静态托管、审计全部手写在 `apps/web/server.mjs`（1111 行）。这一点直接决定了 §5 的所有安全结论都要按「手写代码逐条看」来验，而不能指望框架中间件。

### 1.2 文件级目录树（225 个纳入清单的文件）

生成方式：`(git ls-files; git ls-files --others --exclude-standard)` 得到 225 个路径，按目录递归建树；只为文件建叶（`node_modules`、`out/`、`dist/` 等产物目录不在其中，见 §2.3）。

```
.
├── .github/
│   ├── scripts/
│   │   └── release-notes.mjs
│   └── workflows/
│       ├── ci.yml
│       ├── pages.yml
│       └── release.yml
├── apps/
│   ├── desktop/
│   │   ├── build/
│   │   │   ├── icons/
│   │   │   │   ├── 1024x1024.png
│   │   │   │   ├── 128x128.png
│   │   │   │   ├── 16x16.png
│   │   │   │   ├── 24x24.png
│   │   │   │   ├── 256x256.png
│   │   │   │   ├── 32x32.png
│   │   │   │   ├── 48x48.png
│   │   │   │   ├── 512x512.png
│   │   │   │   └── 64x64.png
│   │   │   ├── linux/
│   │   │   │   └── apparmor-profile.tpl
│   │   │   ├── icon-mac.png
│   │   │   ├── icon.ico
│   │   │   ├── icon.png
│   │   │   ├── icon.svg
│   │   │   └── installer.nsh
│   │   ├── scripts/
│   │   │   ├── adhoc-sign.cjs
│   │   │   ├── after-pack.cjs
│   │   │   ├── gen-icon.mjs
│   │   │   ├── linux-launcher.cjs
│   │   │   └── portable-zip.cjs
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── anthropic.ts
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── openai-responses.ts
│   │   │   │   │   ├── openai.ts
│   │   │   │   │   ├── opencode.ts
│   │   │   │   │   ├── sse.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── browser/
│   │   │   │   │   │   ├── host.ts
│   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   ├── live.ts
│   │   │   │   │   │   ├── page-scripts.ts
│   │   │   │   │   │   ├── pages.ts
│   │   │   │   │   │   └── url.ts
│   │   │   │   │   ├── remote/
│   │   │   │   │   │   ├── feishu-onboard.ts
│   │   │   │   │   │   ├── feishu.ts
│   │   │   │   │   │   ├── hub.ts
│   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   ├── paginate.ts
│   │   │   │   │   │   ├── store.ts
│   │   │   │   │   │   ├── telegram-onboard.ts
│   │   │   │   │   │   ├── telegram.ts
│   │   │   │   │   │   └── types.ts
│   │   │   │   │   ├── appimage.ts
│   │   │   │   │   ├── attachments.ts
│   │   │   │   │   ├── avatar-image.ts
│   │   │   │   │   ├── chat-bus.ts
│   │   │   │   │   ├── chat-store.ts
│   │   │   │   │   ├── chat.ts
│   │   │   │   │   ├── checkpoints.ts
│   │   │   │   │   ├── clipboard.ts
│   │   │   │   │   ├── compaction.ts
│   │   │   │   │   ├── config.ts
│   │   │   │   │   ├── decision.ts
│   │   │   │   │   ├── default-personas.ts
│   │   │   │   │   ├── deliverables.ts
│   │   │   │   │   ├── deva-personas.ts
│   │   │   │   │   ├── exec-policy.ts
│   │   │   │   │   ├── ext-roles.ts
│   │   │   │   │   ├── frontmatter.ts
│   │   │   │   │   ├── fs-guard.ts
│   │   │   │   │   ├── git.ts
│   │   │   │   │   ├── handoff.ts
│   │   │   │   │   ├── image-read.ts
│   │   │   │   │   ├── image-trim.ts
│   │   │   │   │   ├── line-stats.ts
│   │   │   │   │   ├── listing.ts
│   │   │   │   │   ├── mcp-config.ts
│   │   │   │   │   ├── mcp.ts
│   │   │   │   │   ├── media-store.ts
│   │   │   │   │   ├── members.ts
│   │   │   │   │   ├── memory.ts
│   │   │   │   │   ├── model-resolve.ts
│   │   │   │   │   ├── model-view.ts
│   │   │   │   │   ├── office-text.ts
│   │   │   │   │   ├── personas.ts
│   │   │   │   │   ├── portable.ts
│   │   │   │   │   ├── profile.ts
│   │   │   │   │   ├── project-doc.ts
│   │   │   │   │   ├── provider.ts
│   │   │   │   │   ├── repetition.ts
│   │   │   │   │   ├── reply-notify.ts
│   │   │   │   │   ├── schedule.ts
│   │   │   │   │   ├── scheduler.ts
│   │   │   │   │   ├── sealed.ts
│   │   │   │   │   ├── secrets.ts
│   │   │   │   │   ├── shells.ts
│   │   │   │   │   ├── skills.ts
│   │   │   │   │   ├── subagent-store.ts
│   │   │   │   │   ├── subagents.ts
│   │   │   │   │   ├── tasks-types.ts
│   │   │   │   │   ├── tasks.ts
│   │   │   │   │   ├── terminal.ts
│   │   │   │   │   ├── todos.ts
│   │   │   │   │   ├── tool-results.ts
│   │   │   │   │   ├── tool-search.ts
│   │   │   │   │   ├── tools.ts
│   │   │   │   │   ├── tray-icon.ts
│   │   │   │   │   ├── updater.ts
│   │   │   │   │   ├── workspace.ts
│   │   │   │   │   └── xiaomajiang-personas.ts
│   │   │   │   ├── http.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── locale.ts
│   │   │   │   └── pty-host.ts
│   │   │   ├── preload/
│   │   │   │   ├── index.d.ts
│   │   │   │   └── index.ts
│   │   │   ├── renderer/
│   │   │   │   ├── src/
│   │   │   │   │   ├── assets/
│   │   │   │   │   │   └── platforms/
│   │   │   │   │   │       ├── feishu.svg
│   │   │   │   │   │       └── telegram.svg
│   │   │   │   │   ├── components/
│   │   │   │   │   │   ├── DialogProvider.tsx
│   │   │   │   │   │   ├── humation.tsx
│   │   │   │   │   │   ├── Modal.tsx
│   │   │   │   │   │   ├── Select.tsx
│   │   │   │   │   │   └── ToastProvider.tsx
│   │   │   │   │   ├── features/
│   │   │   │   │   │   ├── browser/
│   │   │   │   │   │   │   ├── browser.css
│   │   │   │   │   │   │   ├── BrowserCapsule.tsx
│   │   │   │   │   │   │   ├── BrowserChrome.tsx
│   │   │   │   │   │   │   ├── capsule.css
│   │   │   │   │   │   │   ├── shared.tsx
│   │   │   │   │   │   │   └── text.ts
│   │   │   │   │   │   ├── chat/
│   │   │   │   │   │   │   ├── BackgroundTasks.tsx
│   │   │   │   │   │   │   ├── blocks.tsx
│   │   │   │   │   │   │   ├── DeliverablesCard.tsx
│   │   │   │   │   │   │   ├── dockOrder.ts
│   │   │   │   │   │   │   ├── Markdown.tsx
│   │   │   │   │   │   │   ├── ModelSetupCard.tsx
│   │   │   │   │   │   │   ├── schedule.ts
│   │   │   │   │   │   │   ├── ScheduleEditor.tsx
│   │   │   │   │   │   │   ├── TaskConfirmCard.tsx
│   │   │   │   │   │   │   ├── TaskPickers.tsx
│   │   │   │   │   │   │   └── Todos.tsx
│   │   │   │   │   │   └── settings/
│   │   │   │   │   │       ├── ModelDetail.tsx
│   │   │   │   │   │       ├── ModelSettings.tsx
│   │   │   │   │   │       └── Switch.tsx
│   │   │   │   │   ├── i18n/
│   │   │   │   │   │   ├── i18n.tsx
│   │   │   │   │   │   └── messages.ts
│   │   │   │   │   ├── mock/
│   │   │   │   │   │   ├── extensions.ts
│   │   │   │   │   │   └── models.ts
│   │   │   │   │   ├── redesign/
│   │   │   │   │   │   ├── attachments.tsx
│   │   │   │   │   │   ├── AvatarEditor.tsx
│   │   │   │   │   │   ├── BotsPane.tsx
│   │   │   │   │   │   ├── ChatFirstShell.tsx
│   │   │   │   │   │   ├── composer-editor.ts
│   │   │   │   │   │   ├── memory-editor.ts
│   │   │   │   │   │   ├── ProfilePanel.tsx
│   │   │   │   │   │   ├── redesign.css
│   │   │   │   │   │   ├── resizable.tsx
│   │   │   │   │   │   ├── RewindModal.tsx
│   │   │   │   │   │   └── UpdateSection.tsx
│   │   │   │   │   ├── store/
│   │   │   │   │   │   ├── chat.tsx
│   │   │   │   │   │   ├── extensions.tsx
│   │   │   │   │   │   ├── models.tsx
│   │   │   │   │   │   ├── profile.tsx
│   │   │   │   │   │   ├── tasks.tsx
│   │   │   │   │   │   └── workspace.tsx
│   │   │   │   │   ├── styles/
│   │   │   │   │   │   ├── app.css
│   │   │   │   │   │   └── tokens.css
│   │   │   │   │   ├── theme/
│   │   │   │   │   │   ├── chatFontSize.ts
│   │   │   │   │   │   └── ThemeContext.tsx
│   │   │   │   │   ├── App.tsx
│   │   │   │   │   ├── browser-main.tsx
│   │   │   │   │   ├── env.d.ts
│   │   │   │   │   └── main.tsx
│   │   │   │   ├── browser.html
│   │   │   │   └── index.html
│   │   │   └── shared/
│   │   │       ├── avatar-shape.ts
│   │   │       ├── browser.ts
│   │   │       ├── context.ts
│   │   │       ├── deliverables.ts
│   │   │       ├── effort.ts
│   │   │       ├── limits.ts
│   │   │       ├── mention.ts
│   │   │       ├── quote.ts
│   │   │       ├── slash.ts
│   │   │       └── update.ts
│   │   ├── electron-builder.yml
│   │   ├── electron.vite.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   └── tsconfig.web.json
│   └── web/
│       ├── docs/
│       │   └── web-migration.md
│       ├── src/
│       │   ├── backend/
│       │   │   ├── chromium.mjs
│       │   │   ├── electron-shim.mjs
│       │   │   ├── index.ts
│       │   │   └── updater-stub.mjs
│       │   ├── server/
│       │   │   ├── auth.mjs
│       │   │   ├── backend-pool.mjs
│       │   │   ├── pages.mjs
│       │   │   ├── updater.mjs
│       │   │   ├── util.mjs
│       │   │   └── worker-host.mjs
│       │   ├── web/
│       │   │   ├── favicon.ico
│       │   │   ├── favicon.svg
│       │   │   ├── mobile.css
│       │   │   ├── picker.css
│       │   │   └── picker.js
│       │   ├── electron-shim.js
│       │   └── handlers.mjs
│       ├── test/
│       │   └── smoke.mjs
│       ├── build.mjs
│       ├── docker-compose.yml
│       ├── docker-entrypoint.sh
│       ├── Dockerfile
│       ├── package.json
│       ├── README.md
│       └── server.mjs
├── docs/
│   ├── .nojekyll
│   ├── index.html
│   ├── screenshot.en.png
│   └── screenshot.png
├── .dockerignore
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .npmrc
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.en.md
└── README.md
```

> 说明：`docs/` 下的 6 个 `PROJECT-MAP-FUNCTIONS-*.md` 与本文件是本次新增，尚未 `git add`，故不在此树内（它们本身是本次交付物，见 §3.5）。树中只列文件、不列产物目录——`apps/desktop/out/`、`apps/web/dist/`、根 `out/`、`node_modules/` 的来历见 §2.3。

### 1.3 pnpm workspace 结构

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- 实际成员：`apps/desktop`（`@deva/desktop@0.1.15`）、`apps/web`（`@deva/web@0.1.15`，`private: true`）
- `packages/*` 已在声明里，但**目录尚未创建**——这是留给未来抽公共包的占位（当前所有共享代码走 `apps/desktop/src/shared` 与 esbuild alias `@deva/main`）
- 根包 `package.json` 不发布（`private: true`），只承载脚本与 `pnpm.onlyBuiltDependencies`：`electron`、`electron-winstaller`、`esbuild`、`@parcel/watcher`——pnpm 10 默认不执行依赖的 install 脚本，这 4 个必须放行才能拿到二进制（Electron 运行时、esbuild 原生二进制等）
- `.npmrc` 三件事：npmmirror 源 + Electron/electron-builder-binaries 镜像；`node-linker=hoisted`（electron-builder 对 pnpm 的符号链接结构支持不佳，必须扁平化）

### 1.4 命令链：每条命令实际做了什么

#### 根目录脚本（`package.json`）

| 命令 | 实际执行 | 说明 |
|---|---|---|
| `pnpm dev` | `pnpm --filter @deva/desktop dev` → `electron-vite dev` | 起 Vite dev server（固定 `127.0.0.1:5173`，`strictPort`），编译 main/preload，启动 Electron 并 `loadURL(ELECTRON_RENDERER_URL)`（`apps/desktop/src/main/index.ts:210`） |
| `pnpm build` | `pnpm --filter @deva/desktop build` → `electron-vite build` | 产出 `apps/desktop/out/{main,preload,renderer}`，**不打包安装包** |
| `pnpm build:web` | 桌面 build **再** Web build | 顺序不可颠倒：`apps/web/build.mjs` 一开头就检查 `apps/desktop/out/renderer` 是否存在，缺则退出（`build.mjs:25-30`） |
| `pnpm start` | `electron-vite preview` | 用已构建产物启动 Electron（打开发布形态的窗口） |
| `pnpm start:web` | `node server.mjs`（cwd = `apps/web`） | 起 Web 网关，默认 `0.0.0.0:7080`（`server.mjs:40-41`） |
| `pnpm typecheck` | 只检查桌面：`tsc --noEmit -p tsconfig.node.json` + `tsc --noEmit -p tsconfig.web.json` | **Web 层不在 typecheck 覆盖内**（`apps/web` 无 typecheck 脚本；`apps/web/src/backend/index.ts` 依赖 esbuild alias，无法单独 tsc，见 `out/REPORT.md:321`） |
| `pnpm package:win/mac/linux` | `electron-vite build && electron-builder --win/--mac/--linux` | 真出安装包，见 §1.4.3 |

#### `apps/desktop` 脚本

| 命令 | 实际执行 | 说明 |
|---|---|---|
| `dev` / `build` / `start` | 同上 | — |
| `typecheck:node` | `tsc --noEmit -p tsconfig.node.json --composite false` | 覆盖 `src/main`、`src/preload`、`src/shared`、`electron.vite.config.ts` |
| `typecheck:web` | `tsc --noEmit -p tsconfig.web.json --composite false` | 覆盖 `src/renderer`、`src/preload/index.d.ts` |
| `build:win` / `build:mac` / `build:linux` | build + electron-builder 对应平台 | — |

#### `apps/web` 脚本

| 命令 | 实际执行 | 说明 |
|---|---|---|
| `build` | `node build.mjs` | 3 次 esbuild + node-pty 软链 + 写 3 个元数据文件，见 §4.5 |
| `start` | `node server.mjs` | 读 `dist/manifest.json`（`server.mjs:33`）与 `dist/shim.js`（`server.mjs:34`），**必须先 build** |

#### 打包钩子（electron-builder 调用，不是人手动跑的）

| 钩子 | 文件 | 做什么 |
|---|---|---|
| `afterPack` | `apps/desktop/scripts/after-pack.cjs` | 唯一入口，按平台分派：macOS → `adhoc-sign.cjs`（`codesign --sign -`），Linux → `linux-launcher.cjs`（把 `deva` 换成启动脚本，真 Electron 改名 `deva-bin`，补 Wayland 参数） |
| `afterAllArtifactBuild` | `apps/desktop/scripts/portable-zip.cjs` | Windows 便携 zip 套一层 `Deva/` 目录 |
| （构建资源配置里引用） | `build/installer.nsh` | NSIS 宏：装到无写权限目录时提前拦截 |
| （构建资源配置里引用） | `build/linux/apparmor-profile.tpl` | deb 包 AppArmor 模板：放行 `deva` 与 `deva-bin` 的 userns |
| （手动） | `apps/desktop/scripts/gen-icon.mjs` | 零依赖从 `build/icon.svg` 生成 `icon.png`/`icon.ico`/`icon-mac.png`/`build/icons/*`；**不在任何 npm script 里**，只能在 `apps/desktop` 下手动 `node scripts/gen-icon.mjs` |

#### CI / 发布（`.github/workflows`）

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | PR、push main | `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm build`（Node 22，`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。**不跑 Web 构建、不跑任何测试** |
| `pages.yml` | 手动 `workflow_dispatch` | 把 `docs/` 原样发布到 GitHub Pages |
| `release.yml` | push `v*` tag 或手动 | 矩阵打包 win-x64 / mac-arm64 / mac-x64 / linux-x64，产物传 GitHub Release；版本说明由 `.github/scripts/release-notes.mjs` 按提交前缀分组生成 |

> 值得注意的缺口：仓库**没有 lint、没有单元测试**（无 eslint/prettier/biome 配置、无 `*.test.*`）。唯一的自动化测试是 `apps/web/test/smoke.mjs`（14 项端到端断言），但它不在 CI 里，需要手动对着一个已启动的实例跑。

### 1.5 构建产物从哪来（不逐文件列，但要说清来源）

| 目录 | 谁生成 | 内容 |
|---|---|---|
| `node_modules/` | `pnpm install` | 依赖；`.npmrc` 用 hoisted 布局 |
| `apps/desktop/out/` | `pnpm build`（electron-vite） | `main/index.js`、`main/pty-host.js`、`preload/index.js`、`renderer/index.html` + `assets/*`、`renderer/browser.html` |
| `apps/web/dist/` | `pnpm --filter @deva/web build`（esbuild） | `shim.js`（浏览器 IIFE）、`backend.cjs`（Node CJS）、`pty-host.js`（Node CJS）、`node_modules/@lydell`（软链）、`package.json`（`{"type":"commonjs"}`）、`manifest.json`、`build-info.json` |
| 根 `out/` | 人工运行的检查脚本 | 30 个验证证据文件（探针脚本、前后对比文本、日志、基线副本、报告），**被 `.gitignore` 第 7 行忽略**，不入库 |
| `apps/web/out/` | 此前会话的临时 UI 检查 | 7 个 `.mjs`（`ui-v15.mjs`、`mobile-flow.mjs` 等）+ `shots/` 8 张截图，同样是本地草稿，不入库 |
| `.tmp/` | `out/typecheck-web-backend.sh` 运行期创建 | 临时 tsconfig，脚本退出时自删 |

---

## 2. 文件清单

### 2.1 全量文件表（225 个）

口径见 §0.2。列含义：

- **层**：文件归属的架构层（桌面·主进程 / 桌面·预加载 / 桌面·渲染层 / 桌面·共享 / 桌面·打包钩子 / 桌面·构建资源 / 桌面·工程配置 / Web·网关 / Web·服务 / Web·后端兼容层 / Web·前端壳 / Web·测试 / Web·工程配置 / Web·部署 / CI / 文档 / 文档/资源 / 仓库根）
- **类型**：源码 / 配置 / 文档 / 资源 / 样式 / 页面 / 生成物
- **行数 / 函数条目数**：来自 §3 的 AST 统计；`—` 表示该文件不是源码文件（未参与函数统计）
- **生成物标记**：该文件是否由命令生成（是证据/产物而非手写源）

| 文件 | 层 | 类型 | 行数 | 函数条目 | 一句话职责 | 生成物 |
|---|---|---|---:|---:|---|---|
| `.dockerignore` | 仓库根 | 配置 | — | — | Docker 构建上下文排除清单：排除依赖、产物与 core dump；刻意保留 .git，因为 apps/web/build.mjs 要读 HEAD 写进 build-info.json。 | — |
| `.editorconfig` | 仓库根 | 配置 | — | — | 编辑器通用配置，只约定行尾等基础项。 | — |
| `.gitattributes` | 仓库根 | 配置 | — | — | 统一把文本文件按 LF 检出，避免 Windows 上 core.autocrlf 造成整仓 diff。 | — |
| `.github/scripts/release-notes.mjs` | CI | 源码 | 68 | 2 | 发版说明生成器：取上一个版本 tag 到本次之间的提交，按 feat/fix 等前缀分组成 Markdown 草稿。 | — |
| `.github/workflows/ci.yml` | CI | 配置 | — | — | CI：PR 与推 main 时按冻结锁文件安装，跑 pnpm typecheck 与 pnpm build（Node 22，跳过 Electron 二进制下载）。 | — |
| `.github/workflows/pages.yml` | CI | 配置 | — | — | 手动触发，把 docs/ 目录发布到 GitHub Pages（项目落地页与截图）。 | — |
| `.github/workflows/release.yml` | CI | 配置 | — | — | v* 标签触发的多平台打包与发版工作流（Windows / macOS / Linux 产物上传到 GitHub Release）。 | — |
| `.gitignore` | 仓库根 | 配置 | — | — | 忽略依赖、构建产物（dist/、out/）、日志、编辑器与本地数据目录（.deva/、.claude/）以及 .env。 | — |
| `.npmrc` | 仓库根 | 配置 | — | — | pnpm 配置：npmmirror 源与 Electron 二进制镜像；node-linker=hoisted 让 electron-builder 能正确打包。 | — |
| `LICENSE` | 仓库根 | 配置 | — | — | MIT 许可证全文（版权方 sqfcy，2026）。 | — |
| `README.en.md` | 仓库根 | 文档 | — | — | 英文版项目说明：功能、成员协作、工具参考、安全模型与从源码构建。 | — |
| `README.md` | 仓库根 | 文档 | — | — | 中文版项目说明：定位、模型破甲、成员协作、功能、快速开始、工作方式、工具参考、扩展、安全模型、构建步骤。 | — |
| `apps/desktop/build/icon-mac.png` | 桌面·构建资源 | 资源 | — | — | macOS 图标（1024px，按系统网格留透明边距），由 electron-builder 转 icns。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icon.ico` | 桌面·构建资源 | 资源 | — | — | Windows 多尺寸 ICO 图标（16~256）。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icon.png` | 桌面·构建资源 | 资源 | — | — | 应用图标 1024px 满幅版本，README 展示与 Linux 图标基准。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icon.svg` | 桌面·构建资源 | 资源 | — | — | 图标矢量源文件，图标位图由 scripts/gen-icon.mjs 按它零依赖生成。 | — |
| `apps/desktop/build/icons/1024x1024.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 1024px 尺寸（最大档）。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/128x128.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 128px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/16x16.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 16px 尺寸（16/24/32/48/64/128/256/512/1024 共九档，由 gen-icon.mjs 生成）。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/24x24.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 24px 尺寸（其余尺寸同此，均由 gen-icon.mjs 从 icon.png 缩放生成）。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/256x256.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 256px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/32x32.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 32px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/48x48.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 48px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/512x512.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 512px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/icons/64x64.png` | 桌面·构建资源 | 资源 | — | — | Linux 桌面图标 64px 尺寸。 | 生成物：gen-icon.mjs |
| `apps/desktop/build/installer.nsh` | 桌面·构建资源 | 配置 | — | — | NSIS 安装器自定义宏：安装到无写权限目录时提前拦截并说明，避免误报「Deva 无法关闭」。 | — |
| `apps/desktop/build/linux/apparmor-profile.tpl` | 桌面·构建资源 | 配置 | — | — | deb 包 AppArmor 配置模板：放开 userns 以允许 Chromium 沙箱，同时匹配启动脚本 deva 与真实可执行文件 deva-bin。 | — |
| `apps/desktop/electron-builder.yml` | 桌面·工程配置 | 配置 | — | — | 打包配置：appId dev.sqfcy.deva、asar、afterPack/afterAllArtifactBuild 钩子、Windows NSIS+zip、macOS dmg、Linux AppImage+deb 与 AppArmor 模板。 | — |
| `apps/desktop/electron.vite.config.ts` | 桌面·工程配置 | 源码 | 52 | 0 | electron-vite 配置：main 双入口（index 与 pty-host）、preload 外部化依赖、renderer 的 @renderer 别名与 __APP_VERSION__ 注入、固定 127.0.0.1:5173 开发端口。 | — |
| `apps/desktop/package.json` | 桌面·工程配置 | 配置 | — | — | 桌面应用包定义：版本 0.1.15、main 指向 out/main/index.js、dev/build/start/typecheck/build:win|mac|linux 脚本与全部依赖。 | — |
| `apps/desktop/scripts/adhoc-sign.cjs` | 桌面·打包钩子 | 源码 | 29 | 0 | electron-builder afterPack 钩子：给 macOS 产物做 ad-hoc 签名（codesign --sign -）。 | — |
| `apps/desktop/scripts/after-pack.cjs` | 桌面·打包钩子 | 源码 | 10 | 0 | electron-builder afterPack 钩子入口（只能配一个）：按平台分派给 adhoc-sign / linux-launcher 等子钩子。 | — |
| `apps/desktop/scripts/gen-icon.mjs` | 桌面·打包钩子 | 源码 | 153 | 8 | 图标生成器：零依赖从 build/icon.svg 生成 icon.png、icon.ico、icon-mac.png 与 build/icons 各尺寸。 | — |
| `apps/desktop/scripts/linux-launcher.cjs` | 桌面·打包钩子 | 源码 | 33 | 0 | electron-builder afterPack 钩子（Linux）：把 deva 换成启动脚本，真正的 Electron 改名 deva-bin。 | — |
| `apps/desktop/scripts/portable-zip.cjs` | 桌面·打包钩子 | 源码 | 55 | 1 | electron-builder afterAllArtifactBuild 钩子：给 Windows 便携版 zip 套一层 Deva/ 目录。 | — |
| `apps/desktop/src/main/http.ts` | 桌面·主进程 | 源码 | 254 | 16 | 统一出站 HTTP：默认用 Chromium 会话池发起请求，判定未送达时在直连与系统代理两条线路间切换重试。 | — |
| `apps/desktop/src/main/index.ts` | 桌面·主进程 | 源码 | 437 | 12 | Electron 主进程入口：单实例锁、创建主窗口与托盘、按序注册全部 IPC 业务模块、退出前结算进行中的回合。 | — |
| `apps/desktop/src/main/locale.ts` | 桌面·主进程 | 源码 | 9 | 1 | 主进程侧的中/英文案：错误提示等会显示给用户的文字按界面语言产出。 | — |
| `apps/desktop/src/main/providers/anthropic.ts` | 桌面·主进程 | 源码 | 300 | 8 | Anthropic Messages 适配器：内容块映射、流式解析、停止原因归一与用量统计。 | — |
| `apps/desktop/src/main/providers/index.ts` | 桌面·主进程 | 源码 | 68 | 3 | Provider 门面：按 adapter 类型把请求分派给 anthropic / openai / responses 三个流式实现，并统一注入密钥与错误归一。 | — |
| `apps/desktop/src/main/providers/openai-responses.ts` | 桌面·主进程 | 源码 | 306 | 3 | OpenAI Responses 适配器：流式解析推理/函数调用/用量事件，按工具调用收尾。 | — |
| `apps/desktop/src/main/providers/openai.ts` | 桌面·主进程 | 源码 | 375 | 7 | OpenAI Chat Completions 适配器：流式解析文本、推理与工具调用，含 finish_reason 映射与参数修复。 | — |
| `apps/desktop/src/main/providers/opencode.ts` | 桌面·主进程 | 源码 | 66 | 3 | OpenCode Console 网关的两个硬要求：每对话稳定的 x-opencode-session 头与自有 User-Agent，缺一则请求被拒。 | — |
| `apps/desktop/src/main/providers/sse.ts` | 桌面·主进程 | 源码 | 80 | 3 | SSE 流读取与空闲判定：60 秒无字节即判连接僵死，抛可重试的 StreamIdleError。 | — |
| `apps/desktop/src/main/providers/types.ts` | 桌面·主进程 | 源码 | 370 | 9 | Provider 归一化类型：各适配器与编排层之间的请求、事件、用量与停止原因定义。 | — |
| `apps/desktop/src/main/pty-host.ts` | 桌面·主进程 | 源码 | 103 | 4 | PTY 宿主：跑在独立 Utility Process 里的终端进程，主进程不直接加载 node-pty 原生模块。 | — |
| `apps/desktop/src/main/services/appimage.ts` | 桌面·主进程 | 源码 | 79 | 3 | Linux AppImage 集成：把内嵌的 desktop 条目与图标写到用户目录并指向当前路径，失败静默。 | — |
| `apps/desktop/src/main/services/attachments.ts` | 桌面·主进程 | 源码 | 339 | 10 | 附件 IPC：粘贴落盘（内容哈希去重）、拖入条目、图片读取与系统选文件。 | — |
| `apps/desktop/src/main/services/avatar-image.ts` | 桌面·主进程 | 源码 | 84 | 4 | 自定义头像落盘：同一 name 只保留一张图，写入前清掉所有扩展名变体，读回时按扩展名还原 MIME。 | — |
| `apps/desktop/src/main/services/browser/host.ts` | 桌面·主进程 | 源码 | 669 | 55 | 「Deva 浏览器」窗口：所有前台对话的网页共用一个窗口（标签带角色头像），收起时挪到屏幕外继续渲染。 | — |
| `apps/desktop/src/main/services/browser/index.ts` | 桌面·主进程 | 源码 | 926 | 28 | browser 工具：让模型用真实 Chromium 打开、点击、输入、截图并保留登录态。 | — |
| `apps/desktop/src/main/services/browser/live.ts` | 桌面·主进程 | 源码 | 93 | 6 | 胶囊实时预览：对网页开 CDP Page.startScreencast，有变化才推一帧缩小 JPEG 给主窗口。 | — |
| `apps/desktop/src/main/services/browser/page-scripts.ts` | 桌面·主进程 | 源码 | 378 | 1 | 注入网页执行的脚本源码（自包含、只用浏览器 API，不参与主进程类型检查）。 | — |
| `apps/desktop/src/main/services/browser/pages.ts` | 桌面·主进程 | 源码 | 424 | 35 | 内置浏览器网页登记与宿主：window（前台可见）与 offscreen（后台离屏）两种宿主，按对话归属标签。 | — |
| `apps/desktop/src/main/services/browser/url.ts` | 桌面·主进程 | 源码 | 29 | 1 | 网址规范化：补协议（本机/内网补 http，其余 https）、本机路径转 file:、拒绝 javascript:/chrome: 等危险协议。 | — |
| `apps/desktop/src/main/services/chat-bus.ts` | 桌面·主进程 | 源码 | 69 | 8 | 进程内事件总线：会话、技能、MCP、终端、任务、浏览器、更新等主题的发布订阅，监听者异常不打断发布方。 | — |
| `apps/desktop/src/main/services/chat-store.ts` | 桌面·主进程 | 源码 | 616 | 24 | 对话存盘：会话索引、按压缩边界拆分的 transcript 文件、原子写入与列表元信息。 | — |
| `apps/desktop/src/main/services/chat.ts` | 桌面·主进程 | 源码 | 6801 | 192 | 会话编排（Agent 主循环）：流式生成 → 收集工具调用 → 权限闸门 → 执行 → 结果回灌，并注册全部对话 IPC。 | — |
| `apps/desktop/src/main/services/checkpoints.ts` | 桌面·主进程 | 源码 | 634 | 24 | 回合检查点：每轮记录文件改动快照，支持按轮回滚并汇总增删行数。 | — |
| `apps/desktop/src/main/services/clipboard.ts` | 桌面·主进程 | 源码 | 22 | 3 | 系统剪贴板 IPC 桥（读文本、写文本）。 | — |
| `apps/desktop/src/main/services/compaction.ts` | 桌面·主进程 | 源码 | 713 | 30 | 上下文压缩：按 token 预算触发，插入摘要消息而不删历史，并维护压缩边界。 | — |
| `apps/desktop/src/main/services/config.ts` | 桌面·主进程 | 源码 | 102 | 10 | 配置读写：把 config.json 载入内存、按补丁浅合并写回，并注册配置 IPC。 | — |
| `apps/desktop/src/main/services/decision.ts` | 桌面·主进程 | 源码 | 208 | 9 | 工具调用权限判定与错误归一：区分需确认/自动放行，把异常收拾成可回灌模型的说明。 | — |
| `apps/desktop/src/main/services/default-personas.ts` | 桌面·主进程 | 源码 | 56 | 0 | 默认角色注册表：每个角色是自包含常量（身份、主题色、提示词），由 DEFAULT_PERSONAS 收拢供首启种子化。 | — |
| `apps/desktop/src/main/services/deliverables.ts` | 桌面·主进程 | 源码 | 127 | 8 | 交付卡 IPC：按会话的 delivered 记录取文件、缩略图、打开与定位，不接受任意路径。 | — |
| `apps/desktop/src/main/services/deva-personas.ts` | 桌面·主进程 | 源码 | 28 | 0 | 内置角色「Deva」的身份与系统提示词常量。 | — |
| `apps/desktop/src/main/services/exec-policy.ts` | 桌面·主进程 | 源码 | 67 | 2 | run_command 的执行 shell 解析（纯函数：按平台与用户配置决定用哪个 shell、带什么参数）。 | — |
| `apps/desktop/src/main/services/ext-roles.ts` | 桌面·主进程 | 源码 | 85 | 7 | 技能 / MCP 的「可用角色」映射读写（config.json 对应节），过滤非法项。 | — |
| `apps/desktop/src/main/services/frontmatter.ts` | 桌面·主进程 | 源码 | 157 | 7 | 极简零依赖 frontmatter 解析器（够用即可，不引 YAML 库以减依赖与攻击面）。 | — |
| `apps/desktop/src/main/services/fs-guard.ts` | 桌面·主进程 | 源码 | 123 | 10 | 受信根守卫：只约束渲染层发起的 fs/git IPC，路径须先经 isInsideRoot 校验；Agent 的文件工具不经过这里。 | — |
| `apps/desktop/src/main/services/git.ts` | 桌面·主进程 | 源码 | 1039 | 52 | Git 服务：调用系统 git 命令行实现状态、diff、暂存、提交、分支与远程操作，零凭据存储。 | — |
| `apps/desktop/src/main/services/handoff.ts` | 桌面·主进程 | 源码 | 240 | 10 | 定时任务的结果交接：绑定主对话的任务跑完后把结果送回该会话。 | — |
| `apps/desktop/src/main/services/image-read.ts` | 桌面·主进程 | 源码 | 164 | 7 | 读取并整理图片附件：解码、按需缩放、生成发送用的图片 part 与原尺寸记录。 | — |
| `apps/desktop/src/main/services/image-trim.ts` | 桌面·主进程 | 源码 | 82 | 3 | 请求体积控制：历史回合的工具图片换成文字说明，当前回合只保留最近几块。 | — |
| `apps/desktop/src/main/services/line-stats.ts` | 桌面·主进程 | 源码 | 103 | 5 | 两段文本之间的增删行数统计（只计数，不产出 diff）。 | — |
| `apps/desktop/src/main/services/listing.ts` | 桌面·主进程 | 源码 | 278 | 16 | 清单随消息下发：技能清单、记忆条目、成员名单与按需加载工具的已告知状态，以文字块附在消息里保提示缓存前缀稳定。 | — |
| `apps/desktop/src/main/services/mcp-config.ts` | 桌面·主进程 | 源码 | 303 | 23 | MCP 服务配置：读写、校验、env/headers 的 secretRef 解密与变更监听。 | — |
| `apps/desktop/src/main/services/mcp.ts` | 桌面·主进程 | 源码 | 678 | 37 | MCP 客户端：按 transport 建连、拉取工具并转成 ToolSpec、维护连接状态与前端视图。 | — |
| `apps/desktop/src/main/services/media-store.ts` | 桌面·主进程 | 源码 | 201 | 11 | 媒体 blob 存储的引用扫描与清扫：删除无人引用的图片/附件文件。 | — |
| `apps/desktop/src/main/services/members.ts` | 桌面·主进程 | 源码 | 457 | 20 | 项目成员（多 Agent 协作）：成员名单的增删改与角色绑定。 | — |
| `apps/desktop/src/main/services/memory.ts` | 桌面·主进程 | 源码 | 359 | 23 | 记忆服务：global / project 两个作用域的记忆条目读写、限额与快照。 | — |
| `apps/desktop/src/main/services/model-resolve.ts` | 桌面·主进程 | 源码 | 143 | 6 | 子智能体模型引用解析：把 providerId:modelId 解析成可用的模型配置，失败一律回落父轮模型，永不抛错。 | — |
| `apps/desktop/src/main/services/model-view.ts` | 桌面·主进程 | 源码 | 90 | 9 | 「模型实际看到的部分」：压缩标记常量与按标记截取消息的纯函数，供压缩与存盘共用。 | — |
| `apps/desktop/src/main/services/office-text.ts` | 桌面·主进程 | 源码 | 185 | 11 | Office 文档取文本：从 docx/pptx/xlsx 包内解析 XML 还原文字，供模型读取。 | — |
| `apps/desktop/src/main/services/personas.ts` | 桌面·主进程 | 源码 | 513 | 36 | 角色（persona）：解析 md 的 frontmatter 与正文、首启种子化、增删改与头像关联清理。 | — |
| `apps/desktop/src/main/services/portable.ts` | 桌面·主进程 | 源码 | 51 | 4 | Windows 便携版的 AppUserModelId 注册表写入（显示名与图标），失败静默。 | — |
| `apps/desktop/src/main/services/profile.ts` | 桌面·主进程 | 源码 | 63 | 8 | 本机用户资料：读取与保存头像 spec / 自定义头像图，注册 profile IPC。 | — |
| `apps/desktop/src/main/services/project-doc.ts` | 桌面·主进程 | 源码 | 79 | 2 | 项目说明 AGENTS.md 的读取：只读工作区根一份、每轮开头读一次、按 32KiB 截断、失败静默。 | — |
| `apps/desktop/src/main/services/provider.ts` | 桌面·主进程 | 源码 | 101 | 6 | 服务商侧 IPC 与错误归一：按适配器拉取模型清单，注入解密密钥与网关头。 | — |
| `apps/desktop/src/main/services/remote/feishu-onboard.ts` | 桌面·主进程 | 源码 | 87 | 1 | 飞书扫码建机器人：用官方 SDK 的 registerApp 走 OAuth 设备授权，直接拿到 App ID / Secret 与扫码人 open_id。 | — |
| `apps/desktop/src/main/services/remote/feishu.ts` | 桌面·主进程 | 源码 | 562 | 30 | 飞书适配器：WebSocket 长连接收消息与卡片回调，去重、过滤、渲染成飞书消息并回送答复。 | — |
| `apps/desktop/src/main/services/remote/hub.ts` | 桌面·主进程 | 源码 | 1276 | 66 | 远程通道业务核心（平台无关）：IM 会话与 Deva 对话的绑定、回合视图聚合、指令解析与鉴权配对。 | — |
| `apps/desktop/src/main/services/remote/index.ts` | 桌面·主进程 | 源码 | 340 | 21 | 远程通道入口：适配器注册表、对外状态投影与全部 remote IPC。 | — |
| `apps/desktop/src/main/services/remote/paginate.ts` | 桌面·主进程 | 源码 | 49 | 3 | 按字符预算把回合块切成多页；正文在代码块处切开时给两页补上围栏，保证每页单独渲染正确。 | — |
| `apps/desktop/src/main/services/remote/store.ts` | 桌面·主进程 | 源码 | 155 | 12 | 机器人配置的持久化与规范化（平台、配对用户、回复方式与范围）。 | — |
| `apps/desktop/src/main/services/remote/telegram-onboard.ts` | 桌面·主进程 | 源码 | 84 | 2 | Telegram 添加机器人：长轮询 getUpdates 匹配含 /start 一次性码的私聊，完成认领。 | — |
| `apps/desktop/src/main/services/remote/telegram.ts` | 桌面·主进程 | 源码 | 714 | 41 | Telegram 适配器：校验 Token、设指令菜单、长轮询收消息与回调查询并渲染回复。 | — |
| `apps/desktop/src/main/services/remote/types.ts` | 桌面·主进程 | 源码 | 191 | 0 | 远程通道契约：平台无关的 hub 与各平台适配器之间的类型定义。 | — |
| `apps/desktop/src/main/services/repetition.ts` | 桌面·主进程 | 源码 | 111 | 5 | 复读检测：识别模型输出中逐字重复的区域（只看结构不认内容），命中即判定退化。 | — |
| `apps/desktop/src/main/services/reply-notify.ts` | 桌面·主进程 | 源码 | 125 | 5 | 系统通知：按待输入类型（提问/计划/浏览器操作/挂载）生成中英文正文并弹出。 | — |
| `apps/desktop/src/main/services/schedule.ts` | 桌面·主进程 | 源码 | 394 | 14 | 定时任务的日程计算：cron 解析与下次触发时间、时区校验、可读描述，纯函数。 | — |
| `apps/desktop/src/main/services/scheduler.ts` | 桌面·主进程 | 源码 | 270 | 11 | 调度器：定时 tick 计算应触发的任务并逐个入队执行，单次异常不影响后续。 | — |
| `apps/desktop/src/main/services/sealed.ts` | 桌面·主进程 | 源码 | 64 | 1 | 密封无头执行的权限判定（纯函数）：定时任务运行时不弹窗，只拒绝交互/创建类与未知工具。 | — |
| `apps/desktop/src/main/services/secrets.ts` | 桌面·主进程 | 源码 | 160 | 14 | 密钥库：加密保存各服务商 API Key，提供 IPC 与可用性探测，写入前做安全存储校验。 | — |
| `apps/desktop/src/main/services/shells.ts` | 桌面·主进程 | 源码 | 121 | 7 | Shell 配置探测：枚举系统可用的 shell 供命令执行与终端选择。 | — |
| `apps/desktop/src/main/services/skills.ts` | 桌面·主进程 | 源码 | 782 | 33 | 技能服务：发现与解析 ~/.deva/skills/<id>/SKILL.md、启用态管理与导入导出。 | — |
| `apps/desktop/src/main/services/subagent-store.ts` | 桌面·主进程 | 源码 | 250 | 19 | 子智能体记录的持久化：索引加载、原子写盘、记录删除与清理。 | — |
| `apps/desktop/src/main/services/subagents.ts` | 桌面·主进程 | 源码 | 134 | 3 | 内置子智能体注册表：纯代码常量，不落盘、无 IPC、不可由用户配置。 | — |
| `apps/desktop/src/main/services/tasks-types.ts` | 桌面·主进程 | 源码 | 129 | 0 | 定时任务共享类型：任务记录、日程、授权信封、运行记录与状态。 | — |
| `apps/desktop/src/main/services/tasks.ts` | 桌面·主进程 | 源码 | 514 | 32 | 定时任务服务：任务的增删改查、授权信封、调度落盘、运行记录与错误暂停，全部经 IPC 暴露。 | — |
| `apps/desktop/src/main/services/terminal.ts` | 桌面·主进程 | 源码 | 112 | 9 | 终端 IPC 桥：fork 持有 node-pty 的 Utility Process 并在渲染层与它之间中继消息。 | — |
| `apps/desktop/src/main/services/todos.ts` | 桌面·主进程 | 源码 | 212 | 14 | 待办清单（todo_write）纯函数与状态机，零依赖。 | — |
| `apps/desktop/src/main/services/tool-results.ts` | 桌面·主进程 | 源码 | 234 | 13 | 被清理工具结果的占位文本生成（原字符数、保存路径、图片移除说明，中英双语）。 | — |
| `apps/desktop/src/main/services/tool-search.ts` | 桌面·主进程 | 源码 | 229 | 13 | 按需加载工具：工具表里只放一句话描述与参数骨架，完整说明由 tool_search 按名取回。 | — |
| `apps/desktop/src/main/services/tools.ts` | 桌面·主进程 | 源码 | 2110 | 51 | Agent 工具集：文件读写/编辑、搜索、命令执行、网页抓取等工具的完整定义与执行。 | — |
| `apps/desktop/src/main/services/tray-icon.ts` | 桌面·主进程 | 源码 | 212 | 9 | 托盘图标生成：按平台与主题零依赖合成 PNG（含 PNG 数据块与 CRC32）。 | — |
| `apps/desktop/src/main/services/updater.ts` | 桌面·主进程 | 源码 | 274 | 21 | 检查更新：只在用户点击时检查（Web 版另有独立的 updater.mjs）。 | — |
| `apps/desktop/src/main/services/workspace.ts` | 桌面·主进程 | 源码 | 97 | 7 | 工作区 IPC：打开/定位目录、读目录、读写文件，全部经 fs-guard 校验。 | — |
| `apps/desktop/src/main/services/xiaomajiang-personas.ts` | 桌面·主进程 | 源码 | 295 | 0 | 内置角色「小码酱」的身份与系统提示词常量（面向国产模型的破甲/逆向场景）。 | — |
| `apps/desktop/src/preload/index.d.ts` | 桌面·预加载 | 源码 | 9 | 0 | 全局类型声明：把 window.deva 标注为 preload 导出的 DevaApi。 | — |
| `apps/desktop/src/preload/index.ts` | 桌面·预加载 | 源码 | 1510 | 15 | 预加载桥：用 contextBridge 把主进程全部 IPC 通道包装成 window.deva 对象（153 个 invoke 方法 + 15 个事件订阅）。 | — |
| `apps/desktop/src/renderer/browser.html` | 桌面·渲染层 | 页面 | — | — | 「Deva 浏览器」窗口页面骨架：同套 CSP，加载 src/browser-main.tsx。 | — |
| `apps/desktop/src/renderer/index.html` | 桌面·渲染层 | 页面 | — | — | 主窗口页面骨架：挂 CSP（仅 self、禁内联脚本）与 #root，加载 src/main.tsx。 | — |
| `apps/desktop/src/renderer/src/App.tsx` | 桌面·渲染层 | 源码 | 11 | 1 | 应用根组件：只渲染「对话优先」外壳 ChatFirstShell，旧 IDE 式外壳已下线。 | — |
| `apps/desktop/src/renderer/src/assets/platforms/feishu.svg` | 桌面·渲染层 | 资源 | — | — | 飞书平台品牌图标资源。 | — |
| `apps/desktop/src/renderer/src/assets/platforms/telegram.svg` | 桌面·渲染层 | 资源 | — | — | Telegram 平台品牌图标资源。 | — |
| `apps/desktop/src/renderer/src/browser-main.tsx` | 桌面·渲染层 | 源码 | 19 | 0 | 浏览器窗口的渲染入口：注入主题与 i18n 提供者后挂载 BrowserChrome。 | — |
| `apps/desktop/src/renderer/src/components/DialogProvider.tsx` | 桌面·渲染层 | 源码 | 181 | 7 | 全局确认框与输入框的 Provider：以 Promise 形式向业务代码提供 confirm / prompt。 | — |
| `apps/desktop/src/renderer/src/components/Modal.tsx` | 桌面·渲染层 | 源码 | 62 | 2 | 通用模态框：Portal 渲染、遮罩/Esc 关闭、宽度与无障碍属性可配。 | — |
| `apps/desktop/src/renderer/src/components/Select.tsx` | 桌面·渲染层 | 源码 | 316 | 12 | 统一下拉框：单选/多选、浮层定位、键盘导航与首字母跳转。 | — |
| `apps/desktop/src/renderer/src/components/ToastProvider.tsx` | 桌面·渲染层 | 源码 | 194 | 9 | Toast 通知系统：排队、自动消失、悬停暂停与行内操作按钮。 | — |
| `apps/desktop/src/renderer/src/components/humation.tsx` | 桌面·渲染层 | 源码 | 939 | 52 | Humation 头像统一封装：全应用唯一的头像渲染面（确定性形状与配色）。 | — |
| `apps/desktop/src/renderer/src/env.d.ts` | 桌面·渲染层 | 源码 | 8 | 0 | 渲染层环境类型：声明 __APP_VERSION__ 等构建期注入的全局量。 | — |
| `apps/desktop/src/renderer/src/features/browser/BrowserCapsule.tsx` | 桌面·渲染层 | 源码 | 342 | 12 | 内置浏览器胶囊：左段状态（点开窗口、悬停浮缩略图）+ 右段网页数量与列表。 | — |
| `apps/desktop/src/renderer/src/features/browser/BrowserChrome.tsx` | 桌面·渲染层 | 源码 | 237 | 5 | 「Deva 浏览器」窗口外框：标签条、状态条与网页菜单交互。 | — |
| `apps/desktop/src/renderer/src/features/browser/browser.css` | 桌面·渲染层 | 样式 | — | — | 「Deva 浏览器」窗口外框样式，高度须与 shared/browser.ts 的 BROWSER_CHROME 一致。 | — |
| `apps/desktop/src/renderer/src/features/browser/capsule.css` | 桌面·渲染层 | 样式 | — | — | 浏览器胶囊样式，外观对齐待办清单与后台任务胶囊。 | — |
| `apps/desktop/src/renderer/src/features/browser/shared.tsx` | 桌面·渲染层 | 源码 | 89 | 2 | 内置浏览器的公共渲染件：订阅浏览器界面状态并渲染平台无关的小组件。 | — |
| `apps/desktop/src/renderer/src/features/browser/text.ts` | 桌面·渲染层 | 源码 | 68 | 4 | 内置浏览器界面文案拼装（状态条与胶囊共用）。 | — |
| `apps/desktop/src/renderer/src/features/chat/BackgroundTasks.tsx` | 桌面·渲染层 | 源码 | 208 | 9 | 后台任务胶囊：按轮聚合运行/已完成的子智能体，提供停止按钮。 | — |
| `apps/desktop/src/renderer/src/features/chat/DeliverablesCard.tsx` | 桌面·渲染层 | 源码 | 259 | 7 | 交付物卡片：展示文件信息与缩略图，支持打开、定位与复制路径。 | — |
| `apps/desktop/src/renderer/src/features/chat/Markdown.tsx` | 桌面·渲染层 | 源码 | 130 | 5 | Markdown 渲染：react-markdown + GFM + 代码高亮，附代码块复制按钮。 | — |
| `apps/desktop/src/renderer/src/features/chat/ModelSetupCard.tsx` | 桌面·渲染层 | 源码 | 539 | 16 | 对话内模型接入引导卡：选服务商 → 填密钥 → 选模型，落库并设为当前对话模型。 | — |
| `apps/desktop/src/renderer/src/features/chat/ScheduleEditor.tsx` | 桌面·渲染层 | 源码 | 204 | 6 | 日程编辑器：按重复模式组合出 cron / 单次时间并交回父层。 | — |
| `apps/desktop/src/renderer/src/features/chat/TaskConfirmCard.tsx` | 桌面·渲染层 | 源码 | 405 | 12 | 定时任务确认名片：待决时编辑授权信封，已决时展示终态。 | — |
| `apps/desktop/src/renderer/src/features/chat/TaskPickers.tsx` | 桌面·渲染层 | 源码 | 316 | 12 | 定时任务的下拉选择件：运行方式、会话、角色等候选计算。 | — |
| `apps/desktop/src/renderer/src/features/chat/Todos.tsx` | 桌面·渲染层 | 源码 | 154 | 6 | 待办清单界面：输入框上方的进度胶囊与展开面板，只展示主进程 todos 边车的数据。 | — |
| `apps/desktop/src/renderer/src/features/chat/blocks.tsx` | 桌面·渲染层 | 源码 | 2325 | 77 | 对话块渲染：按 block.kind 分派 Markdown、工具行、名片、问答/计划/挂载卡与压缩提示。 | — |
| `apps/desktop/src/renderer/src/features/chat/dockOrder.ts` | 桌面·渲染层 | 源码 | 16 | 1 | 输入框上方胶囊排的先后顺序：每次出现领一个递增序号当 CSS order，新出现的排最右。 | — |
| `apps/desktop/src/renderer/src/features/chat/schedule.ts` | 桌面·渲染层 | 源码 | 107 | 8 | 日程编辑纯逻辑：cron 反解/拼装与 datetime-local 取值，名片与任务编辑共用同一真源。 | — |
| `apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx` | 桌面·渲染层 | 源码 | 311 | 7 | 模型详情页：编辑显示名、上下文窗口与最大输出上限，留空即用内置自动值。 | — |
| `apps/desktop/src/renderer/src/features/settings/ModelSettings.tsx` | 桌面·渲染层 | 源码 | 733 | 22 | 模型设置页：服务商列表与详情、模型增删改、密钥自动保存与预设套用。 | — |
| `apps/desktop/src/renderer/src/features/settings/Switch.tsx` | 桌面·渲染层 | 源码 | 23 | 1 | 通用受控开关组件。 | — |
| `apps/desktop/src/renderer/src/i18n/i18n.tsx` | 桌面·渲染层 | 源码 | 86 | 6 | 轻量自研 i18n：语言探测、点分 key 查找与 I18nProvider。 | — |
| `apps/desktop/src/renderer/src/i18n/messages.ts` | 桌面·渲染层 | 源码 | 2919 | 0 | 语言资源：点分命名 key 的中英文案字典。 | — |
| `apps/desktop/src/renderer/src/main.tsx` | 桌面·渲染层 | 源码 | 45 | 0 | 主窗口渲染入口：串起主题、i18n、对话框、Toast、模型与其它 Provider 后挂载 App。 | — |
| `apps/desktop/src/renderer/src/mock/extensions.ts` | 桌面·渲染层 | 源码 | 121 | 0 | 扩展（技能 / MCP）的类型定义与默认值，全部为全局配置、与项目无关。 | — |
| `apps/desktop/src/renderer/src/mock/models.ts` | 桌面·渲染层 | 源码 | 203 | 0 | 模型服务商与模型的种子数据。 | — |
| `apps/desktop/src/renderer/src/redesign/AvatarEditor.tsx` | 桌面·渲染层 | 源码 | 268 | 10 | 头像编辑器：部件槽位与配色选择、自定义图片上传与预览。 | — |
| `apps/desktop/src/renderer/src/redesign/BotsPane.tsx` | 桌面·渲染层 | 源码 | 812 | 21 | 机器人（IM 通道）面板：列表、扫码/Token 添加、配对用户与启停。 | — |
| `apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx` | 桌面·渲染层 | 源码 | 8958 | 292 | 应用最外层「对话优先」外壳：侧栏、会话列表、对话区、任务与控制台面板的布局与快捷键。 | — |
| `apps/desktop/src/renderer/src/redesign/ProfilePanel.tsx` | 桌面·渲染层 | 源码 | 611 | 19 | 「我」的资料面板：记忆标签管理与头像编辑入口。 | — |
| `apps/desktop/src/renderer/src/redesign/RewindModal.tsx` | 桌面·渲染层 | 源码 | 413 | 10 | 回滚（rewind）面板：选轮次、看将撤回的文件、执行代码/对话回滚。 | — |
| `apps/desktop/src/renderer/src/redesign/UpdateSection.tsx` | 桌面·渲染层 | 源码 | 144 | 6 | 设置里的「检查更新」区：展示状态、版本与各平台手动更新说明。 | — |
| `apps/desktop/src/renderer/src/redesign/attachments.tsx` | 桌面·渲染层 | 源码 | 536 | 15 | 附件展示件：缩略图缓存、文件卡片与大图预览。 | — |
| `apps/desktop/src/renderer/src/redesign/composer-editor.ts` | 桌面·渲染层 | 源码 | 535 | 31 | 基于 Lexical 的输入框编辑器：@ 成员标签、粘贴/拖放、token 同步与文本读写。 | — |
| `apps/desktop/src/renderer/src/redesign/memory-editor.ts` | 桌面·渲染层 | 源码 | 192 | 8 | 记忆标签墙编辑 hook：读写指定作用域的记忆，含行内编辑、删除与清空。 | — |
| `apps/desktop/src/renderer/src/redesign/redesign.css` | 桌面·渲染层 | 样式 | — | — | 「对话优先」外壳样式，类名统一 cf- 前缀，与 app.css 完全隔离，全部复用语义变量。 | — |
| `apps/desktop/src/renderer/src/redesign/resizable.tsx` | 桌面·渲染层 | 源码 | 145 | 8 | 可拖拽分栏与输入框高度：布局尺寸的读写与拖拽手柄。 | — |
| `apps/desktop/src/renderer/src/store/chat.tsx` | 桌面·渲染层 | 源码 | 2453 | 74 | 对话 store：全部会话、活动态、待决卡与绑定覆盖层，封装发送、中止、增删改与回滚。 | — |
| `apps/desktop/src/renderer/src/store/extensions.tsx` | 桌面·渲染层 | 源码 | 549 | 22 | 扩展 store：技能、MCP 与角色的载入、订阅与增删改启停。 | — |
| `apps/desktop/src/renderer/src/store/models.tsx` | 桌面·渲染层 | 源码 | 334 | 8 | 模型 store：服务商与模型配置的载入、持久化、密钥状态与选择。 | — |
| `apps/desktop/src/renderer/src/store/profile.tsx` | 桌面·渲染层 | 源码 | 67 | 4 | 本机用户资料 store：拉取与保存头像 spec / 自定义图片。 | — |
| `apps/desktop/src/renderer/src/store/tasks.tsx` | 桌面·渲染层 | 源码 | 98 | 7 | 定时任务 store：初始拉取 + 全量广播订阅，转发创建/启停/立即运行/编辑/删除。 | — |
| `apps/desktop/src/renderer/src/store/workspace.tsx` | 桌面·渲染层 | 源码 | 305 | 21 | 工作区 store：项目列表、文件树缓存与按项目分片的编辑器标签。 | — |
| `apps/desktop/src/renderer/src/styles/app.css` | 桌面·渲染层 | 样式 | — | — | 全局样式：reset、应用骨架布局与通用组件类。 | — |
| `apps/desktop/src/renderer/src/styles/tokens.css` | 桌面·渲染层 | 样式 | — | — | 设计 token：颜色/间距/圆角的语义变量，支撑明暗主题与跟随系统。 | — |
| `apps/desktop/src/renderer/src/theme/ThemeContext.tsx` | 桌面·渲染层 | 源码 | 103 | 8 | 主题管理：明/暗/跟随系统，写根元素属性并同步原生标题栏图标色。 | — |
| `apps/desktop/src/renderer/src/theme/chatFontSize.ts` | 桌面·渲染层 | 源码 | 39 | 4 | 对话文字大小（小/标准/大/特大）的取值与持久化。 | — |
| `apps/desktop/src/shared/avatar-shape.ts` | 桌面·共享 | 源码 | 72 | 4 | 头像底板形状名与按 seed 取样（主进程与渲染层共用）。 | — |
| `apps/desktop/src/shared/browser.ts` | 桌面·共享 | 源码 | 49 | 0 | 内置浏览器界面状态类型（主进程推送，主窗口胶囊与浏览器外框共用）。 | — |
| `apps/desktop/src/shared/context.ts` | 桌面·共享 | 源码 | 266 | 12 | 上下文窗口与输出上限的纯函数模块（压缩触发与模型详情页共用）。 | — |
| `apps/desktop/src/shared/deliverables.ts` | 桌面·共享 | 源码 | 10 | 0 | 交付卡文件信息类型（主进程 inspect 返回，渲染层据此绘制）。 | — |
| `apps/desktop/src/shared/effort.ts` | 桌面·共享 | 源码 | 237 | 8 | 思考等级与模型能力内置表（主进程决定发什么，渲染层决定显示哪几档）。 | — |
| `apps/desktop/src/shared/limits.ts` | 桌面·共享 | 源码 | 18 | 0 | Agent 循环的刹车阈值（主进程判定，渲染层引用同一数值出提示）。 | — |
| `apps/desktop/src/shared/mention.ts` | 桌面·共享 | 源码 | 28 | 1 | 「@名字」的识别规则（渲染层上色与主进程认人共用）。 | — |
| `apps/desktop/src/shared/quote.ts` | 桌面·共享 | 源码 | 13 | 2 | Markdown 引用行（> 开头）的判定，识别右键「引用」带进来的他人原话。 | — |
| `apps/desktop/src/shared/slash.ts` | 桌面·共享 | 源码 | 19 | 1 | 「/技能名」的识别规则：渲染层上色与主进程展开技能共用同一套判定，返回出现区间与名字。 | — |
| `apps/desktop/src/shared/update.ts` | 桌面·共享 | 源码 | 33 | 0 | 检查更新的状态类型与发布页地址。 | — |
| `apps/desktop/tsconfig.json` | 桌面·工程配置 | 配置 | — | — | TS 项目引用根：分别引用 node 侧与 web 侧两套配置。 | — |
| `apps/desktop/tsconfig.node.json` | 桌面·工程配置 | 配置 | — | — | 主进程 / preload / 共享代码 / electron.vite 配置的编译配置（Node 侧）。 | — |
| `apps/desktop/tsconfig.web.json` | 桌面·工程配置 | 配置 | — | — | 渲染层与 preload 类型声明的编译配置（DOM 侧）。 | — |
| `apps/web/Dockerfile` | Web·部署 | 配置 | — | — | 两阶段构建镜像：先在 Node 环境里构建 renderer 与 Web 后端，再产出运行镜像，以非 root 用户启动 server.mjs。 | — |
| `apps/web/README.md` | 文档 | 文档 | — | — | Web 版说明：架构、Docker 与本地启动、环境变量、数据与审计、已验证范围、安全边界、已知限制、目录结构。 | — |
| `apps/web/build.mjs` | Web·工程配置 | 源码 | 141 | 2 | Web 构建脚本：打包浏览器侧 shim、Node 后端 backend.cjs、pty-host，并写 manifest / build-info。 | — |
| `apps/web/docker-compose.yml` | Web·部署 | 配置 | — | — | 单服务编排：以上级目录为构建上下文，映射端口与 /data 卷，透传管理员、会话、根目录、更新检查等环境变量。 | — |
| `apps/web/docker-entrypoint.sh` | Web·部署 | 配置 | — | — | 容器入口：先修正 /data 属主，再以 setpriv 降权到 node 用户执行 server.mjs。 | — |
| `apps/web/docs/web-migration.md` | 文档 | 文档 | — | — | Web 化测绘与交付记录：四条路线对比、路线 B 的架构、阻塞点解法、分阶段计划、实跑验证结果与验收标准。 | — |
| `apps/web/package.json` | Web·工程配置 | 配置 | — | — | Web 应用包定义：type=module，build 走 node build.mjs，start 走 node server.mjs，仅依赖 esbuild。 | — |
| `apps/web/server.mjs` | Web·网关 | 源码 | 1111 | 36 | Web 网关：HTTP 服务器、会话与登录、静态资源、路径闸门、每用户后端进程池、SSE 事件流与管理页。 | — |
| `apps/web/src/backend/chromium.mjs` | Web·兼容层 | 源码 | 571 | 46 | 用系统 Chromium 的 CDP 实现 Electron WebContents 的可用子集（导航、点击、输入、截图、对话框）。 | — |
| `apps/web/src/backend/electron-shim.mjs` | Web·兼容层 | 源码 | 593 | 98 | 服务端 electron 兼容层：把主进程用到的 app / BrowserWindow / dialog / Tray 等换成 Node 侧可运行的空实现。 | — |
| `apps/web/src/backend/index.ts` | Web·兼容层 | 源码 | 136 | 9 | Web 后端入口：按 main/index.ts 的顺序注册真实业务模块，不建窗口，事件改由 SSE 广播。 | — |
| `apps/web/src/backend/updater-stub.mjs` | Web·兼容层 | 源码 | 19 | 5 | electron-updater 的 Web 替身：保留接口，调用即失败（Web 版改用 server/updater.mjs）。 | — |
| `apps/web/src/electron-shim.js` | Web·兼容层 | 源码 | 95 | 3 | 浏览器侧 electron 模块替身（供打包后的 shim.js 使用，无 Node API）。 | — |
| `apps/web/src/handlers.mjs` | Web·兼容层 | 源码 | 98 | 3 | 主进程通道的 Web 版兜底实现：未移植的通道统一返回 not_ported 让前端降级。 | — |
| `apps/web/src/server/auth.mjs` | Web·服务 | 源码 | 276 | 24 | 认证与审计：scrypt 密码哈希、用户库、会话库、按日 JSONL 审计与 CSRF 校验。 | — |
| `apps/web/src/server/backend-pool.mjs` | Web·服务 | 源码 | 215 | 9 | 每用户一个 worker 进程的池：按需拉起、空闲回收、invoke/send 转发与事件回传。 | — |
| `apps/web/src/server/pages.mjs` | Web·服务 | 源码 | 195 | 3 | 服务端渲染的 HTML 页面：登录页、管理页与错误页，插值全部转义。 | — |
| `apps/web/src/server/updater.mjs` | Web·服务 | 源码 | 265 | 15 | 上游 Git 提交检查：比对镜像内构建 commit 与 GitHub 最新提交，只提示、不自动更新，可推 webhook。 | — |
| `apps/web/src/server/util.mjs` | Web·服务 | 源码 | 163 | 14 | Web 端通用工具：JSON/文本响应、请求体读取、Cookie 解析、HTML 转义、原子写 JSON、路径包含判断。 | — |
| `apps/web/src/server/worker-host.mjs` | Web·服务 | 源码 | 63 | 2 | 单用户后端进程：加载 dist/backend.cjs，通过 IPC 把 invoke / send / event 转给父进程。 | — |
| `apps/web/src/web/favicon.ico` | Web·前端壳 | 资源 | — | — | 站点图标位图版本，登录页与浏览器标签使用。 | — |
| `apps/web/src/web/favicon.svg` | Web·前端壳 | 资源 | — | — | 站点图标矢量版本（圆角渐变底 + D 形徽标），由 serveStatic 白名单直接下发。 | — |
| `apps/web/src/web/mobile.css` | Web·前端壳 | 样式 | — | — | 手机端断点补丁层：把桌面三列布局在窄屏收成单列，不动上游 renderer 产物。 | — |
| `apps/web/src/web/picker.css` | Web·前端壳 | 样式 | — | — | Web 版目录选择弹层样式，跟随应用主题变量。 | — |
| `apps/web/src/web/picker.js` | Web·前端壳 | 源码 | 377 | 16 | Web 版目录选择器：接收 dir-pick 事件后弹出，浏览受信根并回传所选目录。 | — |
| `apps/web/test/smoke.mjs` | Web·测试 | 源码 | 153 | 5 | Web 版冒烟测试：登录、通道数、文件/终端/Git 越界拦截等端到端断言。 | — |
| `docs/.nojekyll` | 文档/资源 | 配置 | — | — | 空文件，告诉 GitHub Pages 不要用 Jekyll 处理目录内容。 | — |
| `docs/index.html` | 文档/资源 | 页面 | — | — | 项目中文落地页「一个对话，带起一支 AI 团队」，由 pages.yml 发布。 | — |
| `docs/screenshot.en.png` | 文档/资源 | 资源 | — | — | 英文界面截图，供 README.en.md 引用。 | — |
| `docs/screenshot.png` | 文档/资源 | 资源 | — | — | 中文界面截图，供 README.md 与落地页引用。 | — |
| `package.json` | 仓库根 | 配置 | — | — | 工作区根 package.json：声明 pnpm@10.8.0、node>=20、全部 npm scripts 与 onlyBuiltDependencies 白名单。 | — |
| `pnpm-lock.yaml` | 仓库根 | 生成物 | — | — | pnpm 锁文件：锁定全部依赖的精确版本与完整性哈希，由 pnpm install 生成，不手改。 | 生成物：pnpm install |
| `pnpm-workspace.yaml` | 仓库根 | 配置 | — | — | pnpm 工作区定义：成员为 apps/* 与 packages/*（当前只有 apps/desktop、apps/web，packages/ 尚未创建）。 | — |

**分层汇总**（合计 225）：

| 层 | 数量 | 层 | 数量 |
|---|---:|---|---:|
| 桌面·主进程 | 84 | Web·网关 | 1 |
| 桌面·渲染层 | 58（39 `.tsx` + 10 `.ts` + 5 `.css` + 2 `.html` + 2 `.svg`） | Web·服务 | 6 |
| 桌面·构建资源 | 15 | Web·后端兼容层 | 6 |
| 仓库根 | 11 | Web·前端壳 | 5 |
| 桌面·共享 | 10 | Web·部署 | 3 |
| 桌面·工程配置 | 6 | 文档（`*.md`） | 2 |
| 桌面·打包钩子 | 5 | 文档/资源 | 4 |
| 桌面·预加载 | 2 | CI | 4 |
| Web·工程配置 | 2 | Web·测试 | 1 |

**生成物共 13 项**：`pnpm-lock.yaml`（`pnpm install` 生成）+ 12 个图标位图（`icon.png`、`icon.ico`、`icon-mac.png`、`build/icons/{16,24,32,48,64,128,256,512,1024}.png`，全部由 `apps/desktop/scripts/gen-icon.mjs` 从 `build/icon.svg` 生成）。其余 212 个文件是手写源文件、资源或配置。

> 注意一处易混：`apps/desktop/build/` 这个名字看起来像构建输出，实际是**打包资源输入目录**（electron-builder 的 `buildResources` 默认值），不属于 `apps/desktop/out/` 那个构建产物目录。

### 2.2 `out/` 目录：30 个验证证据文件逐条说明

`out/` 不是产品的一部分，是**此前一次「工程健康检查 + 缺陷修复」任务留下的可复核证据**，被 `.gitignore:7`（`out/`）忽略，不入库。既然要求「每个逻辑文件都要说清用途」，这里逐条列出。

**逐文件覆盖**：`out/` 下共 30 个文件 = 9 个日志（`logs/`）+ 6 个 `.mjs` 脚本（其中 5 个探针、1 个基线副本）+ 11 个 `.txt` 证据 + 1 个 `.diff` + 1 个 `.sh` + 1 张 `.png` + 1 个 `REPORT.md`。下表的 22 行按「同一组证据」合并列示，例如 `probe.mjs` / `probe-before.txt` / `probe-after.txt` 合为一行——**30 个文件名全部出现在表中，无一遗漏**。

它的组织逻辑是「**脚本 + 修复前后两份输出 + 日志**」四件套：`xxx.mjs` 是探针，`xxx-before.txt` 是修复前跑出来的失败清单，`xxx-after.txt`（或 `xxx.txt`）是修复后同一脚本的输出；两者对照即证明修复生效。

| 文件 | 类型 | 用途 |
|---|---|---|
| `out/REPORT.md` | 报告（360 行） | 整次检查的主报告：需求对照、检查结果、修复前后对比、6 项根因修复清单、证据索引、改动面、未修复项、结论 |
| `out/logs/01-install.txt` | 日志 | `pnpm install --frozen-lockfile`，exit=0 |
| `out/logs/02-typecheck.txt` | 日志 | `tsc` node + web 两侧，exit=0 |
| `out/logs/03-build-desktop.txt` | 日志 | `electron-vite build`，exit=0 |
| `out/logs/04-build-web.txt` | 日志 | esbuild 三产物构建，记录 commit=109937f，exit=0 |
| `out/logs/05-typecheck-web-backend.txt` | 日志 | **已知限制的复现**：单独 typecheck `apps/web/src/backend/index.ts` 报 4 条 TS2305（esbuild alias 在 tsc 下不生效），exit=2，故意保留作为证据 |
| `out/logs/06-startup.txt` | 日志 | 真实启动：22 行模块注册逐项 ok、`ready: 154 channels`、`/healthz` 200 |
| `out/logs/07-rerun-after-rename.txt` | 日志 | 证据目录从 `verification/` 改名到 `out/` 后，5 个探针脚本全部复跑（30/0、10/0、9/0、4/0、15/0、14/0），且验证了「仓库根调用」与「`cd out` 内调用」两种方式都能跑 |
| `out/logs/08-icon-regression.txt` | 日志 | 图标回归：修复前 0/15 → 修复后 15/15，含 HTTP 响应头实测与产物哈希核对 |
| `out/logs/09-final-verification.txt` | 日志 | 收尾整体复跑：typecheck、web build、154 通道自检、82 项回归全 PASS |
| `out/probe.mjs` | 探针脚本（30 项断言） | 缺陷探针主脚本：登录重定向、伪 fs 子路径浏览、路径闸门误拒、终端 cwd 逃逸、畸形百分号编码等 |
| `out/probe-before.txt` / `out/probe-after.txt` | 证据文本 | 30 项探针的输出：pass 15 / fail 15 → 30/0 |
| `out/git-e2e.mjs` | 探针脚本 | Git 全链路端到端（status/diff/stage/commit/分支） |
| `out/git-before.txt` / `out/git-after.txt` | 证据文本 | 4/6 → 10/0 |
| `out/smoke-baseline.txt` / `out/smoke-after.txt` | 证据文本 | `apps/web/test/smoke.mjs` 的 14 项冒烟，前后一致 14/0 |
| `out/channel-coverage.mjs` / `out/channel-coverage.txt` | 探针脚本 + 输出 | 校验 33 个 fs/git 通道的路径参数是否都已登记在 `CHANNEL_PATHS` 里（4/0） |
| `out/browse-check.mjs` / `out/browse-regression-before.txt` / `out/browse-regression.txt` | 探针脚本 + 输出 | 目录浏览范围的正/负向回归：6/3 → 9/0 |
| `out/icon-check.mjs` / `out/icon-before.txt` / `out/icon-after.txt` | 探针脚本 + 输出 | favicon / 图标回归：0/15 → 15/0 |
| `out/favicon-256-preview.png` | 资源 | 从 `.ico` 里解出的 256×256 帧，用于目视确认图标不是空白 |
| `out/server.baseline.mjs` | 基线副本 | 修复前的 `server.mjs` 完整复刻，只用于 `git diff --no-index` 对照；**需手工复制进 `apps/web/` 才能运行** |
| `out/server-fix.diff` | 补丁 | 基线 → 修复后的完整 diff |
| `out/typecheck-web-backend.sh` | 脚本 | 复现 `logs/05` 那条已知限制的 shell（动态生成临时 tsconfig 到 `.tmp/`，退出时自删） |

> 另有 `apps/web/out/`（7 个临时 UI 检查脚本 + `shots/` 8 张截图），同样是被忽略的本地草稿，属 Web 版界面走查的过程产物，不与 `out/` 混用。

### 2.3 产物与依赖目录（不逐文件列，说明来源即可）

| 目录 | 生成命令 | 内容与去向 |
|---|---|---|
| `node_modules/`（根 + 各 workspace） | `pnpm install` | hoisted 布局；`onlyBuiltDependencies` 放行 4 个包的 install 脚本。`apps/web/dist/node_modules/@lydell` 是 `build.mjs:103` 手工建的软链，绕过 pnpm 的 hoisted 目录结构 |
| `apps/desktop/out/` | `pnpm build`（= `electron-vite build`） | `main/index.js`、`main/pty-host.js`、`preload/index.js`、`renderer/index.html`、`renderer/browser.html`、`renderer/assets/*`。桌面运行时 `loadFile('../renderer/index.html')`（`apps/desktop/src/main/index.ts:211`）从这里读 |
| `apps/web/dist/` | `pnpm --filter @deva/web build`（= `node build.mjs`） | `shim.js`、`backend.cjs`、`pty-host.js`、`package.json`（`{"type":"commonjs"}`）、`manifest.json`、`build-info.json`、`node_modules/@lydell` 软链。Web 网关在 `server.mjs:33-34` 读 manifest 与 shim |
| 根 `out/` | 手工运行上述探针脚本 | 见 §2.2，git 忽略 |
| `apps/web/out/` | 手工运行 UI 检查脚本 | 临时草稿，git 忽略 |
| `apps/desktop/release/`（若打包，本环境未生成） | `pnpm package:*`（electron-builder） | 安装包输出目录。**推测**：`electron-builder.yml` 未显式设置 `directories.output`，按 electron-builder 默认行为解析到项目根（即 `apps/desktop`）下的 `release/`；本环境未执行打包，未实测 |

---
---

## 3. 函数级说明

### 3.1 计数与口径

| 指标 | 数值 | 取法 |
|---|---:|---|
| 源码文件 | **168** | 225 个受控文件中后缀为 `.ts/.tsx/.js/.mjs/.cjs` 且能被 TypeScript 编译器 API 解析者 |
| 函数 / 方法 / IPC 处理器 | **2505** | 含函数声明 1455、箭头函数 660、类方法 175、IPC 处理器 164、对象字面量方法 35、构造器 16 |
| 其中导出 | **713** | 带 `export` 关键字 |
| 源码行数 | **65880** | 168 个文件的源码行合计（`wc -l` 口径：末尾换行不计额外一行） |
| **逐条可查行号** | **2505 / 2505（100%）** | 全部落在 [`FUNCTION-INDEX.md`](./FUNCTION-INDEX.md)，逐条作用说明在六个附录 |

口径说明：

- **只收「有名字或有明确注册点」的函数**。匿名的内联回调（`.map(x => …)`、`addEventListener('x', () => …)`）不计入 2505，否则条目会膨胀到上万条且无说明价值。
- **IPC 处理器单列**：`ipcMain.handle('x', fn)` / `ipcMain.on('x', fn)` 记一条，名字即通道名。这类条目占 164 条，其中 154 条是 `handle`、4 条是 `on`（合计 158 个通道），其余 6 条是 Web 端 `__listChannels` 侧的等价注册——见 §3.7 的三套数字。
- **同一函数多次出现**（如两个文件各有一个 `str()`）按位置分别计数，不做名字去重。
- **说明文字覆盖率**：2505 条在附录里全部有说明，来源分布为 JSDoc/文档注释 979、行尾注释 263、函数体摘要 723（以「代码：」开头，是机械摘要而非人工判断）、人工补写 443、重点文件人工归纳 97。本文 §3.4 的紧凑表格是「精选 + 人工改写」的阅读版，附录才是全量可核查版。

### 3.2 交付物清单

| 文件 | 内容 | 规模 |
|---|---|---:|
| [`FUNCTION-INDEX.md`](./FUNCTION-INDEX.md) | **机械索引**：168 个文件、2505 条，每条 `文件:行号 / 名字 / 形态 / 是否导出 / 签名 / 调用点数量`；按 A1/A2/A3/B/B2/C/D 七个区域分组 | 4003 行 |
| [`PROJECT-MAP-FUNCTIONS-main.md`](./PROJECT-MAP-FUNCTIONS-main.md) | 主进程 84 文件 / 1292 条，含说明与被调用处 | 561 KB |
| [`PROJECT-MAP-FUNCTIONS-renderer.md`](./PROJECT-MAP-FUNCTIONS-renderer.md) | 渲染层 49 文件 / 869 条 | 415 KB |
| [`PROJECT-MAP-FUNCTIONS-web.md`](./PROJECT-MAP-FUNCTIONS-web.md) | Web 16 文件 / 290 条 | 92 KB |
| [`PROJECT-MAP-FUNCTIONS-preload.md`](./PROJECT-MAP-FUNCTIONS-preload.md) | 预加载 2 文件 / 15 条 | 5 KB |
| [`PROJECT-MAP-FUNCTIONS-shared.md`](./PROJECT-MAP-FUNCTIONS-shared.md) | 共享 10 文件 / 28 条 | 15 KB |
| [`PROJECT-MAP-FUNCTIONS-scripts.md`](./PROJECT-MAP-FUNCTIONS-scripts.md) | 脚本 7 文件 / 11 条 | 5 KB |

区域划分（与 `FUNCTION-INDEX.md` 一致）：

| 区域 | 文件数 | 条目数 |
|---|---:|---:|
| A1 Web 网关与服务端（`server.mjs`、`src/server/*`） | 7 | 103 |
| A2 Web 后端兼容层（`src/backend/*`、`electron-shim.js`、`handlers.mjs`） | 6 | 164 |
| A3 Web 构建 / 前端壳 / 测试（`build.mjs`、`picker.js`、`smoke.mjs`） | 3 | 23 |
| B 桌面·主进程（含 preload 之外的全部 `src/main/**`） | 84 | 1292 |
| B2 桌面·预加载（`src/preload/*`） | 2 | 15 |
| C 桌面·渲染层（`src/renderer/src/**`） | 49 | 869 |
| D 共享、脚本与配置（`src/shared/*`、`apps/desktop/scripts/*`、`.github/scripts/*`、`electron.vite.config.ts`） | 17 | 39 |
| **合计** | **168** | **2505** |

### 3.3 怎么读密集模块（先看这里，再看表）

以下 8 个文件占了全部条目的 36%（906 / 2505），读它们会决定对系统的整体理解：

| 文件 | 条目 | 一句话 |
|---|---:|---|
| `apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx` | 292 | 应用外壳：侧栏、会话列表、对话区、任务面板的布局与快捷键 |
| `apps/desktop/src/main/services/chat.ts` | 192 | Agent 主循环：流式生成 → 工具调用 → 权限闸门 → 执行 → 结果回灌 |
| `apps/web/src/backend/electron-shim.mjs` | 98 | Electron API 的 Node 侧替身（app/BrowserWindow/dialog/safeStorage） |
| `apps/desktop/src/renderer/src/features/chat/blocks.tsx` | 77 | 对话块的按 kind 分派渲染 |
| `apps/desktop/src/renderer/src/store/chat.tsx` | 74 | 渲染层会话 store |
| `apps/desktop/src/main/services/remote/hub.ts` | 66 | IM 与 Deva 会话的绑定与回合视图聚合 |
| `apps/desktop/src/main/services/browser/host.ts` | 55 | 「Deva 浏览器」窗口、标签、胶囊预览 |
| `apps/desktop/src/main/services/git.ts` | 52 | Git 命令行封装与全部 git IPC |

### 3.4 关键函数说明（按区域，紧凑表）

每行五列：`行号` | `名称与签名` | `作用` | `调用方` | `边界与副作用`。调用方给的是静态扫描到的真实引用点（`文件:行号`，多处时取前两处），写「框架/入口」表示由 Electron、React、express 式的路由分发或 CLI 调用，代码里没有显式引用。

**选中规则**：每个文件按「是否导出 + 函数体长度 + 调用点数量 + 名字是否为启动/注册/解析类」打分，取分数最高的若干条（Web 网关 6、兼容层 4、主进程 3、渲染层 3……），同一文件内按行号排序。**未进入表格的条目不是被省略，而是其说明在附录里逐条给出**——本表的定位是「先读最关键的 469 条建立骨架」，全量 2505 条见 §3.2 的六个附录与 `FUNCTION-INDEX.md`。

### A · Web 网关与服务端


#### `apps/web/server.mjs`（36 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `203` | `resolvePickPath(user, raw)` | 把外部传入的路径归一成真实路径，并确认它在浏览范围内（挡符号链接穿越）。 | apps/web/server.mjs:643、apps/web… | — |
| `214` | `resolveCreatePath(user, raw)` | 用户手输的新目录：允许路径尚不存在，先确认最近的已存在祖先在浏览范围内， 再逐级创建。 | apps/web/server.mjs:687 | 只给「创建并挂载」用，普通浏览仍然只认已存在的目录。 |
| `444` | `serveStatic(req, res, urlPath)` | 先发 Web 自有资源，否则限在 renderer 目录内读文件，HTML 注入脚本；越界 403、缺失 404。 | apps/web/server.mjs:923、apps/web… | — |
| `542` | `assertPathInside(roots, value)` | 单个路径参数必须落在受信根内；空值与非绝对路径（由 worker 按自身 cwd 解析）放行。 | apps/web/server.mjs:583、apps/web… | — |
| `604` | `handleWorkerPick(req, res)` | worker 发起一次目录选择：挂住 HTTP 请求，等浏览器里的 picker 回传后再返回。 | apps/web/server.mjs:929 | 5 分钟没人响应按「取消」处理，避免 worker 永久占着 IPC。 |
| `830` | `handleAdminPost(req, res, session, user, pathname)` | 校验表单 CSRF 后分派创建用户、重置密码、删用户、检查更新，随后重渲染带提示或错误的 adminPage。 | apps/web/server.mjs:1073 | — |

#### `apps/web/src/server/auth.mjs`（24 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `8` | `hashPassword(password)` | 生成 16 字节盐，用 scrypt(N=16384,r=8,p=1,64 字节) 计算摘要并返回 scrypt$N$r$p$salt$hash。 | apps/web/src/server/auth.mjs:78、… | — |
| `46` | `UserStore.list` | 把用户记录映射为只含 id、用户名、角色、创建时间与禁用标记的视图，不含密码哈希。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `69` | `UserStore.create({ username, password, role = 'user' })` | 校验用户名格式、密码长度与重名后，生成 id、哈希密码、追加用户并原子落盘，返回新用户。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `94` | `UserStore.remove(id)` | 删除用户：不允许删掉最后一个管理员，否则从表里移除并落盘。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `125` | `SessionStore.create(user)` | 为用户生成含随机 id、csrf、创建与过期时间的会话，存入 Map 并异步落盘，返回会话。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `250` | `AuditLog.read(userId, limit=200)` | 读该用户最近 7 个审计文件，合并非空行后取末尾 limit 行倒序返回，不可读时返回空数组。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/web/src/server/backend-pool.mjs`（9 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `BackendPool.constructor({ idleMs = 30 * 60 * 1000, onEvent = () => {}, onLog = (…)` | 保存空闲超时、事件/日志回调、控制面地址与 token、受信根提供函数，并初始化进程条目表。 | 静态扫描未检出（成员方法，可能经接口/回调间接调用） | — |
| `30` | `BackendPool.entry(user)` | 取用户条目：存活或启动中则刷新计时复用，已退出则清理并重建，随后拉起 worker 并登记。 | apps/web/src/server/backend-pool… | — |
| `61` | `BackendPool.spawn(user, entry)` | 以用户 home/workspace 等环境变量 fork worker，接管日志，处理 ready/reply/event 与退出，30 秒未就绪则超时。 | apps/web/src/server/backend-pool… | — |
| `136` | `BackendPool.touch(entry)` | 刷新该后端的最近使用时间并重置空闲回收计时器。 | apps/web/src/server/backend-pool… | — |
| `144` | `BackendPool.invoke(user, channel, args)` | 确保 worker 就绪并刷新空闲计时，分配 id 入 pending 后发送 invoke，按回包 resolve/reject，10 分钟超时。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `185` | `BackendPool.stop(userId, reason='manual')` | 删除该用户条目、清空闲定时器、发 shutdown，3 秒后未退出则 SIGKILL，并拒绝所有 pending。 | apps/web/src/server/backend-pool… | — |

#### `apps/web/src/server/pages.mjs`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `53` | `loginPage({ error = '', next = '/' }={})` | 渲染登录 HTML，含转义后的错误提示与 next 隐藏字段，表单 POST 到 /login。 | apps/web/server.mjs:717、apps/web… | — |
| `75` | `adminPage({ user, users, audit = [], error = '', notice = '', csrf, update = n…)` | 渲染管理页：用户表格含改密与删除表单、创建用户表单、审计文本及更新状态，插值均转义。 | apps/web/server.mjs:840、apps/web… | — |
| `189` | `errorPage(status, message)` | 渲染错误页：带图标链接、状态码、转义后的说明与返回首页链接。 | apps/web/server.mjs:833、apps/web… | — |

#### `apps/web/src/server/updater.mjs`（15 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `83` | `UpdateChecker.start` | 未启动时立即检查一次，并在 intervalMs>0 时建立周期定时器重复检查，定时器 unref。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `101` | `UpdateChecker.check` | 手动或定时触发；并发调用共享同一个请求。 | apps/web/src/server/updater.mjs:86 | — |
| `110` | `UpdateChecker.` | 请求 ref 最新 commit 写入状态并与当前 commit 比对；有新版本且未通知过则推 webhook 存状态，异常记入 state.error。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `162` | `UpdateChecker.(latest)` | 用 compare API 判断当前 commit 是不是落后于目标 ref。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 这一步是为了正确处理「镜像固定在某个旧 commit」：只比 sha 是否相等 会让旧构建永远显示有更新，无法区分「落后」和「分叉」。 compare 拿不到时退化成 sha 不等即有更新。 |
| `190` | `UpdateChecker.(url)` | 带 GitHub 接受头、API 版本与可选 token 发 GET，15 秒超时，非 2xx 抛错，否则返回 JSON。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `218` | `UpdateChecker.` | 无 webhook 直接返回；按 json/slack/discord/telegram 组装负载 POST，非 2xx 抛错，成功记日志。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/web/src/server/util.mjs`（14 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `6` | `json(res, status, body, headers={})` | 以 JSON content-type 与 no-store（可附加自定义头）写出状态码和序列化响应体。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `16` | `text(res, status, body, headers={})` | 以 text/plain 与 no-store 头写出指定状态码和纯文本内容。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `25` | `readBody(req, limit=64 * 1024 * 1024)` | 累积请求体，超 limit（默认 64MB）即销毁请求并 reject，结束后 resolve 为 UTF-8 字符串。 | apps/web/src/server/util.mjs:44 | — |
| `49` | `parseCookies(header)` | 按分号拆分 Cookie 头，逐项按首个等号取键值并 decodeURIComponent，失败保留原值。 | apps/web/server.mjs:310、apps/web… | — |
| `65` | `escapeHtml(value)` | 把值转字符串并转义 & < > " ' 五个字符，用于安全插入 HTML。 | apps/web/src/server/pages.mjs:62… | — |
| `128` | `writeJsonAtomic(file, value, mode=0o600)` | 原子写 JSON：先建目录，写同目录临时文件（默认 0600），再 rename 覆盖目标。 | apps/web/src/server/auth.mjs:103… | — |

#### `apps/web/src/server/worker-host.mjs`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `fail(error)` | `{ console.error('[worker] fatal:', error) process.exit(1) }` | 静态扫描未检出（未导出且无同名调用） | — |
| `21` | `main` | 载入 dist/backend.cjs 创建后端，事件经 IPC 以 event 转发父进程，就绪后发送含通道列表的 ready。 | apps/web/src/server/worker-host.… | — |

### A · Web 后端兼容层


#### `apps/web/src/backend/chromium.mjs`（46 条，下列 4 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `102` | `launch` | 清理失效 SingletonLock 后 spawn 无头 Chromium，从 stderr 取 DevTools 地址建连，返回连接与进程。 | apps/desktop/src/main/services/r… | — |
| `306` | `CDPWebContents._onCdpEvent(method, params)` | 把 CDP 事件转成 Electron 回调：分发 debugger 处理器，再处理加载、导航、window.open、弹窗与崩溃。 | apps/web/src/backend/chromium.mj… | — |
| `426` | `CDPWebContents.loadURL(url)` | 置 loading 并发 did-start-loading，导航后等加载完成或 30 秒兜底；失败则复位状态并抛错。 | apps/desktop/src/main/index.ts:2… | — |
| `539` | `CDPWebContents.close` | 置销毁标记、发出 destroyed，再通过 Target.closeTarget 关闭对应 target，失败忽略。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/web/src/backend/electron-shim.mjs`（98 条，下列 4 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `73` | `__invoke(channel, args)` | 按 channel 查处理器，缺失抛 NOT_PORTED；存在则以伪 event 加参数调用并返回结果。 | apps/web/src/backend/index.ts:132 | — |
| `83` | `__send(channel, args)` | 按 channel 取监听器逐个以伪 event 调用，单个监听器抛错只记日志。 | apps/web/src/backend/index.ts:133 | — |
| `466` | `makeSession` | 构造 session 替身：维护 userAgent，空实现 cookies/权限/网络钩子，fetch 转给全局 fetch。 | apps/web/src/backend/electron-sh… | — |
| `541` | `screen.getPrimaryDisplay` | 返回写死的主显示器几何（1440×900、缩放 1），Web 端无真实屏幕信息。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/web/src/backend/index.ts`（9 条，下列 4 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `55` | `step(name:string, fn:() => void → void)` | 执行模块注册函数并打印 name ok，异常只打印 failed 日志，不中断后续启动。 | apps/web/src/backend/index.ts:83… | — |
| `64` | `createBackend(options:BackendOptions → Promise<Backend>)` | 注入事件出口、登记受信根并逐模块注册 IPC 服务与后台任务，返回 invoke/send/channels。 | apps/web/src/server/worker-host.… | — |
| `71` | `getWindow` | `win as never` | apps/desktop/src/main/services/a… | — |
| `84` | `ipc:window:minimize(...)`（IPC） | `undefined` | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/web/src/backend/updater-stub.mjs`（5 条，下列 4 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `2` | `unavailable` | electron-updater 在 Web 模式下不可用：保留接口，调用即失败。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `7` | `autoUpdater.on` | `autoUpdater` | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `8` | `autoUpdater.once` | `autoUpdater` | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `9` | `autoUpdater.removeListener` | `autoUpdater` | apps/desktop/src/preload/index.t… | — |

#### `apps/web/src/electron-shim.js`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `11` | `csrf` | `{ return globalThis.__DEVA_CSRF__ ?? '' }` | apps/web/src/electron-shim.js:37… | — |
| `15` | `emit(channel, payload)` | 浏览器侧按 channel 取监听器逐个调用，回调收到空 event 与 payload，异常只打日志。 | 静态扫描未检出（未导出且无同名调用） | — |
| `79` | `__devaEmit(channel, payload)` | `{ emit(channel, payload) }` | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/web/src/handlers.mjs`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `createHandlers({ devaHome })` | 以 devaHome 构造最小通道表：读写 config.json、读目录文件，其余返回空值或空实现。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `16` | `readConfig` | `{ try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return {} } }` | apps/web/src/handlers.mjs:34、app… | — |
| `24` | `writeConfig(patch)` | 把补丁浅合并进当前配置并整体写回 config.json，返回新配置。 | apps/web/src/handlers.mjs:36 | — |

### A · Web 构建 / 前端壳 / 测试


#### `apps/web/build.mjs`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `113` | `gitInfo` | 记录构建时用的上游 commit，运行期用它和 GitHub 上的最新提交比对。 | apps/web/build.mjs:126 | 拿不到 git 信息（比如打包成 tar 再构建）就留空，不影响构建。 |
| `114` | `read(args)` | 执行 git 子命令并取回去掉首尾空白的输出，失败返回空串（不中断构建）。 | apps/web/build.mjs:121、apps/web/… | — |

#### `apps/web/src/web/picker.js`（16 条，下列 6 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `66` | `baseName(p)` | 取路径最后一段作为显示名，去尾部斜杠，根路径返回 /。 | apps/desktop/src/renderer/src/st… | — |
| `73` | `build` | 首次创建选择器 DOM（根按钮、路径框、列表、按钮），缓存节点、写本地化文案并绑定点击/回车/Esc。 | apps/web/src/web/picker.js:323、a… | — |
| `159` | `renderRoots` | 清空根目录区并按 state.roots 生成按钮（首个显示为我的工作区），点击加载该根，高亮当前路径。 | apps/web/src/web/picker.js:330 | — |
| `175` | `render` | 按 state 重绘：填路径栏、按需加「..」行、空目录提示与子目录行，并同步根按钮选中态。 | apps/web/src/web/picker.js:247 | — |
| `229` | `load(dirPath)` | 禁用交互并请求 /api/fs/list，把 path/parent/roots/entries 写入 state 后 render，失败显示错误。 | apps/web/src/web/picker.js:128、a… | — |
| `258` | `post(body)` | 向 /api/dir-pick/<id> 发带 CSRF 头的 POST，解析 JSON，非 2xx 或 ok=false 时抛错。 | apps/web/src/web/picker.js:287、a… | — |

#### `apps/web/test/smoke.mjs`（5 条，下列 5 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `17` | `check(name, cond, extra='')` | 断言辅助：条件为真时 pass 计数并打印 PASS，否则 fail 计数并打印 FAIL 与附加信息。 | apps/web/test/smoke.mjs:64、apps/… | — |
| `27` | `login(username, password)` | 表单 POST /login 且不跟随跳转，从 Set-Cookie 提取首段拼成 Cookie 头，返回状态码与 cookie。 | apps/web/test/smoke.mjs:63、apps/… | — |
| `40` | `boot(cookie)` | `{ const text = await (await fetch(BASE + '/boot.js', { headers: { cookie } })).text() return { csrf: /__DEVA_CSRF__="([^"]+)"/.exec(text)?.[1], text } }` | apps/web/test/smoke.mjs:65、apps/… | — |
| `45` | `client(cookie, csrf)` | 返回带 cookie 与 csrf 的客户端对象，其 invoke 向 /api/invoke 发 POST 并统一返回状态与响应体。 | apps/web/test/smoke.mjs:67、apps/… | — |
| `46` | `invoke(channel, args=[], extra={})` | 向 /api/invoke 发送 channel、args 与额外字段并带 cookie/CSRF，204 返回 ok，否则合并状态与 JSON。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

### B · 桌面主进程


#### `apps/desktop/src/main/http.ts`（16 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `43` | `httpFetch(input:string \| URL, init:RequestInit={} → Promise<Response>)` | 统一出站 HTTP 封装：默认用 Chromium 会话池发请求，失败且判定请求未送达时在直连与系统代理两条线路间切换重试一次，返回 Response。 | apps/desktop/src/main/providers/… | — |
| `69` | `viaChromium(route:Route, url:string, init:RequestInit → Promise<Response>)` | 从该线路的会话池里轮转取一个 session 分区发 fetch（不带凭据、不缓存），返回 Response。 | apps/desktop/src/main/http.ts:49… | — |
| `159` | `describeNetError(e:unknown → string)` | 网络错误 → 给用户看的说明 + 原始错误码。 | apps/desktop/src/main/providers/… | 非网络错误（如流空闲超时）原样返回 message。 |

#### `apps/desktop/src/main/index.ts`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `98` | `createWindow(→ void)` | 创建主窗口（无边框、预加载、沙箱），挂首显兜底、关窗驻留托盘、外链转系统浏览器与右键编辑菜单，最后加载渲染页。 | apps/desktop/src/main/index.ts:2… | — |
| `217` | `showMainWindow(→ void)` | 显示 / 唤起主窗口（不存在则重建；隐藏 / 最小化则恢复并聚焦）。 | apps/desktop/src/main/index.ts:2… | — |
| `232` | `createTray(→ void)` | 建系统托盘（幂等）：图标运行期生成（tray-icon.ts，无二进制资产；macOS 为单色模板图）。 | apps/desktop/src/main/index.ts:403 | 菜单——显示 Deva / 定时任务概览〔直达 Tasks 标签〕/ 退出；左键切换窗口可见。 菜单文案按启动时 config.locale 取中/英（运行时改语言需重启方更新，可接受）。 |

#### `apps/desktop/src/main/locale.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `7` | `isEn(→ boolean)` | `{ return getConfig().locale === 'en' }` | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/main/providers/anthropic.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `58` | `mapMessages(messages:Message[] → unknown[])` | 相邻同角色消息合并为一条（块按原序拼接）。 | apps/desktop/src/main/providers/… | 引擎的自愈引导（见 chat.ts 的 AUTO_MARKER）可能紧跟在 工具结果或另一条 user 消息之后；协议虽容忍连续同角色，合并后更稳妥，且不改变语义。 无相邻同角色时产出与改造前逐字节一致。 |
| `131` | `streamAnthropic(cfg:AdapterConfig, req:GenerateRequest → AsyncGenerator<StreamEvent>)` | 向 /v1/messages 发流式请求，解析 SSE 产出文本、思考与工具调用事件，累计用量与停止原因，异常转为 error/done。 | apps/desktop/src/main/providers/… | — |
| `210` | `takeUsage(u:AnthropicUsage \| undefined → void)` | 用量分散在 message_start（输入侧）与 message_delta（输出侧）两处，且各版本带的字段互有出入， 统一用同一个取值器：谁带哪段就取哪段，不覆盖没带的。 | apps/desktop/src/main/providers/… | — |

#### `apps/desktop/src/main/providers/index.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `16` | `toParts(content:string \| ContentPart[] → ContentPart[])` | `{ if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [] return content }` | 静态扫描未检出（未导出且无同名调用） | — |
| `28` | `normalizeMessages(messages:Message[] → Message[])` | 合并「连续同角色」消息为一条（跨适配器统一前置处理，非破坏性：不改动入参数组）。 | apps/desktop/src/main/providers/… | 直连 Anthropic 会自动合并连续同角色轮，但 Bedrock / 部分网关会以 400 「roles must alternate」拒绝；上下文压缩后会出现「摘要(user) + 近期首条(user)」两条连续 user，故在此消弭，对所有服务商稳健。正常交替对话下为无操作；绝不合并不同角色， 因此 assistant(tool_use) ↔ user(tool_result) 的相邻关系始终保持。 |
| `46` | `streamChat(cfg:StreamChatConfig, req:GenerateRequest → AsyncGenerator<StreamEvent>)` | 统一入口：按 adapter 选择实现，密钥在主进程内解密后注入，绝不外泄。 | apps/desktop/src/main/services/c… | 未配置密钥时（本地 Ollama 之类可无钥）以空串继续，由目标服务决定是否放行。 |

#### `apps/desktop/src/main/providers/openai-responses.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `51` | `mapInput(messages:Message[] → ResponsesInputItem[])` | 把归一化消息展开成 Responses 的 input 序列（工具调用/结果各自成独立顶层项）。 | apps/desktop/src/main/providers/… | — |
| `113` | `streamResponses(cfg:AdapterConfig, req:GenerateRequest → AsyncGenerator<StreamEvent>)` | 向 /responses 发流式请求，解析 SSE 产出文本、推理、函数调用与用量事件，处理截断与失败并按工具调用收尾。 | apps/desktop/src/main/providers/… | — |
| `183` | `takeUsage(evt:Record<string, unknown> → void)` | 从响应事件里读取 usage 的输入、输出与缓存命中 token 数，写入闭包内的累计变量。 | apps/desktop/src/main/providers/… | — |

#### `apps/desktop/src/main/providers/openai.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `49` | `mapMessages(system:string \| undefined, messages:Message[] → OpenAIMessage[])` | 把归一化消息展开成 OpenAI 消息序列（一条 assistant 的工具结果会裂成多条 tool 消息）。 | apps/desktop/src/main/providers/… | — |
| `169` | `streamOpenAI(cfg:AdapterConfig, req:GenerateRequest → AsyncGenerator<StreamEvent>)` | 向 /chat/completions 发流式请求，解析 SSE 产出文本、推理、工具调用与用量事件，带内错误与异常转为 error/done。 | apps/desktop/src/main/providers/… | — |
| `233` | `flushCalls(→ Generator<StreamEvent>)` | 按 index 顺序把累积的工具调用解析出参数并产出 tool_call，解析失败的交给 settleBrokenCalls 定性，随后清空累积表。 | apps/desktop/src/main/providers/… | — |

#### `apps/desktop/src/main/providers/opencode.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `21` | `isOpencodeInference(baseURL:string → boolean)` | 该 baseURL 是否指向 opencode.ai 的推理网关（Go 或按量计费）。 | apps/desktop/src/main/providers/… | — |
| `40` | `providerHeaders(baseURL:string, sessionId?:string → Record<string, string>)` | 模型请求（对话流式与拉取模型清单）要追加的请求头，适配器原样并进 fetch headers 即可： · 所有服务商都带 `user-agent: deva/<版本>` 自报身份——不带就是网络库的默认值（Chromium 浏览器 UA），网关、 中转服务与服务商后台都分不出是哪个工具在调用（issue #33）。 | apps/desktop/src/main/providers/… | 版本号与更新器 / MCP 客户端同源。 · opencode.ai 的推理端点另加 `x-opencode-session`（见文件头）。 |
| `54` | `opencodeModelsURL(baseURL:string → string \| null)` | 模型清单地址：网关只在「推理根」下提供 `/v1/models`（`https://opencode.ai/inference/v1/models` 与 Go 的 `https://opencode.ai/inference/go/v1/models`），各 API 路径（`/openai/v1`、`/anthropic/v1`） 下没有 `/models`，按各家常规拼法必然 404。 | apps/desktop/src/main/services/p… | 非网关地址返回 null，由调用方走常规路径。 |

#### `apps/desktop/src/main/providers/sse.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `StreamIdleError.constructor(ms:number)` | 构造流空闲错误：按毫秒换算出秒数，生成中/英文「连接空闲超过 Ns，判定为中断」的消息并设置 name。 | 静态扫描未检出（成员方法，可能经接口/回调间接调用） | — |
| `28` | `iterateSSE(res:Response, idleMs=0 → AsyncGenerator<{ event?: str…)` | 极简 SSE 解析：把 fetch 的响应体流切成一个个 {event, data} 事件。 | apps/desktop/src/main/providers/… | 响应来自统一出站 httpFetch（../http.ts，Chromium 网络栈），按 Web Streams 读取，无需任何依赖， 契合「零环境配置」铁律。Anthropic 与 OpenAI 两套流都走它。 idleMs>0 时启用空闲看门狗：任一 read() 超过 idleMs 未返回即抛 StreamIdleError， 把"僵死的半开连接"变成一个可被上层识别、可自动重连的真实信号。 |
| `67` | `readWithIdle(reader:ReadableStreamDefaultReader<Uint8Array>, idleMs:number → Promise<ReadableStreamReadRe…)` | reader.read() 与空闲计时器竞速：超时抛 StreamIdleError；正常返回则清除计时器。 | apps/desktop/src/main/providers/… | — |

#### `apps/desktop/src/main/providers/types.ts`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `213` | `toolImagesNote(images:ImagePart[] → string)` | 工具结果图片的引子。 | apps/desktop/src/main/providers/… | OpenAI 两套协议的工具结果只收文本，图片只能挪进随后的 user 消息—— 用这句讲明它们属于上方工具结果，免得模型当成用户新发来的图。 |
| `219` | `parseToolArgs(raw:string → unknown)` | 解析工具参数 JSON：空串视为无参数 `{}`；解析失败返回 undefined（多半是被截在了中途）。 | apps/desktop/src/main/providers/… | — |
| `302` | `httpError(status:number, body:string, retryAfter?:string \| null, effortSent?:b… → NormalizedError)` | HTTP 状态码 → 归一化错误。 | apps/desktop/src/main/providers/… | retryAfter 为响应头 retry-after 原值（可选）； effortSent = 本次请求带了思考等级参数（见 GenerateRequest.effort）。 message 会直接显示给用户，按界面语言出中 / 英文（见 locale.ts）。 |

#### `apps/desktop/src/main/pty-host.ts`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `44` | `defaultShell(→ string)` | 默认 shell：Windows 用 Windows PowerShell（5.1 恒随系统预装，零配置）；其余用登录 shell。 | apps/desktop/src/main/pty-host.t… | — |
| `50` | `safeCwd(cwd:string \| null → string)` | cwd 兜底：目录不存在（或未开项目）时回退到用户主目录，避免 spawn 失败。 | apps/desktop/src/main/pty-host.t… | — |
| `55` | `handleCreate(msg:Extract<InboundMessage, { type: 'create' }> → void)` | 处理终端 create 消息：按 shell 路径、尺寸与安全 cwd 启动 pty，登记会话并转发数据与退出消息，启动失败补发 exit。 | apps/desktop/src/main/pty-host.t… | — |

#### `apps/desktop/src/main/services/appimage.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `24` | `quoteExecArg(arg:string → string)` | desktop entry 的 Exec 参数转义：双引号内转义 " ` $ \\，再按字符串值规则把 \\ 加倍；% 写成 %%。 | apps/desktop/src/main/services/a… | — |
| `29` | `integrateAppImage(→ Promise<void>)` | Linux 打包运行时把 AppImage 内嵌的 desktop 条目与图标写入用户目录并指向当前路径，失败静默，非自有文件不处理。 | apps/desktop/src/main/index.ts:288 | — |
| `68` | `copyIcons(appDir:string, destRoot:string → Promise<void>)` | 把 AppImage 里 usr/share/icons/hicolor/<尺寸>/apps/deva.png 拷到用户图标目录（内容不变则跳过）。 | apps/desktop/src/main/services/a… | — |

#### `apps/desktop/src/main/services/attachments.ts`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `73` | `classify(ext:string → AttachmentKind)` | 按扩展名归类附件：图片表命中为 image，.pdf 为 document，文本扩展名集合为 text，其余 unsupported。 | apps/desktop/src/main/services/a… | — |
| `149` | `registerAttachmentsIpc(getWindow:() => BrowserWindow \| null → void)` | 注册附件相关 IPC（粘贴落盘、拖入条目、图片读取、系统选文件），并在启动时清空粘贴临时目录。 | apps/desktop/src/main/index.ts:3… | — |
| `270` | `buildAttachmentPart(path:string, adapter:'anthropic' \| 'openai' \| 'responses' → Promise<{ part?: ContentPart…)` | 把一个「已授权」的附件读成归一化内容块。 | apps/desktop/src/main/services/c… | - 图片 → ImagePart（base64） - PDF → Anthropic（document 块）与 OpenAI Responses（input_file）可原生读取，给 DocumentPart； 仅 OpenAI Chat Completions 无 PDF 通道，跳过并回一条说明 - 文本/代码 → 带前缀标记的 TextPart（注入正文） 未授权 / 超限 / 读取失败 → 返回 note（不产出内容块）。 |

#### `apps/desktop/src/main/services/avatar-image.ts`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `38` | `readAvatarImage(dir:string, name:string → string)` | 读成 data URI 交付渲染层（无图 / 读失败 → 空串，回落生成头像）。 | apps/desktop/src/main/services/a… | — |
| `52` | `clearAvatarImage(dir:string, name:string → void)` | 删掉该 name 的所有头像图片变体（清除 / 覆盖前 / 删角色时调用）。 | apps/desktop/src/main/services/a… | — |
| `63` | `writeAvatarImage(dir:string, name:string, dataUri:string → string)` | 写入自定义头像（data URI）。 | apps/desktop/src/main/services/p… | 成功返回读回的 data URI；参数非法 / 写失败返回空串。 |

#### `apps/desktop/src/main/services/browser/host.ts`（55 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `131` | `uiState(→ BrowserUiState)` | 汇总界面上应显示的网页标签、当前标签、正在操作与等待用户操作的信息，组装成 BrowserUiState 推给渲染层。 | apps/desktop/src/main/services/b… | — |
| `327` | `showWindow(tab?:string \| null, focus=true → void)` | 展开窗口并切到某个标签。 | apps/desktop/src/main/services/b… | focus=false 时不抢焦点（如 Deva 自己弹出时）。 |
| `540` | `registerBrowserIpc(→ void)` | 幂等注册浏览器 IPC 与屏幕监听，注入页面工厂与占用判定，提供状态、开关窗口、标签与导航等通道。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/browser/index.ts`（28 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `61` | `closeSessionPages(sessionId:string → void)` | 对话被删除：结束它的等待、关掉它的网页。 | apps/desktop/src/main/services/b… | — |
| `67` | `disposeAllPages(→ void)` | 应用退出 / 主窗口真正关闭：关掉全部网页与浏览器窗口（它们也算窗口，不关掉应用退不出去）。 | apps/desktop/src/main/index.ts:1… | — |
| `886` | `runBrowserTool(a:Record<string, unknown>, ctx:BrowserToolContext → Promise<ToolOutcome>)` | executeTool 的 browser 分支。 | apps/desktop/src/main/services/t… | 错误以工具失败结果返回，不抛出。 |

#### `apps/desktop/src/main/services/browser/live.ts`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `28` | `startLive(tabId:string, target:() => BrowserWindow \| null → Promise<boolean>)` | 开始推某个标签的画面给 target（主窗口）；已在推别的标签则先停掉。 | apps/desktop/src/main/services/b… | 返回是否开成功（标签不存在、CDP 失败为 false）。 |
| `71` | `stopLive(→ void)` | 停止推送（预览卡收起、换标签、主窗口最小化）。 | apps/desktop/src/main/services/b… | — |
| `91` | `liveTab(→ string \| null)` | 正在推哪个标签（测试用）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/main/services/browser/page-scripts.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `9` | `callScript(fnSource:string, args:unknown[] → string)` | 注入网页执行的脚本（以源码字符串经 executeJavaScript 运行，故不参与主进程类型检查，须自包含、只用浏览器 API）。 | apps/desktop/src/main/services/b… | 元素编号：snapshot 给可操作元素分配 e1、e2…，编号 → 元素存在页面里的 window.__devaRefs（WeakRef，不改 DOM， 不触发网页自己的 MutationObserver）。同一元素再次 snapshot 沿用原编号；页面导航后编号表随页面一起消失。 把函数源码与参数拼成一段可执行的表达式。 |

#### `apps/desktop/src/main/services/browser/pages.ts`（35 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `151` | `browserSession(→ Session)` | 浏览器专用会话：去掉 UA 里的 Electron / 应用名标记（不少网站据此拦截或降级），拒绝一切权限请求，下载存到「下载」目录。 | apps/desktop/src/main/services/b… | — |
| `201` | `createPage(sessionId:string, visible=false, personaId?:string → BrowserPage)` | 新建一个网页（空白），设为该对话的当前标签。 | apps/desktop/src/main/services/b… | visible：用户在电脑前（前台对话），放进浏览器窗口； 否则（定时任务、手机端）放进离屏窗口。 |
| `229` | `basePage(id:string, sessionId:string, personaId:string \| undefined, kind:Brow… → BrowserPage)` | 网页的公共字段（两种宿主共用）。 | apps/desktop/src/main/services/b… | — |

#### `apps/desktop/src/main/services/browser/url.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `9` | `normalizeUrl(raw:string → string \| null)` | 网址规范化（browser 工具的 open 用）：补协议（本机 / 内网地址补 http，其余补 https）； 本机路径转 file:；拒绝 javascript: / chrome: 等。 | apps/desktop/src/main/services/b… | 无效返回 null。 |

#### `apps/desktop/src/main/services/chat-bus.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `32` | `subscribe(topic:string, listener:(p: T) => void → () => void)` | 在内部事件总线上安全订阅某主题：回调异常只记警告、不打断发布方，返回取消订阅函数。 | apps/desktop/src/main/services/c… | — |
| `44` | `publishChatEvent(p:ChatEventPayload → void)` | `{ bus.emit('chat', p) }` | apps/desktop/src/main/services/c… | — |
| `63` | `publishSessionsChanged(→ void)` | 对话清单在回合之外变了（手机上 /new 建出的空对话、删角色时定时任务对话改挂 Deva）。 | apps/desktop/src/main/services/c… | 经回合新建的不必发：首轮 turn_start 已会让渲染层刷新列表。 |

#### `apps/desktop/src/main/services/chat-store.ts`（24 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `340` | `writeFileAtomic(file:string, data:string → void)` | 原子写：先写同目录 `<file>.tmp` 再 rename 覆盖。 | apps/desktop/src/main/services/c… | 进程在写到一半时被杀（强退 / 断电 / 崩溃） 最多丢掉这一次的新内容，**绝不会把旧文件截成半截 JSON**——否则 loadSessionFile 解析失败即 当作「对话不存在」，整条对话凭空消失。 仅当 rename 失败（Windows 上目标文件被杀毒 / 索引服务短暂占用时可能 EPERM）才回退为直接覆盖写 （与旧行为一致）并清掉残留 tmp；tmp 本身写不进（磁盘满等）则原样抛出——此时再去直写只会把 旧文件也截断。`.json.tmp` 不以 `.json` 结尾，扫描重建索引时天然被排除。 |
| `481` | `save(id:string → void)` | 保存单条对话：写该对话文件 + 刷新其索引条目并落盘。 | apps/desktop/src/main/services/c… | 只重写这一条 + 轻量索引，与其它对话无关（这是一对话一文件的核心收益）；压缩过的对话只重写模型还看得到的 那部分，更早的追加进拆分文件（见 syncCompacted）。 |
| `519` | `ensureSession(id:string, opts?:{ personaId?: string; focusRoot?: string \| null; mo… → StoredSession)` | 取会话；不存在则新建（仅入内存缓存 + 索引，尚未落盘，待 save）。 | apps/desktop/src/main/services/c… | 对话无分桶概念，故无归属参数。 `opts.personaId`/`opts.focusRoot`：首发绑定——新建时写入；已存在会话仅当当前为 undefined 才补 persona （**绝不覆盖**已绑定值），focusRoot 可由 mountFocus 后续更新（显式提供即应用，含 null 卸载）。 `opts.model`：本对话模型引用（快照固定）——新建时写入角色偏好快照；已存在会话显式提供即应用（聊天中 切换模型，与 focusRoot 同为「可变·显式即覆盖」；空串=显式回落全局默认）。见 StoredSession.model。 `opts.effort`：本对话思考等级，同 model「可变·显式即覆盖」。见 StoredSession.effort。 |

#### `apps/desktop/src/main/services/chat.ts`（192 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `2309` | `buildForkHistory(history:Message[], forkCallId:string, prompt:string → Message[])` | fork 的起始历史：主对话历史的浅拷贝（消息对象按不可变对待、与主对话共享）+ 一条合成的回灌消息。 | apps/desktop/src/main/services/c… | 派发时主历史的末条是本步含全部 tool_use 的 assistant 消息，协议要求每个 tool_use 紧跟结果：本次 fork 调用自身与同一步的其它调用各补一条说明性结果（tool_result 排在最前），再接分身的任务指令。 |
| `2545` | `registerChatIpc(getWindow:() => BrowserWindow \| null → void)` | 注册对话的全部 IPC 通道并桥接事件总线，涵盖发送、压缩、会话管理、按轮删除、回滚与交互答复等。 | apps/desktop/src/main/index.ts:3… | — |
| `3920` | `runAgentLoop(args:AgentLoopArgs → Promise<{ text: string …)` | Agent 编排核心：单步流式 → 收集工具调用 → 过权限闸门 → 执行 → 结果回灌 → 继续。 | apps/desktop/src/main/services/c… | 主轮与子智能体共用此逻辑；**不发终态 `done`**，仅返回 `{text, stopReason}` 交调用方处置 （主轮由 runTurn 发 done；子轮把 text 作结论回灌父轮）。流式内的 text/tool/usage/error/ reconnect 等中途事件照常发。抛异常则交调用方 catch。 |

#### `apps/desktop/src/main/services/checkpoints.ts`（24 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `69` | `checkpointDirName(id:string → string)` | 会话 id → 目录名（与 chat-store 的 safeId 同一白名单）：id 来自渲染层，杜绝路径穿越。 | apps/desktop/src/main/services/c… | — |
| `209` | `createRecorder(s:StoredSession → Recorder)` | 为一次回合创建记录器（主轮与其子智能体共用同一个，seq 因而全局递增）。 | apps/desktop/src/main/services/c… | 调用方须把每个方法包在 try/catch 里：**记录失败绝不影响工具执行**。 |
| `454` | `planRewind(s:StoredSession, ownerIds:Iterable<string>, focusRoot:string \| null → Promise<RewindPlan>)` | 计算回滚计划：ownerIds = 目标轮起全部 tool_use id。 | apps/desktop/src/main/services/c… | 每个文件取最早记录的 pre 为目标， 与磁盘现状比对出动作与状态；+N −M 是「现状 → 目标」，即这次回滚实际要加减的行数。 每次执行前都在主进程重算，绝不信任渲染层回传的预览。 |

#### `apps/desktop/src/main/services/clipboard.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `registerClipboardIpc(→ void)` | 注册剪贴板 IPC：读取返回系统剪贴板纯文本，写入把给定值转成字符串写入并返回 ok。 | apps/desktop/src/main/index.ts:3… | — |
| `15` | `ipc:clipboard:read-text(...)`（IPC） | 读取剪贴板纯文本（无内容时 Electron 返回空串）。 | 静态扫描未检出（未导出且无同名调用） | — |
| `18` | `ipc:clipboard:write-text(...)`（IPC） | 写入剪贴板纯文本。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/main/services/compaction.ts`（30 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `77` | `insertBody(text:string → string \| null)` | 插入消息的用户原文；不是插入消息则为 null。 | apps/desktop/src/main/services/c… | — |
| `374` | `buildTranscript(messages:Message[], locale:string, maxChars=MIN_TRANSCRIPT_CHARS → string)` | 把待压段拍平成纯文本转录（丢 base64、截断超长工具结果、总量头部截断保留较近）。 | apps/desktop/src/main/services/c… | — |
| `596` | `compactSession(args:{ session: StoredSession model: CompactModelConfig signal… → Promise<{ status: CompactSta…)` | 压缩一个会话：在模型视图上选边界 → 转录待压段 → 一次性摘要 → 把摘要插进对话记录的边界处并落盘。 | apps/desktop/src/main/services/c… | 不删除任何消息：被压的部分照常显示，只是此后不再发给模型（见 modelMessages）。 成功 'compacted'；无可压 'none'；摘要失败或未过把关（复读 / 压完不变短）'failed'（历史保持不变）。 **就地改写** session.messages（不重新赋值）：轮中压缩时 Agent 循环正拿着这个数组往里追加。 |

#### `apps/desktop/src/main/services/config.ts`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `17` | `getDevaHome(→ string)` | Deva 配置根目录：DEVA_HOME 覆盖，否则 ~/.deva。 | apps/desktop/src/main/services/c… | 首次调用即确保目录存在。 |
| `62` | `getConfig(→ Record<string, unknown>)` | 主进程内读取整份配置（只读快照）。 | apps/desktop/src/main/index.ts:1… | 供其它服务在进程内复用（如 git.ts 读 `git.path` 覆盖），避免各自重复读文件。 |
| `82` | `registerConfigIpc(→ void)` | 注册配置 IPC：同步与异步读取整份配置、按补丁浅合并写入，注册前确保配置已载入。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/decision.ts`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `84` | `fetchWithTimeout(url:string, init:RequestInit → Promise<Response>)` | 带超时的 fetch；超时按 AbortError 抛出，交由 networkError 归一。 | apps/desktop/src/main/services/d… | — |
| `94` | `networkError(e:unknown → NormalizedError)` | 把异常归一成网络类 NormalizedError：中断记为请求超时且可重试，其余用 describeNetError 生成说明。 | apps/desktop/src/main/services/d… | — |
| `197` | `decide(cfg:DecisionConfig, state:DecisionState, questions:DecisionQuestion[] → Promise<DecisionResult>)` | 通用决策入口（主进程内部调用，Phase 3 由任务侧闸门使用）：按 adapter 分派。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 绝不经 IPC 暴露给渲染层——决策结果只在主进程内驱动「是否主动发起」。 |

#### `apps/desktop/src/main/services/deliverables.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `39` | `deliveredPaths(sessionId:unknown, toolUseId:unknown → string[])` | 该对话里那次 present_files 调用交付的文件：取会话边车 delivered（已解析、去重）。 | apps/desktop/src/main/services/d… | 边车缺失时回落历史里该调用参数中的绝对路径（早期版本把解析后的路径直接写进了参数，没有边车）。 |
| `69` | `registerDeliverablesIpc(→ void)` | 注册交付卡的 inspect/thumbnail/open/reveal 四个 IPC；文件路径只从会话的 delivered 记录解析，不接受任意路径。 | apps/desktop/src/main/index.ts:3… | — |
| `72` | `ipc:deliverables:inspect(...)`（IPC） | 按对话 id 与工具调用 id 取交付文件列表，逐个 stat 后返回含大小、目录与是否可安全打开的数组。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/main/services/exec-policy.ts`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `17` | `findGitBashOnPath(→ string \| null)` | 在 PATH 上找到 git.exe，据 Git for Windows 的固定布局推导同装的 bash.exe。 | apps/desktop/src/main/services/e… | 覆盖 shells.ts 硬编码候选路径（`%ProgramFiles%\\Git\\bin\\bash.exe` 等）漏掉的场景： 非 C: 盘安装、绿色版、自定义目录——只要 git 在 PATH 上即可（几乎总是）。 只从「真实 git 安装目录」旁推导，故不会误取 System32\\bash.exe（那是 WSL）。 |
| `50` | `resolveExecShell(→ ExecShell)` | 解析执行 shell：**优先 Git Bash**（用户选定，命令统一写 POSIX）。 | apps/desktop/src/main/services/t… | - win：探到 Git Bash → `bash -l -c`（--login 拿全 PATH，去掉交互 -i 防挂起）；否则回落 cmd（shell:true）。 - posix：有 /bin/bash → `bash -c`；否则回落 /bin/sh -c（shell:true）。 |

#### `apps/desktop/src/main/services/ext-roles.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `35` | `getRoles(name:ExtSection, id:string → string[] \| null)` | 某项的可用角色；null = 全部角色。 | apps/desktop/src/main/services/e… | — |
| `40` | `setRoles(name:ExtSection, id:string, roles:string[] \| null → void)` | 设置某项的可用角色；null = 全部角色（删掉该键）。 | apps/desktop/src/main/services/m… | — |
| `52` | `allowsPersona(name:ExtSection, id:string, personaId:string → boolean)` | 该项是否对这个角色可用（不看启用态）。 | apps/desktop/src/main/services/m… | — |

#### `apps/desktop/src/main/services/frontmatter.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `43` | `parseFrontmatter(raw:string → ParsedFrontmatter)` | 解析 frontmatter。 | apps/desktop/src/main/services/p… | 无有效 `---` 头部时 data 为空、body 为原文（容错，绝不抛错）。 |
| `112` | `fmString(data:Record<string, FmValue>, key:string → string)` | 取标量字段（数组则取首项）；缺失或为映射返回 ''。 | apps/desktop/src/main/services/p… | — |
| `151` | `fmScalar(v:string → string)` | 把值序列化为 frontmatter 行的标量表示（含特殊字符时加双引号并转义）。 | apps/desktop/src/main/services/p… | — |

#### `apps/desktop/src/main/services/fs-guard.ts`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `59` | `trustRoot(dir:string → void)` | 登记一个受信根（打开文件夹 / 挂载工作区时）。 | apps/desktop/src/main/services/a… | — |
| `79` | `isInsideRoot(target:string → boolean)` | target 是否落在某个受信根内。 | apps/desktop/src/main/services/f… | 以「真实路径」比较（realResolve 跟随符号链接）：只要目标的真实路径不在任一受信根的 真实路径之内即视为越界——从而堵住「根内符号链接指向根外」的穿越（旧实现仅 resolve 归一 `..` 但不跟随链接，存在真实穿越面）。 |
| `99` | `insideRootFlags(targets:string[] → Promise<boolean[]>)` | 批量版 isInsideRoot（逐条语义相同）：受信根的真实路径只解析一次，目标走异步 realpath。 | apps/desktop/src/main/services/f… | 逐条调 isInsideRoot 会同步 realpath「目标 + 每个受信根」——git status 列出上万个文件时把主进程 卡住数十秒（受信根随挂载过的对话累积，耗时成倍增长）。 |

#### `apps/desktop/src/main/services/git.ts`（52 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `180` | `runGitRaw(cwd:string \| undefined, args:string[], timeout=DEFAULT_TIMEOUT, inpu… → Promise<RunResult>)` | 底层执行（不做 assertInside）：供 `git --version` 等无仓库根上下文的命令用。 | apps/desktop/src/main/services/g… | 用户可控串一律作独立 argv；env 关掉交互提示与可选锁，锁定英文错误文案便于解析。 |
| `311` | `parsePorcelainV2(stdout:string, root:string → Omit<GitStatus, 'isRepo' \| '…)` | 解析 `git status --porcelain=v2 --branch -z` 输出。 | apps/desktop/src/main/services/g… | `-z` 用 NUL 分隔，稳过含空格/中文/特殊字符的路径；重命名（`2`）额外占一个 NUL 段（origPath）。 |
| `623` | `registerGitIpc(→ void)` | 注册 git 相关 IPC：可用性、状态、diff、暂存与提交、分支、远程操作及 AI 生成提交信息。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/handoff.ts`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `124` | `buildHandoffBody(title:string, h:HandoffInput → string)` | 交接通知的正文（主对话里那条通知消息里、交给主角色看的部分）。 | apps/desktop/src/main/services/c… | 首尾标签之间按固定行写任务名、摘要与全文， 供 parseHandoff 解析；标签之后是给主角色的说明。 只是告知的不写全文：原文就是紧跟的下一条（以任务身份显示的那条回复），写两遍白占主对话的上下文。 |
| `141` | `parseHandoff(text:string → HandoffInfo \| null)` | 从通知消息正文里解析出交接信息（不含交接标签则 null）。 | apps/desktop/src/main/services/c… | — |
| `203` | `stubLongInforms(history:Message[] → Message[])` | 发给模型前（只影响这次请求与摘要压缩，历史不动）：只是告知的原文超过 INFORM_INLINE_MAX 字时， 回复换成「标题 + 一行说明」，用户在界面上照样看全文。 | apps/desktop/src/main/services/c… | 早先版本的交接通知里也写着全文，一并去掉。 写法固定（只取决于这条消息本身），每次请求换出来的字节一样，不破坏提示缓存。 |

#### `apps/desktop/src/main/services/image-read.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `28` | `sniffImageMime(buf:Buffer → ImageMime \| null)` | 按魔数识别图片格式；不是这四种之一返回 null。 | apps/desktop/src/main/services/a… | — |
| `57` | `thumbnailDataUrl(buf:Buffer, mime:string → string)` | 图片 → 缩略图 data URI（界面显示附件用，不发给模型）。 | apps/desktop/src/main/services/a… | 原图已够小就原样返回；nativeImage 解不开的格式 （GIF / WebP）也原样返回，由界面自己解码——附件本身限 5MB，原样交出去也不大。`mime` 为图片实际格式。 |
| `104` | `prepareImage(buf:Buffer, mime:ImageMime, name?:string → PreparedImage)` | 把一张图整形成可发送的 ImagePart。 | apps/desktop/src/main/services/b… | `mime` 应来自 sniffImageMime（而非扩展名）。 不超限则原样发送（字节不动）；超限则缩放到长边 MAX_EDGE，PNG 优先保持 PNG（保透明与文字锐度）， 仍超限再逐级降质回退 JPEG。永不抛错。 |

#### `apps/desktop/src/main/services/image-trim.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `23` | `trimmedNote(removed:number, total:number → string)` | `{ return removed === total ? '\\n（图片已从上下文移除以控制请求体积；需要再看请重新读取该文件或重新调用工具。 | apps/desktop/src/main/services/i… | ）' : `\\n（其中 ${removed} 张图片已从上下文移除以控制请求体积；需要再看请重新读取。）` }` |
| `30` | `trimResult(p:ToolResultPart, keep:(img: ImagePart) => boolean → ToolResultPart)` | 按 keep 过滤一条工具结果的图片；没变化返回原对象。 | apps/desktop/src/main/services/i… | — |
| `41` | `trimHistoryImages(history:Message[] → Message[])` | 返回历史副本：之前回合的工具图片换成文字说明，当前回合只留最近几块，控制请求体积且不改原历史。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/line-stats.ts`（5 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `26` | `splitLines(s:string → string[])` | 按行切分；末尾换行不单独算一行（"a\\nb\\n" 与 "a\\nb" 都是 2 行）。 | apps/desktop/src/main/services/l… | — |
| `74` | `lineStats(before:string, after:string → LineStats)` | 从 before 变到 after：新增 added 行、删除 removed 行（修改一行 = −1 +1，与 git 的口径一致）。 | apps/desktop/src/main/services/c… | — |
| `101` | `lineCount(s:string → number)` | 一段文本的行数（用于整文件新建 / 删除时的 +N / −N）。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/listing.ts`（16 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `91` | `attachListing(history:Message[], build:(history: Message[]) => TextPart \| null \| (… → void)` | 请求模型前调用：build 据历史算出清单块（可给多块，按序附上；无差异给 null），附到历史末条——它是这次请求才 首次发出的那条 user 消息（用户提问 / 工具结果），附上去不碰已缓存的前缀。 | apps/desktop/src/main/services/c… | 已告知过则 build 给 null，故重连重发时 调用多少次都一样。 末条是带标记的字符串消息（压缩摘要 / 自愈引导 / 后台通知）时不附：它们靠字符串前缀识别，改成块数组就 认不出了——留给下一条消息（多为下一步的工具结果）。 |
| `163` | `memoryListingPart(history:Message[], root:string \| null → TextPart \| null)` | 当前记忆（全局 + 已挂载工作区的项目私有记忆）与历史里已告知的差异，生成一块记忆清单；一致则返回 null。 | apps/desktop/src/main/services/c… | root 取工具上下文的实时工作区：轮中挂载 / 切换后，新工作区的项目记忆随下一步附上，旧工作区的记作不再适用。 |
| `208` | `guidesAnnounced(history:Message[] → Set<string>)` | 按需加载工具（见 tool-search.ts）的用法哪些已在上下文里：tool_search 的结果、未查就调用被拦下时附上的用法、 加载技能时附上的用法都挂着记录。 | apps/desktop/src/main/services/t… | 只看键不看摘要：用法文案改了不逼模型重查，查到的总是当前版本。 |

#### `apps/desktop/src/main/services/mcp-config.ts`（23 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `177` | `setEnabled(id:string, enabled:boolean → void)` | 用户显式启停：落盘并恒通知对账（即便值未变，也当作「请按此状态兑现」）。 | apps/desktop/src/main/services/m… | — |
| `185` | `listServerConfigs(→ McpServerConfig[])` | 读取全部 MCP 服务配置，过滤非法 id 与非法记录，按 name 排序后返回数组。 | apps/desktop/src/main/services/m… | — |
| `204` | `upsertServer(input:McpServerInput → McpServerConfig)` | 新建或覆盖一个 MCP 服务配置，返回最终记录。 | apps/desktop/src/main/services/m… | — |

#### `apps/desktop/src/main/services/mcp.ts`（37 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `295` | `connect(id:string, cfg:McpServerConfig → Promise<boolean>)` | 建立连接并发现工具；成败都只落状态、绝不抛错。 | apps/desktop/src/main/services/m… | 返回是否连上。 |
| `512` | `autoConnectEnabledServers(→ void)` | 启动时对账所有「已启用」的服务（失败各自降级，不互相阻塞）。 | apps/desktop/src/main/index.ts:3… | — |
| `628` | `registerMcpIpc(getWindow:() => BrowserWindow \| null → void)` | 注册 MCP 的 list/get/upsert/remove/set-roles/set-enabled/retry/set-secret/has-secret，并把状态推送绑到窗口。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/media-store.ts`（11 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `89` | `readBlob(hash:string → string \| null)` | 按引用读回 base64；文件缺失 / 损坏返回 null。 | apps/desktop/src/main/services/c… | — |
| `119` | `hydrateMessages(messages:Message[] → void)` | 载入后原地还原消息里的 blob 引用。 | apps/desktop/src/main/services/c… | 读不回的（media 目录被手动清理等）不能留成空块发给模型—— 服务商会直接 400：消息里的独立块换成一行文字说明，工具结果里的图片去掉并在正文里注明。 |
| `149` | `sweepMedia(→ Promise<void>)` | 启动清扫（异步，不阻塞启动）：删掉没有任何对话 / 子智能体记录引用的 blob。 | apps/desktop/src/main/index.ts:3… | 引用只存在于 data/chats 与 data/subagents 下的 JSON 里（只有它们经 mediaReplacer 落盘）。 |

#### `apps/desktop/src/main/services/members.ts`（20 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `91` | `activeMembers(list:MemberRef[] \| undefined → MemberRef[])` | 未移除的成员。 | apps/desktop/src/main/services/c… | — |
| `283` | `buildTaskMessage(p:{ owner: string; task: string; note: string; context: string } → string)` | 派给成员的任务消息正文（成员会话里的一条 user 消息）：标题 + 主智能体写的任务说明（+ 首次派发时主对话最近几轮）。 | apps/desktop/src/main/services/c… | 不附用户原话：任务由主智能体理解后派发，说明里写完整。 |
| `337` | `mainMemberTools(→ ToolSpec[])` | 主智能体的成员工具：创建、派任务、中止、查状态。 | apps/desktop/src/main/services/c… | 描述写死（名单随消息下发），工具表稳定，提示缓存不受增减成员影响。 这里是完整定义；进工具表前按 DEFERRED_MEMBER_TOOLS 换成按需加载的版本（见 chat.ts）。 |

#### `apps/desktop/src/main/services/memory.ts`（23 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `169` | `writeMemory(content:string, id?:string, scope:MemoryScope=GLOBAL_SCOPE → MemoryWriteResult)` | 新增（无 id）或覆盖更新（有 id）一条记忆。 | apps/desktop/src/main/services/m… | — |
| `251` | `memoryPromptSection(opts:{ writable: boolean projectWritable?: boolean root?: stri… → string[])` | 系统提示词的记忆段：只有固定的规则说明，**不含条目**——条目随消息下发（见 listing.ts），记忆增删改不动 系统提示词。 | apps/desktop/src/main/services/c… | 全局段恒在（记录指引须常驻，否则首条记忆永远不会被写下）；挂载了工作区（root 非空）时再追加 「项目私有记忆」段，同理常驻。 系统提示词里的记忆规则段。writable = 全局与项目记忆都可写（主对话）；projectWritable = 全局只读、项目私有记忆 可写（项目成员，见 members.ts），仅在有工作区（root）时生效。 |
| `338` | `registerMemoryIpc(→ void)` | 面板用：查看 / 增改删 / 清空。 | apps/desktop/src/main/index.ts:3… | 每次都回带最新快照，渲染层直接替换列表。 末位可选参数 root：省略 = 全局记忆（个人资料面板），给出 = 该工作区的项目私有记忆（工作区菜单）。 |

#### `apps/desktop/src/main/services/model-resolve.ts`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `73` | `resolveModelRef(ref:string \| null \| undefined, fallback:ResolvedModel → ResolvedModel)` | 把模型引用 `"providerId:modelId"` 解析为完整 ChatModelConfig。 | apps/desktop/src/main/services/c… | - ref 为空 / 非法 / 找不到对应服务商或模型 → 返回 fallback（父轮模型，即「跟随主对话」）。 |
| `85` | `resolveModelRefOrNull(ref:string \| null \| undefined → ResolvedModel \| null)` | 严格解析模型引用（无 fallback）：命中返回 ResolvedModel，空/非法/悬空返回 null。 | apps/desktop/src/main/services/c… | 供定时任务密封执行「先试信封模型、失败再回落全局默认」的两段式选择： `resolveModelRefOrNull(auth.modelRef) ?? resolveDefaultModel()`。 |
| `122` | `resolveDefaultModel(→ ResolvedModel \| null)` | 解析全局默认模型（`config.models.activeModelId`，即用户最近一次在对话输入框选定的模型）。 | apps/desktop/src/main/services/c… | 供无父轮可回落的场景使用——典型是定时任务密封执行（task.auth.modelRef 为空时的回落）。 无配置 / 悬空引用 → 返回 null（调度器据此记「未配置默认模型」错误，绝不崩溃）。 |

#### `apps/desktop/src/main/services/model-view.ts`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `19` | `isCompactionSummary(m:Message → boolean)` | 该消息是否为压缩摘要。 | apps/desktop/src/main/services/c… | — |
| `24` | `isAutoNudge(m:Message → boolean)` | 该消息是否为引擎注入的自愈引导（见 AUTO_MARKER）。 | apps/desktop/src/main/services/c… | — |
| `37` | `isGenuineUserTurn(m:Message → boolean)` | 真实用户轮：role=user 且不含 tool_result（工具结果回灌消息不算），也不是压缩摘要—— 轮中压缩会把摘要放在本轮中间，摘要若算作轮起点，下次压缩就会把它当成「本轮请求」保留、 而把真正的请求原文压掉。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/office-text.ts`（11 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `13` | `decodeXml(s:string → string)` | XML 实体解码（文字节点里的 &lt; &amp; &#20013; 等）。 | apps/desktop/src/main/services/o… | — |
| `95` | `runsText(xml:string → string)` | 一段富文本里的全部 <t> 文字（共享字符串、行内字符串）。 | apps/desktop/src/main/services/o… | — |
| `161` | `officeText(buf:Uint8Array, ext:string → string \| null)` | 取 Office 文件的文字；不是这三种格式、不是 zip（旧版二进制 / 加密）或缺少正文部件时返回 null。 | apps/desktop/src/main/services/t… | — |

#### `apps/desktop/src/main/services/personas.ts`（36 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `187` | `listPersonas(withImages=false → PersonaRecord[])` | 列出所有 persona（扫描 personas 目录下每个 `<id>.md`）。 | apps/desktop/src/main/services/c… | 解析失败的文件跳过，绝不抛错。 `withImages` 仅 IPC 出口传 true（见 avatarImage 字段注释）。 |
| `237` | `resolvePersonaId(id:string \| undefined → string)` | 对话归属的角色 id：未绑定、或绑定的角色已不存在（如手动删了角色文件）时回落默认角色。 | apps/desktop/src/main/services/c… | 只在读取时换算，不改写对话里存的 personaId（绑定一次性、绝不覆盖）。渲染层的对话列表按同一规则显示。 |
| `487` | `registerPersonasIpc(→ void)` | Agent 提示词读写 IPC（全局；启用态入 config.json）。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/portable.ts`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `15` | `installedByNsis(→ boolean)` | Windows 便携版（zip 解压后直接运行 Deva.exe，见 electron-builder.yml 的 zip 目标）。 | apps/desktop/src/main/services/p… | 与安装版的区别只在程序目录里有没有 NSIS 卸载程序；开发模式两者都不算。数据目录两者共用（~/.deva）， 这里只处理「没经过安装」带来的差异：检查更新的下载方式（updater.ts）与系统通知的显示名和图标。 程序目录里有 NSIS 卸载程序（electron-builder 固定命名为「Uninstall <productName>.exe」）= 经 exe 安装程序装的。 |
| `20` | `isPortable(→ boolean)` | Windows 便携版：打包产物但不是装出来的。 | apps/desktop/src/main/services/p… | — |
| `32` | `registerToastIdentity(appId:string → void)` | 便携版的系统通知身份。 | apps/desktop/src/main/index.ts:286 | Windows 按 AppUserModelID 找通知的显示名和图标：安装版由开始菜单快捷方式提供， 便携版没有快捷方式，通知标题会显示成原始 ID 且没有图标。这里在当前用户注册表 `HKCU\\Software\\Classes\\AppUserModelId\\<id>` 写上显示名「Deva」和图标（运行期生成，存在 userData 下）。 必须赶在这个 ID 的第一条通知之前写：Windows 会记住首次通知时的显示名，之后再写不生效。 每次启动都覆盖写一遍，程序文件夹挪了图标路径也能跟上；失败静默，通知照常弹，只是显示原始 ID。 |

#### `apps/desktop/src/main/services/profile.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `35` | `getProfile(→ UserProfile)` | 读本机用户资料：头像 spec 为空时回落默认头像，并读出头像图片（data URI）。 | apps/desktop/src/main/services/p… | — |
| `48` | `registerProfileIpc(→ void)` | 注册 profile:get、set-avatar、set-avatar-image 三个 IPC，读回资料或写入 spec 与头像图。 | apps/desktop/src/main/index.ts:3… | — |
| `55` | `ipc:profile:set-avatar-image(...)`（IPC） | 空串 = 清除图片；否则返回读回的 data URI（校验 / 写入失败为空串）。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/main/services/project-doc.ts`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `32` | `loadProjectDoc(root:string \| null → ProjectDoc \| null)` | 读取工作区根目录下的 AGENTS.md；无工作区 / 不存在 / 空文件 / 不可读 → null。 | apps/desktop/src/main/services/c… | — |
| `66` | `projectDocPromptSection(doc:ProjectDoc \| null → string[])` | 系统提示词的「项目说明」段（主对话与子智能体共用）。 | apps/desktop/src/main/services/c… | 无 AGENTS.md 返回空数组—— 「用户要求记到项目里时写进 AGENTS.md」的指引不在这里，而在常驻的记忆段（memory.ts）， 否则没有这份文件的项目永远建不出第一份。 |

#### `apps/desktop/src/main/services/provider.ts`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `35` | `fetchWithTimeout(url:string, init:RequestInit → Promise<Response>)` | 带超时的 fetch；超时按 AbortError 抛出，交由 networkError 归一。 | apps/desktop/src/main/services/d… | — |
| `45` | `networkError(e:unknown → NormalizedError)` | 把异常归一为网络错误：AbortError 给超时提示，其余交给 describeNetError，kind 为 network 且可重试。 | apps/desktop/src/main/services/d… | — |
| `72` | `registerProviderIpc(→ void)` | 注册 provider:list-models：按适配器拼清单地址、注入解密密钥与网关头，取回模型 id 去重排序。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/remote/feishu-onboard.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `43` | `startFeishuScan(→ Promise<FeishuScan>)` | 开始一次扫码：二维码就绪即返回；拿不到二维码则抛错。 | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/remote/feishu.ts`（30 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `66` | `FeishuAdapter.start(host:AdapterHost → Promise<void>)` | 先以凭据换取 tenantAccessToken 校验，再注册消息与卡片事件分发器，启动飞书 WebSocket 长连接并向 host 上报连接状态。 | apps/desktop/src/main/services/r… | — |
| `110` | `FeishuAdapter.onMessage(host:AdapterHost, data:{ sender: { sender_id?: { open_id?: str… → void)` | 按 message_id 去重，只接受私聊真人 5 分钟内的消息，解析文本后交给 host.onMessage，非文字内容标为 unsupported。 | apps/desktop/src/main/services/r… | — |
| `155` | `FeishuAdapter.upsert(chat:ChatAddress, card:Card, handle?:MessageHandle → Promise<MessageHandle \| unde…)` | 把卡片序列化为 JSON，已有消息句柄时用 patch 原地更新，否则按 chat_id 新建交互消息，返回消息句柄，失败抛出中文错误。 | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/remote/hub.ts`（66 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `81` | `startChannel(adapter:RemoteAdapter → Promise<void>)` | 先停止同 id 旧通道，构造 host 回调（消息异步处理、动作、状态变化并触发问候），再启动适配器，失败记为 error 状态。 | apps/desktop/src/main/services/r… | — |
| `138` | `stopChannel(id:ChannelId → Promise<void>)` | 从通道表移除该 id、作废配对码并通知状态监听者，随后调用适配器 stop，异常只打印警告。 | apps/desktop/src/main/services/r… | — |
| `401` | `reduce(t:TurnTrack, ev:ChatStreamEvent → boolean)` | 把一个流事件并入回合视图。 | apps/desktop/src/main/services/r… | 返回是否有可见变化。 |

#### `apps/desktop/src/main/services/remote/index.ts`（21 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `44` | `SECRET_KEY(id:ChannelId, field:string → string)` | 机器人面板的 IPC 与生命周期。 | apps/desktop/src/main/services/r… | 机器人都经扫码创建，扫码人自动成为已配对用户（白名单）： · 飞书：扫码即在平台上创建应用、拿到凭据； · Telegram：先粘贴 |
| `199` | `registerRemoteIpc(getWindow:() => BrowserWindow \| null → void)` | 初始化 hub，注册状态推送与各 remote 前缀的 IPC 处理，并在启动时自动连接所有已启用的机器人。 | apps/desktop/src/main/index.ts:3… | — |
| `215` | `ipc:remote:scan-start(...)`（IPC） | 按平台启动飞书或 Telegram 扫码流程，返回二维码 data URL 与 scanId；后台等待结果后保存密钥、创建机器人、推送并启动连接。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/main/services/remote/paginate.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `7` | `paginate(blocks:TurnBlock[], budget:number → TurnBlock[][])` | 按字符预算把块序列切成多页。 | apps/desktop/src/main/services/r… | 长正文在预算处切开（优先在换行处），切口落在代码块里时 本页补上收尾 ```、下一页重开同语言的 ```，保证每页单独渲染都正确。 |
| `10` | `newPage(→ void)` | `{ pages.push([]) used = 0 }` | apps/desktop/src/main/services/r… | — |
| `14` | `cur(→ TurnBlock[])` | `pages[pages.length - 1]` | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/remote/store.ts`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `47` | `normalizeScope(raw:unknown → ReplyScope)` | 外部输入（config.json / IPC）→ 合法的回复范围。 | apps/desktop/src/main/services/r… | — |
| `125` | `updateBot(id:ChannelId, fn:(b: BotConfig) => BotConfig → BotConfig \| null)` | 读-改-写某机器人配置；机器人已被删除则什么也不做。 | apps/desktop/src/main/services/r… | — |
| `135` | `getChannelConfig(id:ChannelId → BotConfig)` | 机器人配置（已删除时回落空配置：无用户、无绑定 → 一切鉴权与投递自然失效）。 | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/remote/telegram-onboard.ts`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `30` | `startTelegramLink(token:string, me:TelegramMe → Promise<TelegramLink>)` | 开始等待主人点 Start（调用前先用 fetchTelegramMe 校验过 Token）。 | apps/desktop/src/main/services/r… | — |
| `38` | `wait(→ Promise<LinkOutcome>)` | 在 10 分钟有效期内长轮询 getUpdates，匹配含 /start 一次性码的私聊消息，返回认领用户或过期、取消、错误结果。 | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/remote/telegram.ts`（41 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `56` | `tgCall(token:string, method:string, params:Record<string, unknown>={}, opts… → Promise<T>)` | 调一个 Bot API 方法。 | apps/desktop/src/main/services/r… | 报错信息里绝不带 URL（里面有 Token）。 |
| `192` | `TelegramAdapter.start(host:AdapterHost → Promise<void>)` | 创建取消控制器，校验 Token、删除 Webhook、设置指令菜单，上报已连接后在后台启动长轮询。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `210` | `TelegramAdapter.poll(host:AdapterHost, signal:AbortSignal → Promise<void>)` | 循环调用 getUpdates 长轮询并分发消息与回调；遇 401/404 报 Token 失效，409 报被占用，其余按退避重试。 | apps/desktop/src/main/services/r… | — |

#### `apps/desktop/src/main/services/repetition.ts`（5 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `45` | `findRepetition(text:string → RepetitionHit \| null)` | 找出文本里最长的一段复读区域；没有则 null。 | apps/desktop/src/main/services/c… | — |
| `73` | `trailingRepetition(text:string → RepetitionHit \| null)` | 文本**结尾**是否正在复读：只看收尾于结尾的那段重复区域，周期从小到大试，第一个够格的即返回（区域取满， 供调用方截掉）。 | apps/desktop/src/main/services/c… | 逐周期从结尾往回比，对不上立刻换下一个周期，正常文本每次只做约 MAX_PERIOD 次比较； 够格即停，复读中的文本也只比到门槛长度。命中条件同 findRepetition：结尾命中的区域在完整文本里必然也命中， 故误报不会多于它（校准见 RULES）。 |
| `100` | `watchRepetition(→ (delta: string) => Repetitio…)` | 流式输出的复读看守：逐段传入增量，结尾正在复读时返回命中（period 可用；start / span 相对看守自留的结尾， 要截断全文请对全文另调 trailingRepetition），否则 null。 | apps/desktop/src/main/services/c… | 一个看守只看一路文本（正文与思考各建一个），每步重建。 |

#### `apps/desktop/src/main/services/reply-notify.ts`（5 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `32` | `show(getWindow:() => BrowserWindow \| null, sessionId:string, title:string… → void)` | 窗口失焦时弹通知（不可用则静默降级）。 | apps/desktop/src/main/services/r… | — |
| `65` | `notifyReplyDone(getWindow:() => BrowserWindow \| null, opts:{ sessionId: string; titl… → void)` | 一轮结束。 | apps/desktop/src/main/services/c… | — |
| `98` | `notifyNeedsInput(getWindow:() => BrowserWindow \| null, opts:{ sessionId: string; titl… → void)` | 按待输入类型（提问/计划/浏览器操作/挂载）生成中英文通知正文，连同会话与标题交给 show。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/schedule.ts`（14 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `88` | `parseCron(expr:string → ParsedCron \| null)` | 解析 5 段 cron（`min hour dom mon dow`）；非法返回 null。 | apps/desktop/src/main/services/s… | 校验前置于**创建时**暴露（拒非法 cron），绝不留到触发时才失败。 dow 的 7 归一为 0（周日）。 |
| `239` | `nextRun(schedule:TaskSchedule, after:number → number \| null)` | 求「> after」的下一次触发（UTC epoch ms）；无更多触发返回 null。 | apps/desktop/src/main/services/s… | - `once`：把墙钟 `at` 按 `tz` 转 UTC，> after 返回，否则 null（已过期）。 - `recurring`：从 after 的下一分钟起按 UTC 分钟前扫，反推 tz 墙钟比对 cron；命中即返回。 非匹配日整日跳过（跳到下一本地午夜），把病态 cron 的扫描收敛到 ~370 次日检 + 命中日的分钟扫描。 |
| `325` | `describeSchedule(schedule:TaskSchedule, locale:'zh-CN' \| 'en' → string)` | 名片/列表用的人读摘要。 | apps/desktop/src/main/services/c… | 尽量把常见 cron 说人话（每天 / 每周 X / 每小时 / 每 N 分钟）， 兜不住的复杂表达式回落原始 cron 串。once 显示墙钟日期时间。 |

#### `apps/desktop/src/main/services/scheduler.ts`（11 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `37` | `countMissed(schedule:TaskSchedule, firstFire:number, now:number → number)` | 定时任务调度器（主进程）· 唯一的「触发」发起方。 | apps/desktop/src/main/services/s… | 设计要点： · **幂等启动**：startScheduler 可重复调用（macOS reactivate 会重建窗口）——仅首次装 timer， 每次都刷新窗口取用器 getWin。 · **30s tick**：cron 粒度为 1 分钟，30s 轮询保证不漏分（宁可同分钟内多看一次也不错过）。 · **串行队列**：一次只跑一个任务；同 id 已在队列 / 正在跑则去重跳过——杜绝重入与并发烧 token。 · **追赶策略**：未运行时段错过多次触发，只补跑**最近一次**，跳过数记入单条 skipped 摘要 （启动不雪崩回填）。 · **退避 / 自动暂停**：由 tasks.applyRunResult 统一善后（连续错误累加、达阈值转 error 弹一次通知）。 · **窗口无关**：runScheduledTask 全程在主进程内取密钥、执行、落盘；窗口关闭 / 隐藏照常触发， emit() 对 null 窗口 no-op，渲染层下次打开经 chat-store / tasks:list 追平。 纯函数 planFires / countMissed 抽出供单测（不碰 IPC / Notification / 时钟）。 循环依赖规避：tasks.ts 经 setTaskRunner 注入运行器（本文件提供），本文件再直调 chat.runScheduledTask； chat.ts 只 import tasks-types 的类型，绝不 import 本文件。 从 firstFire（含）之后到 now（含）之间，除 firstFire 外还错过多少次触发（有界 ≤ 1000，防病态 cron 卡死）。 |
| `53` | `planFires(tasks:TaskRecord[], now:number → Array<{ id: string; missed: …)` | 给定任务快照与当前时刻，返回本 tick 应触发的任务及其错过次数。 | apps/desktop/src/main/services/s… | 仅取 `active` 且 `nextRunAt<=now` 的任务；missed = 除本次外错过的触发数（记入 skipped 摘要）。 |
| `249` | `startScheduler(getWindow:() => BrowserWindow \| null → void)` | 幂等启动调度器：装 30s 定时 tick + 注入「立即运行」运行器。 | apps/desktop/src/main/index.ts:4… | 首 tick 延后 ~3s（等主进程 / chat runtime 就绪，并补跑启动时已错过的任务）。 |

#### `apps/desktop/src/main/services/sealed.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `45` | `sealedDecision(toolName:string → SealedVerdict)` | 判定密封模式下一次工具调用是否放行：除交互/创建类与未知工具外，一律放行。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/secrets.ts`（14 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `59` | `getSecret(key:string → Promise<string \| null>)` | 主进程内部使用：取解密后的密钥。 | apps/desktop/src/main/providers/… | 返回 null 表示未配置或无法解密。 仅供 provider 适配层 / MCP 连接层在发起请求时调用，绝不经 IPC 返回渲染层。 键约定：provider 用 providerId；MCP 用 `mcp:<serverId>:<field>`。 |
| `75` | `setSecret(key:string, value:string → Promise<{ ok: boolean; avail…)` | 主进程内部使用：写入 / 更新密钥（空串视为删除）。 | apps/desktop/src/main/services/m… | 加密不可用时拒绝写入（绝不静默存明文）。 供 secrets:set IPC 与 MCP 连接层（mcp:<id>:<field>）共用。 |
| `120` | `registerSecretsIpc(→ void)` | 注册 secrets:set/has/delete/list/available 五个 IPC，写入前用 safeStorage 加密，不回传明文。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/shells.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `26` | `firstExisting(candidates:(string \| undefined)[] → string \| null)` | 收集首个存在的候选路径。 | apps/desktop/src/main/services/s… | — |
| `103` | `detectShells(→ ShellProfile[])` | 探测本机可用 shell（缓存）。 | apps/desktop/src/main/services/e… | — |
| `116` | `resolveShell(id:string \| null → { path: string; args: string…)` | 把渲染层传来的 shellId 解析为 {path,args}；命不中取默认 profile，再兜底。 | apps/desktop/src/main/services/t… | — |

#### `apps/desktop/src/main/services/skills.ts`（33 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `329` | `listSkills(→ SkillRecord[])` | 列出所有技能（扫描 skills 目录下每个含 SKILL.md 的子目录）。 | apps/desktop/src/main/services/s… | 解析失败的目录跳过，绝不抛错。 |
| `668` | `startSkillsWatcher(getWindow:() => BrowserWindow \| null → void)` | 监听技能目录，技能经任何途径变化（对话 create_skill、模型下载解压、手动拷入、外部删除…）后 防抖重读，向渲染层推送 `skills:changed`（全表），输入框的 / 联想与扩展页随之更新。 | apps/desktop/src/main/index.ts:3… | 主进程运行期（chat.ts）本来就每次现读磁盘，不依赖这里。 - 先建好技能目录再监听，绝不退而监听上级目录（否则无关文件事件会频繁唤醒进程）。 - Windows / macOS：系统原生递归监听，只持有技能目录一个句柄（不妨碍把技能子文件夹移进回收站）。 - 其余平台（Linux）：Node 的递归监听会给每个文件各挂一个 inotify 监听，技能里带大目录时代价大； 改为监听技能目录 + 各技能第一层文件夹（SKILL.md 所在层），数量 = 技能数 + 1。 - 监听出错即整体关闭，退回扩展页进入时重拉的兜底。 |
| `752` | `registerSkillsIpc(getWindow:() => BrowserWindow \| null → void)` | 技能读写 IPC（全局；启用态入 config.json）。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/subagent-store.ts`（19 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `75` | `subagentIdFor(toolUseId:string → string)` | 由创建它的 run_subagent 调用 id 确定性地派生子智能体 id（重开对话时可据此反查卡片标题）。 | apps/desktop/src/main/services/c… | — |
| `121` | `loadSubagent(sessionId:string, id:string → SubagentRecord \| undefined)` | 读取完整记录（内存缓存优先，按需读盘）；不存在 / 已被清理 → undefined。 | apps/desktop/src/main/services/c… | — |
| `139` | `saveSubagent(rec:SubagentRecord → void)` | 落盘一条记录并更新索引；写盘失败只告警，绝不影响本轮。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/subagents.ts`（3 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `114` | `isForkAgent(name:string → boolean)` | `{ return name.trim().toLowerCase() === FORK_AGENT.name }` | apps/desktop/src/main/services/c… | — |
| `119` | `subagentSummaries(→ { name: string; description:…)` | 可派发子智能体的 name+description 摘要（含 fork），用于 `run_subagent` 的 agent 枚举与工具描述。 | apps/desktop/src/main/services/c… | — |
| `130` | `getSubagentByName(name:string → SubagentDef \| null)` | 按名（大小写不敏感）取内置子智能体定义；未命中返回 null（调用方回落 GENERAL_SUBAGENT）。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/tasks.ts`（32 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `178` | `createTask(input:TaskCreateInput → CreateTaskResult)` | 新建任务：schedule.ts 校验（拒非法 cron / 无效时区 / 已过期的 once）、算初始 nextRunAt、铸独占 sessionId。 | apps/desktop/src/main/services/c… | **不落项目**：sessionId 恒 `task-<id>`（chat-store safeId 白名单安全）。 |
| `231` | `updateTask(input:TaskUpdateInput → TaskRecord \| null)` | 更新任务（部分字段）；日程/时区变更则重算 nextRunAt。 | apps/desktop/src/main/services/t… | 找不到返回 null。 |
| `477` | `registerTasksIpc(getWindow:() => BrowserWindow \| null → void)` | 任务读写 IPC（全局；持久化于 ~/.deva/tasks.json）。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/terminal.ts`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `31` | `registerTerminalIpc(getWindow:() => BrowserWindow \| null → void)` | 注册终端 IPC：惰性 fork pty-host 工具进程，在渲染层与宿主间中继 create/input/resize/dispose 与 data/exit。 | apps/desktop/src/main/index.ts:3… | — |
| `39` | `flush(→ void)` | 把待发消息冲刷给 Utility Process；未就绪时留在 pending，spawn 后再发。 | apps/desktop/src/main/services/t… | — |
| `50` | `ensureChild(→ void)` | 首次调用时 fork pty-host.js，就绪后冲刷排队消息、转发数据与退出事件；宿主退出时补发 exit 并复位。 | apps/desktop/src/main/services/t… | — |

#### `apps/desktop/src/main/services/todos.ts`（14 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `71` | `foldTodos(entries:TodoEntry[]=[] → TodoList[])` | 日志 → 清单（按首次出现的先后排列；每个清单取其最后一条快照）。 | apps/desktop/src/main/services/t… | — |
| `90` | `activeTodoList(entries:TodoEntry[]=[], cancelled:string[]=[] → TodoList \| null)` | 当前清单：最近一个清单，且尚未全部完成、也没被取消。 | apps/desktop/src/main/services/c… | 全部完成的清单已在对话流里落成卡片， 取消的清单不再进行，胶囊都随之收起。 |
| `131` | `applyTodoWrite(entries:TodoEntry[]=[], cancelled:string[]=[], id:string, input:unkn… → TodoEntry \| { cancel: string…)` | 应用一次 todo_write： · cancel → 返回要取消的当前清单 id（没有进行中的清单时为 null）； · 否则判定新开还是更新当前清单，产出要追加进日志的快照。 | apps/desktop/src/main/services/c… | 新开清单：显式 new_list / 还没有清单 / 当前清单 已全部完成或已取消，且新条目与它毫无重合（一项内容都对不上，说明是另一件事；有重合则是模型在原清单上 继续——追加后续步骤或恢复已取消的清单，仍算同一个清单）。其余一律更新当前清单。 |

#### `apps/desktop/src/main/services/tool-results.ts`（13 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `29` | `toolResultsDir(sessionId?:string → string)` | 某对话的工具结果文件夹（不创建）。 | apps/desktop/src/main/services/t… | 没有对话 id（极少）时归到 `_misc`。 |
| `85` | `spillLongOutput(text:string, limit:number, sessionId:string \| undefined, label:string → string)` | 结果超过 limit 字符时：全文存文件，返回「说明 + 路径 + 开头和结尾预览」；没超过原样返回。 | apps/desktop/src/main/services/m… | 文件写不进时退回只给预览（开头、结尾各半个 limit），并写明其余内容已丢弃。 label 用作文件名前缀（如 command），便于用户在文件夹里分辨。 |
| `184` | `clearStaleToolResults(session:StoredSession, model:{ adapter: string; model: string }, fro… → ClearOutcome \| null)` | 缓存已过期时清理较早的工具结果（就地改写 session.messages，不落盘——调用方随本轮一起保存）。 | apps/desktop/src/main/services/c… | 只看模型仍看得到的部分：from = 对话记录里仍发给模型的起点（compaction.ts 的 modelStart）， 更早的已不发给模型，清了也省不下什么。 返回 null = 没动（缓存可能还热、没有足够可清的内容）。 只换 tool_result 的内容，不增删消息、不动成败标记：轮下标、工具卡状态、检查点（按 toolUseId）都不受影响。 |

#### `apps/desktop/src/main/services/tool-search.ts`（13 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `49` | `deferTool(spec:ToolSpec, brief:string, guide?:string → ToolSpec)` | 登记一个按需加载的工具，返回工具表里用的版本：一句话描述（写清做什么、什么时候用）+ 参数骨架。 | apps/desktop/src/main/services/c… | guide：参数之外的补充说明，随用法一并给出。 |
| `97` | `buildToolSearchTool(names:string[]=[...deferred.keys()] → ToolSpec)` | names：可查看用法的工具名，缺省为全部按需加载的工具（工具表定稿后由 fitToolSearch 收窄成本表实际有的）。 | apps/desktop/src/main/services/c… | — |
| `143` | `runToolSearch(args:unknown, offered:Set<string> → UsageResult)` | 执行 tool_search：只给本次工具表里有的按需加载工具。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/tools.ts`（51 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `495` | `buildPlanTool(→ ToolSpec)` | exit_plan 工具规格。 | apps/desktop/src/main/services/c… | 常驻主轮工具集：模型对非平凡任务先只读调研，再调用它提交计划待用户批准。 该工具在 runAgentLoop 内「闸门前特判」，不走 executeTool、不授予任何能力——批准仅让循环继续执行。 |
| `515` | `buildTodoTool(→ ToolSpec)` | todo_write 工具规格。 | apps/desktop/src/main/services/c… | 常驻主轮工具集：模型在多步任务里列出并逐项勾选待办清单（或取消不再进行的清单）， 界面以进度胶囊显示。 在 runAgentLoop 内「闸门前特判」，只写会话边车（StoredSession.todos），不走 executeTool、无任何副作用。 |
| `1436` | `executeTool(name:string, args:unknown, ctx:ToolContext → Promise<ToolResult>)` | 工具执行总入口：按工具名分派浏览器、读写文件、列目录、glob/grep、web_fetch、命令执行等并统一包错。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/main/services/tray-icon.ts`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `104` | `drawLogo(size:number, ss=8 → Uint8Array)` | 生成标志 RGBA 像素：渐变圆角底板 + 白色「!」+ 半圆（D）。 | apps/desktop/src/main/services/t… | 按解析几何做 ss×ss 超采样抗锯齿，小尺寸（托盘 16/32px）边缘也不发毛。 |
| `143` | `getAppIcon(→ NativeImage)` | 取应用 / 托盘图标（首次生成后缓存）。 | apps/desktop/src/main/index.ts:1… | 基准 32px，另附 2x（64px）表示供高分屏使用。 生成失败（极端环境）返回空 `NativeImage`——Tray 仍可创建，仅无图标，不崩。 |
| `200` | `getTrayIcon(→ NativeImage)` | 取托盘图标（首次生成后缓存）。 | apps/desktop/src/main/index.ts:235 | - macOS：18pt 画布、字形高 16pt 的单色模板图（附 2x），与系统及其他应用的菜单栏图标同尺寸； `setTemplateImage(true)` 后由系统按浅色 / 深色 / 壁纸染色菜单栏及点开高亮自动着色。 不能用彩色应用图标：32px 会按 32pt 显示，几乎撑满菜单栏，且颜色不随菜单栏变化。 - 其它平台：沿用彩色应用图标。 |

#### `apps/desktop/src/main/services/updater.ts`（21 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `186` | `check(→ Promise<void>)` | 检查更新：查最新版本并与当前版本比较，判定 auto/portable/manual 模式，确认安装包已上传后置为可用。 | apps/desktop/src/main/services/u… | — |
| `259` | `install(→ Promise<void>)` | 仅在已下载时执行：先把进行中的回合收尾落盘，再调用 quitAndInstall 静默安装并自动重启。 | apps/desktop/src/main/services/u… | — |
| `268` | `registerUpdaterIpc(getWin:() => BrowserWindow \| null → void)` | 注册更新相关 IPC：取状态、检查、下载、安装四个通道，并记下窗口取用器用于推送。 | apps/desktop/src/main/index.ts:3… | — |

#### `apps/desktop/src/main/services/workspace.ts`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `41` | `registerWorkspaceIpc(getWindow:() => BrowserWindow \| null → void)` | 注册 fs:open-folder/reveal-folder/read-dir/read-file/write-file，所有路径先经受信根校验再读写。 | apps/desktop/src/main/index.ts:3… | — |
| `43` | `ipc:fs:open-folder(...)`（IPC） | 打开文件夹对话框 → 选中目录登记为受信根 | 静态扫描未检出（未导出且无同名调用） | — |
| `55` | `ipc:fs:reveal-folder(...)`（IPC） | 在系统文件管理器（资源管理器 / 访达）中打开目录。 | 静态扫描未检出（未导出且无同名调用） | 只收受信根内的「目录」：shell.openPath 对文件等于双击运行，绝不能让渲染层借此执行任意文件。 |

### B · 预加载桥


#### `apps/desktop/src/preload/index.ts`（15 条，下列 15 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `929` | `listener(_e:unknown, on:boolean → void)` | `cb(on)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `998` | `listener(_e:unknown, skills:SkillRecord[] → void)` | `cb(skills)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1075` | `listener(_e:unknown, view:McpServerView → void)` | `cb(view)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1209` | `listener(_e:unknown, payload:ChatEventPayload → void)` | `cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1215` | `listener(→ void)` | `cb()` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1232` | `listener(_e:unknown, payload:TerminalDataPayload → void)` | `cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1238` | `listener(_e:unknown, payload:TerminalExitPayload → void)` | `cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1314` | `listener(_e:unknown, reqId:string, text:string → void)` | `cb(reqId, text)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1355` | `listener(_e:unknown, tasks:TaskRecord[] → void)` | `cb(tasks)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1364` | `listener(_e:unknown, payload:{ sessionId?: string; pane?: 'tasks' } → void)` | `cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1409` | `listener(_e:unknown, state:BrowserUiState → void)` | `cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1428` | `listener(_e:unknown, frame:BrowserLiveFrame → void)` | `cb(frame)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1457` | `listener(_e:unknown, state:UpdateState → void)` | `cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1487` | `listener(_e:unknown, state:RemoteState → void)` | `cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `1492` | `listener(_e:unknown, ev:BotScanEvent → void)` | `cb(ev)` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

### C · 桌面渲染层


#### `apps/desktop/src/renderer/src/App.tsx`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `9` | `App(→ React.JSX.Element)` | 应用根组件：渲染「对话优先」外壳。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 旧的 IDE 式外壳（AppShell + 活动栏/侧边面板/底部终端/状态栏等）已整体下线删除， 只保留对话优先形态；相关 store（ui/git）与演示数据一并移除。 |

#### `apps/desktop/src/renderer/src/components/DialogProvider.tsx`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `54` | `DialogProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 全局对话框服务：以命令式 API 取代原生 window.confirm / 各处自绘输入框， 统一走居中模态、复用现有 .btn/.input 与设计 token，保证明暗主题一致。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 同一时刻仅一个对话框（用户驱动、不会叠加）。 |
| `101` | `ConfirmView({ req, onDone }:{ req: Extract<Request, { kind: 'confirm' }> … → React.JSX.Element)` | 渲染确认对话框弹窗，展示标题与说明，用户点确认或取消后把布尔结果经 onDone 回传。 | 静态扫描未检出（未导出且无同名调用） | — |
| `134` | `PromptView({ req, onDone }:{ req: Extract<Request, { kind: 'prompt' }> … → React.JSX.Element)` | 渲染文本输入对话框，打开时预填并全选默认值，非输入法组字时回车或点确认提交去空格文本。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/renderer/src/components/Modal.tsx`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `20` | `Modal({ open, onClose, width = 420, labelledBy, children }:Modal… → React.JSX.Element \| null)` | 居中模态基座：Portal 挂到 body、半透明遮罩、圆角卡片、入场动画。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 仅负责「容器 + 关闭交互」，内容（标题/正文/按钮）由上层组合。 主题通过 :root 上的 CSS 变量级联，Portal 到 body 同样生效，无需额外处理。 |
| `30` | `onKey(e:KeyboardEvent → void)` | `{ if (e.key === 'Escape') { e.stopPropagation() onClose() } }` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

#### `apps/desktop/src/renderer/src/components/Select.tsx`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `91` | `Select(props:SingleProps<V> \| MultiProps<V> → React.JSX.Element)` | 统一下拉框组件，支持单选与多选、浮层定位、键盘导航与首字母跳转，并向调用方回调选中变更。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `109` | `place(→ void)` | 按触发框位置与窗口尺寸计算浮层坐标、宽度和最大高度，下方空间不足时改为向上展开。 | apps/desktop/src/renderer/src/co… | — |
| `137` | `pick(i:number → void)` | 选中第 i 个选项：多选时回调 onToggle，标了 closeOnPick 的随即收起；单选时先收起再回调 onChange。 | apps/desktop/src/renderer/src/co… | — |

#### `apps/desktop/src/renderer/src/components/ToastProvider.tsx`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `53` | `ToastProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 全局轻量 toast 服务：非阻断的右上角浮层提示（让开窗口控件；右下角会压住对话输入框），取代成功场景下的确认框（用户无需点「关闭」）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 命令式 API（useToast().show），可堆叠、到时自动消失，亦可手动关闭；与 DialogProvider 同挂根部。 破坏性 / 需用户抉择的仍走 useDialog；toast 仅用于「已完成 / 已开始」这类知会性反馈。 |
| `58` | `dismiss(id:number → void)` | 按 id 从 toast 列表移除该条提示，并清理它对应的自动消失定时器，避免残留计时。 | apps/desktop/src/renderer/src/co… | — |
| `67` | `arm(id:number, ms:number → void)` | 为指定 toast 启动自动消失计时器，并记录开始时间与剩余毫秒数，供鼠标悬停暂停后续用。 | apps/desktop/src/renderer/src/co… | — |

#### `apps/desktop/src/renderer/src/components/humation.tsx`（52 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `308` | `resolveShape(seed:string, spec?:AvatarSpec \| null → AvatarShape)` | 头像的形状：spec 里存了就用它；没存的一律圆形。 | apps/desktop/src/renderer/src/co… | 用户定（2026-11-09 / 11-11）：已有角色与「我」保持圆形，新加的角色才随机，且创建时就存成具体形状、此后固定—— 手动新建走 randomizeSpec，名片走 seededShape（见 shared/avatar-shape.ts）。 'auto' 只剩旧数据（老成员显示时按它现算），取法冻结在当时的 12 个形状上（legacyAutoShape），形状库改了也不换。 |
| `403` | `parseAvatarSpec(raw:string \| null \| undefined → AvatarSpec \| null)` | 解析存储字符串 → AvatarSpec；空 / 非 JSON / 解析失败一律返回 null（回落 seed 生成）。 | apps/desktop/src/renderer/src/fe… | — |
| `437` | `resolveSpec(seed:string, spec?:AvatarSpec \| null → Required<AvatarSpec>)` | 把「seed + 部分 spec」解析为完整、具体的 spec（编辑器初始化：从此只处理显式值，杜绝漂移）。 | apps/desktop/src/renderer/src/re… | — |

#### `apps/desktop/src/renderer/src/features/browser/BrowserCapsule.tsx`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `50` | `BrowserCapsule({ sessionId }:{ sessionId: string \| null } → React.JSX.Element \| null)` | 内置浏览器胶囊（输入框正上方，与待办清单 / 后台任务胶囊同一排）：本对话在浏览器里打开过网页才出现。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 显示 Deva 此刻在网页上做什么（停止用输入框的停止键，这里不重复放）、等你操作时的提示（「去处理」打开窗口）。 悬停或点胶囊浮出预览卡：网页的实时画面（主进程按 CDP 推送，只在卡显示时推；点画面在「Deva 浏览器」窗口中打开）、 标题（不显示网址，悬停标题看站点）、固定、关闭（关掉这个网页）。有两个以上网页时右侧出箭头，列出本对话打开的全部网页： 点一行预览它，✕ 关掉它，标题右侧「全部关闭」；只有一个网页时没有箭头，关网页用卡上的「关闭」。 |
| `140` | `place(→ void)` | 把预览浮层横向对齐到输入框胶囊：夹在胶囊左右边界之间，再换算成相对根节点的偏移。 | apps/desktop/src/renderer/src/fe… | — |
| `178` | `showPreview(tab:string \| null, mode:Preview['mode'] → void)` | 打开预览卡；tab 为 null 时跟着 Deva。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/browser/BrowserChrome.tsx`（5 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `43` | `BrowserChrome(→ React.JSX.Element)` | 「Deva 浏览器」窗口的外框：一行标签条（占标题栏，带角色头像；左侧后退，右侧「⋯」/ 置顶；收起用窗口的 ✕）与状态条 （Deva 正在操作 / 等你操作）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 浏览器只给 Deva 用，不显示网址、不能输入网址；等用户登录等操作时在状态条里显示站点， 输入密码前能确认是哪个网站。 网页本身是主进程叠放在外框下方的原生视图（见 main/services/browser/host.ts），这里只画外框与网页四周的边框； 各部分高度须与 BROWSER_CHROME 一致，主进程按同一套数字摆放网页。 |
| `72` | `face(id?:string → React.JSX.Element)` | 按人格 id 取其记录并渲染小人脸头像，取不到人格时回退为地球图标。 | apps/desktop/src/renderer/src/fe… | — |
| `86` | `openMenu(btn:HTMLElement → void)` | 以按钮位置为锚点调主进程弹浏览器标签页菜单并传入各项本地化文案，结束后复位打开状态。 | apps/desktop/src/renderer/src/co… | — |

#### `apps/desktop/src/renderer/src/features/browser/shared.tsx`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `9` | `useBrowserState(→ BrowserUiState \| null)` | 订阅内置浏览器的界面状态。 | apps/desktop/src/renderer/src/fe… | — |
| `23` | `PagesPanel({ sessionId, tabs, current, locked, onPick }:{ sessionId… → React.JSX.Element)` | 本对话打开的网页列表（胶囊右侧箭头）：点一行切到它；每行 ✕ 关掉它，标题右侧「全部关闭」。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | locked（Deva 正在用 / 等你操作）时不给关（✕ 不显示，「全部关闭」置灰并在悬停提示里说明）。 定位由外层（.cf-todo__panel 的 bottom:100%）决定。 |

#### `apps/desktop/src/renderer/src/features/browser/text.ts`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `27` | `doingText(t:(key: string) => string, action:string, label?:string → string)` | 「正在点击「退款」」「正在打开网页 works.inca.co.kr」。 | apps/desktop/src/renderer/src/fe… | — |
| `35` | `tabTitle(t:(key: string) => string, tab:{ title: string; url: string } → string)` | 标签显示的标题：网页标题 → 网址里的站点 → 「加载中…」。 | apps/desktop/src/renderer/src/fe… | — |
| `49` | `siteOf(url:string → { host: string; secure: bool…)` | 网页所在的站点（主机名，国际化域名保持 xn-- 编码，仿冒域名更容易看出来）与是否加密；非 http(s) 网页返回 null。 | apps/desktop/src/renderer/src/fe… | 等用户登录时的提示条、标签悬停提示用。 |

#### `apps/desktop/src/renderer/src/features/chat/BackgroundTasks.tsx`（9 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `26` | `SubagentProgressNotice({ ownerName }:{ ownerName: string } → React.JSX.Element \| null)` | 等主智能体汇总的后台子智能体进度（同成员的 MemberProgressNotice，外观同 .cf-mprogress）：同一轮派出的后台子智能体 是一组，主进程等最后一个结束才唤醒主智能体一次、一并汇总。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 组里已有完成、还有在跑的时，对话末尾居中一行 「「检索鉴权逻辑」已完成」/「2 个子智能体已完成」；全部结束即消失，主智能体随之汇总。悬停看每个的状态。 一轮只有一条助手消息，按消息分组即按派发的那一轮分组。只算顺利完成的：出错 / 被停止的结局写在各自的 Task 卡上。 不进对话记录。 |
| `73` | `BackgroundCapsule(→ React.JSX.Element \| null)` | 后台任务胶囊（输入框正上方，与待办清单胶囊同一排）：本对话里仍在后台运行的子智能体（默认即后台运行）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 它们不是本轮在等的事、常比回合活得长，放在对话流里要么随当前步骤上下移动、要么得翻回原消息才能停止， 故固定在这里：一个时直接显示标题与停止键；多个时显示个数，点开向上展开——每个任务固定两行：标题 + 停止键， 下面一行它当前的步骤（同时执行多个工具时只写一个，后缀「等 N 项」），面板右上角「全部停止」。 全部结束即不渲染——结束通知照常作为一行系统通知进入对话流。 对话流里的子智能体节点不带停止键。 |
| `116` | `stop(ids:string[] → void)` | 批量停止后台子智能体：过滤掉已在停止中的，记入停止集合后逐个发出停止请求。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/chat/DeliverablesCard.tsx`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `30` | `formatSize(n:number → string)` | 字节数转 B / KB / MB / GB 的可读文本（KB 起取整或保留一位小数）。 | apps/desktop/src/renderer/src/fe… | — |
| `51` | `DeliverablesCard({ block }:{ block: Extract<ChatBlock, { kind: 'tool' }> } → React.JSX.Element)` | 交付物卡片：从主进程取文件信息与缩略图，逐行展示文件并提供打开、定位与复制路径操作。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `105` | `open(i:number → void)` | 请求主进程用默认程序打开第 i 个交付文件，返回失败时以错误 toast 提示用户。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/chat/Markdown.tsx`（5 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `29` | `CopyButton({ getText }:{ getText: () => string } → React.JSX.Element)` | 代码块表头的「复制」按钮：复制成功后 1.5 秒内显示「已复制」。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 时间轴上展开的命令框同用。 |
| `33` | `copy(→ void)` | 取出 getText 提供的文本写入剪贴板，成功后 1.5 秒内把按钮显示为「已复制」，失败静默。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `112` | `Markdown({ text, muted }:{ text: string muted?: boolean } → React.JSX.Element)` | 渲染一段 Markdown。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | muted：思考块用弱化配色。 |

#### `apps/desktop/src/renderer/src/features/chat/ModelSetupCard.tsx`（16 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `80` | `ModelSetupCard(→ React.JSX.Element)` | 对话区模型接入引导卡：三步（选服务商 / 填密钥 / 选模型）完成写密钥、拉模型清单、落库并设为当前对话模型。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `202` | `resolveTarget(→ { id: string; adapter: Adapt…)` | 确定写入目标：官方直接用预置（含用户在设置页改过的地址）；自定义按需新建一次，之后重试复用。 | apps/desktop/src/renderer/src/fe… | — |
| `227` | `verify(→ Promise<void>)` | 校验并保存密钥（自定义服务先建或更新服务商），调用 listModels 拉清单，按结果切到选模型、手填模式或提示错误。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/chat/ScheduleEditor.tsx`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `35` | `ScheduleEditor({ initial, tz, onChange }:{ /** 初值（草稿或既有任务的日程）；仅首挂载读取，后续由本组件… → React.JSX.Element)` | 日程编辑器：模式下拉加随模式变化的控件拼出 TaskSchedule，每次变更经 onChange 交回父层。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `50` | `onceInit` | 一次性初值：记录带则用，缺则 now+1h（供从周期切到「不重复」时有合理默认）。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `68` | `schedule` | 按当前模式与各控件值拼出日程对象：不重复给 at，周期类调 buildCron 生成 cron 并附时区。 | apps/desktop/src/main/services/s… | — |

#### `apps/desktop/src/renderer/src/features/chat/TaskConfirmCard.tsx`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `31` | `taskErrorKey(code:string → string)` | 定时任务确认名片（autotaskcard）——**唯一的授权时刻**。 | apps/desktop/src/renderer/src/fe… | 模型调 create_task 只写下建议草稿；此名片是可编辑信封（标题/指令/日程/人格/模型）， 用户核对并点「创建」才真正建任务与独占会话（`resolveAutotask('create', input)`）。 创建后触发零交互，故授权在此一次性议定完毕（对齐「创建时批准、执行时零交互」铁律）； 工具全放行（含 skill/mcp）、读写与命令执行不设限、通知固定开启—— 故名片不再有类型/写入根/工具白名单/通知开关。 版式（对比稿 design/task-card.html 方案 A）：三个状态同一副骨架——表头（闹钟 + 「定时任务 ·」+ 标题，右侧编辑 / 收起 / 已创建）+ 键值行（时间 / 执行 / 指令）+ 底栏按钮。pending 默认**摘要**，点「编辑」原地展开表单， 日程无效 / 指令为空 / 创建失败时自动展开；created 换成灰底终态，dismissed 只剩一行。 日程一栏整块交给 ./ScheduleEditor（与任务编辑弹窗共用同一控件，cron 反解/拼装再下沉 ./schedule 单一真源）。 创建出来的任务独立运行：结果记在任务自己的对话里，完成后系统通知。 创建结果 / 预览错误码 → 本地化 key。 导出供管理页的手动新建表单共用（同一套主进程稳定错误码，文案不两处演化）。 |
| `78` | `TaskConfirmCard({ block, onOpen }:{ block: Extract<ChatBlock, { kind: 'autotas… → React.JSX.Element)` | 定时任务确认名片：待决态渲染可编辑的授权信封表单，已决态渲染已创建或已忽略的终态卡。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `95` | `TaskTerminalCard({ block, onOpen }:{ block: Extract<ChatBlock, { kind: 'autotas… → React.JSX.Element)` | 已决终态：created（表头右上角「查看任务」+ 绿勾，下面时间 / 执行两行）/ dismissed（已忽略一行）。 | 静态扫描未检出（未导出且无同名调用） | 任务从 store 的列表实时取：改日程等即时反映；任务已删则只剩表头。 |

#### `apps/desktop/src/renderer/src/features/chat/TaskPickers.tsx`（12 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `22` | `TaskModelSelect({ value, onChange }:{ value: string \| null onChange: (ref: s… → React.JSX.Element)` | 任务表单内嵌的**受控**模型 / 人格选择器——镜像对话输入框 ModelPicker 的 chip + model-pick 菜单 （复用 app.css 的 model-pick / chip / model-pick__menu 类，零新增 CSS），供创建名片与编辑弹窗共用， 使任务的模型/角色切换与对话内嵌选择器**同款交互**。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 与对话 ModelPicker 的区别：这两个是**受控**的（value/onChange，不写全局 activeModel / 会话覆盖层）。 模型选择器带一枚「全局默认」项（value=null）——未选时由主进程按 tasks.modelDefault 兜底解析。 人格选择器**不设**「跟随默认」：定时任务在后台密封执行、无「当前对话」可跟随，故必须固定一个具体角色， value 为 null（旧任务 / 创建卡默认）时自动落到首个已启用角色。菜单向上弹出（.model-pick__menu bottom:calc(100%+8px)），恰在指令框工具条上方。 受控模型选择器。value 为 `"providerId:modelId"` 或 null（= 跟随默认）。 |
| `161` | `TaskRunModeSelect({ value, taskSessionId, faceOf, onChange }:{ value: string… → React.JSX.Element)` | 受控运行方式选择器（编辑定时任务的弹窗里，排在角色 / 模型前面）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | value 为会话 id（= 在该会话中运行）或 null （= 独立运行，默认）。用统一下拉框（同技能 / MCP 的「可用角色」）：第一项「独立运行」，其下「在会话中运行」一组列出 最近的普通会话（不含成员会话、任务自己的对话、已归档的），每行是会话头像 + 标题 + 第二行（挂了文件夹写文件夹名， 否则写角色名，同左侧对话列表）。收起态做成与角色 / 模型同款的贴片。浮层渲染到 body，不会被弹窗的滚动区裁掉。 会话删除后主进程把任务改回独立运行，这里拿不到该会话时同样按独立运行显示。 |
| `253` | `TaskPersonaSelect({ value, onChange }:{ value: string \| null onChange: (id: st… → React.JSX.Element)` | 受控人格选择器。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | value 为 personaId 或 null（= 跟随默认）。 |

#### `apps/desktop/src/renderer/src/features/chat/Todos.tsx`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `14` | `countDone(items:TodoItem[] → number)` | 待办清单（todo_write）的界面：输入框上方的进度胶囊 + 向上展开的清单面板，以及条目列表（对话流里的 「已完成清单」卡也用它）。 | apps/desktop/src/renderer/src/fe… | 数据全来自主进程 todos 边车（store/chat 的 todos），这里只展示；唯一的写操作是 面板里的「取消清单」——不再进行的清单也可由模型自己取消（todo_write cancel），胶囊随之收起。 |
| `19` | `TodoItemList({ items }:{ items: TodoItem[] } → React.JSX.Element)` | 条目列表：已完成打勾划线、进行中高亮、待办空心圈。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `71` | `TodoCapsule(→ React.JSX.Element \| null)` | 进度胶囊（输入框正上方）：最多一个——正在进行的那个清单。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 显示其进行中一项与完成数，点开向上展开它的 全部条目；较早的清单不展示。没有进行中的清单（从未建、已全部完成、或已取消）时不渲染：全部完成的清单 已在对话流里落成「已完成清单」卡。 |

#### `apps/desktop/src/renderer/src/features/chat/blocks.tsx`（77 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `333` | `StatusIndicator({ activity, status, folded = false, pending = false, onSto… → React.JSX.Element \| null)` | 对话流底部的工作状态指示器：随自动滚动停在最新消息下方，仅流式期间显示。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 三种形态：活跃（脉动点 + 活动文案 + 已用秒数）/ 等待授权 / 自动重连（含[停止]）。 "自动重连"是主进程 reconnecting 事件驱动的真实信号，非渲染层猜测。 folded：本轮已有「工作过程」折叠条——当前步骤露在它下面、计时在它标题末尾，活跃形态不再显示； 等待、重连、压缩这些特殊状态照常显示。 pending：回复还什么都没出（请求刚发出、在等第一个字）——活跃形态换成三个跳动的点。 |
| `566` | `BlockView({ block, thinkingDone, onAsk, onPlan, onMountReq, onOpen… → React.JSX.Element \| null)` | 按 block.kind 分派渲染对话块（Markdown 正文、时间轴、角色与任务名片、问答/计划/挂载卡、压缩提示、提示与错误），空文本返回 null。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `1160` | `renderBody(qi:number → React.JSX.Element)` | 单题作答区（候选项 + 「自己输入」项 / 纯自由题的输入框）：单题模式与向导模式共用。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/chat/dockOrder.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `11` | `useDockOrder(visible:boolean, key:string \| null → number \| undefined)` | 输入框上方胶囊排（.cf-dock）里的先后：胶囊每次出现时领一个递增序号当 CSS order，新出现的排在最右—— 用户的目光先落在一排的末尾。 | apps/desktop/src/renderer/src/fe… | 已在的胶囊不挪位，某枚消失也不影响其余几枚的相对先后。 换了会话（key 变）时整排重新领号，同一次渲染里一起出现的按 .cf-dock 里的书写顺序。 只改 order 不动 DOM：胶囊的面板、焦点不受影响，也不会先按书写顺序画一帧再跳位。 |

#### `apps/desktop/src/renderer/src/features/chat/schedule.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `18` | `normalizeDows(dows:number[] → number[])` | 归一星期集合：7→0（周日）、去重、升序；空集回落周一（编辑器恒保留至少一天）。 | apps/desktop/src/renderer/src/fe… | — |
| `29` | `parseRecur(cron:string → { mode: RecurMode time: …)` | 反解 cron 为周期编辑器的初始预设（匹配不上则落「自定义」，原样承载 cron 文本）。 | apps/desktop/src/renderer/src/fe… | — |
| `81` | `buildCron(mode:RecurMode, time:string, dows:number[], hourlyMin:number, everyN… → string)` | 由周期编辑器状态拼出 5 段 cron。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `31` | `ModelDetail({ provider, model, onBack, onUpdate }:Props → React.JSX.Element)` | 模型详情页：编辑模型显示名、上下文窗口与最大输出上限，留空即采用内置自动值。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `142` | `LimitField({ label, autoText, value, presets, range, note, check,… → React.JSX.Element)` | 一项 token 上限：单个组合输入框。 | 静态扫描未检出（未导出且无同名调用） | 留空即自动（占位文字显示自动值），可直接输入（支持 200K / 1M 写法）， 或从右侧下拉选「自动」/ 常用档位；失焦 / 回车保存。展开与否都只占一行，不撑开页面。 |
| `197` | `commit(raw:string → void)` | 保存上限输入：清空即回到自动，非法或越界或交叉校验失败时显示错误，通过则回调 onChange。 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/settings/ModelSettings.tsx`（22 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `42` | `ModelSettings(→ React.JSX.Element)` | 模型设置页组件：维护钻取视图与各草稿状态，渲染服务商列表、服务商详情与模型详情，处理密钥自动保存与预设套用。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `134` | `renderProviderRow(p:(typeof providers)[number] → React.JSX.Element)` | 渲染服务商列表行按钮：状态圆点、名称、模型数或阈值副标题与缺密钥警告，点击钻入该服务商详情。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `210` | `openProvider(id:string → void)` | 点击列表项：选中并钻入详情 | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/features/settings/Switch.tsx`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `2` | `Switch({ checked, onChange, title }:{ checked: boolean onChange: … → React.JSX.Element)` | 通用开关（受控）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/i18n/i18n.tsx`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `28` | `detectLocale(→ Locale)` | 决定初始语言：优先配置文件，其次 localStorage，最后按系统语言并把中文归一到 zh-CN。 | 静态扫描未检出（未导出且无同名调用） | — |
| `46` | `resolve(tree:MessageTree, key:string → string)` | 按点分 key 逐层查找文案字典，路径不存在或最终值不是字符串时原样返回 key。 | apps/desktop/src/main/services/a… | — |
| `56` | `I18nProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 语言上下文提供者：按当前语言构造 t 函数，并把 lang 属性写到根元素上。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/redesign/AvatarEditor.tsx`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `27` | `toHexInput(v:string \| undefined → string)` | 十六进制 ↔ 颜色槽值互转：Humation colors/background 存不带 `#` 的十六进制；<input type=color> 需带 `#`。 | apps/desktop/src/renderer/src/re… | — |
| `43` | `fileToAvatarDataUri(file:File → Promise<string>)` | 用户选的图 → 居中裁成正方 → 缩到 AVATAR_PX → data URI。 | apps/desktop/src/renderer/src/re… | 归一在渲染层做（canvas），主进程只管存字节，故无论原图多大 / 什么比例，落盘的都是小方图。 blob: 与 data: 均在 index.html 的 img-src 白名单内；本地文件同源，canvas 不会被 taint。 |
| `84` | `AvatarEditor({ seed, initialSpec, initialImage, title, busy, onCancel… → React.JSX.Element)` | 头像编辑器面板：管理槽位部件与配色选择、自定义图片上传和预览，完成后交回 spec 与图片。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/redesign/BotsPane.tsx`（21 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `32` | `BotsPane(→ React.JSX.Element)` | 「机器人」tab（图标栏「设置」上方）：与对话 / 角色 / 任务同一套面板——左列表 + 右详情。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 左列表顶部：搜索 + 「添加机器人」（悬停列出支持的平台，点即添加；扫码在弹框里完成）。 机器人都经扫码创建，扫码人自动成为主人（已配对）：飞书扫码即在平台上建好应用； Telegram 先粘贴 |
| `154` | `BotAddMenu({ onPick }:{ onPick: (p: Platform) => void } → React.JSX.Element)` | 「添加机器人」：悬停展开支持的平台（交互同角色 / 任务的 AddMenu），点击即开始添加。 | 静态扫描未检出（未导出且无同名调用） | — |
| `273` | `start` | 先取消上一次扫码，置 loading 后调 remote.scanStart（Telegram 带 token），失败退回填 Token 或失败态，成功进入 waiting 并记下 scanId。 | apps/desktop/src/renderer/src/re… | — |

#### `apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx`（292 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `366` | `ChatFirstShell(→ React.JSX.Element)` | 应用最外层外壳组件，汇总对话、角色、任务与控制台状态，管理侧栏收起浮出、键盘快捷键和 tab 切换，渲染图标栏、列表与中列视图。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `5552` | `renderMsg(m:ChatMessage, i:number, turn?:number → React.JSX.Element)` | 渲染单条消息，先判断是否为成员或任务交差回复，据此调整说话人身份、去掉标题行并隐藏待处理的成员挂载卡，再交给消息组件。 | apps/desktop/src/renderer/src/re… | — |
| `7810` | `save(→ void)` | 保存（create/edit）/ 接受（propose）：同一条渲染层 upsertPersona（用户点击即授权，零提权）。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | propose 态额外落定名片终态为 accepted（重开不退回 pending、不重复建角色）。 |

#### `apps/desktop/src/renderer/src/redesign/ProfilePanel.tsx`（19 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `24` | `ProfilePanel({ onClose }:{ onClose: () => void } → React.JSX.Element)` | 「我」的资料面板：展示并编辑记忆标签，可进入头像编辑器保存头像 spec 与图片，处理关闭与保存中状态。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `158` | `MemoryTag({ entry: e, h, style, elRef }:{ entry: MemoryEntry h: Ta… → React.JSX.Element)` | 一枚记忆标签：悬停时上方浮出编辑 / 删除小工具条（删除经父级二次确认），双击也可原地编辑； 键盘：聚焦后 Enter / F2 编辑、Delete 删除。 | 静态扫描未检出（未导出且无同名调用） | 编辑中 Enter 经 blur 统一保存，Esc 放弃。 |
| `378` | `MemoryTags({ entries, h, emptyText }:{ entries: MemoryEntry[] h: TagH… → React.JSX.Element)` | 窄屏：每条一枚标签自动换行铺开。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/redesign/RewindModal.tsx`（10 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `31` | `RewindModal({ sessionId, turns, initialTurn, promptOf, onClose, onPr… → React.JSX.Element)` | 检查点回滚面板（对标 Claude Code /rewind）：列表屏选一轮 → 详情屏看将被撤回的文件（+N −M、冲突、 链接跳过）与无法撤销的命令 → 选「代码和对话 / 仅对话 / 仅代码」。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | v1 刻意不做 diff，只给行数统计。 预览只是给人看的：主进程执行时按记录重算一遍，不信任这里传回的任何东西（除了勾选覆盖的冲突路径）。 |
| `121` | `apply(mode:RewindMode → Promise<void>)` | 按模式执行回滚：代码模式不带提示词，调 rewindApply 后处理结果，成功关闭面板、必要时预填原问题并给出带撤销的 toast。 | apps/desktop/src/renderer/src/re… | — |
| `241` | `Detail({ text, preview, force, busy, onToggleForce, onBack, o… → React.JSX.Element)` | 回滚详情视图：展示该轮提问与将撤回文件列表（含冲突覆盖勾选）、命令数提示，按有无改动提供三种回滚按钮。 | 静态扫描未检出（未导出且无同名调用） | — |

#### `apps/desktop/src/renderer/src/redesign/UpdateSection.tsx`（6 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `10` | `manualHintKey(file:string \| null → string)` | 手动更新时的说明文案：各平台（Linux 再分 deb / AppImage）的「下载之后怎么装」不一样。 | apps/desktop/src/renderer/src/re… | — |
| `21` | `UpdateSection(→ React.JSX.Element)` | 关于页的「检查更新」：只在点按钮时检查。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 状态由主进程持有（services/updater.ts），这里只展示与触发—— 下载途中离开关于页再回来，进度照样接得上。 |
| `39` | `check(→ void)` | `void window.deva.update.check()` | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

#### `apps/desktop/src/renderer/src/redesign/attachments.tsx`（15 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `278` | `FileCard({ name, kind, size, title, sent, onRemove }:{ name: st… → React.JSX.Element)` | 文件附件卡片：按文件类型显示彩色图标、文件名以及类型与大小，可带移除按钮。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `335` | `AttachmentList({ entries, variant, onRemove }:{ entries: AttachEntry[] va… → React.JSX.Element \| null)` | 附件区：图片缩略图在前，文件卡片在后。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | composer 给 onRemove（每项右上角可移除）；sent 靠右对齐、不可移除。 点任一缩略图在应用内看大图，同一处的几张图可左右切换。 |
| `400` | `ImageViewer({ items, index, onClose }:{ items: ViewerItem[] index: num… → React.JSX.Element)` | 看大图：遮罩上居中只放图片本身（不套窗口、不加边框），下方一行文件信息「名称 PNG · 386 KB · 960×600」， 不显示「2 / 4」这类序号；多张图时遮罩两侧有切换箭头。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | 不设关闭键（铺满时关闭键挨着系统的关闭按钮，容易误关 Deva）：Esc / 点遮罩关闭，← → 切换。原图取到、量好尺寸才换上：切换时旧图留到新图就绪，不会先缩成缩略图大小 再撑开。取不到原图退回缩略图。 |

#### `apps/desktop/src/renderer/src/redesign/composer-editor.ts`（31 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `99` | `MentionNode.createDOM(_config:EditorConfig, editor:LexicalEditor → HTMLElement)` | 为 @ 成员标签节点创建不可编辑的 span，按 editor 上的头像回调渲染 img，再附上名字文本。 | apps/desktop/src/renderer/src/re… | — |
| `130` | `MentionNode.isKeyboardSelectable(→ boolean)` | 方向键直接跨过，不选中整枚（退格同样直接删除，见 Lexical deleteCharacter 的内联 decorator 分支）。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `346` | `useComposerEditor(handlers:ComposerEditorHandlers → ComposerEditor)` | 建立 Lexical 编辑器：注册节点、键位与粘贴/拖放命令、token 同步和更新监听，返回 setText、replaceRange、focusEnd 等操作接口。 | apps/desktop/src/renderer/src/re… | — |

#### `apps/desktop/src/renderer/src/redesign/memory-editor.ts`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `14` | `fill(s:string, vars:Record<string, number \| string> → string)` | 文案占位符替换：`{name}` → vars.name。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `44` | `useMemoryEditor({ root, clearTitle, clearConfirm }:{ /** 工作区根：给了即该项目的私有记忆，省略… → MemoryEditor)` | 记忆标签墙编辑 hook：经 IPC 读写指定作用域记忆，管理行内编辑、删除与清空，返回快照和处理器。 | apps/desktop/src/renderer/src/re… | — |
| `94` | `run(op:() => Promise<MemoryIpcResult> → Promise<boolean>)` | 所有写操作统一收口：成功替换快照；失败挂错误码（i18n 在渲染时做）。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

#### `apps/desktop/src/renderer/src/redesign/resizable.tsx`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `49` | `loadLayout(→ Layout)` | 从配置同步读取已保存的面板与输入框尺寸布局，读取失败或格式不符时返回空对象。 | apps/desktop/src/renderer/src/re… | — |
| `59` | `saveLayout(patch:Layout → void)` | 写入一项尺寸；值为 undefined 即删除该项（恢复默认）。 | apps/desktop/src/renderer/src/re… | — |
| `81` | `ResizeHandle({ axis, value, onChange, onCommit, onReset, className, … → React.JSX.Element)` | 拖拽手柄。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | axis=x：向右拖变大；axis=y：向上拖变大（手柄在输入框上边框）。 拖动中每帧回调 onChange（调用方负责夹取），松手 onCommit 落盘；双击 onReset 恢复默认。 用 pointer capture：拖出手柄 / 越过 iframe 等元素也不会丢失事件。 |

#### `apps/desktop/src/renderer/src/store/chat.tsx`（74 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `1152` | `ChatProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 对话上下文提供者：持有全部会话、各会话活动态、待决卡与绑定覆盖层，封装发送、中止、会话增删改与回滚等操作。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `1393` | `startFresh(personaId?:string, focusRoot?:string \| null, model?:string → void)` | 起一个全新的空会话：切换当前会话（新 id 无活动态 → 视图自然空）。 | apps/desktop/src/renderer/src/re… | 对话优先外壳可传 personaId（绑定身份）/ focusRoot（聚焦工作区）/ model（**快照**角色偏好模型）→ 存进 覆盖层。model 在此刻定格：日后改角色偏好模型不影响本对话（快照固定）。 落盘时机分两路： · 绑定身份（传了 personaId）—— 对话优先外壳「与角色开启新对话」：**立即** createSession 落盘 + 刷新 左侧，空对话就此成为真实持久化会话（重启仍在）；覆盖层 + draftSession 仅作落盘完成前的即时占位， refreshSessions 后同 id 真值并入 sessions、draftSession 转 null，无缝接管。 · 零参调用（旧 AppShell 的 newSession()、启动/删空后的兜底）—— 仍走**惰性**建档：不落盘、不进左侧， 待用户首次 chat:send 时主进程再建档。故删空左侧后不会被自动重建一条空会话（右侧转「快速开启」空态）。 |
| `1879` | `send(text:string, attachments?:SendAttachment[] → Promise<boolean>)` | 返回是否真的发出：false = 未发出（空输入 / 本会话正忙 / 未选模型 / IPC 失败），调用方据此把草稿放回。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | 未发出的原因一律走 toast、不进对话流——这些提示主进程不落盘，做成气泡重启即消失，前后不一致。 |

#### `apps/desktop/src/renderer/src/store/extensions.tsx`（22 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `97` | `rolesAllow(roles:string[] \| null, personaId:string → boolean)` | 可用角色是否含该角色（null = 全部角色）。 | apps/desktop/src/renderer/src/re… | 与主进程 ext-roles.ts 的 allowsPersona 同义。 |
| `220` | `ExtensionsProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 扩展 store：载入技能、MCP 与角色并订阅主进程变更，对外提供增删改启停与刷新等操作。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `345` | `value` | 在 memo 中构造扩展上下文：定义技能导入、角色新建排序与头像设置等方法后连同状态一起返回。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

#### `apps/desktop/src/renderer/src/store/models.tsx`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `67` | `findActive(providers:Provider[], activeId:string \| null)` | 按首个冒号拆分「服务商:模型」标识并查找对应服务商与模型，无效或找不到时返回 null。 | apps/desktop/src/renderer/src/re… | — |
| `81` | `hasUsableModel(providers:Provider[] → boolean)` | 是否至少有一个可在对话里选用的模型（已启用的对话服务商 × 已启用模型；与输入框模型选择器同口径）。 | apps/desktop/src/renderer/src/re… | — |
| `114` | `ModelsProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 模型 store：载入并持久化服务商与模型配置、跟踪密钥状态，对外暴露模型选择与增删改接口。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/store/profile.tsx`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `19` | `ProfileProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 本机用户资料 store：启动时拉取头像 spec 和自定义图片，并向子组件提供落盘头像的方法。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `40` | `saveAvatar(spec:AvatarSpec, image:string → Promise<boolean>)` | 保存头像：先写 spec，图片相对已存值有变化时才写图，任一步失败返回 false。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `63` | `useProfile(→ ProfileContextValue)` | `{ const ctx = useContext(ProfileContext) if (!ctx) throw new Error('useProfile must be used within ProfileProvider') return ctx }` | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/store/tasks.tsx`（7 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `45` | `TasksProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 定时任务 store：初始拉取任务列表并订阅全量广播，对外转发创建、启停、立即运行、编辑与删除。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `65` | `create(input:TaskCreateInput → Promise<CreateTaskResult>)` | 创建：结果直接回给调用方（失败带稳定错误码供渲染层本地化）；成功后的列表刷新交由 tasks:changed 广播。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |
| `94` | `useTasks(→ TasksContextValue)` | `{ const ctx = useContext(TasksContext) if (!ctx) throw new Error('useTasks 必须在 TasksProvider 内使用') return ctx }` | apps/desktop/src/renderer/src/fe… | — |

#### `apps/desktop/src/renderer/src/store/workspace.tsx`（21 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `75` | `WorkspaceProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 工作区上下文提供者：维护项目列表、文件树缓存与按项目分片的编辑器标签和内容，暴露打开目录、读写文件等操作。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |
| `106` | `applyOpen(proj:Project → Promise<void>)` | 打开一个项目的公共路径：登记为项目 + 设为活动 + 载入根目录。 | apps/desktop/src/renderer/src/st… | — |
| `214` | `closeTab(path:string → void)` | 关闭标签：从当前项目的标签列表移除，若关的是活动文件则选同位置的下一个或前一个作为新的活动文件。 | 静态扫描未检出（箭头函数，多作为回调内联传入） | — |

#### `apps/desktop/src/renderer/src/theme/ThemeContext.tsx`（8 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `24` | `readConfigMode(→ ThemeMode \| null)` | 从 ~/.deva/config.json 同步取主题（首帧，避免闪烁）。 | apps/desktop/src/renderer/src/th… | 不可用时返回 null 走后续兜底。 |
| `46` | `readStoredMode(→ ThemeMode)` | 读取主题模式：优先配置文件，其次 localStorage 合法值，最后默认跟随系统。 | 静态扫描未检出（未导出且无同名调用） | — |
| `59` | `ThemeProvider({ children }:{ children: ReactNode } → React.JSX.Element)` | 主题上下文：跟踪系统主题偏好，把生效主题写到根元素属性并同步原生标题栏图标色。 | 导出；静态扫描未检出直接调用（多由 IPC / HTTP 通道或… | — |

#### `apps/desktop/src/renderer/src/theme/chatFontSize.ts`（4 条，下列 3 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `18` | `readChatFontSize(→ ChatFontSize)` | 从 config.json 同步读取（首帧用）；config 不可用（如纯 web 预览）时按标准。 | apps/desktop/src/renderer/src/ma… | — |
| `29` | `applyChatFontSize(size:ChatFontSize → void)` | 应用到页面：标准不写属性，其余写 data-chat-fs。 | apps/desktop/src/renderer/src/ma… | — |
| `36` | `saveChatFontSize(size:ChatFontSize → void)` | 立即生效并落盘。 | apps/desktop/src/renderer/src/re… | — |

### D · 共享、脚本与配置


#### `.github/scripts/release-notes.mjs`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `30` | `git(args)` | stderr 收进异常而不是直接打到终端：「找不到上一个 tag」属正常情况，不该在日志里冒 fatal | .github/scripts/release-notes.mj… | — |
| `33` | `previousTag` | 用 git describe 找当前 ref 之前最近的 v* 标签，正式版排除预发布标签，找不到时返回 null。 | .github/scripts/release-notes.mj… | — |

#### `apps/desktop/scripts/gen-icon.mjs`（8 条，下列 8 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `28` | `inBg(x, y, r=BG_R)` | `{ const cx = Math.min(Math.max(x, r), 1024 - r) const cy = Math.min(Math.max(y, r), 1024 - r) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r }` | apps/desktop/scripts/gen-icon.mj… | — |
| `34` | `inShape(x, y)` | 判断 1024 画布坐标是否落在标志图形内：由感叹号竖线、圆点、两端短横和右半圆环组成。 | apps/desktop/src/main/services/t… | — |
| `55` | `render(size, ss=4, { pad = 0, r = BG_R }={})` | pad：四周透明边距（1024 画布坐标），标志整体以画布中心等比缩小；r：缩小后的底板圆角。 | apps/desktop/scripts/gen-icon.mj… | 默认满幅（pad 0、圆角 224）。 |
| `60` | `toLogo(v)` | `(v * k - pad) / s` | apps/desktop/scripts/gen-icon.mj… | — |
| `97` | `crc32(buf)` | `{ let c = 0xffffffff for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8) return (c ^ 0xffffffff) >>> 0 }` | apps/desktop/scripts/gen-icon.mj… | — |
| `102` | `chunk(type, data)` | 按 PNG 规范组装单个数据块：写入数据长度、块类型与数据本身，并追加 CRC32 校验值。 | apps/desktop/scripts/gen-icon.mj… | — |
| `110` | `png(size, rgba)` | 把 RGBA 像素编码成 PNG 文件：生成 IHDR、经 deflate 压缩的 IDAT 与 IEND 后拼接返回。 | apps/desktop/scripts/gen-icon.mj… | — |
| `126` | `ico(frames)` | 把多张 PNG 帧组装成 ICO：写入含尺寸、位深与数据偏移的目录头，再依次拼接各帧数据。 | apps/desktop/scripts/gen-icon.mj… | — |

#### `apps/desktop/scripts/portable-zip.cjs`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `18` | `rename(from, to)` | 刚生成的文件可能正被杀毒软件扫描，Windows 上改名偶尔 EPERM / EBUSY：稍等重试。 | apps/desktop/scripts/portable-zi… | — |

#### `apps/desktop/src/shared/avatar-shape.ts`（4 条，下列 4 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `28` | `isAvatarShape(v:unknown → v is AvatarShape)` | `{ return typeof v === 'string' && (AVATAR_SHAPES as readonly string[]).includes(v) }` | apps/desktop/src/renderer/src/co… | — |
| `33` | `hashSeed(seed:string → number)` | FNV-1a 32 位：头像的确定性取样（形状、配色）都用它。 | apps/desktop/src/shared/avatar-s… | — |
| `46` | `seededShape(seed:string → AvatarShape)` | 新角色按 seed 挑形状：只在创建时调用一次，结果存成具体形状（名片预览与接受后的编辑器用同一 seed，两处一致）。 | apps/desktop/src/main/services/c… | — |
| `70` | `legacyAutoShape(seed:string → AvatarShape)` | `{ return LEGACY_AUTO_POOL[hashSeed(`${seed}#shape`) % LEGACY_AUTO_POOL.length] }` | apps/desktop/src/main/services/p… | — |

#### `apps/desktop/src/shared/context.ts`（12 条，下列 12 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `102` | `builtinContextWindow(modelId:string → number \| undefined)` | 内置表里的窗口；查不到返回 undefined。 | apps/desktop/src/shared/context.… | — |
| `116` | `capAutoWindow(modelId:string, window:number → number)` | `{ return /claude/i.test(modelId) ? window : Math.min(window, AUTO_WINDOW_CAP) }` | apps/desktop/src/shared/context.… | — |
| `121` | `autoContextWindow(modelId:string, fallback=DEFAULT_CONTEXT_WINDOW → number)` | 「自动」窗口：ID 自带（如 -128k / -1m）> 内置表 > fallback；前两者对非 Claude 模型封顶 AUTO_WINDOW_CAP。 | apps/desktop/src/main/services/c… | — |
| `145` | `autoOutputBudget(adapter:LimitAdapter, modelId:string → number \| undefined)` | 「自动」输出上限：Claude 系 32K；其余 Anthropic / Responses 协议 8K（适配器默认）； OpenAI Chat 协议返回 undefined = 不传，交给服务商默认。 | apps/desktop/src/main/services/c… | — |
| `155` | `validLimit(v:unknown, range:{ min: number; max: number } → v is number)` | config.json 里存的覆盖值是否可用（整数、落在范围内）。 | apps/desktop/src/main/services/m… | — |
| `163` | `formatTokens(n:number → string)` | token 数的紧凑写法：1M / 1.05M / 200K / 128K（131072）/ 8K（8192）。 | apps/desktop/src/renderer/src/fe… | 先认十进制整数（128000 也能被 1024 整除，按二进制会显示成 125K），再认二进制整数。 |
| `178` | `parseTokens(input:string → number \| null)` | 解析用户输入的 token 数：支持 200000 / 200,000 / 200k / 1m / 1.5M；无法解析返回 null。 | apps/desktop/src/renderer/src/fe… | — |
| `191` | `parseContextLimit(body:string → number \| undefined)` | 从服务商的「上下文超限」报错里解析真实窗口（token）；认不出返回 undefined。 | apps/desktop/src/main/providers/… | 只认明确写着上下文上限的句式——输出上限超限（max_tokens > N）的数字不能当成窗口。 |
| `225` | `parseContextOverflow(body:string → ContextOverflow \| undefined)` | 从「输入 + 输出预留超出窗口」的报错里解析三个数；认不出返回 undefined。 | apps/desktop/src/main/providers/… | 这类超限常常不是输入装不下， 而是输出预留太大：没传 max_tokens 时不少服务商按模型的最大输出预留（DeepSeek V4 为 384K，1M 窗口里 输入过 65.5 万即被拒，issue #43）。 |
| `226` | `pick(input:string, output:string, limit:string → ContextOverflow \| undefined)` | 从三个数值构造上下文溢出信息：上限合法且输入输出均大于 0 才算有效，否则 undefined。 | apps/desktop/src/shared/context.… | — |
| `249` | `isCjk(c:number → boolean)` | 中日韩文字、全角符号：一字约 1 token（各家分词器在 0.6~1.5 之间，取 1 偏保守）。 | apps/desktop/src/shared/context.… | — |
| `262` | `estimateTextTokens(s:string → number)` | 文本的 token 估算（拿不到真实用量时用）。 | apps/desktop/src/main/services/c… | 统一按 3.5 字符 ≈ 1 token 会把中文低估到三分之一左右， 压缩线贴近窗口时容易估少撞上限，故中日韩字符单独按一字一 token 计。 |

#### `apps/desktop/src/shared/effort.ts`（8 条，下列 8 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `32` | `isEffortLevel(v:unknown → v is EffortLevel)` | `{ return v === 'default' \\|\\| (THINK_LEVELS as readonly unknown[]).includes(v) }` | apps/desktop/src/main/services/c… | — |
| `129` | `findRule(adapter:EffortAdapter, modelId:string → Rule)` | `{ const id = modelId.toLowerCase() return RULES.find((r) => (!r.adapters \\|\\| r.adapters.includes(adapter)) && r.match.test(id)) ?? FALLBACK }` | apps/desktop/src/shared/effort.t… | — |
| `135` | `endpointFormat(baseURL:string \| undefined → ThinkFormat \| undefined)` | 按服务地址判定私有格式（官方端点）；认不出返回 undefined，交由模型家族决定。 | apps/desktop/src/shared/effort.t… | — |
| `159` | `resolve(adapter:EffortAdapter, modelId:string, baseURL?:string → Resolved \| null)` | 规则 + 协议 + 服务地址 → 实际能力；null = 不支持思考等级。 | apps/desktop/src/main/services/a… | — |
| `184` | `supportedEffortLevels(adapter:EffortAdapter, modelId:string → ThinkLevel[])` | 该模型支持的档位（由低到高）；空数组 = 不支持思考等级。 | apps/desktop/src/shared/effort.t… | 只能开不能调的模型返回 ['high']。 |
| `190` | `isToggleEffort(adapter:EffortAdapter, modelId:string → boolean)` | 是否「只能开、不能调档」：选择器把唯一的一档显示为「开启」。 | apps/desktop/src/renderer/src/re… | — |
| `198` | `clampEffort(adapter:EffortAdapter, modelId:string, level:EffortLevel → EffortLevel)` | 把存下的档位收敛到该模型支持的档：'default' 原样；支持即原样；否则先往低找最近的（省钱、不擅自加码）， 低处没有再往高找；模型不支持思考等级 → 'default'。 | apps/desktop/src/main/services/c… | 对话里存的仍是用户原选（换回支持的模型即恢复）。 |
| `221` | `effortRequest(adapter:EffortAdapter, modelId:string, baseURL:string \| undefined, l… → EffortRequest \| undefined)` | 某档（须已收敛）对应的请求参数；'default' / 不支持 → undefined（不发任何思考参数）。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/shared/mention.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `15` | `mentionRanges(text:string, names:readonly string[] → { start: number; end: number…)` | 正文里会生效的 `@名字` 所在区间 [start, end)（含 | apps/desktop/src/renderer/src/re… | — |

#### `apps/desktop/src/shared/quote.ts`（2 条，下列 2 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `5` | `isQuoteLine(line:string → boolean)` | Markdown 引用行（`>` 开头，前面至多 3 个空格）：用户消息开头右键「引用」带进来的别人的话。 | apps/desktop/src/shared/quote.ts… | 引用里的「/技能名」「@名字」不算用户的指令（见 shared/slash.ts、主进程 chat.ts 的 handleMentions）。 |
| `8` | `withoutQuotes(text:string → string)` | 去掉引用行，只留用户自己写的部分。 | apps/desktop/src/main/services/c… | — |

#### `apps/desktop/src/shared/slash.ts`（1 条，下列 1 条）

| 位置 | 名称与签名 | 作用 | 调用方 | 边界 / 副作用 |
|---|---|---|---|---|
| `11` | `slashTokens(text:string → { start: number; end: number…)` | 消息里的「/技能名」：渲染层（输入框上色）与主进程（chat.ts sendMessage 展开技能）共用同一套认法。 | apps/desktop/src/main/services/c… | `/` 须在消息开头（可有前导空白）或紧跟在空白之后，名字取最长的 [A-Za-z0-9_-]+；名字后面若紧跟 `/` `.` `:` `\\` 就不算（那是路径、文件名或网址，如「看下 /etc/hosts」「/tmp/a.txt」）。引用行（`>` 开头，右键「引用」带进来的 别人的话）里的也不算。认出来的名字是否真是技能由调用方判定。 按出现先后返回区间 [start, end)（含 /）与名字。 |

### 3.5 没有函数条目的源码文件（0 条的原因）

| 文件 | 为什么是 0 |
|---|---|
| `apps/desktop/src/main/services/default-personas.ts` | 只有 `DEFAULT_PERSONAS` 常量数组（角色身份/配色/提示词是数据） |
| `apps/desktop/src/main/services/deva-personas.ts` | 单条常量 |
| `apps/desktop/src/main/services/xiaomajiang-personas.ts` | 常量 + 模板字符串 |
| `apps/desktop/src/main/services/tasks-types.ts` | 纯 `interface` / `type` |
| `apps/desktop/src/main/services/remote/types.ts` | 纯契约类型 |
| `apps/desktop/src/shared/browser.ts` / `deliverables.ts` / `limits.ts` / `update.ts` | 类型 + 常量（`BROWSER_CHROME` 尺寸表、阈值、发布页地址） |
| `apps/desktop/src/renderer/src/env.d.ts` | 环境类型声明 |
| `apps/desktop/src/renderer/src/main.tsx` / `browser-main.tsx` | 只有顶层 `createRoot(...).render(...)`，无具名函数 |
| `apps/desktop/src/renderer/src/i18n/messages.ts` | 2920 行纯字典 |
| `apps/desktop/src/renderer/src/mock/extensions.ts` / `models.ts` | 类型 + 种子数据 |
| `apps/desktop/src/preload/index.d.ts` | 全局声明 `window.deva: DevaApi` |
| `apps/desktop/electron.vite.config.ts` | 配置对象 |
| `apps/desktop/scripts/{adhoc-sign,after-pack,linux-launcher}.cjs` | 只有 `module.exports = async (context) => …` 形式的匿名导出，实参由 electron-builder 注入；行为在 §1.4 钩子表里文字说明 |

### 3.6 未说明条目

**无。** 2505 条在附录中全部有说明文字；其中 723 条是函数体机械摘要（以「代码：」开头），已明确标注来源，不与人工判断混淆。§3.4 的紧凑表只收录 469 条精选，**其余 2036 条不应被视为「未说明」**——它们的说明在附录对应行。

### 3.7 IPC 通道的 153 / 154 / 158

| 数字 | 含义 | 证据 |
|---:|---|---|
| 158 | 主进程注册的全部通道 = 154 `handle` + 4 `on` | `grep -rn "ipcMain.handle(" apps/desktop/src/main --include=*.ts` → 154；`ipcMain.on(` → 4：`config.ts:86`、`terminal.ts:100`、`terminal.ts:104`、`terminal.ts:108` |
| 154 | README / 启动日志里的「channels」，只数 `handle` | `apps/web/README.md:40`、`out/logs/06-startup.txt` 的 `ready: 154 channels` |
| 153 | preload 用 `ipcRenderer.invoke` 暴露的通道数 | `grep -c "invoke('" apps/desktop/src/preload/index.ts` |

差值来源：`app:get-platform`（`apps/desktop/src/main/index.ts:318`）未包装；`config:get-sync` 走 `sendSync`（`apps/desktop/src/preload/index.ts:978`）；`terminal:input/resize/dispose` 走单向 `send`（`apps/desktop/src/preload/index.ts:1226/1228/1229`）。preload 另有 15 个 `ipcRenderer.on` 事件订阅。

---

## 4. 运行机制（一）：Web 请求全链路

入口：`apps/web/server.mjs`（1111 行）。启动命令 `pnpm start:web` → `node server.mjs`，cwd 为 `apps/web`。

### 4.1 启动阶段（进程起来之前/瞬间发生的事）

| 步骤 | 位置 | 输入 → 输出 | 关键点 |
|---|---|---|---|
| 读构建元数据 | `server.mjs:33-34` | `dist/manifest.json`、`dist/shim.js` → 内存 | 缺任一文件直接抛错退出；因此**必须先 `pnpm --filter @deva/web build`** |
| 注入版本 | `server.mjs:38-39` | `manifest.version` → `process.env.DEVA_VERSION` | 子进程（worker）继承环境变量，`app.getVersion()` 才拿到构建版本而非硬编码 |
| 读环境 | `server.mjs:40-46` | `PORT`（默认 7080）、`HOST`（默认 `0.0.0.0`）、`DEVA_WEB_DATA`（默认 `~/.deva-web`）、`SESSION_TTL`、`DEVA_WEB_SECURE_COOKIE` | 默认监听全网卡，见 §5 风险 R4 |
| 目录与权限 | `server.mjs:66-67` | `umask(0o077)` + `mkdir(…, 0o700)` | 数据目录对同机其他用户不可读 |
| 持久化存储 | `server.mjs:74-76` | `UserStore` / `SessionStore` / `AuditLog`（`src/server/auth.mjs`） | `state/users.json`、`state/sessions.json`、`audit/**/YYYY-MM-DD.jsonl` |
| 首启管理员 | `server.mjs:249-262` | 无管理员时创建 `admin`，密码取 `DEVA_ADMIN_PASSWORD` 否则随机生成并打印到 stdout | 随机密码只打印一次，日志被留存则等同于凭据泄露 |
| 后端进程池 | `server.mjs:280-289` | `new BackendPool({ idleMs, ctlUrl: http://127.0.0.1:PORT, ctlToken: WORKER_TOKEN, trustRoots, onEvent → broadcast, onLog })` | 每用户一个 worker（`src/server/backend-pool.mjs`） |
| 更新检查 | `server.mjs:88-108` | `UpdateChecker`（`src/server/updater.mjs`） | 比镜像内 commit 与 GitHub 最新提交，只提示不自动更新 |
| 监听 | `server.mjs:1100-1111` | `server.listen(PORT, HOST)` | 启动日志打印数据目录、renderer 目录、更新检查状态 |

### 4.2 单个 HTTP 请求的路由顺序（`server.mjs:907-1088`）

**顺序即优先级**，下面按代码中 `if` 的先后排列。任何一步 `return` 后不再往下走。

```
请求进入 (907)
 ├─ /healthz                        912   200 {ok, users:N}   无需登录
 ├─ /favicon.ico | /favicon.svg     918   只允许 GET/HEAD；直接 serveStatic（鉴权之前）
 ├─ POST /api/dir-pick              928   worker 回环：校验 x-deva-worker-token → 604
 ├─ /login                          933   GET 渲染登录页；已登录则 302 到 /
 ├─ /logout                         946   销毁会话 + 清 Cookie
 ├─ 【会话闸门】                      958   无会话 → /api/* 返 401 JSON，其余 302 /login?next=…
 │      sessionOf(309) → parseCookies → sessions.get → users.byId → 禁用用户视为未登录
 ├─ /api/me                         969   {id, username, role}
 ├─ /api/fs/list                    974   → handleFsList(642)
 ├─ /api/dir-pick/pending           979   列出该用户待处理的目录选择请求
 ├─ POST /api/dir-pick/:id          988   → handlePickResolve(669)
 ├─ /api/update                     993   admin-only，否则 403
 ├─ /api/channels                  1002   → pool.channels(user)（拉起 worker 取通道名）
 ├─ /api/events                    1008   → handleEvents(790)  SSE
 ├─ /api/invoke                    1013   → handleInvoke(737)
 ├─ /boot.js                       1018   bootScript(353)：注入 CSRF / 用户名 / 配置
 ├─ /shim.js                       1027   直接吐 dist/shim.js 源码
 ├─ /shell.js                      1036   注入登出链接、admin 更新徽标轮询、移动端抽屉
 ├─ /admin、/admin/*                1045/1064  admin-only，POST 走 handleAdminPost(830)
 ├─ 其余方法不匹配                  1077   405（非 GET/HEAD 且未命中任何 API）
 └─ 兜底                           1082   serveStatic(444)
异常                                 1085   catch → 500（不泄露堆栈）
```

### 4.3 `/api/invoke` 的完整数据流（最重要的一条路径）

渲染层的每一次 `window.deva.foo(...)` 最终都变成这里的一次调用。

| 步 | 位置 | 输入 | 输出 / 校验 |
|---:|---|---|---|
| 1 | `shim.js` 内 `ipcRenderer.invoke`（`apps/web/src/electron-shim.js:34-44`） | `channel`、`...args` | `POST /api/invoke`，头带 `x-deva-csrf` |
| 2 | `handleInvoke` 方法校验 `server.mjs:738` | `req.method` | 非 POST → 405 |
| 3 | CSRF 校验 `server.mjs:742` | 头 `x-deva-csrf` vs `session.csrf` | `csrfOk`（`auth.mjs:274`，`safeEqual` 定时安全比较）→ 失败 403 |
| 4 | 解析 JSON `server.mjs:749` | body | 非法 JSON → 400 |
| 5 | 取通道与参数 `server.mjs:756-760` | `body.channel`、`body.args` | 缺 channel → 400；`args` 非数组则退化为 `[]` |
| 6 | **路径闸门** `server.mjs:767` → `jailCheck`（`570`） | 通道名 + 参数 | 见 4.4 |
| 7a | 单向消息：`fireAndForget` `server.mjs:768-772` | — | `pool.send` 后立刻 204 |
| 7b | 请求-响应：`pool.invoke` `server.mjs:775` | — | `{ok:true, value}` |
| 8 | 审计 `server.mjs:779-786` | 通道名、`summarize(args)`、耗时 | 写 `audit/users/<id>/YYYY-MM-DD.jsonl`，敏感键脱敏 |
| 9 | 错误分支 `server.mjs:782-793` | 异常 | 仍返回 HTTP 200 + `{ok:false, error}`，让前端能展示；同时记审计 |
| 10 | `BackendPool.invoke`（`backend-pool.mjs:144`） | — | 取/拉起该用户 worker，`touch()` 刷新空闲计时，`child.send({t:'invoke', id, channel, args})` |
| 11 | worker 进程（`apps/web/src/server/worker-host.mjs:39`） | IPC 消息 | `backend.invoke(channel, args)` |
| 12 | `dist/backend.cjs` → `apps/web/src/backend/index.ts` 的 `createBackend()`（该文件 `:64`） | — | 由真实的主进程业务模块注册出的 `invoke` |
| 13 | 回程 `worker-host.mjs:42` | 结果 / 异常 | `process.send({t:'reply', id, ok, value})` |
| 14 | `BackendPool` 兑现 Promise（`backend-pool.mjs:106`） | — | 按 `id` 找到 pending 的 resolve/reject |

关键设计点：**worker 是「每用户一个」的普通 Node 子进程**（`fork`，见 `backend-pool.mjs:61`），环境变量带 `HOME`、`DEVA_HOME`、`DEVA_WEB_WORKSPACE`、`DEVA_WEB_USER`、`DEVA_WEB_CTL_URL`、`DEVA_WEB_CTL_TOKEN`、`DEVA_WEB_TRUST_ROOTS`，`cwd` 设成该用户的 workspace。因此主进程代码里所有 `getDevaHome()`、相对路径、`process.cwd()` 都自然落在用户自己的目录里——**这是 Web 端多租户隔离的主要手段**，而不是靠代码里的路径判断。

### 4.4 路径闸门的判定逻辑（`server.mjs:570-603`）

```
jailCheck(user, channel, args)
  roots = [user.workspace, user.home, ...pickRoots(user), ...userExtraRoots(user)]
  ├─ channel === 'terminal:create'  → assertTerminalCwdInside(user, roots, args[0].cwd)
  ├─ CHANNEL_PATHS[channel] 存在     → 按登记的「路径参数下标」逐个 assertPathInside
  ├─ 未登记但匹配 /^fs:|^git:/      → 递归扫描 args 里所有字符串，全部当路径校验（从严）
  └─ 其他通道                        → 不校验
```

- `CHANNEL_PATHS` 登记了 **33 个通道**（`server.mjs:501-536`），值是该通道里路径参数的位置：`['one']` 单个、`['many']` 数组、`[]` 无路径。
- `assertPathInside`（`542`）：空/非绝对路径直接放行（相对路径在 `cwd` 里解析，由 worker 承担）；绝对路径按 `\0` 切开后逐段 `isInside(roots)` 校验，越界抛「路径超出本用户工作区」。
- `assertTerminalCwdInside`（`557`）：先按 `user.workspace` 解析成绝对路径，再 `fsp.realpath` 取真实路径（挡符号链接逃逸），再与 `realpath` 后的 roots 比对。
- `isInside`（`apps/web/src/server/util.mjs:157`）是纯字符串前缀判断（`path.relative` 或等价实现），**不含 realpath**——非终端类路径依赖上游 `resolvePickPath`（`server.mjs:196-213`）已经做过真实路径归一。

设计取舍（代码注释 `server.mjs:490-500` 写明了原因）：早先的实现扫描**所有**字符串参数，导致 `fs:write-file(path, '/开头的正文')` 这类正常内容被当成越界路径拒绝；现在改成按登记表只校验路径位。

### 4.5 `fs` 通道与「伪文件系统」

Web 端没有 Electron 的 `dialog.showOpenDialog`。`apps/web/src/backend/electron-shim.mjs:283` 的 `showOpenDialog` 在 `properties` 含 `openDirectory` 时改走**回环 HTTP**：

```
worker（后端进程）
  → POST {ctl}/api/dir-pick     头 x-deva-worker-token: WORKER_TOKEN       (electron-shim.mjs:295-300)
  → 网关 handleWorkerPick(604)  令牌不符 403；用户不存在/禁用 400
  → 没有在线 SSE 客户端时直接返回 user.workspace（降级）
  → 否则挂起该 HTTP 请求，登记到 dirPicks，broadcast('deva:dir-pick') 推给浏览器
  → 浏览器 picker.js 弹层列出受信根（/api/fs/list → handleFsList 642）
  → 用户选定后 POST /api/dir-pick/:id（handlePickResolve 669，校验 csrf + 归属）
  → 挂起的 HTTP 请求被兑现，worker 拿到绝对路径
  → 5 分钟无人响应 → 按「取消」返回，避免 worker 永久占 IPC
```

`handleFsList`（`642`）对每个子项做 `realpath` + `inBrowseScope`（`196`），只列目录，按 locale 排序；根在 `BROWSE_TOP` 时 `parent` 返回 `null`。`BROWSE_TOP` 默认 `/`（`server.mjs:59`），`BROWSE_HIDDEN` 排除 `/proc`、`/sys`、`/dev`、`/run`（`server.mjs:60`），并额外隐藏 state / audit / 其他用户目录（`browseHidden`，`183`）。

### 4.6 事件通道 `/api/events`（SSE）

- `handleEvents`（`790`）写 SSE 头（`text/event-stream`、`no-store`、`x-accel-buffering: no`），先发 `: connected`，再按 `user.id` 把 `res` 放进 `sseClients`，每 15 秒发 `: ping`，`req.on('close')` 时清理。
- 广播源：worker 的 `event` 消息（`backend-pool.mjs:114`）→ `pool` 的 `onEvent` → `broadcast(userId, channel, payload)`（`server.mjs:267`）→ 只写该用户的连接集合。
- 浏览器侧：`apps/web/src/electron-shim.js:85-95` 用单个 `EventSource('/api/events')`，`onmessage` 解析 `{channel, payload}` 后按通道分发。**任意通道都能走这条默认 message 路径**，不需要为每个事件单独命名 SSE 事件。

### 4.7 终端 PTY 通道

- 桌面：`terminal.ts:31` 注册 IPC，`utilityProcess.fork(join(__dirname,'pty-host.js'))`（`terminal.ts:53`），主进程与 PTY 宿主通过 `postMessage` 收发（`pty-host.ts:37/40/78`）。
- Web：`build.mjs:76-95` 把同一个 `pty-host.ts` 打成 `dist/pty-host.js`，并在文件头注入 banner：

  ```js
  if (!process.parentPort) {
    process.parentPort = { postMessage: (m) => process.send(m), on: (e, cb) => process.on('message', (m) => cb({ data: m })) }
  }
  ```

  于是 `pty-host.ts` 里写死的 `process.parentPort` 在普通 Node 子进程里也成立，**源码零改动**即可复用。

### 4.8 静态资源与页面注入

- 白名单 `WEB_ASSETS`（`server.mjs:442`）只有 5 个：`/mobile.css`、`/picker.css`、`/picker.js`、`/favicon.svg`、`/favicon.ico`，直接从 `apps/web/src/web/` 读。
- 其余全部映射到 `manifest.rendererDir`（即 `apps/desktop/out/renderer`），先 `path.resolve` 再 `isInside(root, abs)`，越界 403（`server.mjs:470-475`）。
- 畸形百分号编码先 `decodeURIComponent` 并 catch → 400（`server.mjs:460-466`），不再是 500。
- `.html` 响应会走 `injectIndex`（`361`）：在 `</head>` 前插入 favicon、`mobile.css`、`picker.css`、`boot.js`、`shim.js`、`shell.js`、`picker.js`。注释说明了原因（`server.mjs:362`）：上游页面 CSP 是 `script-src 'self'`，内联脚本会被拦，所以全部走独立文件。

### 4.9 关停

`shutdown(signal)`（`server.mjs:1090`）依次：停更新检查 → `pool.stopAll()`（向所有 worker 发 shutdown，超时强杀）→ `server.close()` → 3 秒后 `process.exit`。信号绑定在 `1096`（SIGTERM）、`1097`（SIGINT）。

---

## 5. 运行机制（二）：Electron 主进程 → preload → 渲染层 → IPC

### 5.1 启动序列（`apps/desktop/src/main/index.ts`，437 行）

> 本节及 5.2 中单独出现的 `index.ts` 一律指 `apps/desktop/src/main/index.ts`；preload 的入口写作 `preload/index.ts`。

| 步 | 位置 | 做什么 |
|---:|---|---|
| 1 | `index.ts:273` | `app.requestSingleInstanceLock()`，第二个实例唤起已有窗口后退出 |
| 2 | `index.ts:283` `app.whenReady()` | 初始化入口 |
| 3 | `index.ts:284` | `setAppUserModelId('dev.sqfcy.deva')`——Windows 通知与任务栏归组的前提 |
| 4 | `index.ts:286` | `registerToastIdentity(...)`，便携版没有快捷方式时通知标题才不会显示原始 ID |
| 5 | `index.ts:288` | `void integrateAppImage()`，Linux AppImage 把 desktop 条目与图标写进用户目录 |
| 6 | `index.ts:293` | Linux 下 `app.setName('deva')`。注释（`290-292`）说明**必须等 ready 之后**：应用名决定 `userData` 目录与钥匙环密钥条目名，ready 前改会换目录、旧 API Key 解不开 |
| 7 | `index.ts:301-318` | 注册 window 控制 IPC：`window:minimize`、`window:toggle-maximize`、`window:close`、`window:is-fullscreen`、`app:get-platform` |
| 8 | `index.ts` 后续若干行 | 按依赖顺序注册全部业务模块的 IPC（chat / git / terminal / mcp / skills / personas / tasks / remote / browser / profile / …） |
| 9 | `index.ts:394` | `createWindow()` |
| 10 | `index.ts:397` | `autoConnectEnabledServers()`，全局 MCP 服务各自失败降级，不阻塞启动 |
| 11 | `index.ts:400` | `startScheduler(() => mainWindow)`，30 秒 tick 的定时任务调度器 |
| 12 | `index.ts:403` | `createTray()`，托盘 |
| 13 | `index.ts:405-406` | `activate`：macOS 点击 Dock 且没有普通窗口时重建 |

### 5.2 窗口创建（`createWindow`，`apps/desktop/src/main/index.ts:98`）

| 项 | 值 | 位置 |
|---|---|---|
| 尺寸 | 1280×820，最小宽 940 | `index.ts:100-102` |
| 无边框 | `titleBarStyle: 'hidden'` + `titleBarOverlay` + 红绿灯位置 | `index.ts:109-115` |
| 首次显示 | `show: false`，`ready-to-show` 再显示（`revealOnce`，`133`） | 避免白屏 |
| 首显兜底 | `did-finish-load` / `did-fail-load` / `render-process-gone` / 5 秒超时 都会触发显示 | `index.ts:133-150` |
| preload | `join(__dirname, '../preload/index.js')` | `index.ts:117` |
| 安全开关 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`、`spellcheck: false` | `index.ts:119-124` |
| 外链 | `setWindowOpenHandler` → `shell.openExternal` + `deny` | `index.ts:172-173` |
| 右键 | `context-menu` 只给可编辑区提供剪切/复制/粘贴 | `index.ts:180` |
| 加载 | 开发态 `loadURL(ELECTRON_RENDERER_URL)`，生产态 `loadFile('../renderer/index.html')` | `index.ts:209-212` |
| 关窗驻留 | Windows 默认驻留托盘；其余平台按配置 opt-in | `index.ts:161-169` |

### 5.3 preload 桥

`apps/desktop/src/preload/index.ts`（1510 行）是单文件：单次 `contextBridge.exposeInMainWorld('deva', api)`（`:1501`），`const api = {…}`（`:920`），`export type DevaApi = typeof api`（`:1510`）。

- **153 个 invoke 方法**，全部是单行箭头：`foo: (a, b) => ipcRenderer.invoke('ns:foo', a, b)`
- **1 个同步方法**：`getSync: () => ipcRenderer.sendSync('config:get-sync')`（`978`）
- **3 个单向 send**：`terminal.write/resize/dispose`（`1226/1228/1229`）
- **15 个事件订阅**：`onX(cb) => { ipcRenderer.on(...); return () => ipcRenderer.removeListener(...) }`

沙箱 + contextIsolation 下渲染层拿不到 `require`/`ipcRenderer`，`window.deva` 是唯一出口——Web 端要做的正是**替换这个对象**（见 5.5）。

### 5.4 渲染层 → 主进程 → 渲染层的一次对话回合

1. 渲染层 `store/chat.tsx` 调 `window.deva.chatSend(...)` → `ipcRenderer.invoke('chat:send')`（主进程 `chat.ts:6090`）
2. `chat.ts` 的 `sendMessage`（`5955`）建会话/回合，然后 `runTurn`（`5428`）
3. `runTurn` 内 `streamChat`（`4482`）走 provider 门面（`apps/desktop/src/main/providers/index.ts:46`），按 `adapter` 分派到 anthropic / openai / responses
4. 流式增量通过 `emit(turnId, sessionId, event)`（`chat.ts:2559`）→ `publishChatEvent`（`chat-bus.ts:44`）→ `bus.emit('chat', p)`
5. `registerChatIpc`（`chat.ts:2545`）订阅总线，`win.webContents.send('chat:event', p)`（`chat.ts:2551`）
6. preload 的 `onChatEvent` 转成回调；渲染层 store 更新消息列表
7. 模型返回工具调用 → `chat.ts` 收集后逐个过权限闸门（`chat.ts:5157-5230`）→ 执行 → 结果回灌为一条 user 消息 → 继续循环
8. 回合结束 → 落盘（`chat-store.ts`）→ 检查点（`checkpoints.ts`）

**权限闸门的真实语义**（`chat.ts:5157-5160` 注释）：

> 纯同步策略，零弹框：所有工具一律放行，文件读写与命令执行不设任何限制（2026-10-09 起）。交互轮唯一的拒绝是「用户暂不挂载工作区」；密封轮另经 `sealedDecision`（排除交互/创建类工具）。

因此「权限闸门」现在只剩两类判断：**挂载前置闸**（`needsWorkspaceMount`，`chat.ts:5171-5217`，交互轮且 `depth === 0` 才生效）和**密封轮策略**（`sealedDecision(tc.name)`，`chat.ts:5219-5221`，`sealed.ts:45`，`SEALED_FORBIDDEN` 在 `sealed.ts:27`）。其余 `allowed = true`。

### 5.5 Web 如何复用同一套代码（这是本项目最关键的架构点）

三层替换，源码零改动：

| 层 | 桌面 | Web | 实现 |
|---|---|---|---|
| `window.deva` 提供方 | `preload/index.ts` 打进 Electron | **同一个文件**用 esbuild 打成 `shim.js`，`alias electron → apps/web/src/electron-shim.js` | `build.mjs:34-52`；`define` 把 `process.platform` 折成 `"linux"`、`process.contextIsolated` 折成 `"false"` |
| IPC 传输 | `ipcRenderer.invoke` → 主进程 | `fetch('/api/invoke')` + SSE | `apps/web/src/electron-shim.js:34-44`（invoke）、`:45-52`（send，`fireAndForget:true`）、`:54-58`（sendSync 直接读 `__DEVA_CONFIG__`）、`:85-95`（EventSource） |
| 主进程业务 | 真 Electron 主进程 | 每用户一个 Node 子进程，`electron` 模块换成 `electron-shim.mjs`，`electron-updater` 换成 `updater-stub.mjs`，`@deva/main` 指回真实主进程目录 | `build.mjs:53-73` |

`apps/web/src/backend/index.ts`（136 行）是后端的「主进程入口复刻」：`createBackend()`（`64`）按 `main/index.ts` 的顺序调用 `register*Ipc`，但**不建窗口**；`app.whenReady` 用 `Promise.resolve` 顶替（`67`）；`BrowserWindow` 换成假对象（`70`）；信任根从 `DEVA_WEB_TRUST_ROOTS` 注入（`74-81`）；事件通过 `setEventSink`（`65`）转给 `worker-host.mjs` 的 `process.send({t:'event'})`。

差异清单（读代码能确认的）：

| 能力 | 桌面 | Web |
|---|---|---|
| 打开目录对话框 | 系统 dialog | 回环 HTTP + 页面内 picker（§4.5） |
| 系统通知 | 原生 | 无（`Notification` 未移植，走 SSE 在前端提示）**推测** |
| 自动更新 | 真 updater | `updater-stub.mjs` 调用即失败；改用 `server/updater.mjs` 比对 commit，只提示 |
| 安全存储 | Electron `safeStorage` | AES-256-GCM，密钥文件 `DEVA_HOME/.web-secret`（`electron-shim.mjs:354-380`） |
| 内置浏览器 | `WebContentsView` | CDP 驱动系统 Chromium（`src/backend/chromium.mjs`） |
| Shell 外链 | `shell.openExternal` | 空实现（`electron-shim.mjs:329` 附近的 `shell` 对象） |

### 5.6 构建期：源码怎么变成可运行产物

**桌面（electron-vite）**——`apps/desktop/electron.vite.config.ts`（52 行）：

- `main` **双入口**：`index`（主进程）与 `pty-host`（PTY 宿主），因为后者必须在独立进程里跑原生模块
- `preload` 把依赖外部化，产出单文件
- `renderer` 两个页面 `index.html` / `browser.html`，别名 `@renderer`，注入 `__APP_VERSION__`（来自 `package.json`）
- 开发服务器固定 `127.0.0.1:5173` + `strictPort`（Web 端要复用它 `/api/invoke` 的源，端口漂移会破坏 CSRF/会话）

产物：`apps/desktop/out/` 下的 `main/`、`preload/`、`renderer/` 三个子目录，`apps/desktop/package.json` 的 `main` 为 `out/main/index.js`（相对 `apps/desktop` 解析，即 `apps/desktop/out/main/index.js`，已存在）。

**Web（esbuild，`apps/web/build.mjs`，141 行）**——3 次 `build()`：

| 产物 | 入口 | 格式 | 关键配置 |
|---|---|---|---|
| `dist/shim.js` | `apps/desktop/src/preload/index.ts` | IIFE / browser / chrome120 | `alias: {electron: src/electron-shim.js}`；`define` 折叠 `process.platform`、`process.contextIsolated` |
| `dist/backend.cjs` | `apps/web/src/backend/index.ts` | CJS / node20 | `alias: {electron, electron-updater, @deva/main}`；`external: ['@lydell/node-pty']` |
| `dist/pty-host.js` | `apps/desktop/src/main/pty-host.ts` | CJS / node20 | 头部 banner 伪造 `process.parentPort` |

收尾工作：`@lydell` 原生模块软链到 `dist/node_modules/`（`build.mjs:100-118`，先解旧软链再建，容忍搬家）；写 `dist/package.json`（`{"type":"commonjs"}`，覆盖父级 `type: module`，`build.mjs:129`）、`dist/manifest.json`（`130`）、`dist/build-info.json`（`134`，含 commit/ref/version/builtAt）。

**桌面如何加载产物**：`loadFile('../renderer/index.html')`（`index.ts:212`），相对 `apps/desktop/out/main/` 解析。
**Web 如何加载前端**：`serveStatic` 以 `manifest.rendererDir` 为根读 `apps/desktop/out/renderer`（`server.mjs:470`），并把 `apps/web/src/web/*` 的 5 个补丁资源叠在上面。

### 5.7 数据落在哪

| 场景 | 根目录 | 内容 |
|---|---|---|
| 桌面 | `~/.deva`（`DEVA_HOME` 可覆盖；`config.ts:17` `getDevaHome`） | `config.json`、`secrets.json`、`mcp.json`、`tasks.json`、`memory.json`、`projects/<key>/memory.json`、`profile/`、`personas/`、`skills/`、`data/chats/<id>.json` + `_index.json` + 压缩分片、`data/subagents`、`data/checkpoints`、`data/media`、`data/tool-results` |
| Web 网关 | `DEVA_WEB_DATA`（默认 `~/.deva-web`，容器内 `/data`） | `state/users.json`、`state/sessions.json`、`state/update-state.json`、`audit/auth.jsonl`、`audit/users/<id>/YYYY-MM-DD.jsonl`、`users/<id>/{.deva,roots.json,workspace}` |
| Web worker | 每个用户的 `DEVA_HOME` = `users/<id>/.deva` | 与桌面完全相同的结构——**同一套 `getDevaHome()` 代码** |

`users/<id>/roots.json` 是用户额外信任的根，网关重启时通过 `DEVA_WEB_TRUST_ROOTS` 重新注入（`server.mjs:149-166` `extraRootsFile` / `userExtraRoots`，`rememberRoot` 在 `167`）。

---

## 6. 关键不变量与风险点

每条都给出「不变量是什么 / 现有保护在哪 / 缺口或注意点」。**没有找到保护的地方明确写「未发现」**，不做「应该没问题」的推断。

### 6.1 路径沙箱（桌面）

| 不变量 | 保护 | 位置 |
|---|---|---|
| 渲染层发起的 fs/git 操作不得越出受信根 | `assertInside` / `assertAllInside` / `isInsideRoot`，根来自 `roots` 集合 | `apps/desktop/src/main/services/fs-guard.ts:90`、`:110`、`:79`、`:13` |
| 校验必须用真实路径，防符号链接逃逸 | `realResolve` / `realResolveAsync`（`fs.realpath`） | `fs-guard.ts:20`、`:40` |
| 工作区 IPC 只能读写根内文件 | `fs:open-folder` 成功后 `trustRoot`；其余读写都过 guard | `workspace.ts:43`（`trustRoot` 在 `:49`）、`:64`、`:82`、`:92` |
| 读文件有体积上限、二进制不入内存 | `MAX_FILE_BYTES`、`looksBinary` | `workspace.ts:33`、`:35` |

**缺口（设计如此，但必须知道）**：`tools.ts:756-757` 的注释写明「不设任何路径限制（2026-10-09 起）：不校验受信根，凭据目录、`~/.deva`、`.git` 一律可读写」，`resolvePath`（`tools.ts:758`）确实不做任何根校验。**Agent 的文件工具完全不经过 `fs-guard`**——模型可以让 `read_file`/`write_file` 读写任意绝对路径。`fs-guard.ts:58` 的文件头也确认它「只约束渲染层发起的 fs/git IPC」。

**注释漂移（真实不一致）**：`tools.ts:40` 仍写着「文件类路径经 fs-guard 校验，严禁越出受信根」，与 `:756-757` 相反。行为以代码为准，但这条过期注释会误导维护者，建议后续修正（本次未改产品代码）。

### 6.2 路径沙箱（Web 网关）

| 不变量 | 保护 | 位置 |
|---|---|---|
| 只有登记过的路径参数被校验 | `CHANNEL_PATHS`（33 个通道）+ `JAILED = /^fs:\|^git:/` | `apps/web/server.mjs:500-536` |
| 绝对路径必须落在 roots 内 | `assertPathInside`：空/非绝对路径放行，其余按 `\0` 切段 `isInside` | `server.mjs:542-555` |
| 终端 cwd 不得逃逸 | `assertTerminalCwdInside`：先按 workspace 解析，再 `realpath` 比对 | `server.mjs:557-568` |
| 未登记的新 fs/git 通道从严处理 | `jailCheck` 递归扫描所有字符串参数 | `server.mjs:578-586` |
| 目录浏览限范围 | `resolvePickPath` 做真实路径归一 + `inBrowseScope` | `server.mjs:203`、`:196`、`:183` |

**注意点 1**：`jailCheck`（`570`）只对 `fs:` / `git:` 前缀的通道生效。其余 100 多个通道（`chat:*`、`mcp:*`、`browser:*`、`terminal:input` 等）**不做任何路径校验**。这是有意的（比如 `chat:send` 的正文不可能当路径看），但意味着：**只要某个非 fs/git 通道接受路径参数，它就是绕过闸门的口子**。新增这类通道时必须同步登记到 `CHANNEL_PATHS` 或改前缀。

**注意点 2**：`isInside`（`apps/web/src/server/util.mjs:157`）是纯字符串判断，不含 `realpath`。可靠性依赖上游调用方先做真实路径归一（`resolvePickPath`、`assertTerminalCwdInside` 都做了）。

**注意点 3**：`BROWSE_TOP` 默认 `/`（`server.mjs:59`）。默认部署下用户可以浏览整机目录树（只读、只列目录），不受限的部分靠 `BROWSE_HIDDEN`（`/proc`、`/sys`、`/dev`、`/run`，`:60`）与 `browseHidden`（state / audit / 其他用户目录，`:183`）遮挡。多用户部署应显式把 `DEVA_WEB_BROWSE_TOP` 收窄。

### 6.3 认证与授权（Web）

| 不变量 | 保护 | 位置 |
|---|---|---|
| 密码不可逆存储 | scrypt N=16384 r=8 p=1 keylen=64，格式 `scrypt$N$r$p$salt$hash` | `apps/web/src/server/auth.mjs:6-17`（常量）、`:8`（`hashPassword`） |
| 校验定时安全 | `timingSafeEqual` | `auth.mjs:19-31`（`verifyPassword`） |
| 会话 Cookie 不可被 JS 读取 | `HttpOnly` + `SameSite=Lax` + `Path=/`，`DEVA_WEB_SECURE_COOKIE=1` 时加 `Secure` | `server.mjs:318-328` |
| 写操作需 CSRF token | `csrfOk` + `safeEqual`，token 是会话创建时的随机值 | `auth.mjs:274`、`server.mjs:742` |
| 登录后跳转不可被劫持 | `safeNext`：必须以 `/` 开头，拒绝 `//`、反斜杠、空白与 NUL | `server.mjs:705-709` |
| 禁用用户立即失效 | `sessionOf` 里 `user.disabled` 视为未登录 | `server.mjs:309-316` |
| 管理接口仅 admin | `/api/update`、`/admin*` 显式判断 `user.role !== 'admin'` | `server.mjs:993`、`:1045` |
| 审计可追溯 | 每次 invoke 记 `{channel, args: summarize(args), ok, ms}`，敏感键脱敏 | `server.mjs:779-790`、`util.mjs:136` |

**缺口 1（未发现保护）：没有任何速率限制。** `server.mjs` 与 `auth.mjs` 里没有登录失败计数、没有 IP 维度限流、没有验证码。`handleLogin`（`711`）失败只写审计并重渲染页面。对暴露在公网的部署，这意味着密码可被无限次暴力尝试。

**缺口 2**：会话默认 TTL 由 `SESSION_TTL` 控制（`server.mjs:43`），`SessionStore.get`（`auth.mjs:140`）只做过期判断，**没有滑动续期与并发登录数限制**。

**缺口 3**：worker→网关的回环用一次性 `WORKER_TOKEN`（`server.mjs:63`，24 随机字节）校验（`server.mjs:605`）。令牌在 `BackendPool` 创建 worker 时通过环境变量注入（`backend-pool.mjs:61` 附近的 fork `env`）。**同机其他进程可以读到彼此的 `/proc/<pid>/environ`**——若部署在有其他不可信进程的机器上，这个边界不成立。容器化部署（`docker-compose.yml`，`no-new-privileges`）里风险可控。

### 6.4 静态资源与注入

| 不变量 | 保护 | 位置 |
|---|---|---|
| 只下发白名单里的 Web 资源 | `WEB_ASSETS`（5 个路径） | `server.mjs:442` |
| renderer 目录外不可读 | `path.resolve` + `isInside` → 越界 403 | `server.mjs:470-475` |
| 响应头防嗅探 / 防嵌套 | `x-frame-options: DENY`、`x-content-type-options: nosniff`（仅 HTML 页面） | `server.mjs:339-340`；静态文件只加 nosniff（`:453`、`:483`） |
| 畸形 URL 不返回 500 | `decodeURIComponent` 包 try/catch → 400 | `server.mjs:460-466` |
| 内联脚本受 CSP 限制 | 上游页面 CSP 是 `script-src 'self'`，所以注入全部走独立文件 | `server.mjs:362`（注释）、`injectIndex`（`361`） |

**注意点**：`shell.js`（`server.mjs:373`）与 `boot.js`（`353`）是服务端拼接的脚本，含用户名与配置 JSON。`bootScript` 用 `JSON.stringify` 序列化，能防 `</script>` 注出；但 `__DEVA_CONFIG__` 来自用户可写的 `config.json`（`readConfig`，`345`），**如果配置里含 `</script>`，`JSON.stringify` 不会转义 `<`**——上游 CSP 会拦住内联脚本，但这是「依赖 CSP 兜底」而不是「序列化本身安全」。属于低危，记录于此。

### 6.5 Git 与命令执行

| 不变量 | 保护 | 位置 |
|---|---|---|
| 不经过 shell，避免命令注入 | `execFile(gitPath, [argv], { cwd })` | `apps/desktop/src/main/services/git.ts:193`（`execFile`）、`:19`（文件头安全注释） |
| 路径参数单独走 `--` 分隔 | `runGitPaths` | `git.ts:240` |
| 所有 git 操作限制在给定 cwd | `runGitRaw` / `runGit` 都带 `cwd` | `git.ts:180`、`:225` |

**注意点**：`git.ts` 是唯一「零凭据存储」的设计——不存 remote 密码、不管理 SSH key，依赖系统 git 的既有配置。这意味着使用者的 git 凭据在服务器上以系统用户身份可用。

### 6.6 后端兼容层的语义差异

| 项 | 风险 | 证据 |
|---|---|---|
| 未移植通道 | `__invoke` 对未注册通道抛 `NOT_PORTED`，前端需降级处理 | `apps/web/src/backend/electron-shim.mjs:73-81` |
| `handlers.mjs` 是死代码 | 该文件从未被 import，不参与运行 | 全文无引用（`rg "handlers.mjs"` 只命中自身） |
| `dialog` 桩 | `showSaveDialog` / `showMessageBox` / `showErrorBox` 是空实现，返回固定值 | `electron-shim.mjs:319-328` |
| `shell` 桩 | `openExternal` 不真正打开浏览器 | `electron-shim.mjs:329` 附近 |
| 安全存储 | AES-256-GCM + 密钥文件；`DEVA_WEB_SECRET` 存在时用其 sha256 作主密钥，否则生成 32 字节 hex 存 `0600` | `electron-shim.mjs:354-380` |
| 内置浏览器 | 依赖系统 Chromium（`findChrome`），找不到时功能不可用 | `apps/web/src/backend/chromium.mjs:14` |

**注意点**：`DEVA_HOME/.web-secret` 与加密后的密文在同一个数据卷里。能读到该卷的人可以解密 `secrets.json`——Web 版的「安全存储」主要防的是误读与明文落盘，不是防同卷攻击者。

### 6.7 其它已确认的缺口

| 缺口 | 说明 | 证据 |
|---|---|---|
| 无 lint / 无单元测试 | 仓库无 eslint/prettier/biome 配置，无 `*.test.*`；CI 只跑 typecheck + build | `.github/workflows/ci.yml` |
| Web 层不在 typecheck 覆盖内 | `apps/web` 无 typecheck 脚本；`src/backend/index.ts` 单独 tsc 会报 4 条 TS2305（esbuild alias 在 tsc 下不生效） | `out/logs/05-typecheck-web-backend.txt`、`out/REPORT.md:321` |
| CI 不覆盖 Web | 打包与启动验证全在本地 | `ci.yml` |
| Docker 镜像未实跑 | 有 Dockerfile 与 compose，但没有 CI 构建验证 | `out/REPORT.md:341` |

---

## 7. 阅读顺序建议

按「建立心智模型的性价比」排序，每步都给出读多少行、读什么。

### 第一阶段：15 分钟看懂「是什么」（约 400 行）

| # | 文件 | 读多少 | 关注什么 |
|---:|---|---|---|
| 1 | `README.md` | 全篇 | 产品定位、成员协作、工具清单、安全模型 |
| 2 | `package.json` + `pnpm-workspace.yaml` | 全文（各几十行） | 命令链、workspace 结构 |
| 3 | `apps/desktop/package.json` | 全文 | 依赖即架构：哪些库存在，就说明有哪些能力 |
| 4 | `apps/desktop/electron.vite.config.ts` | 全文（52 行） | 双入口、双页面、别名 |
| 5 | `apps/web/README.md` | 架构与安全章节 | Web 版是怎么「换壳」的 |
| 6 | 本文 §4、§5 | — | 两套运行链路 |

### 第二阶段：2 小时看懂「一次对话怎么跑起来」（约 2000 行）

按数据流顺序读，不要按目录顺序读：

| # | 文件 | 关键函数 | 为什么此时读 |
|---:|---|---|---|
| 7 | `apps/desktop/src/main/index.ts` | `createWindow`（98）、`whenReady`（283）、`before-quit`（416） | 应用的骨架 |
| 8 | `apps/desktop/src/preload/index.ts` | `const api = {`（920）、`exposeInMainWorld`（1501） | 渲染层能做什么，全看这里 |
| 9 | `apps/desktop/src/main/services/chat.ts` | `registerChatIpc`（2545）、`sendMessage`（5955）、`runTurn`（5428）、权限闸门（5157） | 系统的核心循环 |
| 10 | `apps/desktop/src/main/providers/index.ts` + `types.ts` | 门面 `46` 行附近 | 模型适配器如何归一 |
| 11 | `apps/desktop/src/main/services/tools.ts` | 工具表（`TOOLS`）、`resolvePath`（758） | 模型能做什么 |
| 12 | `apps/desktop/src/main/services/chat-store.ts` | 存储布局（文件头 `20-33`） | 数据落在哪 |
| 13 | `apps/desktop/src/renderer/src/store/chat.tsx` | 会话状态 | 界面如何消费事件 |
| 14 | `apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx` | 只看结构，别逐行读（8958 行） | 界面骨架 |

### 第三阶段：1 小时看懂「Web 版怎么复用」（约 1500 行）

| # | 文件 | 关键点 |
|---:|---|---|
| 15 | `apps/web/build.mjs`（141 行） | 三层 alias 替换，是全部魔法的源头 |
| 16 | `apps/web/server.mjs`（1111 行） | 路由顺序（`907`）、`handleInvoke`（`737`）、`jailCheck`（`570`） |
| 17 | `apps/web/src/backend/index.ts`（136 行） | 主进程入口的复刻清单 |
| 18 | `apps/web/src/backend/electron-shim.mjs` | `__invoke`（73）、`dialog`（282）、`safeStorage`（354） |
| 19 | `apps/web/src/electron-shim.js`（95 行） | 浏览器侧 `window.deva` 的实现 |
| 20 | `apps/web/src/server/backend-pool.mjs` + `worker-host.mjs` | 每用户一进程的进程模型 |

### 反模式（不要这样读）

- **不要从 `ChatFirstShell.tsx` 开始**：8958 行、292 个函数，是全项目最长的文件，但它是**结果**不是**原因**。
- **不要按目录字母序读 `services/`**：84 个文件里有一半是边缘功能（`tray-icon`、`appimage`、`portable`、`clipboard`），先读 §5.4 的链路，再按需展开。
- **不要先读 Web 的 `chromium.mjs`**（571 行）：它只服务于内置浏览器这一个功能，不影响主链路理解。

---

## 8. 交付自查

### 8.1 行号抽查（24 条，逐条对照源码）

| # | 引用 | 断言 | 源码实况 |
|---:|---|---|---|
| 1 | `apps/web/server.mjs:40` | 默认端口 7080 | `const PORT = Number(process.env.PORT ?? 7080)` |
| 2 | `apps/web/server.mjs:66` | umask 077 | `process.umask(0o077)` |
| 3 | `apps/web/server.mjs:501` | `CHANNEL_PATHS` 定义 | `const CHANNEL_PATHS = {` |
| 4 | `apps/web/server.mjs:542` | `assertPathInside` | `function assertPathInside(roots, value)` |
| 5 | `apps/web/server.mjs:570` | `jailCheck` | `async function jailCheck(user, channel, args)` |
| 6 | `apps/web/server.mjs:604` | `handleWorkerPick` | `async function handleWorkerPick(req, res)` |
| 7 | `apps/web/server.mjs:705` | `safeNext` | `function safeNext(raw)` |
| 8 | `apps/web/server.mjs:737` | `handleInvoke` | `async function handleInvoke(req, res, user, session)` |
| 9 | `apps/web/server.mjs:790` | `handleEvents` | `function handleEvents(req, res, user)` |
| 10 | `apps/web/server.mjs:1090` | `shutdown` | `const shutdown = (signal) => {` |
| 11 | `apps/web/server.mjs:444` | `serveStatic` | `async function serveStatic(req, res, urlPath)` |
| 12 | `apps/web/server.mjs:318` | `setCookie` | 函数定义（含 HttpOnly/SameSite） |
| 13 | `apps/desktop/src/main/index.ts:318` | `app:get-platform` IPC | `ipcMain.handle('app:get-platform', () => process.platform)` |
| 14 | `apps/desktop/src/main/index.ts:172` | `setWindowOpenHandler` | `mainWindow.webContents.setWindowOpenHandler((details) => {` |
| 15 | `apps/desktop/src/main/index.ts:416` | `before-quit` | `app.on('before-quit', (e) => {` |
| 16 | `apps/desktop/src/main/services/tools.ts:758` | `resolvePath` 无路径限制 | 函数定义紧跟「不设任何路径限制」注释 |
| 17 | `apps/desktop/src/main/services/chat.ts:2559` | `emit` 发布事件 | `publishChatEvent({ turnId, sessionId, event })` |
| 18 | `apps/desktop/src/main/services/chat.ts:2551` | 推送到渲染层 | `win.webContents.send('chat:event', p)` |
| 19 | `apps/desktop/src/main/services/config.ts:86` | `config:get-sync` 用 `on` | `ipcMain.on('config:get-sync', (evt) => {` |
| 20 | `apps/desktop/src/preload/index.ts:978` | `sendSync` | `getSync: (): Record<string, unknown> => ipcRenderer.sendSync('config:get-sync')` |
| 21 | `apps/desktop/src/preload/index.ts:1226` | `terminal:input` 单向 send | `write: (id, data) => ipcRenderer.send('terminal:input', id, data)` |
| 22 | `apps/web/src/electron-shim.js:86` | SSE 连接 | `const source = new EventSource('/api/events')` |
| 23 | `apps/web/src/backend/electron-shim.mjs:73` | `__invoke` | `export async function __invoke(channel, args) {` |
| 24 | `apps/web/build.mjs:35` | shim 构建 | 第 1 次 `await build({`（浏览器侧 shim） |

以上 24 条均按 `sed -n '<行号>p'` 实测确认，断言与源码一致。

### 8.2 计数一致性

| 项 | 文档声明 | 实测 | 一致 |
|---|---|---|---|
| 受控文件数 | 225（§1.2 树 / §2.1 表） | `git ls-files` 198 + 未跟踪 35 − 本次产出的 8 个文档 = 225 | ✓ |
| 源码行数 | 65880 | 168 个文件 `wc -l` 求和（与 §2.1 各行一致） | ✓ |
| 文件表行数合计 | 与 §2.1 逐行一致 | 168 个数值行逐条比对 `wc -l`，0 处不符 | ✓ |
| 目录树叶子数 | 225 | `gen_tree3.py` 输出 266 行 = 1 根 + 40 目录 + 225 文件 | ✓ |
| 源码文件数 | 168 | AST 扫描 168 | ✓ |
| 函数条目数 | 2505 | AST 扫描 2505 | ✓ |
| 导出台数 | 713 | AST 扫描 713 | ✓ |
| 区域小计 | 103+164+23+1292+15+869+39 = 2505 | 逐区域求和 | ✓ |
| 附录行数合计 | 1292+869+290+15+28+11 = 2505 | 六个附录的编号行计数 | ✓ |
| §3.4 紧凑表条数 | 469 | 生成脚本输出 469 行 | ✓ |

### 8.3 路径存在性

§1.2 目录树的 225 个叶子、§2.1 的 225 行、§4/§5 引用的全部文件路径，逐一 `test -e` 校验通过（225/225）。

全文另有 305 条 `apps/**`、`docs/**`、`out/**`、`.github/**` 形式的路径 token（去掉 `:行号` 后缀后）逐条 `os.path.exists`：304 条存在；唯一例外是 `out/main/index.js`，它在文中紧跟「（相对 `apps/desktop` 解析，即 `apps/desktop/out/main/index.js`，已存在）」的说明，属刻意保留的 `package.json#main` 原始写法。

§6 引用的行号见 8.1。

### 8.4 未覆盖条目

**无未说明条目。** 2505 条在六个附录中全部有说明，其中 723 条是函数体机械摘要（标注为「代码：」开头），其余 1782 条来自文档注释、行尾注释或人工补写。

若按「人工逐条判断」的严格口径，则 723 条机械摘要 + 443 条由代理阅读后补写 = 1166 条非最终人工措辞。这批条目集中在两个最大的文件（`ChatFirstShell.tsx` 292 条、`chat.ts` 192 条）中体量最大的内部辅助函数——它们的签名、调用点、行号是机械准确的，但作用描述是摘要而非人写的一句话。这一点在此明示，不隐瞒。

---

## 附：文档与附录清单

| 文件 | 作用 | 规模 |
|---|---|---:|
| `docs/PROJECT-MAP.md` | 本文：总览 / 文件清单 / 函数说明 / 运行机制 / 风险 / 阅读顺序 | 2558 行 / 283 KiB |
| `docs/FUNCTION-INDEX.md` | 2505 条函数的机械索引（行号 + 签名 + 导出 + 调用点数） | 4003 行 / 226 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-main.md` | 主进程 1292 条逐条说明 | 1561 行 / 548 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-renderer.md` | 渲染层 869 条 | 1033 行 / 406 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-web.md` | Web 290 条 | 355 行 / 90 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-preload.md` | 预加载 15 条 | 38 行 / 5 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-shared.md` | 共享 28 条 | 75 行 / 15 KiB |
| `docs/PROJECT-MAP-FUNCTIONS-scripts.md` | 脚本 11 条 | 49 行 / 5 KiB |
