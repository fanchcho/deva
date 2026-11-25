# Deva 插件运行契约

宿主接口为 plugin API v1 与 Agent API v1。本插件注册一个 Agent、身份读写及会话选择 RPC、模型和 MCP RPC、三个 `agent-settings`
页面（`identity` 身份页、`mcp` MCP 页、`model` 模型页）和一条 `identity` 命令；不注册插件级工具、动作、事件
（Agent 自己的工具表见下文，不属于 `contracts/plugin.json#tools`）；业务数据写在两类地方：身份**内容**是桌面端自己的 `~/.deva/personas/<id>.md` + `config.json` 的
`personas.*`（见[身份与 persona](#身份与-persona文件deva)）；默认/会话选择写桌面 `config.json → personas.selected/sessionSelected`；Studio MCP 管理走宿主 API，Deva 勾选写当前用户/Profile 状态；会话数据写 agent 会话存储（`todos`、`subagents`、附件预算与 checkpoint）。旧 `deva-agent/` 只做一次性迁移备份，不再创建。
`storage.identity` 只是 0.8.3 的旧记录，仅作 seed 参考。插件的 `configSchema` 定义附件、可选策略和仅管理员可改的自定义模型网络批准列表：
Studio MCP 连接配置保留在宿主，旧桌面 MCP 文件不迁入 Studio。

## 清单

`plugin.json`：`id: deva`、`apiVersion: 1`、`server: server.mjs`、`client: client.mjs`、
`permissions: ["agents", "ui", "commands", "browser.cdp", "api.read", "api.write", "compression"]`（技能通道读接口用 `api.read`、写接口用 `api.write`；MCP 走 Studio API）、
`views: [{id: identity, slot: agent-settings, icon: book, order: 0}, {id: mcp, slot: agent-settings, icon: mcp, order: 1}, {id: model, slot: agent-settings, icon: settings, order: 2}]`
（同一个 client 入口按 `ctx.view` 分流，三个页面由宿主 Agent 设置侧栏自动排在一起），
不注册 `navigation.main`；`configSchema` 默认关闭审批与普通单聊摘要。`i18n` 覆盖 `PLUGIN_LOCALES` 全部
12 种语言的名称、描述和三个页面标题。插件版本与 `package.json` 的 `version` 必须一致（harness 校验）。

## Agent 注册

`server.mjs` 的 `apply(ctx)` 调用 `ctx.extensions.agents.register(definition)`，
返回的 disposer 同时交给 `ctx.lifecycle.add`，插件卸载/重载时释放。宿主把 id 映射成
`plugin:deva/deva`。

定义要点：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `id` / `name` / `vendor` | `deva` / `Deva` / `Deva` | Agent 身份；名字在会话选择器里显示 |
| `agentApiVersion` | `1` | 只实现这一版契约 |
| `getStatus` | `{ installed: true, version, source: 'plugin' }` | 内置实现，无外部引擎，所以恒为已安装 |
| `management.settings` | `{ viewId: 'identity' }` | 从宿主 Agent 管理打开身份页；侧栏可切换 MCP 和模型 |
| 注册数量 | 1 个：`plugin:deva/deva`（通用，身份可切） | `createAgentDefinition({ identityId })` 仍可造固定身份 Agent，但正常安装只注册通用那一个 |
| `modes.scoped.protocols` | `chat_completions` / `anthropic_messages` / `codex_responses` | 宿主运行仍为 scoped；跟随会话用注入代理，有自定义地址时由 Deva 直连 Chat Completions |
| `modes.global` | 省略 | 不使用宿主 global 原生引擎模式 |
| `features` | surfaces `chat`/`group-chat`/`workflow`/`api`，`streaming: true`，`resume: true` | 实现 checkpoint()/resumeState，已完成调用不重放，结果未知的操作不自动重试 |

`createSession(session)` 每次会话建一个实例，`dispose()` 之后再 `run` 直接报错。
会话之间不共享可变状态：项目事实与技能清单各有 30 秒的会话内缓存。
写文件、编辑文件或执行命令后立即使项目事实缓存失效；技能修改后立即使技能清单缓存失效。

## 一轮运行的输入

`run(input, run)` 消费宿主的：

- `input.input` 和 `input.history` 共用附件转换：resolve(assetId) 后验证真实路径与预算，受限读取图片/UTF-8 文本；二进制返回 metadata_only 与绝对路径，明确未解析正文。越界/超额/过期有 JSON 错误码。
- `input.history`：最多最近 200 条；更早消息数量显式报告。历史附件也验证，不再过滤。
- `input.instructions`：拼成「Studio 本轮附加指令」段，附在系统提示词末尾。
- `run.model`：`apiMode` / `baseUrl` / `token` / `model` / `outputLimit` / `reasoningEffort`。
  token 只在当轮使用，结束即弃；错误信息统一把 token 替换成 `[redacted]`。
- `run.paths.workspaceDir`：所有工具的操作根；没有工作区时文件与命令工具直接报错。
- `run.signal`：取消信号，透传给 `fetch` 与子进程；取消后不再发事件或启动后续工具，
  包括等待并发名额的子智能体。已发送到外部系统的操作不保证回滚。
- `run.output.emit`：发 `status`、`text.delta`、`reasoning.summary.delta`、
  `tool.started`、`tool.completed`、`tool.failed`。
- `run.interactions.clarify`：`ask_user` 的唯一通道；`dismissed`/`cancelled`/`timeout`
  如实回给模型，绝不改成「默认同意」。
- `run.mcpServers`：宿主注入的 MCP 服务（由宿主按运行入口决定，不假设普通对话一定为空）；插件把它与
  MCP 页勾选的 Studio 服务合并（同名宿主优先）后自行连接；坏配置的原因写进「MCP 连接状态」。
  配置不变时在同一会话内跨轮复用，配置或凭证变化时重连，会话释放时断开。
- `run.host.request`：读写 Studio MCP 服务表（`/api/ekko/mcp/servers*`，读需 `api.read`、写需
  `api.write`）；没有宿主通道时相关 RPC 与设置页直接报错。
- `run.state.profile`：读 Studio MCP 勾选（`namespace(String(userId)).get('mcp')`）。身份不再从这里读：
  `~/.deva/personas/*.md`（唯一真源）决定身份内容与可选列表，`config.json → personas.selected` 决定插件默认用哪个；
  旧 `identity` 记录只在迁移时作为兜底候选，之后不读、不删。
- `run.state.agentSession`：`todo_write` 的清单存放处（键 `todos`），每轮读出附在系统提示词末尾。

## 自定义模型 API（RPC、存储与推理）

| RPC | 输入 | 行为 |
| --- | --- | --- |
| `get-model-selection` | `null` | 桌面默认的 `modelRef`、地址、模型名、强度、已启用的候选模型及身份绑定；只回显 Studio 密钥是否已设置 |
| `save-model-selection` | `{modelRef?,baseUrl,modelName,apiKey?,reasoningEffort?}` | 选择已有的桌面模型，更新所选提供方，或以空 ref 新建独立提供方；地址和模型名均为空可清除默认引用。输入被拒时返回字段级 `error` |
| `save-persona-model` | `{personaId,modelRef}` | 只改身份文件的 `model`，空 ref 删除覆盖；读回同模型页 |

- 管理员显式指定 `sharedDevaUserId`，只有该账号可访问桌面模型；未授权只显示提示，不读取旧私有路由。路径依次为 `sharedDevaHome`、Studio 进程的 `DEVA_HOME`、`~/.deva`。共享目录和文件必须同 OS 用户、同文件系统，保留 POSIX 归属、安全文件类型和写前原文比对。两端不跨机器自动传输配置。
- 桌面唯一真源：`config.json.models.providers[].{adapter,apiHost,models[]}`、`activeModelId`、`activeEffort`；模型引用按首个冒号拆开。`personas/*.md` 的有效绑定优先于桌面默认。未选中时不造默认；`scoped` 可跟随 Studio 会话，`global` 无路线时报错。已有明确选择但适配器不是 OpenAI Chat Completions 或无明确地址时，Studio 推理报错，不冒用其它协议。桌面不修改运行中快照，外部保存前请退出桌面 Deva、保存后重新打开。
- 迁移只对授权账号发生：匹配同地址＋模型的 Desktop provider 时重用；否则导入一个独立提供方。已有有效桌面默认不覆盖，旧选择保留在候选项里；没有有效默认才采用可迁移旧值。迁移成功后删除原私有路由；需要批准的新增地址未经允许时明确报错并保留旧记录。只有旧 Studio 目录 ID、没有可解释的路由时提示重新选择。
- API Key 存 Studio 服务端用户 + Profile，按 providerId 与规范化 Base URL 绑定；不写 Desktop 配置，不读/解密 Electron safeStorage 明文。省略保留，空串清除；已存在桌面凭据的 provider 更换 URL 被拒。修改环境复用同一 Desktop 路径时，不把旧地址 Key 带到新地址。
- 本机、内网与 HTTP 只有在管理员精确配置 `modelTrustedBases` 时允许直连。旧 `allowNonPublic` 输入与 `modelNetworkConsent` 不会授予网络权限。DNS 固定、出站不继承重定向；错误状态、非 SSE 或连接失败不回退。新版强度 `low/medium/high/xhigh/max` 写桌面 `activeEffort`，默认不发送；旧版专有 `minimal` 不改写成其他档位。
- `global` 模型目录保留稳定 ID `deva-direct`；有配置才返回，目录不含 Base URL 或 Key。会话显式强度仍优先于默认，直连被上游拒绝时不移除参数偷偷重试。

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
| `get-identities` | `null` | `{identities, selected, filePath, personasDir, created, migrated, permissionRepaired}` | 身份内容从 personas 目录读；默认选择从 `config.json.personas.selected` 读/写；旧 `deva-agent` 一次性迁移（`migrated:true`）；损坏/不可读直接报错 |
| `get-persona-editor` | `{id}` | `{id,name,description,prompt,revision}` | 仅身份所有者读取指定身份的可编辑字段；版本是所读文件 SHA-256 |
| `create-persona` | `{name,description,prompt}` | `{id}` | 新建 0600 Markdown；登记在 `order` 与 `enabled=true`；不改默认选择 |
| `update-persona` | `{id,name,description,prompt,revision}` | `{id}` | 只替换名称、描述与正文；原子写回；版本陈旧则拒绝 |
| `save-selection` | `{identity}` | `{ok:true, selected, filePath}` | 只接受 personas 目录里的 id（`deva` 为旧别名）；未知 id 报「未知身份」；只改 `selected`。下一轮生效 |

每轮系统提示词的顺序固定为：**身份**（一行「本轮身份：X」，让人设与名字可核对）→ 身份正文
（`personas/<id>.md` 的正文）→ 工具纪律 → 项目事实 → Studio 附加指令。会话内 `@deva:<id>` /
`deva:identity <id>` 只写会话级覆盖（宿主会话存储），不修改文件里的默认值；会话覆盖指向文件里已删除的
身份时回落到文件默认值。`chat_completions` 协议下这段作为首条 `system` 消息发送；`anthropic_messages` 用 `system` 字段；`codex_responses` 用 `instructions`。

插件包里的 `identities/*.md` 现在只作为**首次种子**（`deva` → `general`）：`deva` 是项目开发身份，
`xiaomajiang` 逐字取自仓库 `xiaomajiang-personas.ts` 的 PROMPT；`tests/identity.test.mjs` 会在仓库
源文件可见时逐字节核对小码酱正文。运行期身份正文只从 `~/.deva/personas/<id>.md` 读。

## 身份与 persona 文件（`~/.deva`）

| 数据 | 桌面位置 |
| --- | --- |
| persona 内容 | `<root>/personas/<id>.md`（frontmatter + 正文） |
| 默认 persona | `<root>/config.json → personas.selected` |
| 会话选择 | `<root>/config.json → personas.sessionSelected[sessionId]` |
| MCP | `<root>/mcp.json → mcpServers` + `config.json → mcp.enabled` |
| 模型 | `<root>/config.json → models.*` |
| 密钥 | `<root>/secrets.json`（桌面 safeStorage，插件不读写） |

规则：旧 `deva-agent/` 整目录备份到 `~/.deva-backups/` 后迁移并删除；插件不创建任何新的 `.deva` 顶层条目；
`config.json` 顶层浅合并、段内未知键保留；persona 正文只读写唯一文件、不复制；损坏/权限异常明确报错。

宿主的设置 action 打开 `agent-settings` 身份页；三页侧栏及返回入口由宿主渲染。
不依赖独立导航注册，也不改用户保存的导航偏好；会话 Agent ID 不变。
新增/编辑按真实调用账号校验：`sharedDevaUserId`（配置时）否则宿主激活插件的账号。
显示名按 NFKC / 不区分大小写判重，保留原显示文本；名称/描述拒绝换行和控制字符，
不接受手填 id。新 id 与桌面相同：最多 40 字符的 ASCII slug（无则 `persona`）+ 8 位随机 hex。
桌面专属字段 `avatar/model/workspace`、未知头部、头像文件不由 Studio 编辑；未设置时采用桌面默认。
新增若登记写盘失败，尝试撤销本次新文件；若文件已变或撤销失败，明确报部分失败。
无删除身份 RPC。

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
| 文件/检索 | `write_file`、`edit_file` 的写入路径以 `run.paths.workspaceDir` 为界，越界报错；只读的 `read_file` 与 `grep` 另接受本轮 `runtimeDir`（web_fetch 落盘正文、工具结果落盘文件要能读回、搜索）。文件与检索类结果 ≤ 20000 字符，超长硬截断并标注原长 |
| `run_command` | 工作区仅是 bash 的当前目录，不构成文件系统沙箱；命令及子进程使用宿主进程权限。输出超 20000 字符时全文写入 `runtimeDir/tool-results/`，只回开头与结尾各 1500 字符的预览加路径（`lib/spill.mjs`）——报错与汇总常在结尾。运行目录不可写时退回首尾预览并写明中间已丢弃 |
| `web_fetch` | 只允许 http/https，30s 超时，5MB 上限，非文本拒绝；>100000 字符写入 `runtimeDir/web/` 并给出路径 |
| `ask_user` | 走 `run.interactions.clarify`，一次最多 5 问、每题最多 6 个候选；没有 clarify 时明确报错 |
| `todo_write` | 整份覆盖 `state.agentSession` 的 `todos`，≤50 条，同一时间最多一个 `in_progress` |
| `memory_*` | 走 `state.user` 存储（`memory` 命名空间；角色层再按身份 id、项目层再按工作区真实路径哈希分区）。标题 ≤60 字、正文 ≤1500 字，同层同标题视为同一主题（内容相同则幂等成功，不同则要求带 id 更新）；全局与角色 ≤100 条/4000 字索引，项目 ≤60 条/3000 字索引，超限时先自动归纳（见上），归纳失败才拒写 |
| `browser` | 走 `host.browser`（需 `browser.cdp` 权限）：每次调用 attach → 操作 → release，不长期占用租约；元素编号页面导航后失效并明确提示重新 snapshot；截图写入 `runtimeDir/browser/` |
| `skill_view` / `skill_manage` | 只走 Studio 技能接口（`host.request`，见下节），不读宿主目录、不猜文件路径；无 `run.host` 时明确报错「没有 Studio 宿主通道」 |
| `run_subagent` / `send_to_subagent` | 复用 `runAgentTurn` 跑隔离子轮：自己的系统提示词与历史（fork 继承主对话），工具表按类型收窄且剔除交互/派生/记忆写删/技能/待办，MCP 工具全量附加；子轮 `silent`，事件不进主对话流；`depth>0` 拒绝再派生；结论 ≤20000 字符并截断标注；派发记录写 `state.agentSession` 的 `subagents`（最近 20 个），记录里保存的是子轮自己的完整消息数组（含它每轮的结论），续聊据此接上 |
| MCP 工具 | 参数与结果都当数据；单次调用 60s 超时；成功结果超 30000 字符同样落盘 + 首尾预览（错误文本原样回给模型）；服务连接失败只写进系统提示词 |

Studio 权威清单来自 `GET /api/ekko/mcp/servers`，按当前调用者的 Profile 与权限执行。可用工具由 Studio 原生 `/test` 执行 `tools/list`；探测失败计数未知，清单 401/403、结构异常和服务错误都不是空态。桌面 `mcp.json` 保留，只消费 Studio 清单中无同名项的桌面服务。宿主本轮注入与 Studio 已勾选服务同名时优先使用其配置，不落盘。

## Deva MCP（RPC）

| RPC | 输入 | 行为 |
| --- | --- | --- |
| `get-mcp-servers` | `null` | 读 Studio 已启用/已禁用及默认服务、真实工具数或探测失败位、Deva 勾选；不下发连接配置 |
| `save-mcp-selection` | `{servers:[name]}` | 当前账号/Profile 的 Deva 勾选，最多 32 项。不存在或宿主已停用的名称拒绝保存；不改宿主启用位 |
| `get-mcp-server` | `{name}` | 读来自 Studio 的连接详情；env/headers 值只回掩码 |
| `create-mcp-server` | `{name,config}` | 新增 Studio 服务 |
| `update-mcp-server` | `{name,config}` | 更新 Studio 服务，env/headers 掩码保留、null 清除 |
| `set-mcp-server-enabled` | `{name,enabled}` | 更新 Studio 启用位，与保存勾选的作用域不同 |
| `delete-mcp-server` | `{name}` | 删除 Studio 服务；残留勾选在下一次读取时标记 |
| `test-mcp-server` | `{name}` | 由 Studio 实测并返回安全的工具名称与描述 |

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
缓存只保存成功读取的数据；失败说明不进入 TTL 缓存，下一轮会重新请求。

## 子智能体

内置类型与桌面端 `apps/desktop/src/main/services/subagents.ts` 一致：General（`tools: '*'`）、
Explore / Research / Plan（只读工具集 `read_file`、`list_dir`、`glob`、`grep`、`web_fetch`、
`run_command`）、fork（继承本轮历史与系统提示词、同一模型）。工具集只做**收窄**，每次嵌套调用照常
走同一套工具实现与工作区边界，没有提权；「只读」靠工具表加职责正文约束，不是硬保证（`run_command` 本就能写）。

并发：同一步里多个 `run_subagent` 调用会并发跑（`lib/loop.mjs` 的 `PARALLEL_SAFE`），子轮最多 3 个同时执行，
结论按模型给出的调用顺序回灌；派发记录的「读—改—写」串行化，避免并行回来时互相覆盖。

与桌面端的一处能力差异，必须如实：插件运行期内**没有「子任务结束后唤醒主轮」的通道**，所以
`run_subagent` 一律前台执行——调用会等子智能体跑完再返回结论。工具描述与系统提示词都写明这一点，
不提供 `foreground` 参数，也不假装它在后台继续跑。同理，Studio 侧没有 Task 卡，子轮的
`tool.started` 等事件不外发（`silent`），只有结论回到主轮。

## 尚未提供的桌面端能力

插件内置工具不包含 `present_files`、`create_task`、`propose_agent`、`create_mcp`、`exit_plan`、`tool_search`。
Studio MCP CRUD 由设置页 RPC 提供，不等同模型工具 `create_mcp`；外部 MCP 工具按其实际发现结果提供，权限由服务决定。
当前 SDK 的历史是输入，没有改写宿主历史的接口；`compressing` 仅为状态事件，不表示压缩或旧工具结果清理已发生。
记忆支持 v1 读取兼容与写满时归纳，未提供 `memory-tidy` 后台模型迁移。

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

只面向声明了 Agent API v1、支持 `agent-settings` 并注入 scoped 模型的
Ekko Studio（本仓库验证版本 0.8.30）。宿主升级 Agent 契约时按 `sdk/src/agents.ts`
同步更新本文件与实现，不通过修改宿主类型绕过。

## Ekko SDK v1 对照补充

Agent 会话在 `session.lifecycle` 登记幂等清理函数，与显式 `dispose()` 共用，释放 MCP 连接与缓存。
工具批次在派发前校验非空 id/name 及批次内 id 唯一性；非法批次直接结束本轮，不发送 started 或执行工具。
用量只接受非负安全整数；缺失、非法或累加溢出用 null。任何阶段缺少某字段，其全轮总量保持未知，不能将局部和标为精确总量。

当前附带 SDK 1.0.0 与官方 0.8.30 新增的 compression/installGuideUrl 存在差异，未自动升级。
官方 compression 扩展服务于 Hermes/Ekko 普通单聊；它不提供本插件 Agent 历史的任意改写能力。
历史附件、持久化契约与密钥编辑已在后续补齐；当前行为、验证和环境限制见 EKKO-COMPLETION-REPORT.md 与 docs/OPERATIONS.md。

## Studio 0.8.30 兼容校验

MCP/Skill 清单必须包含 servers/skills 数组，支持文件清单必须包含 files 数组；旧结构和 ok:false 明确报错，不能当作空表。删除 MCP、删除/启停 Skill 必须收到 ok:true 才报告成功。skill_view 缺少正文或宿主标记 invalid 时明确失败并保留宿主原因。

技能清单每轮重新向 Studio 读取，原生页面启停/删除下一轮立即生效；只向提示词注入启用且有效技能的 name 与 description，不缓存正文或复制技能。MCP 每轮取最新配置，同名注入优先；缺失环境变量（含 HTTP headers）完整列出变量名，HTTP 401/403/404/405 保留可诊断类别，任意 stderr/连接配置不进入日志。

运行日志仅记录 surface、宿主通道是否存在及注入服务名，不记录模型代理凭据、MCP env/headers 或技能正文。页面 RPC 的成功不能证明 Desktop 页面已挂载；需独立 Desktop 授权验收。
