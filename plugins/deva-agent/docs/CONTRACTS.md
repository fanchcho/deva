# Deva 插件运行契约

宿主接口为 plugin API v1 与 Agent API v1。本插件注册一个 Agent、十个 RPC（身份目录的读取/保存，
Studio MCP 服务的读取/勾选保存，以及 MCP 服务本身的增删改、启停、测试）、两个 `agent-settings`
页面（`identity` 身份页、`mcp` MCP 页）和一条 `identity` 命令；不注册插件级工具、动作、事件
（Agent 自己的工具表见下文，不属于 `contracts/plugin.json#tools`）；业务数据只写 Studio 提供的
user+profile 作用域存储（身份选择 `storage.identity` 与 MCP 服务名清单 `storage.mcp`，各 version 1）
和 agent 会话存储（待办清单 `todos`、子智能体派发记录 `subagents`）。插件**没有** `configSchema`：
MCP 服务的连接配置只在 Studio 一份，插件不复制、不落盘。

## 清单

`plugin.json`：`id: deva`、`apiVersion: 1`、`server: server.mjs`、`client: client.mjs`、
`permissions: ["agents", "ui", "commands", "browser.cdp", "api.read", "api.write"]`（技能通道读接口用 `api.read`、写接口用 `api.write`；Studio MCP 服务表读写分别走 `api.read` / `api.write`）、
`views: [{id: identity, slot: agent-settings, icon: bot, order: 0}, {id: mcp, slot: agent-settings, icon: mcp, order: 1}]`
（同一个 client 入口按 `ctx.view` 分流，两个页面由宿主 Agent 设置侧栏自动排在一起），
无 `navigation`（不占主侧栏或设置侧栏），无 `configSchema`。`i18n` 覆盖 `PLUGIN_LOCALES` 全部
12 种语言的名称、描述与两个页面标题。插件版本与 `package.json` 的 `version` 必须一致（harness 校验）。

## Agent 注册

`server.mjs` 的 `apply(ctx)` 调用 `ctx.extensions.agents.register(definition)`，
返回的 disposer 同时交给 `ctx.lifecycle.add`，插件卸载/重载时释放。宿主把 id 映射成
`plugin:deva/deva`。

定义要点：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `id` / `name` / `vendor` | `deva` / `Deva` / `Deva` | Agent 身份；名字在 Agent 管理与会话选择器里显示 |
| `agentApiVersion` | `1` | 只实现这一版契约 |
| `getStatus` | `{ installed: true, version, source: 'plugin' }` | 内置实现，无外部引擎，所以恒为已安装 |
| 注册数量 | 1 个：`plugin:deva/deva`（通用，身份可切） | `createAgentDefinition({ identityId })` 仍可造固定身份 Agent，但正常安装只注册通用那一个 |
| `management.settings` | `{ viewId: 'identity' }` | Agent 管理里点「设置」直接打开身份选择页 |
| `modes.scoped.protocols` | `chat_completions` / `anthropic_messages` / `codex_responses` | 只支持 Studio 注入模型的 scoped 模式 |
| `modes.global` | 省略 | 插件不维护模型目录与凭证 |
| `features` | surfaces `chat`/`group-chat`/`workflow`/`api`，`streaming: true`，`resume: false` | 不做 checkpoint，续接靠宿主回传的历史 |

`createSession(session)` 每次会话建一个实例，`dispose()` 之后再 `run` 直接报错。
会话之间不共享可变状态：每轮重新读项目事实，避免跨会话串数据。

## 一轮运行的输入

`run(input, run)` 消费宿主的：

- `input.input`：本轮内容块。`text` 拼进用户消息；`image` 经 `run.attachments.read`
  读成 base64 交给模型；`file` 经 `run.attachments.resolve` 取 `localPath`，
  以文字说明交给模型，让它自己用 `read_file` 读——不静默丢弃任何附件（读失败会写进消息）。
