# Deva-Web 工程健康检查与根因修复报告

- 工作目录：`/home/agent/shared_workspace/deva`（pnpm monorepo）
- 检查对象：`apps/desktop`（Electron 主进程 / preload / renderer）+ `apps/web`（纯 Web 网关与后端复用层）
- 环境：Linux / Node v24.22.1 / pnpm 10.8.0（corepack）/ 无 Docker 守护进程
- 基线提交：`109937f`（v0.1.15）；**第二轮复测基线 `3ddd9dc`（分支 `feat/plugin-deva-agent`）**
- 结论：**构建、类型检查、启动自检全部通过；确认并修复 7 个真实缺陷（4 个安全、2 个功能、1 个 HTTP 语义），另有文档一致性修正 1 处。** 修复前 15 个缺陷探针 + 15 项图标检查失败，修复后各自 30/30 与 15/15 全部通过。
- **第二轮（2026-11-21）**：在上面的基础上补齐三项工程缺陷（lint 工具链、Web 层静态类型检查、CI 覆盖 Web），并修掉 3 个新发现的真实缺陷（`backend-pool` 定时器泄漏、两个回归脚本在共享 roots 部署下的误报、文档通道数过期）。原 §7 的条目全部有了结论，见 §7 各小节的「现状」行。

---

## 0. 需求清单（逐条对照）

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 摸清结构、技术栈、全部可用脚本/检查 | ✅ | 本文 §1 |
| 2 | 逐项运行检查并列出所有错误/告警/缺陷 | ✅ | §2、§3 |
| 3 | 按影响排序修复，只做根因修复 | ✅ | §4（7 个缺陷，逐个复现→修复→回归） |
| 4 | 禁用 `@ts-ignore` / 关规则 / 注释代码 / 跳测试 | ✅（第一轮）/ 第二轮另有 3 处逐行 disable，均已写明理由 | §4；§4.8 |
| 5 | 每批修复后重跑检查，最后整体重跑并给前后对比 | ✅ | §3 表格 + `out/*.txt`、`logs/07`、`logs/08`、`logs/09` |
| 6 | 不新增功能、不重构无关模块 | ✅ | §6 改动面（第一轮：server.mjs + pages.mjs + 2 图标 + 2 文档；第二轮见 §6.1） |
| 7 | 收尾汇报：分类、验证证据、未修项与原因 | ✅ | §4、§5、§7 |
| 8 | 收尾：`verification/` → `out/` 并同步引用 | ✅ | §3.1（逐字节校验 + 新路径复跑） |
| 9 | 收尾：诊断并修复网页端 icon 缺失 | ✅ | §4.7（修复前 0/15 → 修复后 15/15） |

**第二轮需求（2026-11-21，分支 `feat/plugin-deva-agent`）**

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| R1 | 确认当前分支/工作区，重新实测全部健康检查（不用旧数字） | ✅ | §3.2（分支 `feat/plugin-deva-agent` @ `3ddd9dc`） |
| R2 | 修掉所有可复现真实缺陷，只做根因修复，禁止抑制手段 | ✅ | §4.8–4.11（本轮新增 3 个真实缺陷 + 一批 lint 根因修复） |
| R3a | Web 层类型检查缺口：补 shim 的 `.d.ts` + 可运行脚本并接入 pnpm | ✅ | §7.2（4 × TS2305 → exit=0，含负向验证） |
| R3b | CI 覆盖 Web；跑不了的明确标注跳过原因 | ✅ | §7.3（check + web-e2e；跳过项写在 workflow 注释里） |
| R3c | 引入最小可行 lint 并真实通过，不得关规则造假 | ✅ | §4.8、§7.1（30 problems → 0） |
| R4 | 三项判定不改（Agent 工具、`BROWSE_TOP`、Docker）要逐条写清理由 | ✅ | §7.4 / §7.5 / §7.6-2 |
| R5 | 更新本报告 + 新证据入 `out/`，不动无关模块、不加业务功能 | ✅ | §6.1、§5、`logs/10`–`logs/19` |
| R6 | 续跑：每项独立实测、边做边落盘，最后整体复跑并给前后对比 | ✅ | §8.1、§8.2、`logs/16`–`logs/19`（`OVERALL_FAIL=0`） |

---

## 1. 项目结构与技术栈

```
deva/
├── apps/desktop/            Electron 桌面端（29,923 行主进程 / 82 文件，125 个 IPC 通道）
│   ├── src/main/            业务主进程：chat / providers / tools / terminal / git / mcp …
│   ├── src/preload/         window.deva.*（153 invoke + 15 事件订阅）
│   └── src/renderer/        React 18，49 个 ts/tsx，零 Electron API 直调
├── apps/web/                纯 Web 运行层（本次健康检查的主要对象）
│   ├── server.mjs           网关：登录/会话/CSRF/静态托管/审计/路径闸门（1,111 行）
│   ├── build.mjs            esbuild 打包 shim.js / backend.cjs / pty-host.js
│   ├── src/server/          auth / backend-pool / worker-host / pages / updater
│   ├── src/backend/         electron-shim / chromium(CDP) / index.ts（复用主进程模块）
│   └── test/smoke.mjs       14 项冒烟回归
├── out/                     本次新增：缺陷探针、git 端到端、基线副本、报告
└── .github/workflows/       ci.yml（typecheck+build）/ pages.yml / release.yml
```

技术栈：TypeScript（Electron 侧）+ 原生 ESM `.mjs`（Web 侧）+ esbuild + electron-vite + React 18 + node-pty + Chromium/CDP。

### 1.1 可用脚本与检查（第一轮实测；标「第二轮」的是本轮新增）

| 检查 | 命令 | 说明 |
|---|---|---|
| 依赖安装 | `pnpm install --frozen-lockfile` | 有 lockfile，可冻结安装 |
| 类型检查 | `pnpm typecheck` | desktop（`tsconfig.node.json` + `tsconfig.web.json`）**+ web（第二轮新增 `apps/web/tsconfig.backend.json`）** |
| 桌面构建 | `pnpm build` | electron-vite：main + preload + renderer + mobile |
| Web 构建 | `pnpm --filter @deva/web build` | esbuild 打包 3 个产物 + manifest |
| 启动自检 | `node apps/web/server.mjs` | 逐模块注册日志 `[backend] xxx ok` + `ready: 162 channels` |
| 冒烟回归 | `node test/smoke.mjs` | 14 项：登录/CSRF/隔离/闸门/通道/终端/审计 |
| **Lint（第二轮新增）** | `pnpm lint` | ESLint 9 flat config，覆盖 JS/TS/TSX，0 problems |
| **ES 语法（第二轮新增）** | `node --check <file>` | 已入库全部 js/mjs（71 个；本轮新增的 3 个入库后为 74） |
| **插件单测（第二轮新增进 CI）** | `cd plugins/deva-agent && node --test tests/*.test.mjs` | 158 项 |
| **`apps/desktop` 单元测试** | **不存在** | 无 vitest/jest，无 `*.test.*` / `*.spec.*`（见 §7.6-3） |

---

## 2. 检查执行结果（最终状态）

| 检查 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 依赖安装 | `pnpm install --frozen-lockfile` | ✅ exit=0 | `logs/01-install.txt` |
| 类型检查 | `pnpm typecheck` | ✅ exit=0（node + web 两套 tsconfig） | `logs/02-typecheck.txt` |
| 桌面构建 | `pnpm build` | ✅ exit=0（2197 modules） | `logs/03-build-desktop.txt` |
| Web 构建 | `pnpm --filter @deva/web build` | ✅ exit=0（shim/backend/pty-host ok，commit=109937f） | `logs/04-build-web.txt` |
| 启动自检 | `node apps/web/server.mjs` | ✅ 22 个注册步骤逐项 ok（含 window channels），`ready: 162 channels`，`/healthz` 200 | `logs/06-startup.txt`、`logs/20-final-full-run-round2-close.txt` |
| ES 语法 | `node --check` 全部 `.mjs` | ✅ 无语法错误 | 见 §3 命令 |
| 冒烟回归 | `node test/smoke.mjs` | ✅ pass=14 fail=0 | `smoke-after.txt` |
| 缺陷探针 | `node out/probe.mjs` | ✅ pass=30 fail=0 | `probe-after.txt` |
| Git 端到端 | `node out/git-e2e.mjs` | ✅ pass=10 fail=0 | `git-after.txt` |
| 闸门覆盖核对 | `node out/channel-coverage.mjs` | ✅ pass=4 fail=0（33 个 fs/git 通道全覆盖） | `channel-coverage.txt` |
| 浏览范围反向回归 | `node out/browse-check.mjs` | ✅ pass=9 fail=0（正常目录仍可浏览） | `browse-regression.txt` |
| 图标回归 | `node out/icon-check.mjs` | ✅ pass=15 fail=0（favicon 200 + MIME + link 标签） | `icon-after.txt`、`logs/08-icon-regression.txt` |
| **Lint（第二轮新增）** | `pnpm lint` | ✅ exit=0，0 problems（基线 30 problems；`apps/web` 单独跑 4 error → 0） | `logs/11-lint-before.txt`、`logs/12-lint-after.txt`、`logs/17-lint-web-final.txt` |
| **Web 类型检查（第二轮新增）** | `pnpm --filter @deva/web typecheck` | ✅ exit=0（基线 4 × TS2305） | `logs/10-web-typecheck-before.txt`、`logs/16-web-typecheck-final.txt` |
| **插件单测** | `cd plugins/deva-agent && node --test tests/*.test.mjs` | ✅ 158/158 | `logs/14-final-full-run.txt` |
| **CI 等价执行（第二轮新增）** | 见 `.github/workflows/ci.yml` 两个 job | ✅ check + web-e2e 全部步骤本地复跑通过，`OVERALL_FAIL=0` | `logs/13-ci-equivalent.txt`、`logs/20-final-full-run-round2-close.txt` |

