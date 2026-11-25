# Deva for Ekko Studio

把 Deva 这个仓库做成一个 **Ekko Studio 插件 Agent**：装进 Studio 后，它在 Agent 列表里叫
`Deva`（宿主 id `plugin:deva/deva`），选中即可对话——读代码、改代码、跑 `pnpm typecheck` /
`pnpm build`，默认跟随 Studio 当前会话模型，也可在 Deva 设置中为当前账号和 Profile 配置直连 API。

**身份可选**：同一个 Agent 可以按所选身份说话，目前两个身份都取自本仓库的角色定义——

| 身份 id | 显示名 | 来源 | 适合 |
| --- | --- | --- | --- |
| `general`（默认，旧别名 `deva`） | Deva | `apps/desktop/src/main/services/deva-personas.ts` | 改代码、跑检查、写文档 |
| `xiaomajiang` | 小码酱 | `apps/desktop/src/main/services/xiaomajiang-personas.ts` | 安全研究、逆向、强度更高的执行 |

- 插件 id：`deva`（`plugin.json`）· 包名：`studio-plugin-deva` · 版本与 `package.json` 同步
- 头像：`icon.png` 直接取自 `apps/desktop/build/icon.png`（Deva 的应用图标），宿主加载时内联成
  `data:image/png;base64,…` 写进插件记录；Agent 描述符的 `icon` 回落到它，所以 Studio 里显示的是
  Deva 的图标，不再是宿主默认头像
- 入口：`server.mjs` 的 `apply(ctx)`——只注册**一个**通用 Deva Agent（`ctx.extensions.agents.register(...)`），
  外加身份 RPC / 模型 RPC / MCP RPC 与一条身份命令
- 只暴露一个 Agent：插件不再按身份各注册一个固定 Agent；身份在会话内切换（见下）
- 通过 **Agent 管理 → Deva → 设置** 打开设置页；插件不注册单独的主导航快捷入口：
  - **身份**（`views: identity`）：新增、编辑身份直接写 `~/.deva/personas/*.md`（保留桌面专属字段）；默认/会话选择写在桌面 `config.json → personas.selected/sessionSelected`
  - **MCP**（`views: mcp`）：管理与桌面同构的 MCP 服务（`~/.deva/mcp.json` + `config.json.mcp.enabled`）——
    新增、改配置、启停、测试、删除。Studio 自己的 MCP 列表完全不受影响
  - **模型**（`views: model`）：默认「跟随会话当前选择」，也可手填 Base URL、模型名和可选 API Key。

## 它怎么跑

```
Studio 选中 Agent「Deva」并选模型
  → 宿主注入 scoped 模型代理（baseUrl + token，仅本轮有效）
  → 本插件运行一轮 agent loop（lib/loop.mjs）；按设置使用 scoped 代理或自定义 API
      ├─ 系统提示词：Deva 人设 + 工具纪律 + 记忆规则段 + 本轮读到的项目事实
      │        （lib/prompt.mjs、lib/memory-prompt.mjs、lib/project.mjs；记忆索引随消息下发，不进 system）
      ├─ 模型调用：chat_completions / anthropic_messages / codex_responses 三种协议（lib/model.mjs）
      ├─ 工具：read_file / write_file / edit_file / list_dir / glob / grep / run_command / deva_project
      │        / web_fetch / browser / ask_user / todo_write / memory_* / skill_view / skill_manage
      │        / run_subagent / send_to_subagent
      │        （lib/tools.mjs、web.mjs、browser.mjs、interact.mjs、memory.mjs、skills.mjs、subagents.mjs）
      │        超长输出落盘：lib/spill.mjs；复读检测：lib/repetition.mjs
      │        记忆写满自动归纳：lib/memory-consolidate.mjs；DSML 兜底：lib/dsml.mjs；打转检测：lib/loop.mjs
      └─ MCP：连接 MCP 页勾选的 Studio 服务，工具以 mcp__<服务>__<工具> 并入本轮（lib/mcp.mjs）
  → 文本增量、工具起止事件实时回传 Studio；结束返回完整结果与用量
```

### 桌面模型

0.8.18 起，配置经管理员授权后，模型页直接读写桌面 Deva 的 `config.json → models.providers / activeModelId / activeEffort`，身份优先模型读写 `personas/<id>.md → model`。没有选定的桌面模型时显示空态；不另存 Studio 私有路由。未配置 `sharedDevaUserId` 时，模型页提示管理员授权；不会把机器级桌面配置暴露给其他账号。