- `input.history`：最多取最近 200 条，只保留 `user`/`assistant` 文本与 `tool` 结果。
- `input.instructions`：拼成「Studio 本轮附加指令」段，附在系统提示词末尾。
- `run.model`：`apiMode` / `baseUrl` / `token` / `model` / `outputLimit` / `reasoningEffort`。
  token 只在当轮使用，结束即弃；错误信息统一把 token 替换成 `[redacted]`。
- `run.paths.workspaceDir`：所有工具的操作根；没有工作区时文件与命令工具直接报错。
- `run.signal`：取消信号，透传给 `fetch` 与子进程；取消后不再发事件。
- `run.output.emit`：发 `status`、`text.delta`、`reasoning.summary.delta`、
  `tool.started`、`tool.completed`、`tool.failed`。
- `run.interactions.clarify`：`ask_user` 的唯一通道；`dismissed`/`cancelled`/`timeout`
  如实回给模型，绝不改成「默认同意」。
- `run.mcpServers`：宿主注入的 MCP 服务（实际只在任务计划运行里有内容）；插件把它与
  MCP 页勾选的 Studio 服务合并（同名宿主优先）后自行连接，跑完一轮即断开。
- `run.host.request`：读写 Studio MCP 服务表（`/api/ekko/mcp/servers*`，读需 `api.read`、写需
  `api.write`）；没有宿主通道时相关 RPC 与设置页直接报错。
- `run.state.profile`：读本轮身份选择与 Studio MCP 勾选（`namespace(String(userId)).get('identity'|'mcp')`）；
  记录缺失或指向已下线的身份时回退 `deva`，不报错。
- `run.state.agentSession`：`todo_write` 的清单存放处（键 `todos`），每轮读出附在系统提示词末尾。

## 会话内切换的两种文本入口

| 输入 | 行为 |
| --- | --- |
| `@deva:xiaomajiang 帮我看看这段` | 切本会话身份为 xiaomajiang，剥掉前缀后照常回答 |
| `deva:identity xiaomajiang` / `deva:identity` / `deva:identity default` | 只回身份状态，不调模型（本地回话） |

带前导斜杠的 `/deva:identity` 会被 Studio 的内置命令面板拦截（宿主只认自己的命令列表），
所以输入框里用上面两种写法；插件仍注册了 `identity` 命令，供 `kind:"command"` 接口调用。

## 身份（RPC 与存储）

| RPC | 输入 | 输出 | 行为 |
| --- | --- | --- | --- |
| `get-identities` | `null` | `{identities:[{id,name,description}], selected}` | 身份目录 + 当前用户/Profile 的选择；没选过返回 `deva` |
| `save-selection` | `{identity}` | `{ok:true, selected}` | 只接受目录内的 id；未知 id 报「未知身份」。下一轮生效 |

每轮系统提示词的顺序固定为：**身份**（一行「本轮身份：X」，让人设与名字可核对）→ 身份正文
（`identities/<id>.md`）→ 工具纪律 → 项目事实 → Studio 附加指令。`chat_completions` 协议下这段作为首条 `system` 消息发送；`anthropic_messages` 用 `system` 字段；`codex_responses` 用 `instructions`。

身份正文在 `identities/<id>.md`：`deva` 是项目开发身份（原 lib/prompt.mjs 的 PERSONA），
`xiaomajiang` 逐字取自仓库 `xiaomajiang-personas.ts` 的 PROMPT；`tests/identity.test.mjs`
会在仓库源文件可见时逐字节核对，漂移就失败，提醒重新抽取。

## 回传

- 文本：模型增量实时 `text.delta`；最终 `content: [{ type: 'text', text }]` 是**本文本
  轮全部增量之和**（跨工具步骤累加），保证界面所见与最终结果一致。供应商只回最终文本、
  不回增量时，用最终文本补齐差量。
- 工具：`tool.started` 先发，随后 `tool.completed`（结果字符串；超过 100000 字符返回
  `{ truncated: true, text }`）或 `tool.failed`（错误字符串）。参数不是合法 JSON 时
  记为 `tool.failed`，错误文本作为工具结果回给模型自己修正，不中断整轮。