---

## 3. 修复前后对比（验证证据）

基线实例（`out/server.baseline.mjs`，复刻修复前的 `server.mjs`，端口 7091）与修复后实例（端口 7092）跑**同一份**探针脚本：

| 检查 | 修复前（7091 基线） | 修复后（7092） | 提升 |
|---|---|---|---|
| 缺陷探针 `probe.mjs` | **pass=15 fail=15** | **pass=30 fail=0** | 15 项失败全部转绿 |
| Git 端到端 `git-e2e.mjs` | **pass=4 fail=6** | **pass=10 fail=0** | 6 项失败全部转绿 |
| 浏览范围 `browse-check.mjs` | **pass=6 fail=3** | **pass=9 fail=0** | 3 项失败全部转绿 |
| 图标 `icon-check.mjs` | **pass=0 fail=15** | **pass=15 fail=0** | favicon 从 302/404 到 200 |
| 冒烟回归 `smoke.mjs` | pass=14 fail=0 | pass=14 fail=0 | 无回归 |

复现命令：

```bash
# 修复后实例
cd apps/web
DEVA_WEB_DATA=/tmp/deva-final-data DEVA_WEB_ADMIN_PASSWORD=smoke-pass \
DEVA_UPDATE_CHECK_MINUTES=-1 PORT=7092 node server.mjs &

# 基线实例（复刻修复前实现；跑完记得删掉 apps/web/server.baseline.mjs）
cp out/server.baseline.mjs apps/web/
cd apps/web
DEVA_WEB_DATA=/tmp/deva-prefix-data DEVA_WEB_ADMIN_PASSWORD=smoke-pass \
DEVA_UPDATE_CHECK_MINUTES=-1 PORT=7091 node server.baseline.mjs &

cd out
BASE=http://127.0.0.1:7092 node probe.mjs            # 30/0
BASE=http://127.0.0.1:7091 node probe.mjs            # 15/15
BASE=http://127.0.0.1:7092 node git-e2e.mjs          # 10/0
BASE=http://127.0.0.1:7091 node git-e2e.mjs          # 4/6
BASE=http://127.0.0.1:7092 node browse-check.mjs     # 9/0
BASE=http://127.0.0.1:7091 node browse-check.mjs     # 6/3
BASE=http://127.0.0.1:7092 node channel-coverage.mjs # 4/0
cd ../apps/web
BASE=http://127.0.0.1:7092 ADMIN_PASSWORD=smoke-pass SMOKE_CREATE_USER=1 node test/smoke.mjs
```

> 复现基线的两点注意：
> 1. 基线脚本（`out/server.baseline.mjs`）内部 `import './src/server/pages.mjs'`，会用到**当前**的 `pages.mjs`。要复现图标缺陷的 0/15，必须同时把 `pages.mjs` 临时回退到无 `ICON_LINKS` 的版本（本次做法：备份现文件 → 去掉 4 处 `${ICON_LINKS}` 与常量 → 跑基线 → 还原并用 `diff -q` 确认一致）。否则基线页面上会出现 3 条假 PASS。
> 2. 基线实例的端口是 7091/7094，修复后实例是 7092/7093；两轮（首轮 7091/7092、图标回归 7094/7093）数据目录都独立，互不干扰。

修复前的 15 条失败原文见 `probe-before.txt`，Git 的 6 条见 `git-before.txt`。

### 3.1 目录改名 `verification/` → `out/`

`git` 未跟踪该目录（本次新生成），因此用 `mv` 完成迁移，并以 `sha256sum` 逐文件比对：

```
迁移前 23 个文件 → 迁移后 23 个文件，内容逐字节一致（路径前缀替换后 diff 为空）
```

迁移后新增的文件（`icon-check.mjs`、`icon-before.txt`、`icon-after.txt`、`favicon-256-preview.png`、`logs/07-rerun-after-rename.txt`、`logs/08-icon-regression.txt`、`logs/09-final-verification.txt`）是收尾工作的产物，不在迁移对照范围内。

引用同步（改完后全仓搜索 `verification/` 路径，只剩本文档中描述改名历史的文字，无任何可执行路径引用）：

| 位置 | 改动 |
|---|---|
| `REPORT.md` | 所有 `verification/` 路径、目录树、复现命令的 `cd` 目标 |
| `server-fix.diff` | 补丁头 `--- out/server.baseline.mjs`；迁移后重新生成，现包含 favicon 路由与 `serveStatic` 改造（此前版本只到 6 处缺陷修复） |
| `logs/05-typecheck-web-backend.txt` | 首行命令改为 `bash out/typecheck-web-backend.sh` |
| `.gitignore` | 追加 `!/out/`，否则根目录 `out/` 会被 `out/` 规则忽略而无法入库 |

脚本内部**无需改动**：`channel-coverage.mjs` 用 `new URL('../apps/web/server.mjs', import.meta.url)`，`typecheck-web-backend.sh` 用 `$(dirname "$0")/..`，二者都与目录名无关，已在新路径实测通过。

新路径下的复跑（服务 `PORT=7093`，`cd` 到仓库根或 `out/` 均可）：

```bash
cd out
BASE=http://127.0.0.1:7093 node probe.mjs            # 30/0
BASE=http://127.0.0.1:7093 node git-e2e.mjs          # 10/0
BASE=http://127.0.0.1:7093 node browse-check.mjs     # 9/0
BASE=http://127.0.0.1:7093 node channel-coverage.mjs # 4/0
BASE=http://127.0.0.1:7093 node icon-check.mjs       # 15/0
bash typecheck-web-backend.sh                        # 4 条 TS2305，exit=2（已知限制，预期）

# 或从仓库根：
node out/probe.mjs

cd ../apps/web
BASE=http://127.0.0.1:7093 ADMIN_PASSWORD=smoke-pass SMOKE_CREATE_USER=1 node test/smoke.mjs  # 14/0
```

结果与改名前的通过数完全一致，记录在 `logs/07-rerun-after-rename.txt`。

### 3.2 第二轮复测（`3ddd9dc`，分支 `feat/plugin-deva-agent`）

先确认工作区：当前分支 `feat/plugin-deva-agent`，`deva_web` 指向同一提交，`main` 落后 71 个提交（本次工作不做合并）。所有数字均为**本轮实测**，不沿用上一轮。

| 检查 | 第二轮结果 | 说明 |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit=0（1.7s） | lockfile 与 `package.json` 一致 |
| `pnpm lint` | exit=0，**0 problems** | 新增；基线（同一配置跑 HEAD 代码）30 problems |
| `pnpm typecheck` | exit=0 | 已含第三套 tsconfig：`apps/web/tsconfig.backend.json` |
| `pnpm build` | exit=0 | electron-vite main / preload / renderer + mobile |
| `pnpm --filter @deva/web build` | exit=0 | shim.js + backend.cjs + pty-host.js，deva=0.1.16 |
| `node --check`（已入库 71 个 js/mjs） | fail=0 | 新增到 CI |
| 启动自检 | 22 个注册步骤 ok，**`ready: 162 channels`** | 旧文档写 154，实测 162（见 §7.7） |
| `smoke` / `probe` / `git-e2e` / `browse-check` / `channel-coverage` / `icon-check` | **14/30/10/9/4/15，fail=0（合计 82）** | 与上一轮通过数一致 |
| `plugins/deva-agent` 单测 | **158 pass / 0 fail** | 新增到 CI |
| CI 等价执行 | check + web-e2e 两个 job 逐步本地复跑通过，`OVERALL_FAIL=0` | `logs/13-ci-equivalent.txt`、`logs/19-final-full-run-round2-close.txt` |

两种部署形态都跑过：默认（仅用户自己的 workspace）与 `DEVA_WEB_ROOTS` 指向公共目录。后者暴露了一处**回归脚本误报**（见 §4.9），已修。

---

## 4. 修复清单（按影响排序，全部为根因修复）

修复主要集中在 `apps/web/server.mjs`，favicon 另涉 `apps/web/src/server/pages.mjs` 与 2 个静态资源文件，外加 2 处文档数字修正。
完整补丁见 `out/server-fix.diff`（基线与修复后逐行对比，已含 favicon 相关改动）。

### 4.1 安全：登录开放重定向（高危）

**位置**：`server.mjs:705` `safeNext()`，用于 `server.mjs:722`（POST）与 `server.mjs:942`（GET `/login?next=`）

**根因**：旧实现只判断 `next.startsWith('/')`。`//evil.example/x` 与 `/\evil.example/x` 都满足，但浏览器会按**协议相对 URL** 跳到外站，形成钓鱼入口。

