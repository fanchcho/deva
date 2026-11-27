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
| `get-model-selection` | `null` | 桌面默认的 `modelRef`、地址、模型名、强度、已启用的候选模型及身份绑定；回显密钥**状态与来源**（`hasApiKey`/`keySource`/`keySourceReadOnly`/`keyProblem`/`keyDiagnostics`），不回显值 |
| `save-model-selection` | `{modelRef?,baseUrl,modelName,apiKey?,reasoningEffort?}` | 选择已有的桌面模型，更新所选提供方，或以空 ref 新建独立提供方；地址和模型名均为空可清除默认引用。输入被拒时返回字段级 `error` |
| `save-persona-model` | `{personaId,modelRef}` | 只改身份文件的 `model`，空 ref 删除覆盖；读回同模型页 |

- 管理员显式指定 `sharedDevaUserId`，只有该账号可访问桌面模型；未授权只显示提示，不读取旧私有路由。路径依次为 `sharedDevaHome`、Studio 进程的 `DEVA_HOME`、`~/.deva`。共享目录和文件必须同 OS 用户、同文件系统，保留 POSIX 归属、安全文件类型和写前原文比对。两端不跨机器自动传输配置。
- 桌面唯一真源：`config.json.models.providers[].{adapter,apiHost,models[]}`、`activeModelId`、`activeEffort`；模型引用按首个冒号拆开。`personas/*.md` 的有效绑定优先于桌面默认。未选中时不造默认；`scoped` 可跟随 Studio 会话，`global` 无路线时报错。已有明确选择但适配器不是 OpenAI Chat Completions 或无明确地址时，Studio 推理报错，不冒用其它协议。桌面不修改运行中快照，外部保存前请退出桌面 Deva、保存后重新打开。
- 迁移只对授权账号发生：匹配同地址＋模型的 Desktop provider 时重用；否则导入一个独立提供方。已有有效桌面默认不覆盖，旧选择保留在候选项里；没有有效默认才采用可迁移旧值。迁移成功后删除原私有路由；需要批准的新增地址未经允许时明确报错并保留旧记录。只有旧 Studio 目录 ID、没有可解释的路由时提示重新选择。
- API Key 存 Studio 服务端用户 + Profile，按 providerId 与规范化 Base URL 绑定；不写 Desktop 配置，不读/解密 Electron safeStorage 明文。省略保留，空串清除；已存在桌面凭据的 provider 更换 URL 被拒。修改环境复用同一 Desktop 路径时，不把旧地址 Key 带到新地址。
- 本机、内网与 HTTP 只有在管理员精确配置 `modelTrustedBases` 时允许直连。旧 `allowNonPublic` 输入与 `modelNetworkConsent` 不会授予网络权限。DNS 固定、出站不继承重定向；错误状态、非 SSE 或连接失败不回退。新版强度 `low/medium/high/xhigh/max` 写桌面 `activeEffort`，默认不发送；旧版专有 `minimal` 不改写成其他档位。
- `global.listModels` 返回 SDK `AgentModelCatalog`：桌面启用项 + 每个已启用 OpenAI provider 的 `/models` 去重结果，`scope=available`，不返回 Key/路由地址。远端失败不清空本地项，原因进入 `message`；没有候选且失败时为 `status=error`。宿主 0.8.30 对 ready 的 message 不显示，详细原因在插件模型页查看。
- 具体项 ID 为 `deva-model:` + `encodeURIComponent(providerId:modelId)`；模型名可含冒号。空 model、`default` 和旧 `deva-direct` 跟随身份/桌面默认；`default` 为 SDK 默认条目，旧 ID 以 hidden 条目保留兼容。宿主自己生成“Agent 默认模型”行并去重默认的具体模型。
- 会话具体选择由 Studio 保存并以 `run.model.model` 注入；global 运行优先解析它，provider 被删除/禁用或模型被明确禁用即报错，不回退。不修改 `~/.deva/config.json` 的默认引用或身份绑定，也不新增持久化目录真源。远端专有模型按已配置 provider 的地址与该账号/Profile 的凭据运行；所有真实网络仍复核批准。会话显式强度优先于默认，上游拒绝时不移除参数重试。

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
| MCP | Studio API 为权威；桌面 mcp.json 仅在 Studio 无同名项时遗留兜底 |
| 模型 | `<root>/config.json → models.*` |
| 密钥 | `<root>/secrets.json`（桌面 safeStorage 加密；0.8.44 起插件**只读**：按 providerId 取密文并按需 DPAPI 解密，明文只在内存、不写回、不落库、不进日志、不回前端） |

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

