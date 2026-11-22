# Deva 纯 Web 化：测绘、方案与交付结果

## 结论

**能做，路线 B 已完整交付。** Electron 只是外壳，真正的业务全在主进程：

| 指标 | 数值 |
|---|---|
| 主进程 TypeScript | 29,923 行 / 82 个文件 |
| IPC 通道 | 125 个（121 个 handle + 4 个 on） |
| preload 暴露给前端的方法 | 153 个 `invoke` + 15 个事件订阅 |
| 同步 IPC | 1 处（`config:get-sync`） |
| 引入 `electron` 的主进程文件 | 32 个 |
| 渲染层 | React 18，49 个 ts/tsx，零 Electron API 直接调用 |
| Web 版实际注册通道 | **162 个**（22 个注册步骤全部 ok） |

渲染层只通过 `window.deva.*` 一个对象访问后端，因此**前端一行没改**。

## 四条路线

| 路线 | 做法 | 结果 |
|---|---|---|
| A. 桌面塞进容器 | Xvfb + x11vnc + noVNC | 已交付在 `../deva-docker/`，像素级还原桌面，不适合多用户 |
| B. Node 后端复用主进程代码 | Electron 兼容层把主进程跑进 Node，只替换窗口/对话框/浏览器 | **已迁入上游仓库 `apps/web/`，本文件描述的实现** |
| C. 重写 Web 后端 | 按 Web 语义重写 chat/tools/MCP | 未采用，工期 2 个月起 |
| D. 复用 remote 通道 | 给 `RemoteAdapter` 加 web 实现 | 未采用，只覆盖聊天，没有文件/终端/Git |

## 已实现的架构（路线 B）

```
浏览器
  │  HTTP + SSE（HttpOnly Cookie，写操作校验 CSRF）
  ▼
server.mjs
  ├─ /login /logout /admin        账号、角色、密码重置
  ├─ 静态托管 out/renderer        原前端产物，零改动
  ├─ /api/invoke                  162 通道路由 + 路径闸门 + 审计
  ├─ /api/events                  按用户隔离的 SSE 事件流
  └─ /healthz
  │  IPC（fork，按用户懒启动，空闲回收）
  ▼
worker-host.mjs × N（每用户一个进程）
  ├─ HOME / DEVA_HOME / cwd 全部按用户隔离
  └─ dist/backend.cjs
       ├─ chat / providers / tools / checkpoints / subagents
       ├─ config / secrets / personas / memory / tasks / skills
       ├─ terminal（node-pty，独立 pty-host 进程）
       ├─ git / workspace / attachments / deliverables
       ├─ mcp / remote / scheduler
       └─ browser（系统 Chromium + CDP 的 WebContents 替身）
```

两处「壳」的替身：

| Electron | Web 实现 |
|---|---|
| `preload/index.ts` + `ipcRenderer` | `dist/shim.js`：`invoke` → `POST /api/invoke`，`on` → SSE |
| `app` / `BrowserWindow` / `dialog` / `safeStorage` / `webContents` | `src/backend/electron-shim.mjs` + `chromium.mjs` |

关键实现点：

1. 浏览器 shim 保持 153 个方法签名不变，原 renderer 不需要改代码。
2. SSE 使用默认 `message` 事件、帧体 `{"channel","payload"}`；`event: <channel>` 在浏览器里收不到。
3. `config:get-sync` 改为登录后由 `boot.js` 内联 `__DEVA_CONFIG__`。
4. `dialog.showOpenDialog({properties:['openDirectory']})` 转成页面内目录选择器
   （`/api/dir-pick` + SSE），可翻上级、可跨 `DEVA_WEB_ROOTS`、可手输路径并自动创建
   不存在的文件夹，选中后仍走 `trustRoot`；文件选择类对话框返回 `canceled`。
5. `safeStorage` 用 AES-256-GCM，密钥为每用户 `.deva/.web-secret`（0600），明文 Key 不落盘。
6. 内置浏览器用系统 Chromium + CDP，启动参数含 `--no-sandbox --disable-dev-shm-usage`。
7. 终端仍是 `node-pty`，由独立 `pty-host.js` 子进程承载，输出经 SSE 回传。

## 阻塞点与解法