**修复**：新增 `safeNext()`——必须以单个 `/` 开头，且不得以 `//` 开头、不得含 `\` 或空白/NUL；否则回落 `/`。GET 与 POST 两条路径统一走同一函数（此前 GET 页面的 `next` 甚至没做任何校验）。

**回归**：`//evil.example/x`、`/\evil.example/x`、`https://evil.example/` 全部 302 → `/`；站内 `next=/admin`、`next=/admin?tab=1` 正常保留。

### 4.2 安全：伪文件系统子路径可浏览（高危）

**位置**：`server.mjs:183` `browseHidden()`

**根因**：`BROWSE_HIDDEN.includes(real)` 是**精确匹配**，只挡住 `/proc`、`/sys`、`/dev`、`/run` 本身；`/proc/self`、`/proc/1`、`/sys/kernel`、`/dev/shm` 全部返回 200，可枚举进程与内核信息。

**修复**：改为按「目录及其所有子路径」判断——`BROWSE_HIDDEN.some((p) => isInside(p, real))`，与同一函数里 `DATA_ROOT/state`、`DATA_ROOT/audit`、其它用户目录的判定方式一致。

**回归**：`/proc`、`/proc/self`、`/proc/1`、`/sys/kernel`、`/dev/shm` 均 403；`/`、`/tmp`、`/etc`、`/var`、`/usr` 仍 200（`browse-check.mjs` 确认没有误伤正常浏览）。

### 4.3 功能：路径闸门把所有字符串参数当路径，误拒正常内容（影响最大）

**位置**：`server.mjs:496` `CHANNEL_PATHS` 表（`:501` 起）/ `:542` `assertPathInside()` / `:570` `jailCheck()`

**根因**：旧 `jailCheck` 递归扫描**所有**字符串参数，凡以 `/` 开头就要求落在受信根内。于是：

- `fs:write-file(path, '/slash-start')`、`/* C comment */`、`// js comment` 等内容被当成越界路径，**无法写入**；
- `git:commit(repo, '/slash-start subject\n\nbody')` 提交信息被拒，**无法提交**；
- `git:stage`、`git:create-branch` 等含 `/` 的分支名/路径同样被误判。

这是「安全校验过度导致功能不可用」，属于真实可复现缺陷（`git-e2e` 修复前 6/10 失败）。

**修复**：显式登记每个 fs/git 通道**哪个参数是路径**（`one` 单个 / `many` 数组），只校验这些位置。33 个已注册通道全部登记，覆盖核对由 `channel-coverage.mjs` 守住（新增通道漏登记会立刻失败）。未登记的新 fs/git 通道仍退回旧的逐项全扫（保守兜底），`git:commit` / `git:set-config` 的消息、配置值、分支名不再当路径。

**回归**：以 `/` 开头的内容写入+读回成功；`git:commit` 消息含 `/` 与 `//` 成功提交；`git:stage` / `git:branches` / `git:log` 端到端可用；同时 `fs:read-dir /etc`、`fs:read-file /etc/passwd`、`fs:write-file /etc/...`、`git:status /etc`、`git:stage [ws/../escape.txt]` 仍被拒绝。

### 4.4 安全：终端 `cwd` 可逃出工作区（高危，探针阶段新发现）

**位置**：`server.mjs:557` `assertTerminalCwdInside()`，由 `jailCheck()` 对 `terminal:create` 调用

**根因**：`terminal:create` 把 `cwd` 直接交给 worker 里的 PTY（`apps/desktop/src/main/services/terminal.ts:96`），**不经过** fs 通道那层 `fs-guard`。旧闸门只校验绝对路径字符串，因此：

- 相对路径 `../../../../../../etc` 被直接放行（PTY `pwd` 实测为 `/etc`）；
- 工作区内一个指向 `/etc` 的符号链接同样被放行。

**修复**：对 `terminal:create` 单独走真实路径校验——按 worker 的 cwd（即用户工作区）解析相对路径，`realpath` 解开符号链接，再与各受信根的 `realpath` 比对；越界抛 `路径超出本用户工作区`。该函数为 async，`jailCheck` 与调用点同步改为 `await`。

**回归**：相对路径逃逸、符号链接逃逸均被拒；工作区内正常 cwd 仍可建终端；`fs:*` 的符号链接逃逸仍由 worker 的 `assertInside` 拦住（双保险）。

### 4.5 HTTP 语义：畸形百分号编码返回 500（低危）

**位置**：`server.mjs:459` 起静态托管的路径解码（`decodeURIComponent` 在 `:463`）

**根因**：`decodeURIComponent(urlPath)` 未捕获 `URIError`，`/%E0%A4%A` 这类畸形转义直接抛异常落进 500，实为客户端错误。

**修复**：`try/catch` 解码，失败返回 `400 {"error":"bad request path"}`；解码与去前缀逻辑拆开，正常路径行为不变。

**回归**：`/%E0%A4%A` → 400；正常静态资源仍 200。

### 4.6 文档：验证结果数字过期（无代码影响）

`apps/web/README.md:237`、`apps/web/docs/web-migration.md:107` 记录的冒烟结果仍是 `pass=11 fail=0`，实际 `test/smoke.mjs` 已稳定 14 项。已更正为 `pass=14 fail=0`，并复核无误。

附带清理（不影响行为）：`injectIndex` / `serveStatic` 去掉未使用的 `username` 参数，移除未使用的 `escapeHtml` 导入；删除仓库根遗留的临时文件 `smoke.txt`（由冒烟脚本写出，未被 .gitignore 覆盖）。

### 4.7 功能：网页端 favicon 缺失（收尾补充修复）

**诊断（实测，非推断）**：修复前 `apps/web` 里既没有任何 favicon 文件，`apps/desktop/src/renderer/index.html` 也没有 `<link rel="icon">`。登录后请求实测：

```
/favicon.ico -> 404 {"ok":false,"error":"not found"}
/favicon.svg -> 404
/index.html 的 <link> 只有 modulepreload + 2 个 stylesheet + mobile.css/picker.css
```

未登录时更糟：`/favicon.*` 先命中登录墙，`302 → /login?next=%2Ffavicon.svg`，浏览器拿不到图标。**结论：缺的是浏览器标签页 favicon（站点图标），不是 UI 内图标**——UI 里的图标 `cf-about__icon` 走 `import devaIcon from '../../../../build/icon.svg'`，Vite 已内联成 `data:image/svg+xml,...` 进入 `index-feRGkUOb.js`，构建产物里存在，未缺失。

**修复（沿用工程现有静态资源方式，零新依赖）**：

- `apps/web/src/web/favicon.svg`：复用 `apps/desktop/build/icon.svg` 的工程标识（indigo→violet 圆角底板 + 白色 D 形），与 `src/web/` 下 `mobile.css` / `picker.js` 同一目录。
- `apps/web/src/web/favicon.ico`：复制 `apps/desktop/build/icon.ico`（7 帧，16–256）作为不支持 SVG favicon 的旧浏览器兜底。
- `server.mjs`：`serveStatic` 改为 `WEB_ASSETS` 白名单 + 按扩展名取 MIME（SVG 不再被当成 JS）；`/favicon.*` 路由放在鉴权**之前**，只接受 GET/HEAD；`injectIndex` 注入两条 link。
- `src/server/pages.mjs`：`ICON_LINKS` 常量，登录页 / 管理页 / 错误页三处头部一并引用（这三页不是 renderer 产物，必须单独加）。
- 不需要改构建配置：图标是 Web 层静态资源，`build.mjs` 不管，Dockerfile 已有 `COPY /src/apps/web/src /app/src`。
- 因此 `apps/web/dist/` 里**不会**出现 favicon（那目录只放 esbuild 的 `shim.js` / `backend.cjs` / `pty-host.js`）；图标的“被打出”体现为镜像里 `/app/src/web/favicon.*` 存在且可被服务端读到——这一点用下面的产物布局复刻实测。

**产物核对（不是只看源码目录）**：按 Dockerfile runtime 阶段的实际 `COPY` 布局，在 `/tmp/deva-runtime-sim` 复刻出 `app/{server.mjs,package.json,dist/,src/}` + `src/apps/desktop/out/renderer/`（不含仓库其余部分），在该目录起服务（PORT=7095）：`/favicon.svg` → `200 image/svg+xml`、`/favicon.ico` → `200 image/x-icon`，响应体 sha256 与仓库文件逐字节相同（`d0eb27a9…` / `e6164595…`）。说明镜像里即使没有仓库源码树，图标也能被 `here/src/web` 解析到。UI 内图标走 Vite 内联（`index-feRGkUOb.js` 里的 `data:image/svg+xml`），不依赖任何静态文件路径，因此不受改动影响。

**回归**：`out/icon-check.mjs` 15 项——修复前 0/15，修复后 15/15。`GET /favicon.svg → 200 image/svg+xml 761B`，`GET /favicon.ico → 200 image/x-icon 12567B`（文件头 `00 00 01 00`），`POST /favicon.ico → 405`，登录页/首页/管理页/403 页 HTML 均含 `rel="icon"`。证据见 `logs/08-icon-regression.txt`。