## 0.8.21 模型写入

modelSettingsView.desktopWriteMessage 是可选拒绝提示，含当前调用账号、配置所有者、宿主激活账号和重试步骤；与 desktopWriteRequired 同时用于前端禁用说明。未配置 sharedDevaUserId 时仅宿主激活账号可写本机 profile/.deva 的普通配置文件；实际网络请求授权不变。保存模型不检查 modelTrustedBases，直连时仍检查。

## 0.8.24 模型列表与长度

`list-provider-models`：输入 `modelDiscoveryInput`（baseUrl 必填，apiKey/modelRef 可省略），输出 `modelDiscoveryView` 的 models 数组。省略 modelRef 使用当前桌面默认引用，空串表示新提供方、不复用存储 Key。apiKey 省略时仅从当前用户/Profile 同一 provider/Base URL 读取；显式空串使用无 Key 请求。操作不写配置/凭据、不查询宿主模型目录。HTTP、解析、超时和网络批准错误由 RPC 抛出可读原因，空数组作为空态显示。

`modelSettingsInput` 新增可选 `contextWindow` / `maxOutput` / `maxInput`，单位 tokens，正安全整数记录，省略保留已有值，0 表示删除该字段（0 不写成模型长度）。`modelSettingsView` 及 desktopModels 只返回有效正整数，未知时省略。模型选择的表单草稿变更才发送这些字段；旧客户端无字段时保持已有记录。记录位于桌面 config 的 provider.models 项，不迁移密钥，不改变对话请求参数。

## 0.8.26 桌面模型优先

模型页和「获取模型列表」读取桌面 config.json，不依赖 API Key。另设「刷新远端模型列表」作为补充，失败保留桌面候选。modelSettingsView.desktopDiagnostics 为 JSON 文本，包含 path/source/exists/stat/providerCount/modelCount/error；计数未知为 null。credentialError 只说明凭据读取错误，不使桌面列表失效。设置页展示已配置但未启用的模型，运行时启用过滤保持不变。

路径优先级：显式 sharedDevaHome、AI_UPPER_HOME、DEVA_HOME、默认 ~/.deva。当前仓库桌面 config.ts 只支持 DEVA_HOME；AI_UPPER_HOME 是插件兼容项，不能声称桌面此版本已支持。诊断明确标明 env 来源。secrets.json 仍由桌面 safeStorage 管理，插件不写回、不覆盖；0.8.44 起插件在服务端**按需只读解密**同一 provider 的密文（Windows DPAPI CurrentUser，密文经 stdin 交给 PowerShell，明文只在短时内存缓存），解密结果不落盘、不写入插件状态、不进日志、不回前端；不可读或解不开时按原因码给出诊断，不把其不可读视为 config 模型不存在。远端请求优先用插件侧保存的凭据，其次用桌面只读来源。

## 0.8.27 已有配置形态核对

读取标准来自桌面 `services/model-resolve.ts` 与 `store/models.tsx`：models.providers 数组、provider.apiHost、provider.models 数组及 models.activeModelId。模型 ID 按第一个冒号拆分引用；缺 purpose 视为 llm；设置页可展示未启用项。未设默认值时仍列出现有模型。

在当前字段缺失时出现顶层 providers/provider/model/defaultModel、models.provider/model/defaultModel、provider.model/baseUrl/baseURL，或 providers/models 非数组，均显式报告不兼容字段路径并禁用写入，不自动猜测或迁移。当前桌面源码不提供这些别名迁移，不能将例子称为已经证实的历史版本格式。真正空配置仍是空态，不是结构错误。未知的桌面扩展字段继续保留，不作为别名覆盖现有标准字段。

读取错误时 desktopDiagnostics 保持合法 JSON 文本，包含 path/exists/stat 和 error；无法解析的条数为 null。保存继续写原 config.json，不建立模型副本；回归验证顶层扩展、models 扩展、provider headers/threshold、model name/tags 等不丢失。