| 阻塞点 | 原状 | 交付方案 | 状态 |
|---|---|---|---|
| 绝对路径模型 | 渲染层直接传本机绝对路径 | 每用户 `workspace/` + `.deva/` + 手动挂载的受信根，网关对 `fs:*` / `git:*` / `terminal:create` 做 `isInside` 校验 | ✅ |
| 原生文件选择框 | `dialog.showOpenDialog` 5 处 | 目录选择走页面内 picker（可翻上级、可切根、可取消）；其余返回 canceled | ✅ |
| PTY 终端 | `node-pty` 4 个文件、6 个通道 | 服务端保留 node-pty，独立 pty-host + SSE 双向流 | ✅ |
| 内置浏览器 | `webContents` + CDP，2,498 行 | 系统 Chromium + CDP 实现 WebContents 子集 | ✅ |
| 密钥加密 | `safeStorage` 4 处 | AES-256-GCM + 每用户密钥文件 | ✅ |
| 同步 IPC | `config:get-sync` | 登录后内联配置 | ✅ |
| 托盘/菜单/通知/更新 | Tray、Menu、Notification、autoUpdater | 通知走 Web Notification，其余桩化 | ✅ 降级 |
| 窗口控制 | `window:*` 5 个通道 | no-op | ✅ 降级 |
| 剪贴板/截图 | `clipboard`、`desktopCapturer` | 进程内文本缓冲 / 浏览器能力 | ✅ 降级 |
| 多用户与安全 | 单机应用，无鉴权 | 登录、scrypt、会话落盘、CSRF、每用户进程/目录、审计 | ✅ |

## 分阶段计划：P0–P5 全部交付

| 阶段 | 内容 | 结果 |
|---|---|---|
| P0 | 静态托管 + preload 复用 + 通道桥 | ✅ 原 UI 在浏览器完整渲染 |
| P1 | 配置、模型、密钥、角色、记忆、任务 | ✅ 设置页可用，Key 加密保存 |
| P2 | 对话主链路：providers + chat + tools + 检查点 | ✅ 真实 UI → mock OpenAI → SSE 流式回显 |
| P3 | 终端、文件、Git | ✅ PTY 端到端；工作区读写；Git 通道可用 |
| P4 | 内置浏览器（Chromium + CDP） | ✅ 浏览器状态/导航/截图通道可用 |
| P5 | 多用户、鉴权、部署、审计 | ✅ 登录、用户隔离、审计、Dockerfile/compose |

## 已验证结果（本机实跑）

环境：Linux / Node 24 / 系统 Chromium / 无 Docker 守护进程。

| 项 | 证据 |
|---|---|
| 上游版本 | `109937f` / v0.1.15，renderer + preload + 主进程 bundle 重建后全部通过 |
| 后端模块注册 | 22 个注册步骤全部 ok，日志 `ready: 162 channels`，无 failed |
| 通道清单 | `GET /api/channels` 返回 162 |
| 冒烟回归 | `test/smoke.mjs`：**pass=14 fail=0** |
| 登录 / CSRF | 未登录 302；缺 `x-deva-csrf` → 403 |
| 会话持久化 | 登录后重启服务，旧 Cookie 调 `/api/me` 仍返回 admin |
| 路径闸门 | `fs:read-dir /etc` → `路径超出本用户工作区` |
| 用户隔离 | 两个用户 config/workspace/secrets 互不可见，跨用户路径被拒 |
| 密钥 | `secrets:set/has/list` 通过，明文不入 config |
| 聊天 | 真实 UI 输入 → mock OpenAI(7095) → 流式 `WEB_CHAT_OK` |
| 终端 | `terminal:create` → PTY → SSE 收到 `SMOKE_PTY_OK` |
| 文件 | 工作区写入 / 读回 |
| Git / 记忆 / 任务 / 技能 / MCP / 浏览器 | 通道调用正常（14 项通道测试 pass，3 项按设计 skip） |
| 审计 | auth 与每用户 JSONL 落盘，参数脱敏、超长截断 |
| 版本更新提示 | mock GitHub(7096) + mock webhook(7097)：发现新提交、管理页卡片、管理员角标、同一 commit 只推一次、`current == latest` 判为已是最新 |

复现命令：