**渲染级核对（确认不是空白占位）**：`.ico` 含 7 帧（16/24/32/48/64/128/256，均 32bpp）；解出最大帧（PNG 压缩的 256×256 RGBA）后目视确认画面为紫色渐变圆角底板 + 白色 D 形感叹号，采样 57 种颜色（`#ffffff` 与 `#6640e9` 渐变系为主）。导出的帧另存为 `favicon-256-preview.png`，可直接打开核对。`.svg` 为同几何的矢量版（761B，含 `<svg>` 根节点与线性渐变定义）。

**一处未做的取舍**：`apps/desktop/src/renderer/index.html` 本身没有加 `<link rel="icon">`。桌面端（Electron）窗口图标由 `BrowserWindow` 的 icon 决定，这个 HTML 也被桌面端复用；把 Web 的 `/favicon.svg` 绝对路径写进源头 HTML 会让桌面端多一个无意义请求。因此只在 Web 侧 `injectIndex` 与三个服务端渲染页面注入，桌面端产物保持原样。

### 4.8 工程：lint 工具链缺失 → 引入并让当前代码真实通过

**原始状态**：仓库没有任何 lint 配置与 `lint` 脚本（§7.1）。直接引入 ESLint 推荐集后，当前代码报出 **30 problems（29 errors / 1 warning）**，全部是真问题，没有一条是靠关规则消掉的：

| 文件 | 问题 | 根因修法 |
|---|---|---|
| `apps/desktop/src/main/index.ts:317` | `no-unused-expressions`（三元表达式当语句用） | 改写为 `if/else` |
| `apps/desktop/src/main/services/ask-questions.ts:39` | `no-useless-escape`：`[…\.。:：\s]` 里 `\.` 多余 | 合并进字符类（`.tmp` 里做过等价性证明） |
| `apps/desktop/src/main/services/frontmatter.ts:153` | `no-useless-escape`：`\[` 多余 | 改为 `[:#[\]]{}"'\n]` |
| `apps/desktop/src/main/services/{attachments,remote/web/files,remote/telegram}.ts` | `no-control-regex` | 三处正则**就是要匹配控制字符**（清理脏字节），逐行加 `eslint-disable-next-line` 并写明理由 |
| `apps/desktop/src/preload/index.ts:1253` | `@typescript-eslint/ban-ts-comment`（`@ts-ignore`） | 移除 `@ts-ignore`，改为文件末尾 `declare global { interface Window { deva: DevaApi } }`——顺带让 preload 的类型真正闭合 |
| `apps/desktop/src/renderer/src/redesign/{Rail,attachments,Conversation}.tsx` | `exhaustive-deps` / `no-irregular-whitespace` | `setQuery` 经 ref 取最新实现（放进依赖会改变「切 tab 保留搜索词」的行为）；`exitSelect`/`patchLocal`/`setterFor` 改 `useCallback` 后入依赖；注释里的全角空格改为说明文字 |
| `apps/desktop/src/renderer/src/store/chat.tsx` | 两处 `_stale` / `_persisted` 解构丢弃、`exhaustive-deps` | 新增 `omitModel()` 只去掉 `model` 键；`streamStatus` 用 `useMemo` 固化引用；`isMemberSession` 改 `useCallback` 并补依赖 |
| `apps/desktop/src/renderer/src/store/extensions.tsx` | `exhaustive-deps` | `setterFor` / `patchLocal` 改 `useCallback` 后入依赖 |
| `apps/desktop/src/renderer/src/redesign/Conversation.tsx:571` | 遗留的无效 disable 指令 | 随 `exitSelect` 改造一并删除 |
| `apps/web/{build.mjs,src/backend/chromium.mjs,src/electron-shim.js,src/web/picker.js}` | 未使用的导入/变量、多余 `catch` 绑定 | 直接删除 |
| `plugins/deva-agent/{lib/*,tests/*}` | 未使用的参数/导入、`agent.test.mjs` 里多余的回调参数 | 删除未用项；测试里 `model: async request =>` 改为 `async () =>` |

**规则取舍（不是「关掉整个包」）**：
- `no-irregular-whitespace` 开 `skipRegExps/skipStrings/skipTemplates`：本仓库有「清理零宽字符」的正则与用全角空格分隔的模板字符串，字符本身是被处理对象。
- `no-unused-vars` 用 `argsIgnorePattern: '^_'`、`caughtErrors: 'none'`：与代码既有约定一致（`_` 前缀显式表示「故意不用」）。
- TS 文件用 `@typescript-eslint/no-unused-vars` 替换基础规则，避免同一处重复报错；`react-hooks` 两条规则 `error` 级，只作用于 renderer / mobile。
- 未引入任何风格类规则（格式化、命名、复杂度），仓库没有既有风格约定。

**结果**：`pnpm lint` exit=0，0 problems。基线 30 problems 见 `logs/11-lint-before.txt`，修后见 `logs/12-lint-after.txt`。配置在仓库根 `eslint.config.mjs`，根 `package.json` 新增 `"lint": "eslint ."`，CI 已接入。

**关于 disable 指令的准确账目**（`git grep` / `grep -r` 实测）：

| 项 | 数量 |
|---|---|
| 基线 HEAD 已有 `eslint-disable*` | 29（28 个 `next-line` + 1 个 `line`，几乎全是 `react-hooks/exhaustive-deps`） |
| 本轮新增 | **3**（全部是 `no-control-regex`，逐行带 `-- 理由`：两处清理文件名控制字符、一处 `\u0000` 作内部定界符） |
| 本轮删除 | 1（`Conversation.tsx:571` 那条无效的 exhaustive-deps disable，随 `exitSelect` 改 `useCallback` 一并移除） |
| 当前工作区总数（不含构建产物） | 31 = 29 − 1 + 3 ✅ |

即：**本轮没有靠新增 disable 来让 lint 变绿**；基线那 28 条 `react-hooks` disable 是仓库原有约定，本轮未动也未被用来掩盖新问题。

### 4.9 工程：回归脚本在 `DEVA_WEB_ROOTS` 部署下的误报

**现象**：`smoke.mjs` 与 `probe.mjs` 的「跨用户路径被拒绝」只认错误文案含「超出」。默认部署（用户只有自己的 workspace）走网关 `assertPathInside`，文案是「路径超出本用户工作区」；配了 `DEVA_WEB_ROOTS` 时路径在共享根内，网关放行，由后端 `fs-guard.ts` 的「拒绝访问：路径不在已打开的项目内」拦下。**仍然被拒绝，但断言误判为 FAIL**（实测 smoke 14→13、probe 30→29）。

**修复**：断言改为「请求失败 且 文案命中两道闸门之一」（`/超出|拒绝访问/`），并在注释里说明为什么有两种文案。修后两种部署形态都 14/0、30/0（`logs/13-ci-equivalent.txt` 末尾）。

### 4.10 工程：`backend-pool.invoke()` 重复登记与定时器泄漏

**位置**：`apps/web/src/server/backend-pool.mjs:149`（原实现）。

**问题**：`entry.pending.set(id, {resolve, reject})` 之后又把同一 id 覆盖成包装对象，外层 `resolve/reject` 被丢弃；包装函数 `clearTimeout(timer)` 之后调用的是 `wrap.resolve`，而 `wrap` 正是被覆盖掉的那一条。结果：每次 `invoke` 都会留下一个 10 分钟的定时器（虽然 `unref()` 不会阻止进程退出，但每条调用都挂一个），且多一层无意义的间接。

**修复**：一次性登记带 `clearTimeout` 的 `{resolve, reject}`，`timer` 在超时分支里自行删除条目。行为不变（超时 10 分钟、后端退出时 reject 全部 pending），只是去掉重复包装。修后 `probe`（30 项，含大量通道调用）、`git-e2e`（10 项）与全部冒烟均通过。

### 4.11 文档：通道数与模块数过期

`/api/channels` 实测 `count=162`，启动日志 `ready: 162 channels`；`apps/web/src/backend/index.ts` 有 22 个 `step()`。旧文档写「154 个通道 / 21 个模块」。已同步 `apps/web/README.md`（2 处）与 `apps/web/docs/web-migration.md`（4 处）。这是文档与实现的偏差，不是代码缺陷。

---

## 5. 验证证据文件索引

