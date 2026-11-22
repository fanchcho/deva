# Deva for Ekko Studio

把 Deva 这个仓库做成一个 **Ekko Studio 插件 Agent**：装进 Studio 后，它在 Agent 列表里叫
`Deva`（宿主 id `plugin:deva/deva`），选中即可对话——读代码、改代码、跑 `pnpm typecheck` /
`pnpm build`，模型用 Studio 当前选择的那个。

**身份可选**：同一个 Agent 可以按所选身份说话，目前两个身份都取自本仓库的角色定义——

| 身份 id | 显示名 | 来源 | 适合 |
| --- | --- | --- | --- |
| `deva`（默认） | Deva | `apps/desktop/src/main/services/deva-personas.ts` | 改代码、跑检查、写文档 |
| `xiaomajiang` | 小码酱 | `apps/desktop/src/main/services/xiaomajiang-personas.ts` | 安全研究、逆向、强度更高的执行 |

- 插件 id：`deva`（`plugin.json`）· 包名：`studio-plugin-deva` · 版本与 `package.json` 同步
- 头像：`icon.png` 直接取自 `apps/desktop/build/icon.png`（Deva 的应用图标），宿主加载时内联成
  `data:image/png;base64,…` 写进插件记录；Agent 描述符的 `icon` 回落到它，所以 Studio 里显示的是
  Deva 的图标，不再是宿主默认头像
- 入口：`server.mjs` 的 `apply(ctx)`——只注册**一个**通用 Deva Agent（`ctx.extensions.agents.register(...)`），
  外加身份 RPC / MCP RPC 与一条身份命令
- 只暴露一个 Agent：插件不再按身份各注册一个固定 Agent；身份在会话内切换（见下）
- 两个独立设置页（slot 都是 `agent-settings`，宿主侧栏自动排在 Agent 管理的「设置」里）：
  - **身份**（`views: identity`）：只读/存默认身份；身份选择存在 Studio 的 user+profile 作用域存储里
  - **MCP**（`views: mcp`）：直接管理 Studio 的 MCP 服务表——新增、改配置、启停、测试、删除，
    并勾选本 Agent 用哪些服务。改的就是 Studio「MCP」页面那份配置，插件不复制、不存密钥

## 它怎么跑