```bash
# 服务已在跑时
BASE=http://127.0.0.1:7080 ADMIN_USER=admin ADMIN_PASSWORD='<密码>' \
SMOKE_CREATE_USER=1 SMOKE_NEW_USER=smoke$(date +%H%M%S) node test/smoke.mjs
```

聊天链路需要已配置的模型服务商；冒烟测试不依赖模型。

## 版本更新提示

桌面版靠 `electron-updater` 查发布，Web/Docker 版没有这条链路，改成查 Git 提交：

- 构建时 `build.mjs` 把上游 `git rev-parse HEAD` 写进 `dist/build-info.json`；
- 运行期 `src/server/updater.mjs` 启动即查 `GET /api.github.com/repos/<repo>/commits/<ref>`，
  之后按 `DEVA_UPDATE_CHECK_MINUTES` 定时查；
- 当前 commit 与远端不一致时，再调一次 compare API 区分「落后 N 个提交」和「分叉」，
  避免固定旧 commit 的镜像永远显示有更新；
- 结果三处消费：`GET /api/update`（仅管理员）、`/admin` 的「版本更新」卡片、
  管理员主界面左下角角标；配置 webhook 时同一 commit 只推一次（`state/update-state.json`）。

只检测、不自动更新。更新 = 在仓库根 `git pull` 后 `cd apps/web && docker compose up -d --build`，
数据卷 `deva-data` 不受影响。检查失败只写 `state.error`，不影响服务。

## 安全边界（必须读）

这个应用的能力约等于「给模型一个 shell」，按这个前提部署：

1. **渲染层通道有路径闸门**：`fs:*`、`git:*`、`terminal:create` 的绝对路径必须落在本人
   工作区、`.deva/` 或本人手动挂载过的目录。
2. **Agent 文件工具不经过闸门**（上游桌面版也不限制）。因此不可信多租户必须
   **一人一容器**：同一镜像、不同 `DEVA_WEB_DATA` 卷 / 端口，不要把多用户直接塞进一个实例。
3. 首次启动务必设置 `DEVA_WEB_ADMIN_PASSWORD`，登录后到 `/admin` 改密码、建用户。
4. 公网部署放在 Caddy/Nginx + HTTPS 后面，并设 `DEVA_WEB_SECURE_COOKIE=1`。
5. 镜像入口以 root 修正 `/data` 属主后立即降权到 `node`（uid 1000）运行应用，
   `no-new-privileges`，Chromium 带 `--no-sandbox`。
6. 审计记录通道与参数摘要，密钥字段已脱敏，不等同于完整取证日志。

## 已知限制

- 内置浏览器没有桌面版单独的 `browser.html` 外框窗口，画面以应用内截图/快照使用。
- 自动更新只做到「检测 + 提示」；不落盘校验、不自动重建镜像；托盘/菜单/系统通知/窗口控制为 no-op 或浏览器通知。
- 文件选择类原生对话框返回 canceled；目录选择器可跨根上翻，也可手输路径（不存在会自动创建）。
- 单个 Node 网关进程；用户后端按需 fork，空闲 30 分钟回收，下次请求自动拉起。
- stdio MCP 依赖容器内可用的命令；桌面专属 MCP 需自行补依赖。
- **Docker 镜像未在本机实跑**：开发环境没有 Docker 守护进程。Dockerfile 的每一步
  （COPY 源码 → pnpm install --frozen-lockfile → pnpm build → `pnpm --filter @deva/web build`
  → 原生模块解引用 → 按同样绝对路径启动）已在本地等价验证；首次 `docker compose up -d --build` 请预留
  构建时间并检查日志。入口脚本的「root 修属主 → 降权」用本地 uid 模拟验证过
  （root → nobody，含首次 chown 与二次跳过）。

## 验收标准

- [x] 浏览器新建会话、发消息、流式输出、工具调用链路可用
- [x] 刷新/重启后会话与消息不丢（服务端持久化）
- [x] 两个用户互不串数据、跨用户路径被拒
- [x] 越界路径访问被拒绝（`../` 与工作区外绝对路径）
- [x] 登录、CSRF、审计、密码重置、用户管理可用
- [x] 终端、文件、Git、MCP、技能、记忆、任务、浏览器通道可用