- 结束：`finishReason` 为 `stop`（模型自然结束）、`length`（模型侧长度截断，或本轮被判复读后
  截断收尾）或 `tool_limit`（24 步到顶）。
- 正文兜底：供应商把工具调用漏成正文里的 DeepSeek DSML 标记时，适配器在 `callModel` 这一层扣留该段
  （`lib/dsml.mjs`，判定与桌面端 `providers/dsml.ts` 一致：只认正文末尾一整段、代码块内不算、只在带工具
  的请求里启用），解析成 `toolCalls` 并把 `finishReason` 由 `stop` 改为 `tool_calls`；认不出就原样放行。
  参数没写完、或撞上输出长度上限的调用打 `broken` 标记，不回给模型执行，由循环如实回灌「参数残缺」。
- 用量：只累加模型真实返回的 usage；一次都没返回就省略 `usage`，不虚构数值。

### 复读检测

流式接收正文与思考时，结尾一旦出现逐字重复的区域（同一段内容原样连续重复，阈值同桌面端
`apps/desktop/src/main/services/repetition.ts`：重复 ≥4 遍且 ≥250 字符，或 ≥10 遍且 ≥200 字符），
就掐断本步的流（`lib/repetition.mjs`、`lib/loop.mjs`）：

1. 第一次命中：丢弃本步的正文、**整步重试一次**（正文与思考两个通道一样处理）。重试不占用工具
   步数（不消耗 `maxSteps`），因为这一整步都作废了。
2. 重试后仍复读：把**本步**正文截到第一次重复处（只保留一份重复单元），接在此前各步的文字之后，
   `finishReason` 记为 `length`，并在回复末尾附一句「模型输出陷入逐字重复…」。此前各步已执行的
   工具调用与结果原样保留；本步尚未执行的工具调用直接丢弃（这一整步作废）。

如实暴露的限制：宿主事件里没有 `stream_reset`，**已经发出的 `text.delta` 无法收回**。命中时界面
预览里会短暂留着重复的尾部，最终 `content` 覆盖后恢复正常（重试成功时是重试后的正文，截断收尾时
是截断后的正文）。复读检测只认逐字相同的周期，带序号的列表、逐行不同的表格不误伤。

### 原地打转检测