| 文件 | 内容 |
|---|---|
| `logs/01-install.txt` | pnpm install --frozen-lockfile，exit=0 |
| `logs/02-typecheck.txt` | tsc node + web，exit=0 |
| `logs/03-build-desktop.txt` | electron-vite build，exit=0 |
| `logs/04-build-web.txt` | esbuild 三产物，commit=109937f，exit=0 |
| `logs/05-typecheck-web-backend.txt` | 已知限制复现：4 条 TS2305，exit=2 |
| `logs/06-startup.txt` | 模块逐项 ok（22 行，含 window channels / mcp autoconnect）、154 channels、healthz 200 |
| `logs/07-rerun-after-rename.txt` | 目录改名到 `out/` 后全部脚本复跑：30/0、10/0、9/0、4/0、15/0、14/0；含“仓库根调用 / `cd out` 内调用”两种方式 |
| `logs/08-icon-regression.txt` | 图标回归：修复前 0/15 → 修复后 15/15，含 HTTP 头实测、产物布局复刻与哈希核对 |
| `logs/09-final-verification.txt` | 第一轮收尾后整体复跑（typecheck、web build、82 项回归全 PASS） |
| `logs/10-web-typecheck-before.txt` | 第二轮：Web 层类型检查缺口复现（4 × TS2305，exit=2） |
| `logs/11-lint-before.txt` | 第二轮：同一份 lint 配置跑 HEAD 代码 → 30 problems |
| `logs/12-lint-after.txt` | 第二轮：修复后 `pnpm lint` → 0 problems |
| `logs/13-ci-equivalent.txt` | 第二轮：CI 两个 job 的等价命令本地逐步复跑；含共享 roots 场景 |
| `logs/14-final-full-run.txt` | 第二轮收尾整体复跑：install/lint/typecheck/build/web build/node --check + 82 项 + 插件 158 项 |
| `logs/15-round2-summary.txt` | 第二轮三项工程缺陷与顺带修复的汇总 |
| `logs/16-web-typecheck-final.txt` | 第二轮收尾：`apps/web` 独立类型检查 exit=0；移走 `electron-shim.d.ts` 后复现 4 × TS2305 / exit=2；`--listFiles` 统计 118 个 `apps/desktop/src/main` 文件 |
| `logs/17-lint-web-final.txt` | 第二轮收尾：Web 层 lint before/after（apps/web 4 error → 0；全仓 30 problems → 0，345 个文件） |
| `logs/18-docker-attempt.txt` | 第二轮收尾：Docker 实测尝试的完整命令与原始报错（client 有、daemon 不可用、无 compose 插件）；compose 文件 `js-yaml` 静态解析通过 |
| `logs/19-final-full-run-round2-close.txt` | 第二轮收尾整体复跑（与 CI 两 job 同命令）：install / lint / typecheck（desktop+web）/ 两处 build / `node --check` 71 个 / 启动自检 22 步 + 162 channels / 6 个回归脚本 82 项 / 插件 158 项 → `OVERALL_FAIL=0` |
| `logs/20-final-full-run-round2-close.txt` | 用可复用脚本 `out/final-run.sh` 再跑一遍同样流程（脚本自身 exit=0），作为「一条命令可复现」的最终证据 |
| `logs/21-version-check-before.txt` | 第三轮：版本一致性断言修复前 → desktop 0.1.16 / web 0.1.15，exit=1 |
| `logs/22-version-check-after.txt` | 第三轮：统一后断言 exit=0；lockfile `md5sum -c` OK（版本改动不产生 lockfile diff）；版本读取链路 4 处 grep |
| `logs/23-desktop-tests-pass.txt` | 第三轮：`pnpm test:desktop` 全量通过（179 项，18 个测试文件） |
| `logs/24-desktop-tests-negative.txt` | 第三轮：负向验证（改坏一条断言）→ 178 pass / 1 fail / exit=1，随后恢复并 `cmp` 确认一致 |
| `logs/25-docker-static-check.txt` | 第三轮：Docker 资产静态校验 77 项全 PASS；附本机 `docker info` / `docker build` 的原始报错（无守护进程） |
| `logs/26-desktop-tests-node22.txt` | 第三轮：同一套单测在 Node 22.22.0（= ci.yml 的 node-version）下 179/179 通过 |
| `logs/27-desktop-coverage.txt` | 第三轮：desktop 247 个源文件的导入边界统计（92 可导入 / 155 不可，按 4 类原因归类）与已测模块清单 |
| `logs/28-final-full-run-round3-close.txt` | 第三轮收尾整体复跑：install / lint / check:versions / test:desktop / typecheck×2 / build×2 / node --check 71 / 启动自检 22 步 + 162 channels / 6 个回归脚本 82 项 / Docker 静态 77 项 / 插件 158 项 → `OVERALL_FAIL=0` |
| `docker-check.mjs` | Docker 资产静态校验脚本（Dockerfile 阶段与 COPY 源、builder 产物路径、compose 契约、CI 是否真有 docker job） |
| `desktop-coverage.mjs` | desktop 源码「能否被 Node 原生导入」的边界统计脚本，用来说明未覆盖模块的原因 |
| `final-run.sh` | 整体复跑脚本：`bash out/final-run.sh`（可用 `PORT=` 覆盖端口）；CI 两个 job 的命令都在里面 |
| `probe.mjs` / `probe-before.txt` / `probe-after.txt` | 30 项缺陷探针：pass 15 / fail 15 → 30/0 |
| `git-e2e.mjs` / `git-before.txt` / `git-after.txt` | Git 端到端：4/6 → 10/0 |
| `smoke.mjs`（apps/web/test） | 冒烟：14/0（前后一致） |
| `channel-coverage.mjs` / `.txt` | 33 个 fs/git 通道的路径参数登记覆盖 4/0 |
| `browse-check.mjs` / `browse-regression*.txt` | 浏览范围正/负向回归 6/3 → 9/0 |
| `icon-check.mjs` / `icon-before.txt` / `icon-after.txt` | favicon 回归：0/15 → 15/0 |
| `favicon-256-preview.png` | 从 `.ico` 解出的 256×256 帧，用于目视确认图标非空白 |
| `server.baseline.mjs` | 修复前实现复刻（仅用于对照，需复制进 `apps/web/` 才能跑） |
| `server-fix.diff` | 基线 → 修复后完整补丁 |
| `typecheck-web-backend.sh` | 复现 5(1) 中已知限制的脚本 |

---

## 6. 改动面（未超出修复范围）

```
apps/web/server.mjs                         +135 / -28（6 处缺陷修复 + favicon 路由 + 清理；`git diff --no-index` 统计）
apps/web/src/server/pages.mjs               +8（ICON_LINKS 常量 4 行 + 空行 + 登录页/管理页/错误页 3 处引用）
apps/web/src/web/favicon.svg                新增（复用 build/icon.svg 的工程标识）
apps/web/src/web/favicon.ico                新增（复制 build/icon.ico，旧浏览器兜底）
apps/web/README.md                          1 行（pass=11 → pass=14）
apps/web/docs/web-migration.md              1 行（pass=11 → pass=14）
apps/web/test/…、apps/desktop/…             未改动
.gitignore                                  新增 `!/out/`（根目录证据目录需要入库）
out/                                        新增（探针、端到端、基线、日志、报告）
```

> 说明：`out/` 原名 `verification/`，按收尾要求整体改名。仓库原有 `.gitignore` 的 `out/` 规则本意是构建产物（`apps/desktop/out/`），加 `!/out/` 只放行根目录这一个，`apps/desktop/out/` 仍被忽略（已用 `git check-ignore` 双向确认）。

以下未提交改动在本次会话开始前就已存在于工作区，**不是本次修复引入**，仅确认其不破坏构建与类型检查：`apps/desktop/src/main/services/git.ts`（`LC_ALL=C.UTF-8` + `core.quotepath=false`，修中文路径乱码）、`package.json`（`build:web` / `start:web`）、`pnpm-lock.yaml`（`apps/web` importer）、`.gitignore`（`.tmp/`）、`.dockerignore`、`apps/web/` 整体，以及 `plugins/deva-agent/lib/{agent,mcp,tools,model,loop,memory}.mjs` 与对应测试的功能性改动（该分支的进行中工作）。

### 6.1 第二轮改动的文件清单

| 文件 | 改动 | 类别 |
|---|---|---|
| `eslint.config.mjs` | 新增 | 工具链 |
| `package.json` | `lint` 脚本；`typecheck` 串联 web；eslint 相关 devDeps | 工具链 |
| `apps/web/tsconfig.backend.json` | 新增 | 类型检查 |
| `apps/web/src/backend/electron-shim.d.ts` | 新增（模块增强） | 类型检查 |
| `apps/web/package.json` | `typecheck` 脚本 + `typescript` devDep | 类型检查 |
| `apps/desktop/src/preload/index.ts` | 去掉 `@ts-ignore`，补 `declare global` | 类型闭合 |
| `apps/desktop/src/main/index.ts` | 三元语句 → `if/else` | lint 根因 |
| `apps/desktop/src/main/services/ask-questions.ts` | 去掉多余转义 | lint 根因 |
| `apps/desktop/src/main/services/frontmatter.ts` | 去掉多余转义 | lint 根因 |
| `apps/desktop/src/main/services/{attachments,remote/web/files,remote/telegram}.ts` | 3 处控制字符正则加行级 disable + 理由 | lint（合理豁免） |
| `apps/desktop/src/renderer/src/redesign/{Rail,attachments,Conversation}.tsx` | 依赖修复、全角空格、删无效 disable | lint 根因 |
| `apps/desktop/src/renderer/src/store/{chat,extensions}.tsx` | `omitModel` 助手、`useCallback` 化、`streamStatus` memo、依赖补全 | lint 根因 |
| `apps/web/{build.mjs,src/backend/chromium.mjs,src/electron-shim.js,src/web/picker.js}` | 删除未使用的导入/变量 | lint 根因 |
| `plugins/deva-agent/{lib,tests}` | 删除未使用的参数/导入（仅 8 个文件的小改，不含功能性改动） | lint 根因 |
| `apps/web/src/server/backend-pool.mjs` | `invoke()` 单次登记 pending + 清定时器 | 真实缺陷 |
| `apps/web/test/smoke.mjs`、`out/probe.mjs` | 跨用户断言兼容两种闸门文案 | 真实缺陷 |
| `apps/web/README.md`、`apps/web/docs/web-migration.md` | 154 → 162、21 → 22 | 文档 |
| `.github/workflows/ci.yml` | `check` + `web-e2e` 两个 job | CI |
| `.gitignore` | 根 `out/` 放行 `*.mjs` / `*.md`（CI 要用脚本） | 配套 |
| `out/logs/16`–`19` | 收尾新增证据：类型检查负向验证、Web 层 lint 前后、Docker 实测报错、整体复跑 | 证据 |