两端需指向同一文件系统、同一 OS 用户的目录（`sharedDevaHome` → Studio 进程的 `DEVA_HOME` → `~/.deva`）。请先完整退出 **Deva 桌面应用**，在 Studio 保存后再打开：桌面主进程缓存配置，已打开的窗口不会自动采纳外部修改。桌面保存后，Studio 模型页重新进入或下轮对话读到新值。API Key 必须在两端各自保存，Studio 只回显「已设置」。

Studio 直连只支持有明确 Base URL 的 OpenAI Chat Completions 模型。公网 HTTPS 可用；本机、内网和 HTTP 必须由管理员在 `modelTrustedBases` 批准确切地址，页面不能自行放行。直连失败直接报错，不替换为会话模型。无桌面路由时，`scoped` 仍用宿主会话模型；`global` 需要可用的桌面路由。详见 [契约](docs/CONTRACTS.md#自定义模型-apirpc存储与推理)。

## Agent 能力

| 工具 | 用途 |
| --- | --- |
| `read_file` | 带行号读文件，支持 `offset`/`limit` 分段 |
| `write_file` | 新建或整份覆盖（局部改动用 `edit_file`） |
| `edit_file` | 精确字符串替换；命中多处时报错，要求更长的上下文或 `replace_all` |
| `list_dir` | 列目录，目录在前并带大小 |
| `glob` | `**`/`*` 通配查找，跳过 `node_modules`、`.git`、`out`、`dist` |
| `grep` | 正则搜索内容，返回 `文件:行号:内容`，可 `include` 过滤；`path` 可指定搜索根（含运行目录里的落盘结果） |
| `run_command` | 工作区根目录跑 `bash -lc`，返回退出码与 stdout/stderr，默认 120s、上限 600s；输出上限 8 MiB（超出截断并标注），超长结果落盘只回首尾预览；超时/取消终止整个进程组 |
| `deva_project` | 项目速览：版本、常用脚本、文档入口、git 分支与未提交改动 |
| `web_fetch` | 抓取 http/https 页面（30s 超时、5MB 上限），HTML 转文本；超过 10 万字符写进运行目录并给出路径 |
| `browser` | 操作 Studio 已授权共享的桌面浏览器（CDP）：打开、读取结构、点击、输入、截图、执行 JS、管理标签 |
| `ask_user` | 走 `run.interactions.clarify` 真正询问用户；关闭/超时如实返回 dismissed/timeout，不当作同意 |
| `todo_write` | 整份覆盖本会话待办清单，下一轮自动附在系统提示词里；同一时间最多一个 `in_progress` |
| `memory_read` / `memory_write` / `memory_delete` | 长期记忆三层（global 用户偏好 / role 当前身份的经验 / project 当前工作区私有经验），带类型（user / feedback / project / reference）、标题与正文；索引随消息下发，正文按 id 读取；写满时先用本轮模型自动归纳旧条目 |
| `skill_view` | 读取 Studio 技能的完整 SKILL.md（渐进式披露：清单里只有名字与描述）；传 `file` 读技能内的支持文件 |
| `skill_manage` | 创建 / 更新 / 启停 / 删除 Studio 技能；只写 SKILL.md 正文，内置技能只读 |
| `run_subagent` | 在隔离上下文里跑一个子智能体（General / Explore / Research / Plan / fork），只把结论交回主轮；前台执行，可并行发起多个 |
| `send_to_subagent` | 给已派出的子智能体续聊，让它在保留自己上下文的基础上继续；记录存在本会话（最近 20 个） |
| `mcp__<服务>__<工具>` | 本轮连接的 MCP 服务工具（stdio / Streamable HTTP / 旧版 SSE），来自 MCP 页勾选的 Studio 服务与宿主注入 |

工程事实里的 `docs/PROJECT-MAP.md` 与 `docs/FUNCTION-INDEX.md` 是本地生成物，不入库；
工作区里存在时才会出现在系统提示词与 `deva_project` 速览里，不存在就静默跳过，不影响其他能力。

## MCP 配置

**Studio → Deva → MCP** 显示原生 `/ekko/mcp` 的服务及内置项，并由 Studio 探测已启用服务的工具数。卡片的新增、编辑、启停、测试和删除走官方 Studio 接口，受同样的权限约束。**保存勾选**只改当前账号与 Profile 的 Deva 服务名单；不会启停宿主。未保存过勾选时默认继承所有启用服务，显式空勾选不连接任何 Studio 服务。

既有的桌面 `mcp.json` 保留；未在 Studio 登记的桌面服务仍可按桌面启用位使用。与 Studio 同名的旧副本不会覆盖 Studio 配置或绕过勾选。宿主本轮注入的同名配置可用于刷新连接凭据，不写入磁盘。

配置里的 `${VAR}`（环境变量与请求头的值）从插件进程环境展开；变量缺失时该服务连接失败并在
系统提示词的「MCP 连接状态」里点名缺哪个变量，不会静默跳过。连接失败只影响该服务，不中断对话。

插件对外**只注册一个 `Deva` Agent**（`plugin:deva/deva`），它出现在 Agent 选择器里；不再为每个身份各注册一个固定 Agent。身份在会话内切换，或由设置页给默认值。

两种切换方式，按使用场景挑：

| 场景 | 做法 | 生效范围 |
| --- | --- | --- |
| 会话里换身份 | 输入框发 `@deva:xiaomajiang 你的问题` 或 `deva:identity xiaomajiang` | 只影响当前会话 |
| 改默认 | **Studio → Agent 管理 → Deva → 设置 → 身份**，或用下面的 RPC | 与桌面共用的 Deva 默认值 |

> 若你想在 DSH 会话的输入框「层叠」预设里直接选到 **Deva**：由配套的 `dsh-deva-presets` 模块
> （`~/.dsh/deva-presets`）把**单个** `Deva` 预设注册进 `/api/coding-agents/dsh/agent-presets`，
> 层叠下拉里只保留一个「Deva」，不再有小码酱或「· 子任务」子预设。身份仍在上面的会话内命令里切。

备注：带斜杠的 `/deva:identity` 会被 Studio 当内置命令拦截（宿主的命令面板只认自己的列表），
所以输入框里请用不带斜杠的 `deva:identity …` 或 `@deva:<id>` 前缀；斜杠形式只在插件
`invoke` 接口（`kind:"command"`）里直接调用。

`write_file`、`edit_file` 的写入路径以会话工作区为界（符号链接按 `realpath` 解析后再校验，指向外部的链接会直接报错）；
只读的 `read_file`、`grep` 另接受本轮运行目录（`web_fetch` 落盘的正文、工具结果落盘文件要能读回、搜索）。
`run_command` 只把工作区设为 bash 的当前目录，不提供文件系统沙箱；命令和子进程仍拥有宿主进程的文件访问权限。
MCP 工具的权限由对应服务决定，文件工具的路径校验不会限制 shell 或 MCP。文件与检索类结果单条
上限 20000 字符（超长标注原长）；`run_command` 与 MCP 的超长结果在各自上限内**全文落盘 + 首尾预览**，路径在运行
目录的 `tool-results/` 下——命令报错常在结尾，只留开头会看不出为什么失败。
一轮最多 24 步工具循环，到顶返回 `finishReason: tool_limit`。同一步里的只读工具和多个子智能体会并发跑，
结果按模型给出的调用顺序回灌。

同一个工具用相同参数反复调用、结果又始终不变时，第 3 次起在该条工具结果后附提醒，第 5 次起停止执行工具、
改发一次收尾请求让模型说明卡在哪里（阈值与桌面端 `shared/limits.ts` 一致）。收尾请求里模型若仍给工具调用，
一律不执行并如实回灌「已停止」，历史里不留悬空的工具调用。

模型流里漏出的 DeepSeek DSML 工具调用会在正文层被扣留并解析回真正的工具调用（`lib/dsml.mjs`，规则与桌面端
`providers/dsml.ts` 一致）：只认正文末尾的一整段、代码块里的不算、只在带工具的请求里启用；参数没写完的调用
打上 broken 标记，不执行并如实告知，而不是当成一次成功的写入。

Gemini 3 起每步的第一个工具调用必须带思考签名，缺了整个请求 400。适配器会把收到的签名原样回放，取不到时补
官方占位 `skip_thought_signature_validator`，且只对 Gemini 请求发 `extra_content`。兼容端点不给 `index` 的
并行调用按 id 归位，避免参数被拼成一串坏 JSON。

模型输出退化、结尾开始逐字复读时，本轮会掐断这一步的流并重试一次；重试后仍复读就截到第一次重复处收尾
（`finishReason: length`，回复末尾说明原因）。判定阈值与桌面端一致，带序号的列表、逐行不同的表格不误伤。
宿主没有 `stream_reset` 事件，已经发出的增量无法撤回，界面预览在最终结果覆盖前会短暂留着重复段。

### 技能与子智能体的边界

- **技能**走 Studio 自己的技能接口（`host.request`，需要清单里的 `api.read` / `api.write` 权限）：
  已启用技能的 name + description 按会话缓存（`skill_manage` 成功后下一轮立即重读，外部改动最多延迟 30 秒），
  模型命中后用 `skill_view` 取全文。该接口只能写 SKILL.md 正文，**不能写支持文件**；内置技能只读。
  失败时把宿主原始报错交回模型，不缓存失败提示，下一轮重试。
- **子智能体**与桌面端同一套类型（General / Explore / Research / Plan / fork），工具表只做收窄。
  插件运行期内没有「子任务结束后唤醒主轮」的通道，所以 `run_subagent` **一律前台执行**：等它跑完
  再返回结论，不提供 `foreground` 参数，也不假装它在后台继续跑。子轮事件不外发（Studio 没有 Task 卡），
  只有结论回到主轮；派发记录存在本会话，供 `send_to_subagent` 续聊（最近 20 个）。

### 与桌面端仍有的能力差异

插件没有内置 `present_files`、`create_task`、`propose_agent`、`create_mcp`、`exit_plan`、`tool_search`。
其中 MCP 服务的新建、编辑、启停、删除可在插件设置页通过 Studio RPC 完成，但不是名为 `create_mcp` 的模型工具。
当前 Agent SDK 没有改写宿主历史的通道，插件不会执行宿主侧历史压缩或清理旧工具结果；`compressing` 状态不代表历史已被修改。
记忆 v1 条目在读取时兼容为 v2，尚无 `memory-tidy` 后台模型迁移。这些能力差异不由测试通过数代表已补齐。

## 身份与 `~/.deva`（与桌面同构）

`~/.deva` 的顶层条目由桌面端定义，插件不新建顶层文件/目录：
`config.json`、`personas/`、`mcp.json`、`skills/`、`data/`、`secrets.json`、`read-state.json` 等。

| 数据 | 桌面位置（插件同读同写） |
| --- | --- |
| persona 内容 | `personas/<id>.md`（frontmatter `name/description/avatar/model/workspace` + 正文） |
| 默认 persona | `config.json → personas.selected`（personas 段内的扩展键；桌面 `getConfig()` 可读，`writeEnabledMap` 合并保留） |
| 会话选择 | `config.json → personas.sessionSelected[sessionId]` |
| persona 启停/排序 | `config.json → personas.enabled/order` |
| MCP | `mcp.json → mcpServers` + `config.json → mcp.enabled` |
| 模型 | `config.json → models.providers/activeModelId` |
| 密钥 | 桌面 `secrets.json`（插件不读写密文） |

- **迁移**：旧 `deva-agent/` 整目录先备份到 `~/.deva-backups/`（`DEVA_BACKUP_ROOT` 可改），把
  `identity.json.selected` → `personas.selected`、`sessions.json` → `personas.sessionSelected`、
  `mcp-servers.json` → `mcp.json`/`mcp.enabled`，成功后删除 `deva-agent/`，不再创建。
- **persona 唯一真源**：插件不保存 persona 正文副本；`identities` 历史副本只备份、不写回、不覆盖用户文件。
- **新增、编辑**：填写名称、单行描述和 Markdown 提示词；新增默认启用并追加至桌面排序，但不改变默认身份。编辑保留同一 id、桌面专属字段和未知元数据。身份所有者可以增改；不提供删除。
- **会话内选身份**：默认取 `personas.selected`；`@deva:<id>` / `/deva:identity <id>` 写宿主会话存储 +
  `config.json.personas.sessionSelected`，只影响该会话，后续回合立即生效。
- **头像**：读 `personas/avatars/<id>.<webp|png|jpg>`（只读 data URI），无图回退首字母；`avatar` frontmatter 只是 Humation spec。
- **出错/权限**：坏 JSON、persona 不可读、路径/软链/大小异常都明确报错；`config.json`/`mcp.json` 0600，persona 目录 0700。

## 身份与 Studio MCP 的 RPC

```bash
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"get-identities","input":null}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"save-selection","input":{"identity":"xiaomajiang"}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"get-mcp-servers","input":null}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"save-mcp-selection","input":{"servers":["files"]}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"get-mcp-server","input":{"name":"files"}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"create-mcp-server","input":{"name":"files","config":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/data"]}}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"update-mcp-server","input":{"name":"files","config":{"type":"stdio","command":"npx","args":["/data"]}}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"set-mcp-server-enabled","input":{"name":"files","enabled":false}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"test-mcp-server","input":{"name":"files"}}
POST /api/studio/plugins/deva/invoke  {"kind":"rpc","name":"delete-mcp-server","input":{"name":"files"}}
```

`get-identities` 返回 `{identities:[{id,name,description}], selected, filePath, created, permissionRepaired}`；
`save-selection` 只接受身份文件里的 id，未知 id 直接报错（不会静默回退），返回 `{ok, selected, filePath}`。`get-mcp-servers` 返回
`{servers:[{name,transport,managed,enabled}], selected}`（不含连接配置与密钥），
`save-mcp-selection` 只接受 Studio 规则的服务名（字母或数字开头，可含点、下划线、连字符）、去重、最多 32 个。

MCP 服务 CRUD 走桌面同构文件（`~/.deva/mcp.json` + `config.json.mcp.enabled`），与 Studio「MCP」页互不影响：`get-mcp-server` 是唯一下发连接配置的接口
（编辑回填用），`create-mcp-server` 配置交给 Studio 规范化（只认 `stdio` 与 `streamable_http`），
`update-mcp-server` 整体替换配置、服务不存在时报错，`set-mcp-server-enabled` 启停，
`test-mcp-server` 让 Studio 连一次并列工具（停用或连不上时报错，不返回空表），`delete-mcp-server` 删除。
写入类都只回展示字段，不把配置或密钥回给页面。

身份页还用 `get-persona-editor` / `create-persona` / `update-persona` 读取和原子保存共享身份，详见运行契约。

## 开发与验收

```bash
cd plugins/deva-agent
node scripts/plugin-harness.mjs check   # 清单/契约/i18n/文档/SDK 完整性
node --test tests/*.test.mjs            # 251 个用例：工具、超长输出落盘、web、MCP、浏览器、记忆（三层/归纳/迁移）、技能、子智能体、交互、复读与打转检测、三种协议（含 DSML 恢复与 Gemini 签名）、loop、身份、Studio MCP 与 MCP 服务 CRUD、RPC、harness
```

测试全部离线：假网关在 `127.0.0.1` 上回放 SSE，不访问真实模型、不读用户目录。

## 安装到 Studio

跨设备安装、升级和回滚见 [安装指南](INSTALL.md)。普通安装使用 `npm pack` 的解包成品，
不链接开发源码；新版本使用覆盖安装，不能用「重载」替代。

## 文档

- `docs/ARCHITECTURE.md`、`docs/STUDIO_CTX.md`、`docs/STUDIO_RETURNS.md`、`docs/HOST_API.md`、
  `docs/FIELD_REFERENCE.md`、`docs/DEVELOPMENT.md`：随 SDK 分发的宿主说明
- `docs/CONTRACTS.md`：本插件的运行契约（输入、事件、结果、模型代理、失败行为）
- `sdk/src/*.ts`：宿主类型（`agents.ts` 是 AgentDefinition / AgentRunContext 的准确定义）

### Ekko 规范核对与发布内容

本插件以 Studio SDK v1 的 Agent 运行时为接入点。官方开发手册：
https://github.com/EKKOLearnAI/ekko-studio/blob/61cda7e6c1d0b7b17f6394a8c4f3822e6dd36944/docs/plugins.md 。
历史逐章审计保存在原工作区，未随发布；剩余兼容性/产品决策不能由单测通过替代。

`package.json.files` 列出发布所需入口、运行模块、身份、契约、SDK（含许可/署名）、文档与测试；
本地证据、审计报告、临时缓存和基线副本不进入 npm 包。安装使用已构建的 `.mjs`，不依赖宿主执行安装脚本。
开发链接仍指向源码目录；不要把包含本地证据的整个工作目录当作精简发布包。

## 附件、恢复与可选策略（Ekko 0.8.30）

历史附件与本轮附件统一做授权根/预算/过期校验；二进制仅返回明确的 metadata_only 和绝对路径。MCP 配置编辑对 env/headers 采用固定掩码：未改保留、新字符串替换、null 清除。Agent 已实现 checkpoint 恢复，完成调用不重放，结果未知时先核对。

插件设置新增附件预算与显式授权根；高风险工具审批和 Hermes/Ekko 普通单聊 compression **默认关闭**。后者运行时探测宿主接口，不改变 Deva 的历史。详细默认值、错误码、迁移、审批覆盖面、恢复限制与发布条件见 [运行说明](docs/OPERATIONS.md)。真实 Desktop 验证状态见本轮审计报告，未把 mock 测试当作实际挂载通过。
