# Deva Agent 安装、更新和回滚：Ekko Studio 0.8.30

**Studio 不支持把源码 bundle 或 `.tgz` 直接上传、导入为插件。** 本轮验证的官方安装入口是「插件中心」或管理 API：把**已解包的成品目录放到 Studio 服务端**，让 Studio 从其绝对路径复制和注册。Git bundle 能恢复源码，不是即装即用的离线安装包。

执行记录（2026-11-25）：本机 Studio 0.8.30 已热装 **Deva 0.8.17**，并用 `GET /api/studio/plugins` 读回 active / enabled（版本与 revision 见本轮报告）。发布件跟随 [deva-agent-v0.8.17](https://github.com/fanchcho/deva/tree/deva-agent-v0.8.17)。插件 ID `deva`，Agent ID `plugin:deva/deva`。Windows 请看 [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md)。

> **0.8.18（标签 `deva-agent-v0.8.18`）**：模型页改读写桌面 Deva 的模型与身份绑定；需要管理员设置 `sharedDevaUserId`，非公网地址需批准 `modelTrustedBases`。MCP 页改用 Studio 原生服务表，勾选只控制本 Agent。三页顶栏仍由 Studio 宿主渲染，插件不能改，0.8.18 未改页头。桌面端只在启动时读配置，保存前请先退出桌面端；API Key 两端各自设置。下文步骤按 0.8.17 写成并验证，安装 0.8.18 时把其中的 tag 换成 `deva-agent-v0.8.18`。


## 1. Studio 实际支持哪些入口

| 入口 | 前置条件和格式 | 本轮结果 |
| --- | --- | --- |
| 插件中心 → 安装插件 | Studio **超级管理员交互登录**。安装弹窗为 source 文本框 + 信任确认，不是文件选择器；浏览器所在机器的路径不等于 Studio 服务器的路径。 | 登录态点击**未实测**。源码 [StudioPluginsView.vue:218–220,426–434](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/packages/client/src/views/StudioPluginsView.vue#L426-L434) 确认同一安装 API。 |
| 服务端绝对目录（UI 或 API） | 主机进程可读的**成品根目录**，包含 `package.json`、`plugin.json`、已构建的 client/server 入口和所需文件；版本一致，入口必须在包内。宿主复制目录，不代跑 npm build/install。Docker 要把目录挂载到容器可见的绝对路径。 | Linux 隔离 Studio **已实测**，禁止测试进程外联时仍能安装和启用。绝对 `.tgz` 文件路径报 `400 PLUGIN_INVALID: Local plugin source must be a directory`；不存在目录本轮报 `500 ENOENT`。 |
| npm registry 精确版本 | `package@1.2.3` 或 `@scope/package@1.2.3`，需要宿主能从配置仓库获取发布包及生产依赖。宿主用 `--ignore-scripts --omit=dev`，不能依靠生命周期脚本生产入口。 | 宿主联网安装路径由源码确认；外联阻断时用 `is-number@7.0.0` 做负对照（它不是 Studio 插件）：请求报 `422 PLUGIN_INSTALL`。不带版本被拒绝。Deva 0.8.17 的 `package.json` 是 `private: true`；本轮公共 npm 该包返回 404，**不要用 npm 源安装此插件**。 |
| Git / 插件市场 | 普通公开 GitHub 仓库 URL 由宿主在线解析 **默认分支最新完整 SHA**；另支持 `github:owner/repo#完整40位SHA`、`git+https://gitlab.com/group/repo.git#完整40位SHA` 与 Gitee 同类固定源。市场走发布目录给的固定源与版本并需确认信任；不是任意 zip 上传。 | 普通 GitHub 源在外联阻断时实测 `422 PLUGIN_SOURCE_RESOLVE`。Deva 是 monorepo 子目录，发布 tag 根目录的 `plugin.json` 返回 404，插件子目录有清单；**不要把本仓库 URL、Git SSH 地址、GitHub tag URL 或子目录 URL 填作本插件安装源**。市场条目和已登录市场安装未实测。 |
| CLI / 开发模式 | `ekko-studio plugins create/link/list/dev/unlink` 管开发项目；使用同一个 `HERMES_WEB_UI_HOME`，到插件中心确认信任并启用才是开发运行。无通用 `plugins install <tgz>` 命令。项目可被构建和监听，不是正式部署。 | 0.8.30 实测 help、link、list、unlink；link 只登记，未触发现用 Studio 的任何安装。开发启用及热更新 UI 未实测。 |
| 随宿主内置插件 | 宿主自己的 `builtin:` 解析与校验是分发机制，不意味着用户可把文件塞到宿主目录自行注册。 | 源码确认，未用此路径部署 Deva。 |

依据：[Studio 安装手册](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/docs/plugins.md)、[installer.ts:13–76](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/packages/server/src/modules/studio/services/plugins/installer.ts#L13-L76)、[manager.ts:91–177](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/packages/server/src/modules/studio/services/plugins/manager.ts#L91-L177)、[GitHub 解析源码](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/packages/server/src/modules/studio/services/plugins/source.ts)。本轮保存了 [OpenAPI 端点详情](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/openapi-studio-plugins.json>)、[安装 API 原始验收](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/install-api-results.txt>)、[CLI 登记轨迹](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/cli-link.txt>) 与 [远端来源验证](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/public-source-probes.txt>)。

## 2. 联网构建，再安装成品

先准备 Git、Node ≥20（本轮 Node 24/npm 11）、npm、tar；Studio 宿主已安装启动且能登录，自己通过 npm 启动 Studio 0.8.30 则其 Node 要求 ≥23。下面是 Linux 可执行流程；远端 Studio 时要把成品传到服务器上解包。

```bash
git clone --branch deva-agent-v0.8.17 --depth 1 https://github.com/fanchcho/deva.git
cd deva
git rev-parse HEAD  # 应为 deva-agent-v0.8.17 指向的提交（发布页或 git ls-remote 可核对）
node scripts/install-deva-agent.mjs --ref deva-agent-v0.8.17 --dry-run
```

第一段从发布 tag 克隆；`--dry-run` 从本地 ref 导出插件子目录、装开发依赖并运行 npm pack；包的 prepack 有 harness 与测试。它打印 `studio-plugin-deva-0.8.17.tgz` 和解包 `package/` 的绝对路径，**此时还未注册插件**。需要转运时传 tgz（核对上传前后的 SHA-256），在服务器解包。例如在服务器可写工作目录：

```bash
OUT="$PWD/.tmp/deva-agent-package"
mkdir -p "$OUT"
tar -xzf "/收到的绝对路径/studio-plugin-deva-0.8.17.tgz" -C "$OUT"
test -f "$OUT/package/plugin.json"
printf '%s\n' "$OUT/package"
```

**UI 安装**：目标 Studio → 插件中心 → 安装插件 → 填解包的目录 → 信任 → 安装 → 启用。更新已有同 ID 插件时在详情里选升级，不用当作首装再安装。UI 点击未实测；下列同一 API 已实测。

**用仓库脚本调官方 API**：在含 `scripts/install-deva-agent.mjs` 的仓库根执行，`OUT` 可以指向上述目录，若用 dry-run 成品则把 `SOURCE` 改为实际打印的 package 绝对路径。地址是目标 Studio 的 HTTPS origin（仅 loopback 可为 HTTP），密码在终端输入，不进入日志：

```bash
set +x
export STUDIO_URL=http://127.0.0.1:8648
SOURCE="$OUT/package"
read -rsp '目标 Studio 超管密码: ' STUDIO_ADMIN_PASSWORD; printf '\n'
export STUDIO_ADMIN_PASSWORD
node scripts/install-deva-agent.mjs --username admin --password-env STUDIO_ADMIN_PASSWORD --package "$SOURCE" &&
node scripts/install-deva-agent.mjs --username admin --password-env STUDIO_ADMIN_PASSWORD --package "$SOURCE" --check
unset STUDIO_ADMIN_PASSWORD
```

已有目标 Studio 超管的 Bearer 时可用环境变量 `STUDIO_API_TOKEN`，省略 username/password 参数。脚本 `--package` 跳过 Git、npm、tar 构建，但 **仍通过 Studio HTTP API 安装，不会直接写 registry**（`scripts/install-deva-agent.mjs:77–90,120–160,169–213,226–247`）。

管理 API 使用 `GET /api/studio/plugins` 取 registry revision；`POST /api/studio/plugins/install` JSON 传 `source`（绝对目录）、最新 `revision`、`trusted:true`、`expectedVersion`；覆盖已有插件带 `pluginId:"deva"`。新装默认 disabled，`PATCH /api/studio/plugins/deva` 传最新 revision 与 `enabled:true`，再 GET 验证 `version`、`active`、`enabled=true`。不可用普通 Agent 运行令牌替代超管。插件详情/管理 API 负责注册、启停与回滚，不要手工写 `state.json`。

## 3. 纠正离线结论

- **没有「空白电脑 + 单个 bundle/tgz + 无网」自动装好 Studio 和 Agent 的证据。** Git bundle 只装有 Git 对象。把 tgz 直接填到 Studio，实测失败；没有 Studio 服务、超管会话、服务端目录权限和构建/解包工具，不能从文件完成安装。客户端完全不能访问服务端时，管理 API 本身也不可用。
- **有已运行 Studio 和预制包时，宿主无需访问公网即可本地目录安装。** 上一轮（0.8.15 发布时）复用与现场二进制 SHA-256 相同的 Studio 0.8.30，在独立 home/registry 上用 `LD_PRELOAD` 拦截被测进程及继承环境的子进程对外的 `connect/sendto/sendmsg`，负对照公网 TCP 返回 `ENETUNREACH`。已解包目录实测安装 0.8.15、启用到 revision 2、覆盖 0.8.17 至 3、回滚 0.8.15 至 4；旧 revision 被 409 拒绝。这不是机器级断网，也没验证外部模型或 MCP 可用。
- **用于手头这一个发布 tag，源码构建在限定条件下可复现，不应说 bundle 文件损坏。** 完整 bundle 从干净目录克隆命中既定 SHA；本轮用新缓存、`npm_config_offline=true` 和同样的进程外联限制运行 `--dry-run`，确实产生包。其开发依赖是包内 `file:./sdk`，没有 npm 运行时依赖。换版本、缺 Git/Node/tar、需要其它依赖、目标机无可用 Studio 时不能套用。先在有完整工具的机器制备和核对 tgz，再拷贝 tgz 或已解包的 `package/` 到宿主，是更稳的交付法；不要搬现用 registry、账号库或整个配置目录。
- 证据：[外联负对照](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/network-negative-control.txt>)、[源码 dry-run](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/offline-source-dry-run.txt>)、[同一限制下的真实 ref 安装](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/offline-source-real-install.txt>)（覆盖至 revision 6，`--check` 读回 active/enabled）、[预制目录脚本安装](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/installer-package-upgrade.txt>)。无法从当前证据倒推另一台设备当时具体失败在哪个命令。

## 4. 首次配置与验收

打开「Agent 管理 → Deva → 设置」。默认用 Studio 当前会话模型，或录入该账号/Profile 的自定义模型 Base URL（OpenAI 兼容）和 Key；**本机/内网/HTTP 地址先经目标管理员批准**。MCP 需要在目标机逐项配置、启用和测试；插件 MCP 的 `mcp.json` + `config.mcp.enabled` 与 Studio 原生 MCP 列表分开，不复制未审阅的旧机凭据。身份从宿主运行账号的 `~/.deva/personas` 读取，可按 [审计报告](../../out/DEVA-DOT-DEVA-AUDIT.md) 迁移审阅过的 Markdown 与必要非密钥字段；会话、模型凭据、历史和权限不随包。设置页顶部标题由 Studio 宿主渲染（「Agent 管理 / Deva」），不在本插件交付范围内，也不改 Studio 部署目录。

## 5. 更新、回滚与排错

联网更新：在来源仓库将 `NEXT` 设为实际已发布的新 tag，使用上面的目标 Studio 超管凭据；以下采用 Bearer 环境变量。保留旧 tag 或旧成品。

```bash
git fetch origin tag "$NEXT" &&
node scripts/install-deva-agent.mjs --ref "$NEXT" &&
node scripts/install-deva-agent.mjs --ref "$NEXT" --check
```

不联网或不想在宿主构建：传送新成品、解包、改用 `--package` 安装并检查。真正跨版本写入提高 revision，同版检查不提高；保留上一版可用时以旧 ref 回滚，示例：

```bash
OLD=deva-agent-v0.8.15
node scripts/install-deva-agent.mjs --rollback --ref "$OLD" &&
node scripts/install-deva-agent.mjs --check --ref "$OLD"
```

也可在插件详情使用宿主「回滚」。API 是 `PATCH /api/studio/plugins/deva` 传 `action:"rollback"` 和最新 revision；没有保留副本时重新安装可信旧包。回滚的是安装版本，不是 Profile、凭据或用户数据；卸载前先备份，并从 UI/官方 PATCH 操作，不直接删注册表。上一轮在隔离环境备份 registry 及 versions 后测试，未写生产。更新命令以 0.8.16 → 0.8.17 真实升级验证（本机 0.8.30 也完成 0.8.17 热装）；回滚命令从 0.8.17 真实退到 0.8.15。[更新回读](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/documented-update.txt>) · [回滚回读](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/documented-rollback.txt>)。

401/403 查登录和角色；409 重新取 revision，不覆盖状态；版本不符核对两份 manifest 和 expectedVersion；查插件日志 `GET /api/studio/plugins/deva/logs`（超级管理员），或目标实例 `HERMES_WEB_UI_HOME/plugins/global/logs/`；前端仍见旧静态资源时硬刷新。不要把「重载」当成取新版本，或把模型 API 401 当插件安装失败。

**未实测：** 已登录浏览器点击安装/升级/市场流程、Windows 真机、真实第二台设备、机器级完全断网从零部署、其它插件的联网 npm/固定 Git/市场成功安装、目标模型与 MCP 联通，以及尚未发布的未来版本。