未改动：`apps/web/server.mjs`（本轮零改动）、`apps/desktop/src/main/services/*` 除上表所列之外的任何文件、所有业务逻辑与 UI。

---

## 7. 未修复 / 无法修复项（及原因，含第二轮最新状态）

> 第二轮已把原 7.1 / 7.2 / 7.3 三项工程缺陷修掉，并新增 7.7（文档过期）作为已修项。7.4 / 7.5 / 7.6 保持不动，理由见下。

### 7.1 仓库内没有 Lint 工具链 —— **已修（第二轮）**

引入 `eslint.config.mjs`（ESLint 9 flat config + typescript-eslint + react-hooks），根 `package.json` 增加 `"lint": "eslint ."`，CI 已接入。基线 30 problems 全部为真实问题，逐条根因修复（详见 §4.8），仅 3 处控制字符正则按行加 disable 并写明理由。**现在 `pnpm lint` exit=0、0 problems。**

Web 层单独统计（`logs/17-lint-web-final.txt`）：基线 `apps/web` 有 4 条 error（`build.mjs` 未用的 `createRequire`、`chromium.mjs` 未用的 `sleep`、`electron-shim.js` 未用的 `pending` / `nextId`）→ 现在 `eslint apps/web` 覆盖 17 个文件，**errors=0 warnings=0，exit=0**。三条未用变量均已按根因删除而非加豁免。证据：`logs/11-lint-before.txt`、`logs/12-lint-after.txt`、`logs/17-lint-web-final.txt`。

### 7.2 `apps/web/src/backend/index.ts` 无法单独类型检查 —— **已修（第二轮）**

- 新增 `apps/web/src/backend/electron-shim.d.ts`：用 `declare module 'electron'` 把 shim 额外提供的 `setEventSink / __invoke / __send / __listChannels / __events` 合进 Electron 的类型声明。这是**模块增强**，tsc 会真正校验（移除该文件立即重现 4 条 TS2305，见负向验证）。
- 新增 `apps/web/tsconfig.backend.json`（`noEmit`，`paths` 把 `@deva/main/*` 指到 `apps/desktop/src/main/*`），include 只有 `src/backend/index.ts` 与该 `.d.ts`。
- `apps/web/package.json` 增加 `"typecheck": "tsc --noEmit -p tsconfig.backend.json"`（含 `typescript` devDep）；根 `pnpm typecheck` 已串联 desktop 与 web 两包。
- 结果：`pnpm typecheck` exit=0，`--listFiles` 显示实际加载 118 个 `apps/desktop/src/main/**` 文件 + 2 个 web 文件。没有任何 `@ts-ignore` / `skipLibCheck` 之外的抑制。证据：`logs/10-web-typecheck-before.txt`（修复前 4 × TS2305，exit=2）、`logs/16-web-typecheck-final.txt`（收尾实测：修复后 exit=0；再次移走 `.d.ts` 仍能复现 4 条 TS2305，exit=2，恢复后 exit=0）。

### 7.3 CI 未覆盖 Web 层 —— **已修（第二轮）**

`.github/workflows/ci.yml` 改为两个 job：

- `check`：install → `node --check`（已入库全部 js/mjs，目前 71 个）→ `pnpm lint` → `pnpm typecheck` → `pnpm build` → `pnpm --filter @deva/web build` → 插件单测（158 项）。
- `web-e2e`：起真实 Web 实例（无需 Chromium，`ensureBrowser` 是惰性的；终端用 `@lydell/node-pty` 的 linux-x64 预编译包，无编译步骤）→ `smoke`（含 PTY 回显与用户隔离）→ `probe` / `git-e2e` / `channel-coverage` / `browse-check` / `icon-check`，失败时打印服务日志。

**明确跳过的部分**（写在 workflow 末尾注释里，不执行、不伪装成已覆盖）：
- 浏览器能力断言：需要真正启动 Chromium 打开网页，runner 无预装；现有探针与冒烟本身也不含浏览器断言，因此不存在「写着覆盖其实没跑」的情况。
- Docker 镜像：本机无 docker 守护进程（见 7.5）。

**本地等价验证**：两个 job 的每一步都在本机用同样的命令跑过（`logs/13-ci-equivalent.txt`、`logs/19-final-full-run-round2-close.txt`），check 全绿、web-e2e 6 个脚本合计 82 项全 PASS、`OVERALL_FAIL=0`。GitHub 上的 ubuntu-latest 与本地差异只有操作系统镜像版本，依赖均为 npm 上的公共预编译包，不涉及本机特有能力。

**没有 CI runner 时如何自证 workflow 配置本身没写错**：
1. `js-yaml` 解析 `.github/workflows/ci.yml`，确认结构可解析 → `jobs: check,web-e2e`；`check` 10 步无依赖，`web-e2e` 10 步 `needs=check`。语法错的 YAML 在这一步就会报。
2. 逐个把 workflow 里的 `run:` 命令原样抄到本地 shell 执行（`logs/19-final-full-run-round2-close.txt` 就是这套命令的逐条输出），因此 Step 名称与实际命令的一致性也能核对。
3. CI 引用的 `out/*.mjs` 必须在干净检出里存在：`git add -An out` 显示 `out/probe.mjs`、`out/git-e2e.mjs`、`out/channel-coverage.mjs`、`out/browse-check.mjs`、`out/icon-check.mjs` 都会被加入版本库（`git check-ignore -v out/probe.mjs` 命中 `.gitignore:15:!/out/*.mjs` 的放行规则），不存在「CI 上找不到脚本」的问题。
4. workflow 不执行的浏览器/Docker 断言已用注释显式声明，不写 `continue-on-error` 之类掩盖失败，也不加 `|| true` 让脚本假通过。

> 说明：本环境没有 GitHub Actions runner，所以「workflow 在 GitHub 上真的跑起来」无法在此自证；能自证的是 YAML 结构、命令可执行、脚本存在于版本库、以及每一步在本地得到相同结果。

### 7.4 Agent 文件工具绕过网关闸门 —— **保持不改（产品设计，非缺陷）**

`fs:*` / `git:*` / `terminal:create` 的闸门在网关；Agent 自己调用的文件工具走主进程服务，不经网关（README「安全边界」第 3 条已写明，桌面版同样不限制）。这意味着**同一实例内的不同用户之间**，Agent 侧仍有越界能力。这是产品设计取舍，不是可「修」的 bug——收紧它等于改变 Agent 的能力边界；正确做法是部署侧一人一容器（README 已给出）。**判定：不是可修缺陷。**

### 7.5 Docker 镜像 —— **已进 CI（第三轮），本机仍无法实跑**

本环境只有 Docker 客户端，没有可用的守护进程；也没有 compose 插件。实际尝试的命令与原始输出（完整版见 `logs/18-docker-attempt.txt`）：

```
$ docker --version
Docker version 26.1.5+dfsg1, build a72d7cd              # exit=0，client 存在

$ docker info
Server:
ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
                                                         # exit=1

$ ls -l /var/run/docker.sock
ls: cannot access '/var/run/docker.sock': No such file or directory   # exit=2
$ ps aux | grep -c '[d]ockerd'
0                                                        # 没有守护进程在跑

$ docker build -f apps/web/Dockerfile apps/web
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
                                                         # exit=1（构建无法开始）

$ docker compose version
docker: 'compose' is not a docker command.               # exit=1，无 compose 插件
$ docker-compose -f apps/web/docker-compose.yml config
docker-compose: command not found                        # 也没有独立二进制
```

能做的静态自证：`apps/web/docker-compose.yml` 用 `js-yaml` 解析通过（`services: deva-web`，exit=0），`apps/web/Dockerfile` 首行 `# syntax=docker/dockerfile:1` 结构正常——即失败的原因不是文件本身写错，而是**运行时缺守护进程**，属于环境限制。

**第三轮的处置**：

