# Deva Web · 纯 Web 版

把 [sqfcyily/deva](https://github.com/sqfcyily/deva) 桌面应用原样搬进浏览器：
**前端一行没改**，Electron 外壳换成 Node 服务 + 每用户一个后端进程。

登录后在浏览器里使用完整功能：对话、模型与密钥、角色、记忆、任务、技能、MCP、
终端、文件树、Git、内置浏览器（Chromium/CDP）、剪贴板。

> 本目录是上游仓库的 `apps/web`，和桌面版共用同一份源码与 pnpm workspace。
> 另有一条「桌面塞进容器 + noVNC」的路线，见独立仓库的 `deva-docker/`；
> 那个是像素级还原桌面；这里是真正的 Web 服务，可多用户。

---

## 架构

```
浏览器
  │  HTTP + SSE（Cookie 会话，CSRF 校验）
  ▼
server.mjs ── 登录 / 用户管理 / 静态托管 / 审计 / 路径闸门
  │  IPC（fork）
  ▼
每用户一个后端进程（DEVA_HOME / HOME / cwd 全部按用户隔离）
  └─ dist/backend.cjs = 原 apps/desktop/src/main 的业务模块，按 main/index.ts 顺序注册
       ├─ chat / providers / tools / checkpoints / subagents
       ├─ config / secrets / personas / memory / tasks / skills / mcp
       ├─ terminal（node-pty，独立 pty-host 进程）
       ├─ git / workspace / attachments / deliverables
       └─ browser（系统 Chromium + CDP，替代 Electron WebContents）
```

两处「壳」的替身：

| Electron | Web 实现 |
|---|---|
| `preload/index.ts` + `ipcRenderer` | `dist/shim.js`：`invoke` → `POST /api/invoke`，`on` → `GET /api/events`（SSE） |
| `app` / `BrowserWindow` / `dialog` / `safeStorage` / `webContents` | `src/backend/electron-shim.mjs` + `chromium.mjs` |

渲染层通过 `window.deva.*` 访问后端的 162 个 IPC 通道，签名与桌面版一致。

---

## 快速开始

### Docker（推荐）

默认跑 registry 里的镜像，不在服务器上编译：

```bash
cd apps/web
export DEVA_WEB_ADMIN_PASSWORD='换成你的强密码'
docker compose up -d

# 首次启动若没设密码，日志里会打印随机初始密码
docker compose logs deva-web | grep -A2 初始管理员
```

打开 `http://<服务器IP>:7080`，用 `admin` + 上面的密码登录，然后到 `/admin` 建用户。

compose 里同时起了 `watchtower`：它轮询 `ghcr.io/sqfcyily/deva` 的 digest，
变了就 pull + 重建 `deva-web`。**watchtower 看不到源码文件**，只认镜像 digest，
所以「改源码 → 自动更新」的前提是 CI 已经把新镜像推上去（当前 checkout 缺少镜像发布 workflow，需部署仓库提供）。

要在服务器上用当前源码自己构建（不经过 registry）：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yaml up -d --build
```

镜像分 builder / runtime 两阶段。Docker 仅构建共用的 renderer 与 Web 后端，
跳过 Electron main/preload 和手机端；运行镜像包含生产 bundle、编译后的网关/worker、
原生 node-pty、Chromium、字体和终端/Git 工具，不复制整个源码或开发依赖目录。
React 等部分声明在 devDependencies 的浏览器运行代码仍会进入 bundle，这是必需内容。
安装仍使用冻结的 workspace 依赖：Web 没有自己的依赖声明，依赖 desktop 工具链和
relay-node 的 esbuild，且使用 hoisted linker；单独 filter Web 无法构建，暂不拆依赖图。
安装缓存清理于同一层，最终阶段不包含 pnpm store、Electron 二进制或构建工具链。

`.dockerignore` 排除 node_modules、out、dist、.git、.tmp、缓存和本地数据。
排除 Git 后，本地覆盖构建需显式传递版本元数据（CI 同样传入 build args）：

```bash
export DEVA_COMMIT=$(git rev-parse HEAD)
export DEVA_REF=$(git symbolic-ref --short -q HEAD || true)
# 当前目录 apps/web；只构建，不启动
docker compose -f docker-compose.yml -f docker-compose.build.yaml build
```

当前 checkout 没有 `scripts/redeploy.sh`、`out/OPS.md` 或 `.github/workflows/image.yml`；
上面的直接 Compose 命令是可用替代。远程拉取和 watchtower 配置保留，但 CI 发布需由部署仓库提供。

### 小内存 Docker 配置

将 `.env.example` 复制为本目录 `.env` 后修改参数。以下默认面向 2 GiB 主机上轻量单用户、
少量 Chromium 页面；大页面、多用户或 MCP 子进程可能触及上限，必须按实际负载调整。
运行限制不约束 Docker builder，建议小机器拉远程镜像，在独立构建机编译。

| 变量 | 默认 | 作用 |
|---|---|---|
| `DEVA_WEB_MEM_LIMIT` | `1280m` | 整个 Web 容器 RAM 硬上限，给 2 GiB 主机留下约 768 MiB；其他服务仍占此余量 |
| `DEVA_WEB_MEMSWAP_LIMIT` | `1280m` | RAM + swap 总额；等于 RAM 上限即禁用容器 swap，必须不小于 RAM 上限 |
| `DEVA_WEB_NODE_HEAP_MB` | `256` | 注入 `NODE_OPTIONS=--max-old-space-size=256`，每个 Node 进程 old-space 的 MiB 上限，worker 继承；不含 native/Buffer/Chromium |
| `DEVA_WEB_SHM_SIZE` | `256m` | /dev/shm 容量上限，按需占用并计入容器内存；过小可能使 Chromium 崩溃，大页面可改 512m |
| `PNPM_CHILD_CONCURRENCY` | `1` | 构建 ARG：安装生命周期脚本并发 |
| `PNPM_NETWORK_CONCURRENCY` | `4` | 构建 ARG：下载并发 |
| `BUILD_NODE_HEAP_MB` | `768` | 构建 ARG：安装/编译 Node old-space 上限；不是 builder RSS 总上限 |
| `DEVA_COMMIT` | 空 | 构建 ARG：当前 commit，空则本地 build.mjs 尝试 Git；Docker 无 .git 时为空 |
| `DEVA_REF` | 空 | 构建 ARG：分支/ref，Docker 无 .git 时更新检查回退 main；deva_web 部署请传 deva_web |
| `WATCHTOWER_POLL_INTERVAL` | `900` | 秒；保留 15 分钟自动检查与更新，不延长更新延迟 |

不添加 `deploy.resources.limits`，避免与非 Swarm 的 `mem_limit` 重复配置；若以后添加，
两者内存值必须一致。watchtower 保留 cleanup=true（节省磁盘而非直接降低 RSS）、
scope=deva 与 enable 白名单；不加过紧的 watcher 内存限制，以免更新过程被 OOM 中断。
`shm_size` 从 1 GiB 降到 256 MiB 不意味着空闲 RSS 立即减少 768 MiB。

服务器应用配置后，用以下只读命令确认实际值（本次改造不执行部署）：

```bash
docker compose config
docker stats --no-stream deva-web deva-watchtower
docker inspect deva-web --format 'memory={{.HostConfig.Memory}} swap_total={{.HostConfig.MemorySwap}} shm={{.HostConfig.ShmSize}} oom={{.State.OOMKilled}}'
docker exec deva-web sh -c 'echo "$NODE_OPTIONS"; du -sh /src/node_modules; cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak'
docker image inspect "$(docker inspect deva-web --format '{{.Image}}')" --format '{{.Size}}'
docker history --no-trunc "$(docker inspect deva-web --format '{{.Image}}')"
```

cgroup v2 的 memory.peak 需内核支持；在实际登录、打开 Chromium 页面后重复采样。
不要改 Compose project name；仍是 `web`，数据卷仍是 `web_deva-data`。

### 有新提交时怎么知道

服务启动时检查一次上游 `sqfcyily/deva` 的目标 ref，之后每 30 分钟查一次；
构建时用的 commit 记录在 `dist/build-info.json`，容器里也能读：

- 管理员登录后，主界面**左下角**出现「有新版本 · <sha>」角标，点击进 `/admin`；
- `/admin` 顶部「版本更新」卡片显示当前/远端 commit、落后多少个提交、最近检查时间、
  检查错误，以及可直接复制的重建命令；
- 需要主动推送时配 `DEVA_UPDATE_WEBHOOK`（支持 json / slack / discord / telegram），
  同一个 commit 只推一次，记录在 `$DEVA_WEB_DATA/state/update-state.json`。

镜像里的代码是构建时固化的；更新有两种方式：

```bash
# A. 主线：等 CI 把新镜像推到 ghcr，watchtower 在轮询间隔内自动 pull + 重启。
# B. 备用：在服务器上用当前源码直接构建部署。
git pull --ff-only
export DEVA_COMMIT=$(git rev-parse HEAD)
export DEVA_REF=$(git symbolic-ref --short -q HEAD || true)
docker compose -f docker-compose.yml -f docker-compose.build.yaml up -d --build
```

`deva-data` 卷不动，用户、会话、密钥都保留；工程目录是宿主 bind mount，不受影响。
不想检查就设 `DEVA_UPDATE_CHECK_MINUTES=-1`；只想手动检查设 `0`。

### 本地直接跑

```bash
# 1) 在仓库根装依赖并构建桌面 renderer + Web 运行层（需要 Node 20+ / pnpm 10.8）
corepack enable
pnpm install
pnpm build:web

# 2) 启动（需要系统里有 chromium / chrome）
cd apps/web
DEVA_WEB_DATA=$PWD/.data \
DEVA_WEB_ADMIN_PASSWORD='换成你的强密码' \
PORT=7080 node server.mjs
```

只重建 Web 层（renderer 已存在时）：`pnpm --filter @deva/web build`。
`CHROME_PATH=/usr/bin/chromium` 可显式指定浏览器可执行文件。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `7080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DEVA_WEB_DATA` | `~/.deva-web` | 数据根：用户、会话、审计、每用户 `.deva`（DEVA_HOME）与默认工作区 |
| `DEVA_WEB_ADMIN_USER` | `admin` | 首次启动创建的管理员名 |
| `DEVA_WEB_ADMIN_PASSWORD` | 随机并打印 | 首次启动管理员密码 |
| `DEVA_WEB_SESSION_HOURS` | `168` | 会话有效期（小时），落盘，重启不掉登录 |
| `DEVA_WEB_IDLE_MINUTES` | `30` | 用户后端进程空闲回收时间；下次请求自动拉起 |
| `DEVA_WEB_SECURE_COOKIE` | `0` | 走 HTTPS 反代时设 `1`，Cookie 加 `Secure` |
| `DEVA_WEB_ROOTS` | `$DEVA_WEB_DATA/workspaces` | 「打开文件夹」的快捷根，多个用 `:` 分隔；第一个存在的根同时作为默认工作区（Docker 里是 `/projects`） |
| `DEVA_WEB_BROWSE_TOP` | `/` | 目录浏览上界；设成 `/projects` 可把选择器锁在工程目录内 |
| `DEVA_PROJECTS_DIR` | `./projects`（相对 compose 文件） | compose 里工程目录的宿主路径，挂到容器 `/projects` |
| `LANG` / `LC_ALL` | `C.UTF-8`（镜像内置） | 中文文件名与终端/git 输出编码 |
| `DEVA_UPDATE_REPO` | `sqfcyily/deva` | 检查的上游仓库 |
| `DEVA_UPDATE_REF` | 构建时的 ref，否则 `main` | 检查的分支 / tag / commit |
| `DEVA_UPDATE_CURRENT` | `dist/build-info.json` 里的 commit | 覆盖「当前版本」，一般不用 |
| `DEVA_UPDATE_CHECK_MINUTES` | `30` | 检查间隔；`0` 仅手动，负数关闭 |
| `DEVA_UPDATE_TOKEN` | 空 | GitHub token：私有仓库或提高限额 |
| `DEVA_UPDATE_API` | `https://api.github.com` | API 地址（GHE / 测试用） |
| `DEVA_UPDATE_WEBHOOK` | 空 | 发现新提交时 POST 的地址 |
| `DEVA_UPDATE_WEBHOOK_KIND` | `json` | `json` / `slack` / `discord` / `telegram` |
| `DEVA_UPDATE_TELEGRAM_CHAT_ID` | 空 | telegram 模式的 `chat_id` |
| `DEVA_RUN_USER` | `node` | 容器内降权后的运行用户（entrypoint 用） |
| `CHROME_PATH` | 自动探测 | 内置浏览器用的 Chromium |

### 可选目录（挂载其他文件夹）

Web 版没有系统目录对话框，`fs.openFolder()` 会弹页面内的目录选择器。可浏览的范围由
`DEVA_WEB_BROWSE_TOP` 限定（默认整个容器，和桌面版系统对话框一致）：可以从任意根
往上翻、直接选当前目录，选中的目录会登记为受信根。`DEVA_WEB_ROOTS` 只决定顶部
快捷根；`$DEVA_WEB_DATA/state`、`$DEVA_WEB_DATA/audit` 和别人的
`$DEVA_WEB_DATA/users/<id>` 不出现也进不去。

选择器底部可以手输文件夹名（相对当前目录）或绝对路径：目录不存在会自动创建再挂载，
已存在则直接选中。

**配置目录和工程目录是分开的**：`/data` 用命名卷存用户、会话、审计和每用户默认
`.deva`；工程目录用 bind mount 挂到 `/projects`，就是默认工作区。
`docker compose` 里默认就是这样：

```yaml
services:
  deva-web:
    environment:
      DEVA_WEB_ROOTS: /projects
    volumes:
      - deva-data:/data
      - /srv/projects:/projects
```

注意卷名带 compose 的 project 前缀（目录是 `apps/web`，所以实际叫 `web_deva-data`）。
不要为了「好看」改 project name，否则会挂上一个空的新卷、看起来用户数据全丢了。

老部署如果仍想把工程放在配置卷里，显式设 `DEVA_WEB_ROOTS=/data/workspaces` 即可。

多个宿主目录可以挂成子目录，再把 `/projects` 当根浏览：

```yaml
    volumes:
      - deva-data:/data
      - /srv/projects:/projects/projects
      - /srv/datasets:/projects/datasets
```

容器内应用以 uid 1000（`node`）运行，宿主机目录要让它可写，否则只能浏览不能改：
`sudo chown -R 1000:1000 /srv/projects`，或者把 `DEVA_RUN_USER` 改成对应宿主用户。
compose 自动创建的空 `./projects` 会由 entrypoint 改成运行用户属主；已有内容的目录不会动。

选中的目录会持久化到 `$DEVA_WEB_DATA/users/<userId>/roots.json`，worker 重启后自动
重新登记为受信根；服务端路径闸门也会同步放行该目录。符号链接指向根外的目录不会出现在
列表里，选中时还会再用 `realpath` 校验一次。

### 中文文件名乱码

镜像内置 `LANG=LC_ALL=C.UTF-8`，并给 git 设了 `core.quotepath=false`，中文路径在
文件树、终端、diff 里都按原文显示。自建镜像或直接跑 `server.mjs` 时也要保证这两个
环境变量是 UTF-8；老容器需要重新 build 才会带上。

---

## 用户、数据与审计

```
$DEVA_WEB_DATA/
├── state/
│   ├── users.json             # 用户与 scrypt 密码哈希
│   ├── sessions.json          # 服务端会话（HttpOnly Cookie）
│   └── update-state.json      # 上次已推送 webhook 的 commit（防重复）
├── audit/
│   ├── auth/YYYY-MM-DD.jsonl          # 登录/登出/建用户/重置密码
│   └── users/<userId>/YYYY-MM-DD.jsonl  # 每次 IPC 调用：通道、参数摘要、耗时、错误
└── users/<userId>/
    ├── .deva/                 # DEVA_HOME，和桌面版 ~/.deva 同构：config/secrets/记忆/技能
    ├── roots.json             # 用户手动选过的额外受信根
    └── workspace/             # 仅在没有任何 DEVA_WEB_ROOTS 时兜底；有 /projects 时不会创建
```

旧版本把 `users.json` / `sessions.json` / `update-state.json` 和 `audit/*.jsonl` 平铺在
`$DEVA_WEB_DATA` 根下；升级后首次启动会自动搬进 `state/` 和 `audit/auth|users/`，
不需要手动迁移，也不会覆盖已存在的新文件。每用户的 `home/` 也会自动改名为 `.deva/`。
旧版本留下的空 `users/<id>/workspace/` 会自动删除（非空则保留）。

- 首个管理员在启动时创建，密码打印在日志；之后只在 `/admin` 里管理。
- `/admin`：建用户、删用户（连同数据）、重置密码、查看最近审计。
- 密钥用 AES-256-GCM 加密，主密钥在每用户 `.deva/.web-secret`（0600），明文 API Key 不落盘。
- 会话 Cookie 为 `HttpOnly + SameSite=Lax`，所有写操作额外校验 CSRF Token。

---

## 已验证范围

本机（Linux / Node 24 / Chromium 156，无 Docker 守护进程）实际跑过：

| 项 | 结果 |
|---|---|
| 上游版本 | `109937f` / v0.1.15（renderer、preload shim、主进程 bundle 全部重建） |
| 后端模块注册 | 22 个注册步骤全部 ok，`ready: 162 channels` |
| 冒烟回归 | `test/smoke.mjs`：pass=14 fail=0 |
| 原 renderer 渲染 | 零改动，登录后完整 UI |
| 登录 / 会话 / CSRF | 未登录 302，无 CSRF 403，重启服务后旧 Cookie 仍有效 |
| 用户隔离 | 两个用户 config / workspace / 密钥互不可见，跨用户路径被拒 |
| 路径闸门 | `fs:read-dir /etc` → `路径超出本用户工作区` |
| 密钥 | `secrets:set/has/list` 通过，明文不入 config |
| 聊天 | 真实 UI 发消息 → mock OpenAI → SSE 流式回显 `WEB_CHAT_OK` |
| 终端 | `terminal:create` → PTY → SSE 收到 `SMOKE_PTY_OK` |
| 文件 | 工作区写入/读回 |
| Git / 记忆 / 任务 / 技能 / MCP / 浏览器状态 | 通道调用正常 |
| 审计 | auth 与每用户 JSONL 均落盘，参数已脱敏 |
| 更新提示 | mock GitHub：发现新提交 / 角标 / 管理页卡片 / webhook 去重 / 已是最新 均通过 |

回归测试：

```bash
BASE=http://127.0.0.1:7080 ADMIN_USER=admin ADMIN_PASSWORD=... \
SMOKE_CREATE_USER=1 node test/smoke.mjs
```

聊天链路需要一个可用的模型服务商（在 UI 设置里配，或直接写 `.deva/config.json` 的
`models.providers`）。冒烟测试不依赖模型。

---

## 排障

### `EACCES: permission denied, mkdir '/data/audit'`

应用以 `node`（uid 1000）运行，但 `/data` 属主是 root，常见三种原因：

- named volume 是旧镜像 / 旧容器创建的，属主停在 root；
- 你把 `deva-data:/data` 改成了宿主 bind mount，宿主目录 root 所有；
- rootless Docker 的 uid 映射和镜像里的 1000 对不上。

镜像入口脚本会以 root 起步，把 `$DEVA_WEB_DATA` 的属主修成运行用户后立刻降权，
所以重建容器即可自愈（镜像本身不用变）：

```bash
docker compose up -d --force-recreate
```

不想重建，直接修现有卷：

```bash
docker compose run --rm --user root --entrypoint sh deva-web -c 'chown -R node:node /data'
docker compose up -d
```

bind mount 就在宿主上改：

```bash
sudo chown -R 1000:1000 ./data
```

如果 chown 也失败（NFS、rootless、只读挂载），说明这个路径没法给 uid 1000 写权限，
改用 named volume，别用 bind mount。要换运行用户就设 `DEVA_RUN_USER`，但数据目录属主
必须和它一致。

---

## 安全边界（重要）

这个应用的能力约等于「给模型一个 shell」，请按这个前提部署：

1. **必须改掉初始密码**，并给每个真实用户单独建账号。
2. **渲染层的 fs/git/terminal 通道有路径闸门**：只能落在本人工作区与 `.deva/`，
   以及本人在选择器里手动挂载过的目录。
3. **Agent 文件工具不经过闸门**（上游设计如此，桌面版也不限制）。因此：
   - 只给可信用户使用；
   - 面向不可信多租户时，**一人一容器**（同一镜像，不同 `DEVA_WEB_DATA` 卷 / 不同端口），
     不要把多用户直接暴露在同一个实例上。
4. 镜像入口先以 root 修正数据目录属主，随后立即降权到 `node`（uid 1000）运行应用；
   `no-new-privileges`，Chromium 带 `--no-sandbox`。
5. 内置服务是明文 HTTP，公网请放在 Caddy/Nginx + HTTPS 后面，并设
   `DEVA_WEB_SECURE_COOKIE=1`。
6. 审计记录的是通道与参数摘要，密钥类字段已脱敏；不要把它当完整取证日志。

---

## 已知限制

- **内置浏览器**：网页视图走 CDP，功能可用；桌面版单独的 `browser.html` 外框窗口没有托管，
  浏览器画面在应用内以截图/快照形式使用。
- **自动更新**：`electron-updater` 已桩化，`updater:*` 通道为空实现。
- **托盘 / 菜单 / 系统通知 / 窗口控制**：no-op 或浏览器通知降级。
- **剪贴板**：走进程内文本缓冲，不读系统剪贴板图片。
- **单实例**：一个 Node 网关进程；用户后端按需 fork、空闲 30 分钟回收。
- **MCP**：stdio MCP 在用户后端进程里拉起，依赖容器内可用的命令；桌面专属的 MCP 需要自行补依赖。
- **Docker 构建**：当前开发环境没有 Docker 守护进程，镜像未在本机 `docker build` 实跑；
  本次验证范围与证据见 `docs/docker-memory-report.md`，不能以本地 bundle 验证替代完整镜像构建。

---

## 目录结构

```
apps/web/
├── Dockerfile / docker-compose.yml
├── build.mjs                 # 打包 shim.js / backend.cjs / pty-host.js / manifest.json
├── server.mjs                # 网关：登录、用户、静态、/api/invoke、/api/events、审计
├── src/
│   ├── electron-shim.js      # 浏览器侧 preload 替身（HTTP + SSE）
│   ├── backend/
│   │   ├── electron-shim.mjs # 服务端 Electron 兼容层（app/window/dialog/safeStorage…）
│   │   ├── chromium.mjs      # 系统 Chromium + CDP 的 WebContents
│   │   ├── updater-stub.mjs
│   │   └── index.ts          # 按 main/index.ts 顺序注册真实业务模块
│   └── server/
│       ├── auth.mjs          # scrypt 密码、会话、用户、审计
│       ├── backend-pool.mjs  # 每用户后端进程池（fork / 回收 / 崩溃清理）
│       ├── worker-host.mjs   # 单用户后端进程入口（IPC 桥）
│       ├── pages.mjs         # 登录页 / 管理页
│       └── util.mjs
├── test/smoke.mjs
└── docs/web-migration.md     # 迁移测绘、路线对比、阻塞点
```

Docker 构建上下文是仓库根，根目录 `.dockerignore` 负责排除依赖与产物。

---

## 故障排查

| 现象 | 处理 |
|---|---|
| 页面一直转圈 / 401 | 清 Cookie 重登；确认反代没有吞掉 `Set-Cookie` |
| 发消息无回复 | 设置里确认模型服务商已启用、模型已勾选、Key 已保存；看容器日志 `[backend:<user>]` |
| 终端空白 | 容器需有 `bash`；`node-pty` 需与镜像架构一致（重新 build 即可） |
| 内置浏览器报错 | 确认 `CHROME_PATH` 指向存在的 Chromium；容器内需要 `--no-sandbox`（已默认） |
| 上传大文件失败 | 网关默认 64MB 上限，见 `readBody` |
| 想重置某个用户 | `/admin` 里删除用户会连数据一起删；只改密码用「重置」 |

## 与上游手机端的边界

上游 `apps/desktop/src/mobile` 是配对设备访问桌面会话的手机端，经 WebSocket 网关连接；本目录是独立的多用户 Node 服务，经 HTTP/SSE 适配桌面 preload。两者认证、协议和部署职责不同。Web 桌面业务只使用上游 renderer/preload/main，不维护第二份业务源码。

`favicon.svg` 唯一源为 `apps/desktop/src/mobile/public/favicon.svg`。`node build.mjs` 将它与本地 `src/web` 的独有资源输出到 `dist/web`；服务从该目录读取，Docker 已复制整个 `dist`，运行时无需上游源码。修改资源后需重新构建。

## Web 构建验证

在仓库根运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm --filter @deva/web typecheck`、`pnpm build:web` 和 `node apps/web/test/build-smoke.mjs`。使用根 packageManager 指定的 pnpm 10.8.0。

Web 构建复用本仓库 `.npmrc` 的 hoisted 工具链：TypeScript 来自 desktop、esbuild 来自 relay-node 的既有锁定依赖。此分支 lockfile 没有 Web 独立依赖记录，因此不另行声明或解析一套工具版本；Web 不能脱离 workspace 单独安装。冻结安装可能补写空的 Web importer，不涉及依赖版本变化。

产物包括 `apps/desktop/out/renderer` 与 `apps/web/dist`（shim.js、backend.cjs、pty-host.js、manifest.json、build-info.json、web/）。冒烟脚本只监听 localhost，使用仓库 `.tmp` 内的隔离数据目录，验证登录后首页及实际引用的 JS/CSS，再终止测试进程；不连接现有部署。本地完整构建调用 `pnpm build:web`；Docker 使用 renderer 专用配置再构建 Web。
