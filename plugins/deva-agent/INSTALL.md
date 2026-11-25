# 在另一台设备安装和更新 Deva Agent

**验证基线：Ekko Studio Web 0.8.30，Deva 0.8.15，插件 API v1。** 插件 ID 是 `deva`，会话里的 Agent ID 是 `plugin:deva/deva`。下面安装的是 Studio **服务端**插件，并非安装 Deva 桌面应用，也不是把当前设备的配置复制过去。

## 1. 前置条件

- 目标设备上已有可用的 Studio；推荐先以 **0.8.30** 复现，其他版本须复测，不假定兼容。Studio 0.8.30 从 npm 自建要求 Node ≥23；插件构建要求 Node ≥20。建议使用已验证的 **Node 24 / npm 11**（本次 24.22.1 / 11.19.1），并具备 Bash、Git 和 tar。Windows 可用可访问 Studio 服务端目录的 WSL；Docker 要在容器内执行，或把成品解包到服务端能看到的共享挂载。
- 可读取 GitHub 远端；私有 fork 需另行配置 Git 认证。构建只依赖仓库随附的 SDK，不需要模型 API Key。Studio 安装需要目标站点的超级管理员登录、服务端目录读取权限，并且信任该可执行插件。
- 登录后应能找到 **插件中心 → 安装插件**，支持粘贴**服务端绝对目录**。本基线的安装 API 没有本机 `.tgz` 文件上传参数；不要把 tarball 路径、浏览器本机路径或 monorepo 根 URL 填进去。若只在另一台电脑打开网页，先把包传给服务端管理员解包。找不到安装入口时，先核对角色和 Studio 版本。

## 2. 获取和构建

发布到远端后，在目标 Studio 服务端的可写工作目录运行。首次安装优先固定 tag，避免分支移动：

```bash
git clone --branch deva-agent-v0.8.15 https://github.com/sqfcyily/deva.git
cd deva
node --version
npm --version
```

分支入口是 `feat/plugin-deva-agent`。安装所需目录：`plugins/deva-agent/` 含 `plugin.json`、`package.json`、`server.mjs`、`client.mjs`、`lib/`、`contracts/`、`sdk/`；仓库根 `scripts/` 提供安装器和可选的宿主标题脚本。不用安装 monorepo 或桌面端的依赖。

**脚本构建（不安装）：**

```bash
node scripts/install-deva-agent.mjs --ref deva-agent-v0.8.15 --dry-run
```

脚本从指定 ref 导出已提交的插件源码，不会改变工作树。它执行依赖安装、`npm pack`、解包和清单/入口校验，并打印 `studio-plugin-deva-0.8.15.tgz` 与解包后 `package/` 的绝对路径，两者保留在仓库 `.tmp/` 下。另有 lockfile 的将来版本可用 `npm ci`；0.8.15 没有 npm lockfile，使用 `npm install`。包不进 Git。

**手工构建（与脚本同样产物；首次手工构建）：**

```bash
OUT="$PWD/.tmp/deva-agent-package"
mkdir -p "$OUT/unpacked" "$OUT/runtime"
printf '*\n' > "$OUT/.gitignore"
export TMPDIR="$OUT/runtime" npm_config_cache="$OUT/npm-cache"
(
  set -e
  cd plugins/deva-agent
  npm install --ignore-scripts --no-audit --no-fund --no-package-lock
  npm pack --foreground-scripts --pack-destination "$OUT"
)
tar -xzf "$OUT/studio-plugin-deva-0.8.15.tgz" -C "$OUT/unpacked"
printf '%s\n' "$OUT/unpacked/package"
```

## 3. 安装及验收

**推荐：脚本走官方管理 API。** 在 Bash 中关闭 xtrace；不要把密码或 token 写进命令参数、仓库、日志或 shell 启动文件。为目标 Studio 用 HTTPS；脚本只允许 loopback 使用 HTTP。将示例地址/账号替换为自己的值：

```bash
set +x
export STUDIO_URL='http://127.0.0.1:8648'
read -rsp 'Studio 超级管理员密码: ' STUDIO_ADMIN_PASSWORD; printf '\n'
export STUDIO_ADMIN_PASSWORD
node scripts/install-deva-agent.mjs --username admin --password-env STUDIO_ADMIN_PASSWORD --ref deva-agent-v0.8.15
node scripts/install-deva-agent.mjs --username admin --password-env STUDIO_ADMIN_PASSWORD --ref deva-agent-v0.8.15 --check
unset STUDIO_ADMIN_PASSWORD
```

脚本调用 `POST /api/auth/login` 并仅在进程内用返回的 token 作 Bearer 鉴权。如果已经有目标 Studio 超管登录的 Bearer，可改用 `read -rsp 'Studio token: ' STUDIO_API_TOKEN; export STUDIO_API_TOKEN` 后去掉 `--username/--password-env`，或传 `--token-env 你的环境变量名`。用完 `unset`。不是模型 API Key，也不能用 Agent 运行凭据。地址亦可用 `--studio URL` 指定。用 `--package "$OUT/unpacked/package"` 可直接安装已解包成品，跳过重新构建。