## 0.8.28 页面桥接诊断

模型页「获取模型列表」旁有只读可全选复制的 JSON 文本，记录客户端版本、当前文档 URL（移除查询/片段/凭据）、origin、iframe、可访问的 parentOrigin/src/sandbox，以及 RPC 方法、阶段、HTTP 状态（桥未提供时为 unknown）、错误码、配置路径和条数。无法跨源读取的环境信息明确为 unavailable-cross-origin，不推断。监听本 iframe 的 CSP 违规事件并在卸载时移除，不放宽 CSP。

get-model-selection/list-provider-models 等待上限20秒，超时显示 RPC_TIMEOUT；不自动重试、不把超时说成 HTTP 504；保存操作不添加超时，避免不确定写入后重试。初次读取失败释放 busy 状态，允许点击本地获取重试；在成功读取设置前仍禁止保存。错误脱敏后同时出现在诊断与页面错误区。非 JSON 上游响应现在保留实际 HTTP 状态。

上述诊断仅在客户端 mount 已执行时存在。若宿主未加载模块、Blob import 被 CSP 拦截或 mount 未被调用，插件代码无法自行显示诊断；必须从宿主页面控制台和 DOM 获取证据。客户端 API 的 CSP 响应头不能代替父页面/iframe 文档 CSP。

## 0.8.29 历史形态兼容（替代0.8.27的别名拒读规则）

读取统一支持顶层/嵌套 providers 数组或单对象、provider、apiHost/baseUrl/baseURL、models 数组（含空数组）或单 model、字符串模型以及 id/model/name 标识的对象模型。activeModelId/defaultModel 可为 providerId:modelId、无歧义裸模型名或 {providerId,modelId}；模型ID可含冒号。缺少 provider ID 时按文件顺序使用 legacy-provider-N；若裸模型名命中多个提供商，明确报告歧义，不擅自选择。损坏字段、非字符串ID、JSON错误均返回诊断，不能当空列表。

读取不迁移。明确保存才在同一个 config.json 中写当前桌面规范 models 段，同时保留并同步已存在的提供商/地址/默认引用别名。旧模型字符串可在保存时转成对象；未知扩展字段保留。未改动的规范提供商按原对象保留，避免给无关字段补默认值。此为插件兼容策略，不宣称所有历史桌面程序都接受迁移后的字段类型。

新增 modelSettingsView.desktopProviders：包括没有模型的 provider，公开 id/name/baseUrl/models(id/name)，不包含 secrets/headers。页面展示完整本地目录与默认引用；远端依旧只按用户明确点击补充。desktopDiagnostics 含 step、json=parsed、路径/stat/条数/具体失败原因。

## 页面取证日志 0.8.32

model-ui-trace RPC 接收 uiTraceInput 并返回 uiTraceResult。日志写安装插件目录 diagnostics/model-ui.jsonl，目录0700、文件0600，当前文件256KiB后滚动到单份.1。只记录阶段/方法/状态/耗时/计数等元数据；不记录RPC输入、配置正文、Key或原始异常文本。client报告不等同于可信HTTP访问日志。revision不是ClientContext公开字段，明确记录not-exposed-by-sdk，需和当时registry快照关联。

宿主client资源GET与iframe初始化发送没有插件SDK钩子，无法在插件内直接记录；mount事件只能证明初始化已到达并执行。无日志不能推出未请求client、未mount或用户点了宿主页面。服务器resolved阶段HTTP由宿主控制，记录host-owned，不伪造200。

0.8.33 的 uiTraceInput 增加点击及几何字段：phase=pointerdown/click 时 scope 区分 iframe-document/host-document，坐标为该document的CSS像素，tag/label与hitTag/hitLabel分别对应target与elementFromPoint。文本仅允许插件固定按钮名称，其他文本写[other]，不读取input值或宿主会话正文。父文档监听仅在浏览器同源策略允许时建立，卸载释放；没有跨源绕过。

phase=geometry 每个element单独记录：root/candidates/diagnostic/status/iframe；present、top/left/width/height、offsetHeight/clientHeight、viewportHeight/documentHeight、display/visibility/opacity/overflow、inViewport及最近滚动祖先clientHeight(scrollHeight字段)。inViewport只表示矩形相交，不证明没被遮罩；点击hit和父文档iframe几何须一起看。渲染、resize、scroll后采样。固定状态区使用iframe内sticky，不能越过宿主遮罩或保证零高度iframe内可见。不能把无点击事件作为用户没点击的充分证据。