连续用**相同参数**调**同一个工具**、且结果（含错误标记）完全一致时（指纹 = sha1(工具名 + 参数 + 错误位 +
结果），阈值与桌面端 `apps/desktop/src/main/shared/limits.ts` 一致）：

1. 第 3 次（`REPEAT_WARN`）：在该条工具结果后附提醒，要求换做法或基于已有结果收尾。
2. 第 5 次（`REPEAT_STOP`）：停止执行工具，改发一次收尾请求（`stop` 结束原因），要求说明已完成部分、
   卡在哪里与建议的下一步。收尾请求里模型若仍返回工具调用，一律不执行、如实回灌「已停止」，历史里
   不留悬空的 `tool_use`。

### 记忆

三层作用域，按 id 前缀自动定位：`m_` 全局、`r_` 角色（按本轮身份 id 分区）、`p_` 项目（按工作区真实路径
哈希分区）。每条记忆有类型（user / feedback / project / reference）、一句话标题（≤60 字）和正文（≤1500 字）；
上限按索引行计，全局与角色各 100 条 / 4000 字，项目 60 条 / 3000 字。

- **索引随消息下发**，不进系统提示词：system 里只有固定的记忆规则段（`lib/memory-prompt.mjs`），条目索引作为
  一条 user 消息附在用户输入之后，此后每步只在内容变化时补发。这样写一条记忆不会作废提示缓存前缀。
  索引只给 id、类型与标题；做事方式类（feedback）另附正文，其余正文用 `memory_read` 按 id 读取。
- **写满自动归纳**（`lib/memory-consolidate.mjs`）：撞上条数 / 索引字数上限时，用本轮同一个模型把已有条目
  归纳到上限七成左右（同主题合并、新的取代旧的、删过时、相对日期换具体日期），再写入新条目；归纳前把原条目
  备份到 `runtimeDir/memory-backups/`（保留 5 份）。模型输出不可解析、有条目超长、或归纳后仍接近上限，
  一律放弃并退回原来的拒写，记忆文件不动。
- **旧格式兼容**：读到 v1 的一句话 `content` 条目时按 user 类型、标题取第一句、正文保留原文来读，不回写。

## 工具

工具定义在 `lib/tools.mjs`（文件/检索/命令/项目速览）、`lib/web.mjs`（`web_fetch`）、
`lib/browser.mjs`（`browser`）、`lib/interact.mjs`（`ask_user`、`todo_write`）、
`lib/skills.mjs`（`skill_view`、`skill_manage`）、`lib/subagents.mjs`（`run_subagent`、`send_to_subagent`）、
`lib/memory.mjs`（`memory_read` / `memory_write` / `memory_delete`）。本轮可用的工具 = 以上工具 + `lib/mcp.mjs`
从已连接 MCP 服务发现并命名空间化成 `mcp__<服务>__<工具>` 的工具。

超长结果的治理水平与桌面端一致：命令输出与 MCP 结果超过上限时**全文落盘 + 首尾预览**，而不是只留
开头（`lib/spill.mjs`，对标 `apps/desktop/src/main/services/tool-results.ts`）。落盘文件在
`run.paths.runtimeDir/tool-results/`，`read_file` 能直接读回。

| 工具 | 边界 |
| --- | --- |
| 文件/检索/命令 | 一切**写入**路径以 `run.paths.workspaceDir` 为界，越界报错；只读的 `read_file` 与 `grep` 另接受本轮 `runtimeDir`（web_fetch 落盘正文、工具结果落盘文件要能读回、搜索）。文件与检索类结果 ≤ 20000 字符，超长硬截断并标注原长 |
| `run_command` | 输出超 20000 字符时全文写入 `runtimeDir/tool-results/`，只回开头与结尾各 1500 字符的预览加路径（`lib/spill.mjs`）——报错与汇总常在结尾。运行目录不可写时退回首尾预览并写明中间已丢弃 |
| `web_fetch` | 只允许 http/https，30s 超时，5MB 上限，非文本拒绝；>100000 字符写入 `runtimeDir/web/` 并给出路径 |
| `ask_user` | 走 `run.interactions.clarify`，一次最多 5 问、每题最多 6 个候选；没有 clarify 时明确报错 |
| `todo_write` | 整份覆盖 `state.agentSession` 的 `todos`，≤50 条，同一时间最多一个 `in_progress` |
| `memory_*` | 走 `state.user` 存储（`memory` 命名空间；角色层再按身份 id、项目层再按工作区真实路径哈希分区）。标题 ≤60 字、正文 ≤1500 字，同层同标题视为同一主题（内容相同则幂等成功，不同则要求带 id 更新）；全局与角色 ≤100 条/4000 字索引，项目 ≤60 条/3000 字索引，超限时先自动归纳（见上），归纳失败才拒写 |
| `browser` | 走 `host.browser`（需 `browser.cdp` 权限）：每次调用 attach → 操作 → release，不长期占用租约；元素编号页面导航后失效并明确提示重新 snapshot；截图写入 `runtimeDir/browser/` |
| `skill_view` / `skill_manage` | 只走 Studio 技能接口（`host.request`，见下节），不读宿主目录、不猜文件路径；无 `run.host` 时明确报错「没有 Studio 宿主通道」 |
| `run_subagent` / `send_to_subagent` | 复用 `runAgentTurn` 跑隔离子轮：自己的系统提示词与历史（fork 继承主对话），工具表按类型收窄且剔除交互/派生/记忆写删/技能/待办，MCP 工具全量附加；子轮 `silent`，事件不进主对话流；`depth>0` 拒绝再派生；结论 ≤20000 字符并截断标注；派发记录写 `state.agentSession` 的 `subagents`（最近 20 个），记录里保存的是子轮自己的完整消息数组（含它每轮的结论），续聊据此接上 |
| MCP 工具 | 参数与结果都当数据；单次调用 60s 超时；成功结果超 30000 字符同样落盘 + 首尾预览（错误文本原样回给模型）；服务连接失败只写进系统提示词 |

MCP 配置有两个来源，同名时宿主优先：

1. `storage.mcp` 里勾选的 Studio 服务（推荐）。MCP 页勾选，只存服务名；服务的连接配置
   只有一份，在 Studio 的 MCP 服务表里（MCP 页能直接新增/改配置/启停/测试/删除，改的就是同一份）。
   每轮 `resolveStudioServers`（`lib/studio-mcp.mjs`）用 `GET /api/ekko/mcp/servers`
   取这些服务的**当前** config，再交给 `parseServerConfig`。Studio 里改配置、停用或删除，
   下一轮就体现出来；已选但不可用的服务写进系统提示词的「MCP 连接状态」，不静默跳过。
2. 宿主注入的 `run.mcpServers`（只在任务计划运行里有内容）。

连接与断开都发生在单轮内，凭证不跨轮保留；插件不复制 Studio 的凭据，也不读写宿主配置文件。

## Studio MCP（RPC）

| RPC | 输入 | 输出 | 行为 |
| --- | --- | --- | --- |
| `get-mcp-servers` | `null` | `{servers:[{name,transport,managed,enabled}], selected:[name]}` | 服务清单来自 `GET /api/ekko/mcp/servers`（需 `api.read`）；只下发展示字段，**不含**连接配置与密钥。宿主通道或请求失败时抛错，不返回空表 |
| `save-mcp-selection` | `{servers:[name]}` | `{ok:true, selected:[name]}` | 服务名须与 Studio 规则一致（`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`）、去重、最多 32 个；写 `storage.mcp`（user+profile 作用域）。下一轮生效 |
| `get-mcp-server` | `{name}` | `{server, config}` | 单条详情：编辑表单按需回填。列表接口不下发配置，只有这里按名字单独取；服务不存在时报错。`config` 是 Studio 规范化后的形状，`stdio` 可能不带 `type`（只有 `command`/`args`/`env`/`enabled`），所以契约不要求 `type` 必填 |
| `create-mcp-server` | `{name, config}` | `{ok:true, server}` | `POST /api/ekko/mcp/servers`；配置交给 Studio 规范化（仅 `stdio` / `streamable_http`），重名与非法配置原样报错 |
| `update-mcp-server` | `{name, config}` | `{ok:true, server}` | `PATCH /api/ekko/mcp/servers/:name`，整体替换配置；服务不存在时报错，不新建 |
| `set-mcp-server-enabled` | `{name, enabled}` | `{ok:true, server}` | `PATCH` 传 `{enabled}`；停用的服务本轮不连接，Studio 也拒绝测试 |
| `delete-mcp-server` | `{name}` | `{ok:true, name}` | `DELETE /api/ekko/mcp/servers/:name`；只删 Studio 里的服务表项，插件勾选不动，下一轮按「已不存在」点名 |
| `test-mcp-server` | `{name}` | `{ok:true, tools:[{name,description}]}` | `POST /api/ekko/mcp/servers/:name/test`，由 Studio 实测连接并列工具；停用或连不上时抛错，不返回空表 |

`resolveStudioServers` 在每轮连接 MCP 前运行：先读选择（没有选择就不访问宿主），再取服务清单，
把启用且有 config 的条目转成客户端配置；选择里已删除、已停用或缺配置的服务各记一条 problem。

写入类 RPC 只回传展示字段（`server` 里没有 `config`），配置与密钥只经 `get-mcp-server` 按需下发。

## 技能（Skills）

技能是 Studio 自己维护的操作手册，本插件通过 `run.host.request` 使用宿主 Skills 接口（需
`api.read` 读、`api.write` 写；Profile 固定为本轮身份），不触碰宿主文件系统：

| 用途 | 请求 |
| --- | --- |
| 清单 | `GET /api/ekko/skills` |
| 详情（含 SKILL.md 正文） | `GET /api/ekko/skills/{name}` |
| 支持文件清单 | `GET /api/ekko/skills/{name}/files` |
| 读支持文件 | `GET /api/ekko/skills/{name}/file?path=<相对路径>` |
| 新建 | `POST /api/ekko/skills`，body `{name, content, category?}` |
| 覆盖正文 | `PUT /api/ekko/skills/{name}`，body `{content}` |
| 启停 | `PUT /api/ekko/skills/{name}/toggle`，body `{enabled}` |
| 删除 | `DELETE /api/ekko/skills/{name}` |

渐进式披露：每轮只在系统提示词里注入**已启用且校验通过**技能的 `name` + `description`
（`## 可用技能` 段落），模型命中后再用 `skill_view` 取全文，避免把全部技能塞进上下文。
技能正文里的 `allowed-tools` 只是建议文本，不参与权限判断。

已知边界（如实暴露，不做绕过）：这个接口只能写 SKILL.md 正文，**没有写支持文件的端点**；
内置技能（`builtIn: true`）的更新与删除会被宿主拒绝（400）。两种情况都把宿主原始报错交给模型
转述给用户。清单读取失败时，提示词里写的是失败说明而不是空列表——模型不会假装「没有技能」。

## 子智能体

内置类型与桌面端 `apps/desktop/src/main/services/subagents.ts` 一致：General（`tools: '*'`）、
Explore / Research / Plan（只读工具集 `read_file`、`list_dir`、`glob`、`grep`、`web_fetch`、
`run_command`）、fork（继承本轮历史与系统提示词、同一模型）。工具集只做**收窄**，每次嵌套调用照常
走同一套工具实现与工作区边界，没有提权；「只读」靠工具表加职责正文约束，不是硬保证（`run_command` 本就能写）。

并发：同一步里多个 `run_subagent` 调用会并发跑（`lib/loop.mjs` 的 `PARALLEL_SAFE`，与只读工具同一规则），
结论按模型给出的调用顺序回灌；派发记录的「读—改—写」串行化，避免并行回来时互相覆盖。

与桌面端的一处能力差异，必须如实：插件运行期内**没有「子任务结束后唤醒主轮」的通道**，所以
`run_subagent` 一律前台执行——调用会等子智能体跑完再返回结论。工具描述与系统提示词都写明这一点，
不提供 `foreground` 参数，也不假装它在后台继续跑。同理，Studio 侧没有 Task 卡，子轮的
`tool.started` 等事件不外发（`silent`），只有结论回到主轮。

## 失败行为

| 情况 | 表现 |
| --- | --- |
| 技能接口未授权或无宿主通道 | 工具结果里返回「没有 Studio 宿主通道」或宿主原始报错（如 400 Built-in skill cannot be edited），不当作成功 |
| 子智能体运行失败 | 工具结果里返回「子智能体「X」运行失败：<原始错误>」，不带假的结论与 ID |
| 非 scoped 模式或没有注入模型 | 抛错「Deva Agent 需要 Studio 注入的模型（scoped 模式）…」，不静默降级 |
| 模型请求失败 | 抛 `模型请求失败：HTTP <status> <body 前 800 字符>`，token 已打码 |
| 本轮被取消 | 抛「本轮已被取消」，不发后续事件 |
| 工具路径越界 | 工具结果里返回「路径越界」，模型可改路径重试 |
| 工具执行异常 | 记为 `tool.failed`，异常文本作为工具结果继续本轮 |

## 兼容性

只面向声明了 Agent API v1、支持 `agent-settings`/独立 Agent 管理并注入 scoped 模型的
Ekko Studio（本仓库验证版本 0.8.28）。宿主升级 Agent 契约时按 `sdk/src/agents.ts`
同步更新本文件与实现，不通过修改宿主类型绕过。