```
Studio 选中 Agent「Deva」并选模型
  → 宿主注入 scoped 模型代理（baseUrl + token，仅本轮有效）
  → 本插件并发一轮 agent loop（lib/loop.mjs）
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

只有 `scoped` 模式：插件不维护模型目录、不保存任何 API key。没有注入模型时直接报错提示去 Agent
管理里选模型，不静默降级。

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

Studio 只在「任务计划运行」里给 Agent 注入 `run.mcpServers`，普通插件运行拿到的是空对象，
所以本插件自带一个零依赖 MCP 客户端（`lib/mcp.mjs`）。MCP 服务的连接配置只有一份，在 Studio
自己的 MCP 服务表里；本插件不再有 `mcpServers` 插件配置。服务来源有两个，同名时宿主优先：

1. **Studio 的 MCP 服务（推荐）**：到 **Studio → Agent 管理 → Deva → 设置 → MCP** 直接管理服务——
   新增、改命令/参数/环境变量或 URL/请求头、启停、测试（让 Studio 连一次并列出工具）、删除，
   与 Studio 的「MCP」页面是同一份数据（走 `/api/ekko/mcp/servers`）；再勾选本 Agent 要用的服务。
   插件只存服务名（user+profile 作用域），每轮运行按名字去 Studio 取最新连接配置——
   改了 URL、env 或启停状态，下一轮对话就生效，不用改插件配置、也不复制 Studio 的凭据。
   同一会话里配置没变时复用已有连接（stdio 子进程不重启）；配置或宿主注入的凭证变了才重连。
   页面上的「在 Studio 中打开 MCP 页面」可直接跳到宿主原生界面。
   已勾选但被 Studio 删除或停用的服务会在系统提示词的「MCP 连接状态」里点名，不会静默跳过。
2. **宿主注入的 `run.mcpServers`**：只在任务计划运行里有内容，同名覆盖 Studio 勾选。

配置里的 `${VAR}`（环境变量与请求头的值）从 Studio 进程环境展开；变量缺失时该服务连接失败并在
系统提示词的「MCP 连接状态」里点名缺哪个变量，不会静默跳过。连接失败只影响该服务，不中断对话。

插件对外**只注册一个 `Deva` Agent**（`plugin:deva/deva`），它出现在 Agent 选择器里；不再为每个身份各注册一个固定 Agent。身份在会话内切换，或由设置页给默认值。

两种切换方式，按使用场景挑：

| 场景 | 做法 | 生效范围 |
| --- | --- | --- |
| 会话里换身份 | 输入框发 `@deva:xiaomajiang 你的问题` 或 `deva:identity xiaomajiang` | 只影响当前会话 |
| 改默认 | **Studio → Agent 管理 → Deva → 设置 → 身份**，或用下面的 RPC | 用户 + Profile 的默认值 |

> 若你想在 DSH 会话的输入框「层叠」预设里直接选到 **Deva**：由配套的 `dsh-deva-presets` 模块
> （`~/.dsh/deva-presets`）把**单个** `Deva` 预设注册进 `/api/coding-agents/dsh/agent-presets`，
> 层叠下拉里只保留一个「Deva」，不再有小码酱或「· 子任务」子预设。身份仍在上面的会话内命令里切。

备注：带斜杠的 `/deva:identity` 会被 Studio 当内置命令拦截（宿主的命令面板只认自己的列表），
所以输入框里请用不带斜杠的 `deva:identity …` 或 `@deva:<id>` 前缀；斜杠形式只在插件
`invoke` 接口（`kind:"command"`）里直接调用。

所有**写入**路径以会话工作区为界（符号链接按 `realpath` 解析后再校验，指向外部的链接会直接报错），越界直接报错；
只读的 `read_file` 另接受本轮运行目录（`web_fetch` 落盘的正文、工具结果落盘文件要能读回）。文件与检索类结果单条
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
  失败时把宿主原始报错交回模型，不假装成功。
- **子智能体**与桌面端同一套类型（General / Explore / Research / Plan / fork），工具表只做收窄。
  插件运行期内没有「子任务结束后唤醒主轮」的通道，所以 `run_subagent` **一律前台执行**：等它跑完
  再返回结论，不提供 `foreground` 参数，也不假装它在后台继续跑。子轮事件不外发（Studio 没有 Task 卡），
  只有结论回到主轮；派发记录存在本会话，供 `send_to_subagent` 续聊（最近 20 个）。

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

`get-identities` 返回 `{identities:[{id,name,description}], selected}`；`save-selection` 只接受身份目录里的
id，未知 id 直接报错（不会静默回退）。`get-mcp-servers` 返回
`{servers:[{name,transport,managed,enabled}], selected}`（不含连接配置与密钥），
`save-mcp-selection` 只接受 Studio 规则的服务名（字母或数字开头，可含点、下划线、连字符）、去重、最多 32 个。

MCP 服务 CRUD 走 Studio 自己的接口，行为与 Studio「MCP」页面一致：`get-mcp-server` 是唯一下发连接配置的接口
（编辑回填用），`create-mcp-server` 配置交给 Studio 规范化（只认 `stdio` 与 `streamable_http`），
`update-mcp-server` 整体替换配置、服务不存在时报错，`set-mcp-server-enabled` 启停，
`test-mcp-server` 让 Studio 连一次并列工具（停用或连不上时报错，不返回空表），`delete-mcp-server` 删除。
写入类都只回展示字段，不把配置或密钥回给页面。

设置页就是这些 RPC 的薄壳，按 `ctx.view` 分成两个独立页面：`identity` 只放身份下拉与保存，`mcp` 放服务列表、
增删改/启停/测试与勾选保存。

## 开发与验收

```bash
cd plugins/deva-agent
node scripts/plugin-harness.mjs check   # 清单/契约/i18n/文档/SDK 完整性
node --test tests/*.test.mjs            # 142 个用例：工具、超长输出落盘、web、MCP、浏览器、记忆（三层/归纳/迁移）、技能、子智能体、交互、复读与打转检测、三种协议（含 DSML 恢复与 Gemini 签名）、loop、身份、Studio MCP 与 MCP 服务 CRUD、RPC、harness
```

测试全部离线：假网关在 `127.0.0.1` 上回放 SSE，不访问真实模型、不读用户目录。

## 安装到 Studio

```bash
# 1. 登记开发目录（同一 HERMES_WEB_UI_HOME 与运行中的 Studio 一致）
HERMES_WEB_UI_HOME=/home/agent/.hermes-web-ui \
  node /app/bin/hermes-web-ui.mjs plugins link "$PWD"

# 2. 让 Studio 信任、构建并启用（也可以直接在插件中心点「启用」）
curl -s -X POST "$STUDIO/api/studio/plugins/install" -H 'content-type: application/json' \
  -d '{"source":"'"$PWD"'","revision":0,"trusted":true}'
```

启用后：Studio → Agent 管理出现 `Deva`；新建会话选它并选一个模型即可。源码改动后
`POST /api/studio/plugins/deva` `{"action":"reload","revision":<当前 revision>}` 热重载。

## 文档

- `docs/ARCHITECTURE.md`、`docs/STUDIO_CTX.md`、`docs/STUDIO_RETURNS.md`、`docs/HOST_API.md`、
  `docs/FIELD_REFERENCE.md`、`docs/DEVELOPMENT.md`：随 SDK 分发的宿主说明
- `docs/CONTRACTS.md`：本插件的运行契约（输入、事件、结果、模型代理、失败行为）
- `sdk/src/*.ts`：宿主类型（`agents.ts` 是 AgentDefinition / AgentRunContext 的准确定义）