几何诊断的 element=candidate-buttons 指普通按钮列表，native-select 指折叠原生选择框；top/bottom/height/inViewport 分别测量，不能跨对象推断可见性。服务端 version 来自安装包清单，clientVersion 来自实际下发模块元数据。

服务端 model-request 诊断只记录序列化后的 modelName/reasoningEffort 与账号/Profile，不记录完整请求体、消息或密钥；不接收客户端指定这些字段。

## Skill 页面 RPC

- `get-skills`：读取 Studio 技能清单；输入 `empty`，输出 `skillListPage`。
- `get-skill`：读取完整技能正文；输入 `skillTarget`，输出 `skillRecord`。
- `save-skill`：创建或更新技能正文；输入 `skillDraft`，输出 `skillRecord`。
- `set-skill-enabled`：启停并核对实际状态，不修改过滤规则；输入 `skillEnabled`，输出 `skillRecord`。
- `delete-skill`：删除宿主技能；输入 `skillTarget`，输出 `skillTarget`。
- `get-skill-files`：读取支持文件清单；输入 `skillTarget`，输出 `skillFiles`。
- `read-skill-file`：读取支持文件正文；输入 `skillFile`，输出 `skillContent`。
- `get-skill-directories`：读取外部目录；输入 `empty`，输出 `skillDirectories`。
- `save-skill-directories`：保留原目录并注册配置推导的 Deva skills 目录；输入 `empty`，输出 `skillDirectories`。

外部目录 PUT 请求为 `{directories: string[]}`。不新增插件存储。支持文件只读；目录注册不等于文件创建或权限授权。404 保留宿主原因，页面其它技能仍可读取。

## Skill 接口边界与安装可见性

`importSkill` **未支持**：当前宿主 OpenAPI 的 `/api/ekko/skills/import` 没有明确请求体，插件不猜测参数。
外部目录注册只保存目录清单，不创建目录或技能，也不保证索引成功。请核对目录 exists/isDir 警告与技能列表。实际外部来源可提供 `sourcePath`（来源根目录，不是 SKILL.md 文件路径），页面按宿主原值展示。支持文件只能位于 references/、templates/、scripts/、assets/ 下；技能根目录的其它文件不会列出且读取会被拒绝。
安装成品应先解压，选择包含 plugin.json/package.json 的 package 目录作为安装来源；不能把 zip/tgz 路径直接作为来源。安装后重新加载设置页面或重启 Studio 客户端，才能让已有界面重新读取包含 Skill 页的 manifest/client；服务端热装不代表其他设备已经加载新页面。

外部技能的 edit/delete 由宿主拒绝（400 Only local skills can be edited/deleted）。新建接口不声明外部目标目录，不能承诺落盘到调用者指定的临时目录；本插件不猜测 path/directory 参数。外部样本的真实验证包含读取、支持文件、启停和拒绝编辑/删除，不等同于 local CRUD 成功。

## 0.8.47 桌面密钥解密诊断（Windows）

`list-provider-models` 的返回在 `models` 之外新增 **`authProbe`**（`modelDiscoveryView.authProbe`）：

| 字段 | 含义 |
| --- | --- |
| `sentAuthorization` | 拉列表时是否携带 `Authorization`（只有拿到可用 Key 才会带）。 |
| `chatAuthorized` | `authorized` = 同一凭据在 `POST {base}/chat/completions` 通过鉴权；`unauthorized` = 被 401/403 拒绝；`absent` = 本次没有可用 Key，**列表 200 不能证明对话可用**；`unknown` = 探测未完成（网络/批准等）。 |
| `chatHttp` | 鉴权探测的 HTTP 状态（未知时省略）。 |
| `reason` | 可操作说明；不含凭据。 |

鉴权探测故意发送 `{"model": "...", "messages": []}` 这种**结构不合法**的请求，只到鉴权层：401/403 判 `unauthorized`，其它 4xx/5xx 判 `authorized`（说明鉴权已过、只是请求体不合规），**不产生生成、不花 token**。`GET {base}/models` 是否强制鉴权取决于网关，**不能**把「列表 200」当作凭据有效的通用证据，页面文案也不得这么写。