- `.github/workflows/ci.yml` 新增 `docker` job（`docker/setup-buildx-action@v3` + `docker/build-push-action@v6`，`context: .`、`file: apps/web/Dockerfile`、`push: false`、`load: false`、GHA 缓存）。镜像能否真正构建由这个 job 证明。**本机没有跑过、也无法跑**——`docker build -f apps/web/Dockerfile -t deva-web:ci-check .` 的原始输出仍是 `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`（见 `logs/25-docker-static-check.txt`）。
- 本机能做的只有静态校验，已固化成 `out/docker-check.mjs`（77 项全 PASS）：Dockerfile 阶段声明与 `--from` 指向、每个上下文 COPY 源「存在 + 被 git 跟踪 + 未被 .dockerignore 排除」、builder 产物路径与本地 `pnpm build` 的实际输出一致、ENTRYPOINT 脚本的 shebang/可执行位/降权与 `exec`、compose 的 `build.context`/端口/`no-new-privileges`/`shm_size` 与 EXPOSE 对齐、以及「CI 里确实有构建镜像的 job 且 `push: false`」。
- 这些静态断言**不能**代替真构建：`RUN pnpm install` 能否在 `node:20-bookworm-slim` 里跑通、原生模块编译、Chromium 安装、镜像层路径，都只有 GitHub runner 那次执行能证明。报告不把静态校验算作「镜像已验证」。
- **仍未覆盖**：容器运行期（entrypoint 降权、`/data` 属主修正、HEALTHCHECK 真跑）。CI 的 docker job 只构建不启动容器，本机也没有 daemon，这一块目前既无本地实测也无 CI 覆盖，已在 `ci.yml` 末尾注释中声明。

### 7.6 其它残留风险（已记录，未改）

1. **未登记的新 fs/git 通道**会退回「全字符串扫描」兜底：不会漏拦路径，但可能误伤以 `/` 开头的内容。`channel-coverage.mjs` 可在注册新通道时立即发现（已进 CI），建议新通道一并补 `CHANNEL_PATHS`。
2. **`BROWSE_TOP` 默认 `/`**：登录用户可浏览 `/etc` 等本机目录（与桌面版系统对话框一致，README 已说明）。需要收窄时设 `DEVA_WEB_BROWSE_TOP=/projects`。**改默认值会改变既有部署行为，属于部署取舍而非缺陷，未改。**
3. **`apps/desktop` 单测覆盖有限 —— 已补（第三轮）**：18 个测试文件、179 项，覆盖 fs-guard 受信根（`..` / 符号链接 / 新建文件）、通道参数校验与错误分支、DSML 恢复、SSE 分帧与空闲看门狗、原子写失败分支、shell 解析、配置与协议解析等纯逻辑模块。仍有 155 个源文件无法被 Node 原生导入（84 个 `.tsx`/renderer/preload 需 bundler 或 DOM、32 个目录导入、22 个缺 electron 命名导出、17 个参数属性等），逐类清单见 `logs/27-desktop-coverage.txt`；这些模块目前仍只靠构建 + 类型检查 + 端到端探针兜底。
4. **包版本号不一致 —— 已修（第三轮）**：`apps/web/package.json` 由 `0.1.15` 改为 `0.1.16`，与 `apps/desktop/package.json` 对齐（desktop 是唯一事实源）。`pnpm-lock.yaml` 的 `md5sum` 前后一致——lockfile v9 的 `importers` 只记录依赖，不记录包自身 version，所以该改动不产生 lockfile diff；工作区里那份 `+718/−3` 的 lockfile diff 来自前几轮新增的 eslint / typescript-eslint / web typescript 依赖，与本项无关。另加 `out/check-versions.mjs`（零新依赖）与根脚本 `pnpm check:versions`，并接进 CI 的 `check` job。

### 7.7 文档数字过期（154 → 162）—— **已修（第二轮）**

`apps/web/README.md`（2 处）与 `apps/web/docs/web-migration.md`（4 处）把通道数写作 154、模块数写作 21。实测 `/api/channels` 返回 162、`ready: 162 channels`，`step()` 调用 22 个。已按实测值更正。这是文档与实现的偏差，不是代码缺陷。

---

## 8. 最终结论

- 修复前：`probe` 15/30、`git-e2e` 4/10、`browse` 6/9、`icon-check` 0/15 通过；4 个安全问题（开放重定向、伪文件系统可浏览、终端 cwd 逃逸 ×2 形态）、1 个功能性阻塞（内容/提交信息被误判为越界路径）与 1 个页面图标缺失（`/favicon.*` 404 + 被登录墙 302、页面无 `rel="icon"`）**均可稳定复现**。
- 修复后：`probe` 30/30、`git-e2e` 10/10、`browse` 9/9、`smoke` 14/14、`channel-coverage` 4/4、`icon-check` 15/15；`install / typecheck / desktop build / web build / 启动自检` 全部 exit=0。
- 证据目录 `verification/` → `out/` 已完成迁移：23 个既有文件 sha256 逐一相同，全部路径引用同步，新路径下 5 个脚本复跑通过数与迁移前完全一致（见 §3.1、`logs/07-rerun-after-rename.txt`）。
- 关于 `out/` 入库的一处配套改动：`.gitignore` 原本的 `out/` 会连根目录证据目录一起忽略，第二轮进一步放行 `/out/*.mjs` 与 `/out/*.md`（CI 需要在干净检出里调用这些脚本），`apps/desktop/out/` 的构建产物仍被忽略。属于让证据与脚本可提交的必要改动，不是功能变更。
- 收尾后在工作区当前状态做了一次整体复跑（`logs/09-final-verification.txt`）：`pnpm typecheck` exit=0、`pnpm --filter @deva/web build` exit=0、`probe/git-e2e/browse-check/channel-coverage/icon-check/smoke` 合计 82 项全 PASS、fail=0。

### 8.1 第二轮收尾结论（分支 `feat/plugin-deva-agent` @ `3ddd9dc` + 工作区改动）

**通过数对比（同一套检查，修前 → 修后）**

| 检查 | 修前 | 修后 |
|---|---|---|
| `pnpm lint` | 30 problems（29 error / 1 warning） | **0 problems** |
| `pnpm --filter @deva/web typecheck` | 4 × TS2305，exit=2 | **exit=0** |
| `pnpm typecheck`（含 desktop） | exit=0 | exit=0（现覆盖三套 tsconfig） |
| `pnpm build` / `@deva/web build` | exit=0 / exit=0 | exit=0 / exit=0 |
| `node --check`（71 个 js/mjs，入库后 74） | 未纳入检查 | **fail=0** |
| 启动自检 | 22 步 ok / 162 channels（未记录） | 22 步 ok / **162 channels** |
| smoke / probe / git-e2e / browse / coverage / icon | 14 / 30 / 10 / 9 / 4 / 15（默认部署） | **14 / 30 / 10 / 9 / 4 / 15（默认与共享 roots 两种部署）** |
| 插件单测 | 158 pass | 158 pass |
| CI 覆盖 Web | ❌ | ✅ check + web-e2e 两个 job |

**剩余问题与处置**

| # | 问题 | 为何不修 | 是否需要用户拍板 |
|---|---|---|---|
| 1 | Agent 文件工具绕过网关闸门 | 产品设计：Agent 走主进程服务，桌面版同样不限制；收紧等于改能力边界。部署侧一人一容器即可隔离（§7.4） | 否（若要改属产品方向决策，需单独立项） |
| 2 | `BROWSE_TOP` 默认 `/` | 部署行为：与桌面版系统目录对话框一致；改默认值会改变既有部署的可见范围（§7.6-2） | 否（用 `DEVA_WEB_BROWSE_TOP=/projects` 即可收窄） |
| 3 | Docker 镜像无法在本机实跑 | 环境限制：无守护进程（`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`）。**第三轮已加进 CI**（`docker` job，`push: false`），真构建由 runner 证明；容器运行期仍未覆盖（§7.5） | 否（已按「加进 CI」执行） |
| 4 | `apps/desktop` 无单元测试 | **第三轮已补**：18 个文件 / 179 项，`test:desktop` 已进 CI；155 个源文件仍无法 Node 原生导入，原因已归类（§7.6-3） | 否（已补） |
| 5 | 未登记的新 fs/git 通道走全字符串兜底 | 非缺陷：兜底仍会拦路径，只是可能误伤 `/` 开头的内容；`channel-coverage` 已进 CI 兜住（§7.6-1） | 否（新通道注册时顺手补 `CHANNEL_PATHS` 即可） |
| 6 | 3 处控制字符正则使用行级 eslint-disable | 规则无等价替代（`no-control-regex` 没有选项），逐行写明理由，非整文件关闭（§4.8） | 否 |
| 7 | `apps/desktop` 0.1.16 / `apps/web` 0.1.15 版本号不一致 | **第三轮已统一**为 0.1.16，并加 `pnpm check:versions` 断言（lockfile 无 diff） | 否（已统一） |
| 8 | 本轮改动全部未提交 | 交付前提：CI 在干净检出跑，新增文件必须先入库（清单见下） | **是**：是否现在提交 |

**验证命令（可直接复跑）**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build && pnpm --filter @deva/web build

DEVA_WEB_DATA=/tmp/deva-check DEVA_WEB_ADMIN_PASSWORD=ci-pass \
DEVA_UPDATE_CHECK_MINUTES=-1 PORT=7080 node apps/web/server.mjs &
(cd apps/web && BASE=http://127.0.0.1:7080 ADMIN_USER=admin ADMIN_PASSWORD=ci-pass \
  SMOKE_CREATE_USER=1 node test/smoke.mjs)