| 官方 API | 安装器的行为 |
| --- | --- |
| `GET /api/studio/plugins` | 读取全局 registry `revision` 和 Deva 状态；不写回整份列表。 |
| `POST /api/studio/plugins/install` | JSON：`source` 为解包后的服务端绝对目录，`revision` 为刚读取的值，`trusted:true`、`expectedVersion` 为包版本；更新时另带 `pluginId:"deva"`。 |
| `PATCH /api/studio/plugins/deva` | 如未启用，以最新 revision 发 `enabled:true`；再次 GET 验收。 |

首次安装后必须看到 `Deva=0.8.15 status=active enabled=true`；真正的安装/启用会增加 **目标机** registry revision，数字不必与其他设备相同。同版本已启用时重复执行不重装、不改变 revision；不要用相同版本号发布不同运行代码。单独 `--check` 不安装、不启用；带地址的 `--dry-run` 读注册表但不变更插件。

**也可以用 UI 首装：** 超管进 **插件中心 → 安装插件**，填上面打印的 `…/unpacked/package`，核对权限、勾选信任后安装，再在 Deva 卡片启用。更新建议用脚本，避免把更新误做成新装。随后从 **Agent 管理 → Deva → 设置** 打开身份、MCP、模型，或访问 `/studio/plugin-agent-settings/deva/identity`。新建会话选择 Deva，发一条不调用工具的短消息确认模型连通。独立 0.8.30 实例以官方 API 验证，未实点已登录 UI 或验证真实第二台设备。

## 4. 首次配置及哪些数据不随包走

| 配置 | 在目标设备重做 |
| --- | --- |
| **模型 API** | 不填直连地址可沿用 Studio 会话模型；直连在 **Deva → 模型** 填 OpenAI 兼容 Base URL（例如 `https://api.example.com/v1`）、模型名和可选 Key，插件请求 `{Base URL}/chat/completions`。每个账号/Profile 独立。**本机、内网或 HTTP 地址须先经目标 Studio 管理员批准**：管理员可在插件配置 `modelTrustedBases` 放行精确 URL；若批准后采用模型页的单地址确认，须勾选该地址的确认框并保存，换地址要重新确认。技术上插件支持按账号/Profile 记住确认，不是独立的工单审批系统。容器内 `localhost` 指容器，不指浏览器电脑。API Key 在目标实例重新录入，不复制旧 token；直连失败不自动回退。 |
| **MCP** | 本次源机的 Deva MCP 和 Studio 原生 Ekko MCP 均报告同样 **5** 个服务已启用：`ekko-studio-api`、`ekko-studio-browser`、`ekko-studio-use`、`ekko-studio-plugins`、`hindsight`。在目标实例逐一配置、启用并测试；前四项可能由目标 Studio 托管，Hindsight 配目标端点及凭据。**Deva → MCP** 写入 `~/.deva/mcp.json` 与 `~/.deva/config.json` 的 `mcp.enabled`，不会改 Studio 原生列表；运行入口注入同名服务时宿主优先。按目标机器填 stdio 命令/路径/环境变量，或远程 URL/请求头，不要把源机凭据原样复制。 |
| **身份与本地状态** | 在 Deva 的身份页新建或迁入审核过的 `~/.deva/personas/*.md`；`~/.deva/config.json` 的 `personas` 段保存默认、排序、启用和会话选择，不同实例的会话 ID 不要照搬。路径以 Studio **运行用户**为准：`sharedDevaHome` → `DEVA_HOME` → 该用户 `~/.deva`。只迁必要的非密钥字段；账号、Profile、密钥、记忆、历史会话及工作区路径均不由 npm 包带走。 |

## 5. 更新与回滚

有新 tag 后，只取你要升级的版本；以下用已验证的 tag 展示命令形态，把 `NEXT` 改成实际发布的新 tag。沿用上节的认证环境变量或密码选项：

```bash
NEXT=deva-agent-v0.8.15
git fetch origin tag "$NEXT"
node scripts/install-deva-agent.mjs --ref "$NEXT"
node scripts/install-deva-agent.mjs --ref "$NEXT" --check
```

也可 `git fetch origin feat/plugin-deva-agent` 后使用 `--ref FETCH_HEAD`；先确认该提交的版本号和内容。不要用 Studio 的「重载」替代更新：重载运行的是已经安装的副本。更新成功后保留旧 tag/旧 tgz；操作前按目标设备策略备份身份、MCP 和本地配置，不要把备份放入 Git。

优先恢复 Studio 保存的上一版。命令显式固定目标，重复运行不会在两个版本之间来回切换：