### 解密原因码（`desktop-secrets.mjs`）

`decrypt-tool-missing`（两个 PowerShell 变体都不存在）、`decrypt-assembly-unavailable`（程序集缺失/`Add-Type` 被禁）、`decrypt-language-mode-restricted`（Constrained Language）、`decrypt-output-invalid`（stdout 被噪声/BOM 污染，取不到可校验 base64）、`decrypt-roundtrip-failed`（自检 protect→unprotect 失败）、`ciphertext-invalid`（密文不是合法 base64）、`dpapi-foreign-blob`（**自检成功**但该 blob 解不开 → 属于别的 Windows 用户/机器，密码学上不可解）、`dpapi-failed`（其它）、`platform-unsupported`（Studio 不在 Windows 上）、`decrypt-timeout`、`plaintext-empty`。

前六种归为**工具链问题**（`isToolchainFailure`），页面提示修 PowerShell/程序集/语言模式；`dpapi-foreign-blob` 与 `platform-unsupported` 归为**归属/平台问题**，页面明确说明「Studio 内部绕不过去，需要在模型页填一次，或由桌面端显式交接」。`dpapi-failed` 只在无法归因时兜底。

### DPAPI 自检

`createDpapiDecoder().selfCheck()` 用固定假字符串做 protect→unprotect 往返（**不碰用户密文**），返回 `{platform, container, ok, code, runtime, variants[]}`，每个 variant 含 `binary/runtime/version/languageMode/assembly/roundtrip/code`。容器/WSL 由 `detectContainer()` 从环境变量与 `/proc` 特征只读判断。自检结果只进 `keyDiagnostics`（字符串，脱敏），**不含**密文、明文或 Key 片段；`stderr` 经 `redactStderr()` 去掉用户路径与凭据样式后最多保留 3 行 300 字。

自动迁移与永久性：手动填写的 Key 写在 `state.user.namespace("desktopModelKeys")`（账号级，与 Profile 无关），换 Profile/new run 仍可读；清除同时清账号级与旧 Profile 级记录，旧记录不会复活。

## 0.8.48 macOS 钥匙串解密（darwin）

桌面端在 macOS 用 Electron `safeStorage`，底层是 Chromium OSCrypt。依据（源码，非推测）：

- Electron 33 `shell/browser/electron_browser_main_parts.cc:539-540`：`KeychainPassword::GetServiceName() = app_name + " Safe Storage"`、`GetAccountName() = app_name`。
- Chromium 130 `components/os_crypt/sync/os_crypt_mac.mm`：`kSalt = "saltysalt"`（:33）、`kEncryptionIterations = 1003`（:39）、`kDerivedKeySizeInBits = 128`（:36）、`kEncryptionVersionPrefix = "v10"`（:44）、IV = 16 个空格（:168），AES-128-CBC + PKCS#7。
- Chromium `components/os_crypt/sync/keychain_password_mac.mm`：钥匙串里存的是一条**随机 16 字节的 base64 文本**（不是二进制），PBKDF2 的 password 就是这串 base64。

