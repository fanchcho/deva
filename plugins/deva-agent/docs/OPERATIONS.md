# Ekko 0.8.30 运行、恢复与发布

基准：[官方固定手册](https://github.com/EKKOLearnAI/ekko-studio/blob/61cda7e6c1d0b7b17f6394a8c4f3822e6dd36944/docs/plugins.md)。插件 API/Agent API 为 v1，SDK 公共类型和六份指南来自该提交（SDK 包版本仍为 1.0.0）。Node 要求 >=20。

## 附件配置与拒绝原因

Studio 插件配置可保存以下字段；未设置采用默认值。模型的 `input.options` 不能扩展授权根或关闭审批。

| 配置 | 默认 | 含义 |
|---|---|---|
| attachmentMaxFileBytes | 2097152 | 单文件最大字节数 |
| attachmentMaxSessionBytes | 8388608 | 同会话唯一 assetId 累计最大字节；同文件增长只补差额 |
| attachmentTtlMs | 86400000 | 首次成功解析后 24 小时；重读不刷新 |
| attachmentAllowedRoots | [] | 管理员显式授权的额外绝对目录；工作区始终可读 |
| approvalEnabled | false | 开启高风险工具审批 |
| approvalTools | [] | 额外纳入审批的工具名 |
| compressionEnabled | false | 开启 Hermes/Ekko 普通单聊的可选摘录摘要；改动后重载插件 |

原 SDK 不提供上传时间，故过期从首次解析计时；若宿主未来返回 expiresAt，则也服从它。历史和本轮附件走同一路径：先经宿主 resolve(assetId)，再验证词法/realpath 和打开后的真实文件位置。符号链接不能越过授权根。工作区以外的上传目录必须由管理员显式授权，不能把“宿主返回路径”等同任意目录授权。运行目录仅保留原有工具落盘读取用途，不自动成为附件授权根。

文本文件使用有界读取并严格 UTF-8 解码；NUL/无法解码或二进制格式只返回 `status: metadata_only`、`code: BINARY_NOT_TEXT`、元数据与绝对路径，明确未解析正文。合法 PNG/JPEG/GIF/WebP 图片以图片块送模型。模型若不支持图片，代理报错会传播，不声称已看图。`read_file` 对本轮已解析附件仍服从同一预算、过期与二进制策略。

失败包含结构化 code：`OUTSIDE_AUTHORIZED_ROOT`、`FILE_BUDGET_EXCEEDED`、`SESSION_BUDGET_EXCEEDED`、`ATTACHMENT_EXPIRED`、`ASSET_UNAVAILABLE`、`ASSET_CHANGED` 等。历史超过 200 条显式给出 HISTORY_LIMIT 与省略数。附件内容不因文本截断而无声消失。恢复 checkpoint 时重新按 assetId 解析，清除过期缓存正文。二进制解释器/Office/PDF 提取并未实现；这符合本轮“二进制只返回元数据及路径”的明确要求，不能把 metadata_only 说成已读取正文。

## 持久化与兼容

contracts/plugin.json 登记 memory(v2)、todos(v1)、subagents(v1)、attachments(v1)、checkpoint(v1)。统一校验器实际用于读写，不仅用于 harness。memory 保持原存储桶与 entries 数组；v1 content 派生 title/body 并保留原 content。缺失类型/时间/待办状态/子轮可选字段补默认值；未知 JSON 字段保留。读取不主动写回，正常修改时才写兼容记录。缺失关键 ID、非法类型等损坏记录明确拒绝，不能用空表覆盖。

fixture 来源为原仓库 memory.test.mjs 与 subagents.test.mjs 已有 v1 样例，不冒称生产数据导出。无版本升级后批量重写用户数据库。子轮保留已完成工具消息，只为缺少结果的调用补“结果未知、未重试”的记录。

## MCP 密钥编辑

get-mcp-server 返回 env/headers 的每个值为 `__EKKO_SECRET_UNCHANGED__`，不向页面发送存量明文。保存时服务端重新取当前配置：字段/键省略或保留掩码都保持原值，新字符串替换，**显式 null 删除该键**。删除键或传 `{}` 不等于清除；要清除 TOKEN 应提交 `{"env":{"TOKEN":null}}`。新建服务不能提交无原值的掩码。

这是整个 env/headers 的保守策略，非秘密环境变量也掩码，避免依赖键名猜测。宿主和 MCP 任意错误全文不再回显/落日志，只保留安全类别（权限、重名、未找到、停用、缺环境变量名）；错误消息可能比以前简短。插件不控制宿主服务端自己的日志，宿主日志脱敏不在本轮验证范围。

## 审批

默认行为不变。开启 approvalEnabled 后，run_command/write_file/edit_file/memory_write/memory_delete/skill_manage/browser、所有 mcp__ 工具以及 approvalTools 指定工具都走 `run.interactions.approve`。审批卡给出工具及适用的路径、命令/操作预览，不提交文件正文。子轮继承相同 run.config，无法绕开策略。只有 approved 放行；denied/cancelled/timeout/未知结果或宿主缺接口全部拒绝。审批开关不是 OS 沙箱，shell 仍受宿主进程权限控制。

## checkpoint 恢复

Agent 声明 resume=true，提供 checkpoint()。run 结束时保存最终结果；中途在模型返回工具批次后、每个工具执行前和执行后写入检查点。主轮存 state.agentSession.checkpoint；子轮检查点存对应 subagents 记录内。记录含真实 owner、schemaVersion=1、单调 revision、归一化历史、工具指纹与 pending/running/completed/failed 状态，不含模型 token/MCP 配置。

重建实例时传 session.resumeState；开始运行也读取宿主会话存储，较新 revision 优先。已完成/失败结果直接回灌；running 表示可能已有副作用，pending 表示尚未开始，两者都不自动重试。恢复轮中即使模型用新 callId 重提相同工具及结构化参数，也返回已有结果/结果未知说明。正常完成后的新一轮不受旧去重表影响。若完成结果送达前中断，相同输入的恢复直接返回缓存最终结果。主轮恢复前的用量不再冒充本次准确累计。

无法把“外部系统执行成功”和“本地记录完成”做原子提交；崩溃窗口内采取不重放策略，需要用户/模型先核对外部状态再发起明确的新操作。相同操作确需再次执行，可在恢复轮完成后新开正常轮。检查点上限 2 MiB；大历史/图片/工具结果超限会明确停止，不能静默丢弃记录后继续副作用。存储写入失败同样停止后续操作。跨用户/Profile/Agent/会话、未知版本或损坏记录均拒绝恢复。

## SDK 与 compression 采用结论

采用固定提交新增的 compression 权限、公共回调类型与接口；同步 installGuideUrl 类型，但本插件为内置 JS 引擎，没有外部安装指引需求，不设置该字段。SDK 版本号 1.0.0 并不能唯一标识类型内容，NOTICE 记录精确提交。安装宿主上次 OpenAPI 回报 0.8.30，不据此推断所有可选接口必然存在；代码用运行时探测。

compression 默认关闭，开启但接口缺失时日志说明并交宿主内置摘要器；注册资源交 lifecycle。可用时返回标记为 extractive summary 的首尾摘录并完整保留 previousSummary；使用 UTF-8 字节保守预算，仍以 Studio 最终 token 校验为准。不够放旧摘要、预算过小、取消时返回 null。没有假定可访问模型凭据；没有加入额外 LLM 请求或写入历史 API。适用全部 Profile 的 Hermes/Ekko 普通单聊，**不用于改写 Deva Agent 的 history**。

## 发布准备与尚未执行

package.json 明确 MIT、repository.directory、bugs、keywords、Node engines 及 files 白名单；plugin.json 填仓库/主页/文档/issues，保持 12 语言与稳定 ID。manifest 官方类型没有 engines，不添加私有字段；兼容基准在本文说明。SDK 与项目 LICENSE/NOTICE 随包保留，证据、缓存和审计报告排除。

仓库 URL 取自当前 origin；本插件位于 monorepo 的 plugins/deva-agent，不假称仓库根可直接被市场安装。官方市场从仓库根读取 plugin.json，需要维护者提供插件独立仓库或把发布包根推送到发布源的流程、市场账号/目标、正式版本。当前 private=true 与版本 0.8.0 保持，代码和本地包准备就绪，真实市场发布/升级安装未执行。`npm pack --dry-run` 和实际本地 tarball 可验证入口、资源、许可、fixtures 与相对 import；不会 commit、push、deploy。

真实 Desktop 挂载/主题/语言/交互仍须目标 Desktop 开启远程控制并成为当前账号/Profile 的已授权活动浏览器。Node mock/client 测试不替代该验收。