```bash
OLD=deva-agent-v0.8.15
node scripts/install-deva-agent.mjs --rollback --ref "$OLD"
node scripts/install-deva-agent.mjs --check --ref "$OLD"
```

若上一版本已被替换，去掉 `--rollback` 用旧 tag 重新构建并覆盖；若只有备份包，解包后改用 `--package /服务端绝对路径/package`。回滚会生成新的 registry revision，恢复插件代码，不回滚独立用户数据或模型密钥。若新版本做过数据迁移，按版本说明处理备份，不要直接覆盖整份注册表。

| 症状 | 处理 |
| --- | --- |
| 版本不兼容、插件不 active | 核对 Studio 版本、目标 ref、包 ID/入口/权限；查看插件中心日志，或用超管登录读 `GET /api/studio/plugins/deva/logs`。服务端日志目录：`${HERMES_WEB_UI_HOME:-$HOME/.hermes-web-ui}/plugins/global/logs/`，文件 `deva.json` 在产生日志后才会出现。 |
| 401 / 403 | 核对访问的是目标实例、登录 token 未过期、角色是超级管理员；模型 API 的 401 是另一套凭据。 |
| 409 / revision 改变 | 安装器非零退出；不要盲重试或覆盖 registry。先重新读取当前版本、状态和 revision，再决定是否重跑。 |
| 前端仍是旧资源 | 页面硬刷新：Windows/Linux `Ctrl+Shift+R`、macOS `Cmd+Shift+R`。宿主 hashed 资产可能设置 `immutable`；反向代理缓存也须按部署方式清理。 |

## 6. 可选：复现宿主顶部「← Deva」

**这不是插件功能，包内没有这项热修。** 本机只改了宿主部署文件 `/app/dist/client/assets/js/PluginPageView-Bsu_7XTl.js:1`，原文件证据备份在本工作区 `.tmp/deva-header-20261125/backup/PluginPageView-Bsu_7XTl.js`。宿主上游源码定位是 [PluginPageView.vue:20–32](https://github.com/EKKOLearnAI/ekko-studio/blob/61cda7e6c1d0b7b17f6394a8c4f3822e6dd36944/packages/client/src/views/PluginPageView.vue#L20-L32)：匹配 `studio.pluginAgentSettings`、`pluginId === 'deva'` 及同一个 `back-link` 标题组；仅该组把文字链接换成有本地化读屏名称的箭头、隐藏斜杠，保留返回到 Agent 管理的路由和 manifest 标题。其他页面不变。

非必要不要改宿主；有宿主部署权限且 SHA-256 **完全相同**时才应用。将 `HOST_JS` 换成目标部署的真实文件：

```bash
HOST_JS=/app/dist/client/assets/js/PluginPageView-Bsu_7XTl.js
node scripts/patch-deva-studio-header.mjs "$HOST_JS"            # 默认 dry-run，不写文件
node scripts/patch-deva-studio-header.mjs "$HOST_JS" --apply     # 备份后原子替换；可重复
curl -fsS -H 'Cache-Control: no-cache' "$STUDIO_URL/assets/js/PluginPageView-Bsu_7XTl.js" | sha256sum
# 应用后：e3fde64db9d275042a01434deb1ed41003ed4436e06362d3fd1bd5ac0c1e9b02
```

应用后硬刷新。要撤回：

```bash
node scripts/patch-deva-studio-header.mjs "$HOST_JS" --rollback
curl -fsS -H 'Cache-Control: no-cache' "$STUDIO_URL/assets/js/PluginPageView-Bsu_7XTl.js" | sha256sum
# 回滚后：cc501c0899425381a90b0c4ae680b88ed132cf9fd92a39cb1b938bdffe8506ff
```

备份在资产同级的 `.tmp/PluginPageView-Bsu_7XTl.js.deva-original`，回滚前也校验哈希。之前用其它方式打过补丁但没有这份备份时，从同一构建的可信原包恢复，不要凭文件名猜。镜像重建/Studio 升级可能覆盖热修或改变 chunk 名；先重跑 dry-run，未知哈希会停止，需按新源码重新核对，不能拿旧文件覆盖新构建。没有必要为该热修重装 Deva。

## 7. 参考

- [Deva README](README.md)、[运行与存储契约](docs/CONTRACTS.md)、[运行说明](docs/OPERATIONS.md)、[Studio 官方插件手册](https://github.com/EKKOLearnAI/ekko-studio/blob/61cda7e6c1d0b7b17f6394a8c4f3822e6dd36944/docs/plugins.md)。
- 原工作区的历史验收笔记（仅供现场追溯，不随 Git 发布）：[安装测试](INSTALL-STUDIO-TEST.md)、[模型和标题热修](INSTALL-STUDIO-MODEL.md)、[MCP 与 Skills](INSTALL-STUDIO-MCP-SKILLS.md)。本指南不依赖其中的日志或备份。