因此 `lib/macos-keychain.mjs` 的链路是：`security find-generic-password -s "<App> Safe Storage" -a "<App>" -w` → PBKDF2-SHA1(password, "saltysalt", 1003, 16) → AES-128-CBC(IV=16×0x20，关闭自动去填充后自校验 PKCS#7) → 明文。候选 app 名依次为 `Deva`（productName）、`deva`（executableName）、`@deva/desktop`（package name）、`Electron`（默认名）；只有「条目不存在」才换下一个候选。

原因码：`mac-keychain-tool-missing`、`mac-keychain-item-missing`、`mac-keychain-denied`、`mac-keychain-no-session`、`mac-keychain-timeout`、`mac-keychain-error`、`mac-key-mismatch`、`mac-ciphertext-truncated`、`mac-unsupported-format`、`ciphertext-invalid`。`platform-unsupported` 仅用于 Linux 等既非 Windows 也非 macOS 的宿主，**不再**被解释成「服务端不在那台 Windows 上」。

自检 `selfCheck()` 输出 `{platform, ok, code, service, account, roundtrip, variants[]}`：`variants` 是每个 app 名候选的 `service/account/ok/code`，`roundtrip` 用真实 PBKDF2+AES 往返验证（不碰用户密文）。

`aclReadable` / `fileOwner` 在 POSIX 平台改为真实可读性（`access(R_OK)`）+ `uid`/`mode`/`self`，不再对非 Windows 返回 `platform-unsupported`。

## 0.8.49 Windows safeStorage（v10 AES-256-GCM + Local State）

Windows 桌面端的 safeStorage **不是**“明文直接 DPAPI 后写盘”。依据 Chromium 130 `components/os_crypt/sync/os_crypt_win.cc`：

- `kNonceLength = 96/8 = 12`（:42）、`kEncryptionVersionPrefix = "v10"`（:45）、`kDPAPIKeyPrefix = "DPAPI"`（:48）。
- `EncryptString`：AES-256-GCM，`v10` + nonce(12) + 密文（GCM tag 16 附在末尾）（:191-215）。
- 密钥：随机 32B，`os_crypt.encrypted_key` = base64(`DPAPI` + DPAPI(32B key))，存于 `<userData>/Local State`（:109-125,256-295）；Electron 的 Local State 在 `DIR_SESSION_DATA/Local State`（`shell/browser/browser_process_impl.cc:110-122`，即 `<userData>/Local State`）。

`lib/windows-safe-storage.mjs` 的链路：候选 Local State（`%APPDATA%` / `%LOCALAPPDATA%` 下 `Deva` / `deva` / `@deva/desktop` / `Electron`）→ `os_crypt.encrypted_key` 校验 base64/`DPAPI` 前缀 → DPAPI(`CurrentUser`) 解出 32B key → `lib/safe-storage.mjs` 的 AES-256-GCM 解 v10；不以 `v10` 开头的值是 legacy 裸 DPAPI，走 `legacy-raw-dpapi-ok`。

原因码：`local-state-missing`、`encrypted-key-invalid`、`key-unprotect-failed`、`gcm-auth-failed`、`blob-not-dpapi`、`legacy-raw-dpapi-ok`、`v10-detected`、`foreign-blob-proven`（仅当同机不同用户可确证时）。`0x80131501`（.NET 泛化 `MethodInvocationException` / 参数无效）只表示“不是合法 DPAPI blob”，**不得**据此推断跨用户/跨机器。

`lib/safe-storage.mjs` 同时提供 macOS v10 的 AES-128-CBC 实现（IV=16×0x20），macOS 的 Keychain 密钥由 `lib/macos-keychain.mjs` 提供——两端共用同一个 v10 信封解析器，但密码算法不同。

## 0.8.50 macOS 钥匙串发现与密文指纹

- 发现（只读属性）：`security list-keychains -d user`、`security default-keychain -d user`，对每个 keychain 执行 `security dump-keychain <path>`（**不带 `-d`，不读取密码数据**），解析 `class: "genp"` 块的 `svce`/`acct`；过滤 `/deva|safe ?storage|electron/i`；输出 `{paths, defaultKeychain, totalGenericPasswords, matched, entries[service,account,keychain], errors}`。
- 命中策略：四个 app-name 候选（`Deva` / `deva` / `@deva/desktop` / `Electron`）均 miss 后，对发现到的条目按「精确 service+account」→「仅 service」重试（带 keychain 路径）。
- 原因码：`mac-keychain-item-missing`（属性里也没有匹配条目）与 `mac-keychain-item-invisible`（属性里能看到、但当前进程读不到密码：Data Protection keychain/access group/ACL 未授权）分开。
- 指纹：`desktopSecretsStructure` 每条输出 `key/keyLength/valueChars/decodedBytes/prefix/likelyFormat`。`likelyFormat` 仅按 `decodedBytes` 判断：mac-cbc = `(bytes-3)` 为 16 的倍数且 ≥32；win-gcm = `bytes-3-12-16 ≥1`；两者都满足 = `ambiguous`。`win-gcm` 表示这份 v10 在 Windows 生成，macOS 的 AES-128-CBC 解不开，应在本机桌面端重存或模型页手填。
- `get-keychain-diagnostics` RPC + 模型页「钥匙串诊断」按钮输出可复制文本（路径/用户/条目统计/service/account/长度/前缀/指纹），不含任何 Key 值或密文。