BASE=http://127.0.0.1:7080 ADMIN_PASSWORD=ci-pass node out/probe.mjs
BASE=http://127.0.0.1:7080 ADMIN_PASSWORD=ci-pass node out/git-e2e.mjs
BASE=http://127.0.0.1:7080 ADMIN_PASSWORD=ci-pass node out/channel-coverage.mjs
BASE=http://127.0.0.1:7080 ADMIN_PASSWORD=ci-pass node out/browse-check.mjs
BASE=http://127.0.0.1:7080 ADMIN_PASSWORD=ci-pass node out/icon-check.mjs
(cd plugins/deva-agent && node --test tests/*.test.mjs)
```

以上每条均在本次会话中实际执行过，输出见 `out/logs/14-final-full-run.txt`、`out/logs/13-ci-equivalent.txt`、`out/logs/19-final-full-run-round2-close.txt` 与 `out/logs/20-final-full-run-round2-close.txt`（均为 `OVERALL_FAIL=0`）。

**一条命令复现**：`bash out/final-run.sh`（脚本里就是上面这一串，外加启动实例、健康轮询、失败时 `tail` 服务日志与 `OVERALL_FAIL` 汇总；端口被占用时 `PORT=7225 bash out/final-run.sh`）。`logs/20` 就是这条命令的完整输出，脚本自身 `exit=0`。

### 8.2 第二轮收尾核对（续跑后重做，2026-11-21）

| 用户要求 | 实际执行 | 结果 | 证据 |
|---|---|---|---|
| ① Web 层可独立跑的类型检查 | 新增 `apps/web/tsconfig.backend.json` + `src/backend/electron-shim.d.ts`，`pnpm --filter @deva/web typecheck` | 4 × TS2305 / exit=2 → **exit=0**；负向验证可复现 | `logs/10`、`logs/16` |
| ② CI 覆盖 Web 层 | `.github/workflows/ci.yml` 两个 job（check + web-e2e） | 本地同命令全跑通，`OVERALL_FAIL=0` | `logs/13`、`logs/19` |
| ③ 最小可用 lint 并真实通过 | `eslint.config.mjs` + `"lint": "eslint ."` | 全仓 **30 problems → 0**；`apps/web` **4 error → 0**（17 个文件） | `logs/11`、`logs/12`、`logs/17` |
| ④-1 Agent 文件工具绕过网关 | 复核 README「安全边界」第 3 条 + 桌面版同构行为 | **产品设计，非缺陷，不改** | §7.4 |
| ④-2 `BROWSE_TOP` 默认 `/` | 复核 `server.mjs:58-59` 注释与 README | **部署行为，非缺陷，不改**（可用 `DEVA_WEB_BROWSE_TOP` 收窄） | §7.6-2 |
| ④-3 无 Docker 守护进程 | 实跑 `docker info` / `docker build` / `docker compose version` | **环境限制**：`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`，`ls: cannot access '/var/run/docker.sock'`，无 compose 插件 | `logs/18` |
| ⑤ 一条命令可复现整套检查 | 新增 `out/final-run.sh`，内含 CI 两 job 的全部命令 + 启动实例 + 汇总 | `bash out/final-run.sh` → `OVERALL_FAIL=0`，脚本自身 exit=0 | `logs/20` |

**本轮没有任何用 `@ts-ignore`、`eslint-disable`（除 3 处逐行写明理由的控制字符正则）、注释代码或跳过测试来凑绿的处置。**

**交付前提（必须知道）**：以上改动全部在**工作区**，尚未提交（`git status` 实测：42 个已修改文件 + 16 个未跟踪条目，其中与本次相关的是下面这几个）。CI 在干净检出上运行，因此下面这些新增文件必须先入库，否则 GitHub 上的 job 会直接失败：

| 新增文件（未跟踪） | 缺失后果 |
|---|---|
| `eslint.config.mjs` | `pnpm lint` 报找不到配置 |
| `apps/web/tsconfig.backend.json` | `pnpm --filter @deva/web typecheck` 找不到 project |
| `apps/web/src/backend/electron-shim.d.ts` | 类型检查退回 4 × TS2305 |
| `out/probe.mjs`、`out/git-e2e.mjs`、`out/channel-coverage.mjs`、`out/browse-check.mjs`、`out/icon-check.mjs` | `web-e2e` 的探针 step 找不到脚本 |
| `.github/workflows/ci.yml`、`apps/web/package.json`、`package.json`、`.gitignore` | 这些是**修改**（已跟踪），会随提交进入干净检出 |
| `out/final-run.sh`、`out/typecheck-web-backend.sh` | `.gitignore` 已放行 `!out/*.sh`，可正常入库 |

`git add -An out` 已确认 `out/*.mjs`、`out/*.md`、`out/*.sh` 会被正常加入（`.gitignore` 的放行规则生效），构建产物目录 `apps/desktop/out/` 仍被忽略。

**注意**：`out/logs/*.txt` **不入库**（`.gitignore` 的 `!/out/*.md` 只放行顶层 `out/*.md`，子目录仍被忽略）——这是有意的：日志是本次运行的证据，体积大且一次性；入库的是脚本 + `REPORT.md`，CI 只需要脚本。若希望证据日志也进版本库，需要再放开 `out/logs/`，但那属于「留档方式」的选择，**请你确认**。

**是否现在提交，等你决定；我没有擅自 commit。**

### 8.3 第三轮：四项待定项落地（2026-11-22）

用户对上一轮列出的四项待定项与附注答复「全部都做」。逐项状态与证据：

| # | 事项 | 状态 | 实测证据 |
|---|---|---|---|
| ② | 版本号统一（desktop 0.1.16 / web 0.1.15） | ✅ 完成 | `apps/web/package.json` → `0.1.16`；新增 `out/check-versions.mjs` + 根脚本 `check:versions`；改前 exit=1（`logs/21`）、改后 exit=0（`logs/22`）；`pnpm-lock.yaml` `md5sum -c` OK；运行时链路实测 `manifest.version` / `app.getVersion()` / `build-info.json` 三处均为 `0.1.16` |
| ③ | `apps/desktop` 单测 | ✅ 完成 | 18 个 `test/*.test.mjs`、**179 项全通过**（Node 24 / Node 22 双跑，`logs/23`、`logs/26`）；负向验证 178/1/exit=1 后恢复一致（`logs/24`）；`pnpm test:desktop` 已进 CI `check` job；覆盖边界与未覆盖原因见 `logs/27` |
| ④ | Docker 进 CI | ✅ 完成（CI 侧）；本机只能静态校验 | `ci.yml` 新增 `docker` job（buildx + build-push `push:false`）；`out/docker-check.mjs` **77 项全 PASS**（`logs/25`）；本机 `docker build` 实测仍报 `Cannot connect to the Docker daemon`，**未声称本地构建过镜像**；`ci.yml` 末尾旧说明已改写 |
| ⑤ | `out/logs/*.txt` 留档 | ✅ 完成 | `.gitignore` 加 `!/out/logs/` + `!/out/logs/*.txt`；28 个文件、约 59 KB（单文件最大 6.2 KB），全部按文本入库，无需裁剪 |
| ① | 拆分提交 + 普通 push | 见 §8.4 | `git log` / `git rev-parse` 实测输出 |

**通过的检查（第三轮整体复跑，`logs/28`）**

| 检查 | 数值 |
|---|---|
| `pnpm install --frozen-lockfile` | exit=0 |
| `pnpm lint` | exit=0 |
| `pnpm check:versions` | exit=0 |
| `pnpm test:desktop` | **179 pass / 0 fail** |
| `pnpm typecheck`（desktop + web） | exit=0 |
| `pnpm build` / `pnpm --filter @deva/web build` | exit=0 / exit=0 |
| `node --check` | 71 个文件，fail=0 |
| 启动自检 | 22 步 ok / **162 channels** |
| smoke / probe / git-e2e / channel-coverage / browse / icon | 14 / 30 / 10 / 4 / 9 / 15，合计 **82 项 fail=0** |
| `out/docker-check.mjs`（静态） | **77 项 fail=0** |
| 插件单测 | **158 pass / 0 fail** |
| **合计** | `OVERALL_FAIL=0` |

**修前 → 修后（相对第二轮收尾 `logs/20`）**

| 项目 | 第二轮 | 第三轮 |
|---|---|---|
| desktop 单测 | 0 项（无测试） | **179 项** |
| 版本一致性 | 不一致（0.1.16 vs 0.1.15） | **一致 + CI 断言** |
| CI 覆盖 | check + web-e2e | check（+版本/单测）+ web-e2e + **docker** |
| 证据日志入库 | 不入库 | **入库（28 个 / 59 KB）** |
| 整体复跑 | `OVERALL_FAIL=0` | `OVERALL_FAIL=0` |

**本机无法自证、只能靠 GitHub runner 的部分（单列）**

1. **CI 真跑**：本机没有 `gh` / `act` / token，无法读取 Actions 运行结果；本地只做了「与 CI 同命令」的等价执行（`logs/28`）。真实 runner 上的结论需在推送后查看运行页面。
2. **docker 真构建**：本机无 daemon，`docker build` 无法开始；`docker` job 是否通过只能由 runner 证明。静态校验（`logs/25`）只覆盖配置正确性。
3. **容器运行期**：entrypoint 降权、`/data` 属主修正、HEALTHCHECK 均未在任何环境实测（CI 的 docker job 只构建、不启动）。
