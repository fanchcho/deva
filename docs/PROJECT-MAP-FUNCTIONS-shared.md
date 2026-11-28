# 附录：共享类型与工具（apps/desktop/src/shared） 函数级说明

本附录由主文档 `PROJECT-MAP.md` §3 引用，收录 **10** 个源码文件中的 **28** 个函数 / 方法 / IPC 处理器，逐条给出位置、签名、说明与调用方。

列说明：

- **位置**：`文件:行号`，行号为声明（`function` / `const x =` / `ipcMain.handle` 等）所在行。
- **类型**：TypeScript 编译器 API 判定 —— 函数声明、箭头函数、类方法、对象字面量方法、构造器、`ipcMain.handle/on` 处理器。
- **导出**：是否带 `export`。Web 版经 `__listChannels()` 暴露的通道不算 `export`，以 IPC 处理器条目体现。
- **签名**：参数与返回类型（`async` 前缀表示异步）。
- **说明**：优先取源码 JSDoc / 行上注释；无注释时给出函数体摘要（以「代码：」开头）；仍无法概括时如实写明。
- **被调用处**：对整个工作区（主进程、渲染层、preload、Web 版、脚本）做静态调用扫描，再逐条回到该行校验名字确实以调用形式出现；`get` / `start` / `listener` 这类高频短名仅保留同文件引用，以避开同名误匹配。空着表示静态扫描未发现调用，不等于运行时不执行 —— IPC 处理器、事件回调、成员方法天然经框架或接口间接调用。

| # | 位置 | 名字 | 类型 | 导出 | 签名 | 说明 | 被调用处 |
|---:|---|---|---|---|---|---|---|

### `apps/desktop/src/shared/avatar-shape.ts`（72 行，4 个条目）

| 1 | `apps/desktop/src/shared/avatar-shape.ts:28` | `isAvatarShape` | 函数 | 是 | `isAvatarShape(v:unknown)` → `v is AvatarShape` | 代码：`{ return typeof v === 'string' && (AVATAR_SHAPES as readonly string[]).includes(v) }` | apps/desktop/src/renderer/src/components/humation.tsx:311、apps/desktop/src/renderer/src/components/humation.tsx:417、apps/desktop/src/renderer/src/components/humation.tsx:431、apps/desktop/src/renderer/src/components/humation.tsx:469、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:1109 |
| 2 | `apps/desktop/src/shared/avatar-shape.ts:33` | `hashSeed` | 函数 | 是 | `hashSeed(seed:string)` → `number` | FNV-1a 32 位：头像的确定性取样（形状、配色）都用它。 | apps/desktop/src/shared/avatar-shape.ts:47、apps/desktop/src/shared/avatar-shape.ts:71、apps/desktop/src/renderer/src/components/humation.tsx:127 |
| 3 | `apps/desktop/src/shared/avatar-shape.ts:46` | `seededShape` | 函数 | 是 | `seededShape(seed:string)` → `AvatarShape` | 新角色按 seed 挑形状：只在创建时调用一次，结果存成具体形状（名片预览与接受后的编辑器用同一 seed，两处一致）。 | apps/desktop/src/main/services/chat.ts:3215、apps/desktop/src/main/services/remote/hub.ts:1257、apps/desktop/src/renderer/src/features/chat/blocks.tsx:2308、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:7750 |
| 4 | `apps/desktop/src/shared/avatar-shape.ts:70` | `legacyAutoShape` | 函数 | 是 | `legacyAutoShape(seed:string)` → `AvatarShape` | 代码：`{ return LEGACY_AUTO_POOL[hashSeed(`${seed}#shape`) % LEGACY_AUTO_POOL.length] }` | apps/desktop/src/main/services/personas.ts:318、apps/desktop/src/renderer/src/components/humation.tsx:310 |

### `apps/desktop/src/shared/browser.ts`（49 行，0 个条目）


### `apps/desktop/src/shared/context.ts`（266 行，12 个条目）

| 5 | `apps/desktop/src/shared/context.ts:102` | `builtinContextWindow` | 函数 | 是 | `builtinContextWindow(modelId:string)` → `number \| undefined` | 内置表里的窗口；查不到返回 undefined。 | apps/desktop/src/shared/context.ts:132 |
| 6 | `apps/desktop/src/shared/context.ts:116` | `capAutoWindow` | 函数 | 否 | `capAutoWindow(modelId:string, window:number)` → `number` | 代码：`{ return /claude/i.test(modelId) ? window : Math.min(window, AUTO_WINDOW_CAP) }` | apps/desktop/src/shared/context.ts:125、apps/desktop/src/shared/context.ts:130、apps/desktop/src/shared/context.ts:133 |
| 7 | `apps/desktop/src/shared/context.ts:121` | `autoContextWindow` | 函数 | 是 | `autoContextWindow(modelId:string, fallback=DEFAULT_CONTEXT_WINDOW)` → `number` | 「自动」窗口：ID 自带（如 -128k / -1m）> 内置表 > fallback；前两者对非 Claude 模型封顶 AUTO_WINDOW_CAP。 | apps/desktop/src/main/services/compaction.ts:154、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:34 |
| 8 | `apps/desktop/src/shared/context.ts:145` | `autoOutputBudget` | 函数 | 是 | `autoOutputBudget(adapter:LimitAdapter, modelId:string)` → `number \| undefined` | 「自动」输出上限：Claude 系 32K；其余 Anthropic / Responses 协议 8K（适配器默认）； OpenAI Chat 协议返回 undefined = 不传，交给服务商默认。 | apps/desktop/src/main/services/chat.ts:1381、apps/desktop/src/main/services/compaction.ts:174、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:35 |
| 9 | `apps/desktop/src/shared/context.ts:155` | `validLimit` | 函数 | 是 | `validLimit(v:unknown, range:{ min: number; max: number })` → `v is number` | config.json 里存的覆盖值是否可用（整数、落在范围内）。 | apps/desktop/src/main/services/model-resolve.ts:109、apps/desktop/src/main/services/model-resolve.ts:110、apps/desktop/src/shared/context.ts:205、apps/desktop/src/shared/context.ts:228、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:206 |
| 10 | `apps/desktop/src/shared/context.ts:163` | `formatTokens` | 函数 | 是 | `formatTokens(n:number)` → `string` | token 数的紧凑写法：1M / 1.05M / 200K / 128K（131072）/ 8K（8192）。 先认十进制整数（128000 也能被 1024 整除，按二进制会显示成 125K），再认二进制整数。 | apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:80、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:87、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:95、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:101、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:209、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:210、apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:296、apps/desktop/src/renderer/src/store/chat.tsx:1688 |
| 11 | `apps/desktop/src/shared/context.ts:178` | `parseTokens` | 函数 | 是 | `parseTokens(input:string)` → `number \| null` | 解析用户输入的 token 数：支持 200000 / 200,000 / 200k / 1m / 1.5M；无法解析返回 null。 | apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx:205 |
| 12 | `apps/desktop/src/shared/context.ts:191` | `parseContextLimit` | 函数 | 是 | `parseContextLimit(body:string)` → `number \| undefined` | 从服务商的「上下文超限」报错里解析真实窗口（token）；认不出返回 undefined。 只认明确写着上下文上限的句式——输出上限超限（max_tokens > N）的数字不能当成窗口。 | apps/desktop/src/main/providers/types.ts:267、apps/desktop/src/main/providers/types.ts:317、apps/desktop/src/main/providers/types.ts:353 |
| 13 | `apps/desktop/src/shared/context.ts:225` | `parseContextOverflow` | 函数 | 是 | `parseContextOverflow(body:string)` → `ContextOverflow \| undefined` | 从「输入 + 输出预留超出窗口」的报错里解析三个数；认不出返回 undefined。这类超限常常不是输入装不下， 而是输出预留太大：没传 max_tokens 时不少服务商按模型的最大输出预留（DeepSeek V4 为 384K，1M 窗口里 输入过 65.5 万即被拒，issue #43）。 | apps/desktop/src/main/providers/types.ts:268、apps/desktop/src/main/providers/types.ts:318、apps/desktop/src/main/providers/types.ts:354 |
| 14 | `apps/desktop/src/shared/context.ts:226` | `pick` | 箭头函数 | 否 | `pick(input:string, output:string, limit:string)` → `ContextOverflow \| undefined` | 从三个数值构造上下文溢出信息：上限合法且输入输出均大于 0 才算有效，否则 undefined。 | apps/desktop/src/shared/context.ts:235、apps/desktop/src/shared/context.ts:238、apps/desktop/src/shared/context.ts:241 |
| 15 | `apps/desktop/src/shared/context.ts:249` | `isCjk` | 函数 | 否 | `isCjk(c:number)` → `boolean` | 中日韩文字、全角符号：一字约 1 token（各家分词器在 0.6~1.5 之间，取 1 偏保守）。 | apps/desktop/src/shared/context.ts:264 |
| 16 | `apps/desktop/src/shared/context.ts:262` | `estimateTextTokens` | 函数 | 是 | `estimateTextTokens(s:string)` → `number` | 文本的 token 估算（拿不到真实用量时用）。统一按 3.5 字符 ≈ 1 token 会把中文低估到三分之一左右， 压缩线贴近窗口时容易估少撞上限，故中日韩字符单独按一字一 token 计。 | apps/desktop/src/main/services/compaction.ts:189、apps/desktop/src/main/services/compaction.ts:191、apps/desktop/src/main/services/compaction.ts:193、apps/desktop/src/main/services/compaction.ts:204、apps/desktop/src/main/services/tool-results.ts:213 |

### `apps/desktop/src/shared/deliverables.ts`（10 行，0 个条目）


### `apps/desktop/src/shared/effort.ts`（237 行，8 个条目）

| 17 | `apps/desktop/src/shared/effort.ts:32` | `isEffortLevel` | 函数 | 是 | `isEffortLevel(v:unknown)` → `v is EffortLevel` | 代码：`{ return v === 'default' \|\| (THINK_LEVELS as readonly unknown[]).includes(v) }` | apps/desktop/src/main/services/chat.ts:5987、apps/desktop/src/main/services/chat.ts:6179、apps/desktop/src/main/services/model-resolve.ts:139 |
| 18 | `apps/desktop/src/shared/effort.ts:129` | `findRule` | 函数 | 否 | `findRule(adapter:EffortAdapter, modelId:string)` → `Rule` | 代码：`{ const id = modelId.toLowerCase() return RULES.find((r) => (!r.adapters \|\| r.adapters.includes(adapter)) && r.match.test(id)) ?? FALLBACK }` | apps/desktop/src/shared/effort.ts:160 |
| 19 | `apps/desktop/src/shared/effort.ts:135` | `endpointFormat` | 函数 | 否 | `endpointFormat(baseURL:string \| undefined)` → `ThinkFormat \| undefined` | 按服务地址判定私有格式（官方端点）；认不出返回 undefined，交由模型家族决定。 | apps/desktop/src/shared/effort.ts:177 |
| 20 | `apps/desktop/src/shared/effort.ts:159` | `resolve` | 函数 | 否 | `resolve(adapter:EffortAdapter, modelId:string, baseURL?:string)` → `Resolved \| null` | 规则 + 协议 + 服务地址 → 实际能力；null = 不支持思考等级。 | apps/desktop/src/main/services/attachments.ts:194、apps/desktop/src/main/services/attachments.ts:211、apps/desktop/src/main/services/attachments.ts:249、apps/desktop/src/main/services/attachments.ts:274、apps/desktop/src/main/services/browser/host.ts:504、apps/desktop/src/main/services/browser/host.ts:634、apps/desktop/src/main/services/chat.ts:1560、apps/desktop/src/main/services/chat.ts:1564 |
| 21 | `apps/desktop/src/shared/effort.ts:184` | `supportedEffortLevels` | 函数 | 是 | `supportedEffortLevels(adapter:EffortAdapter, modelId:string)` → `ThinkLevel[]` | 该模型支持的档位（由低到高）；空数组 = 不支持思考等级。只能开不能调的模型返回 ['high']。 | apps/desktop/src/shared/effort.ts:200、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:7495 |
| 22 | `apps/desktop/src/shared/effort.ts:190` | `isToggleEffort` | 函数 | 是 | `isToggleEffort(adapter:EffortAdapter, modelId:string)` → `boolean` | 是否「只能开、不能调档」：选择器把唯一的一档显示为「开启」。 | apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:7498 |
| 23 | `apps/desktop/src/shared/effort.ts:198` | `clampEffort` | 函数 | 是 | `clampEffort(adapter:EffortAdapter, modelId:string, level:EffortLevel)` → `EffortLevel` | 把存下的档位收敛到该模型支持的档：'default' 原样；支持即原样；否则先往低找最近的（省钱、不擅自加码）， 低处没有再往高找；模型不支持思考等级 → 'default'。对话里存的仍是用户原选（换回支持的模型即恢复）。 | apps/desktop/src/main/services/chat.ts:1409、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:7505 |
| 24 | `apps/desktop/src/shared/effort.ts:221` | `effortRequest` | 函数 | 是 | `effortRequest(adapter:EffortAdapter, modelId:string, baseURL:string \| undefined, level:EffortLevel)` → `EffortRequest \| undefined` | 某档（须已收敛）对应的请求参数；'default' / 不支持 → undefined（不发任何思考参数）。 | apps/desktop/src/main/services/chat.ts:1410 |

### `apps/desktop/src/shared/limits.ts`（18 行，0 个条目）


### `apps/desktop/src/shared/mention.ts`（28 行，1 个条目）

| 25 | `apps/desktop/src/shared/mention.ts:15` | `mentionRanges` | 函数 | 是 | `mentionRanges(text:string, names:readonly string[])` → `{ start: number; end: number }[]` | 正文里会生效的 `@名字` 所在区间 [start, end)（含 | apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:5966、apps/desktop/src/renderer/src/redesign/composer-editor.ts:207 |

### `apps/desktop/src/shared/quote.ts`（13 行，2 个条目）

| 26 | `apps/desktop/src/shared/quote.ts:5` | `isQuoteLine` | 箭头函数 | 是 | `isQuoteLine(line:string)` → `boolean` | Markdown 引用行（`>` 开头，前面至多 3 个空格）：用户消息开头右键「引用」带进来的别人的话。 引用里的「/技能名」「@名字」不算用户的指令（见 shared/slash.ts、主进程 chat.ts 的 handleMentions）。 | apps/desktop/src/shared/quote.ts:11、apps/desktop/src/shared/slash.ts:15、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:6028、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:6031、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:6046、apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx:6066 |
| 27 | `apps/desktop/src/shared/quote.ts:8` | `withoutQuotes` | 函数 | 是 | `withoutQuotes(text:string)` → `string` | 去掉引用行，只留用户自己写的部分。 | apps/desktop/src/main/services/chat.ts:3772 |

### `apps/desktop/src/shared/slash.ts`（19 行，1 个条目）

| 28 | `apps/desktop/src/shared/slash.ts:11` | `slashTokens` | 函数 | 是 | `slashTokens(text:string)` → `{ start: number; end: number; name: string }[]` | 消息里的「/技能名」：渲染层（输入框上色）与主进程（chat.ts sendMessage 展开技能）共用同一套认法。 `/` 须在消息开头（可有前导空白）或紧跟在空白之后，名字取最长的 [A-Za-z0-9_-]+；名字后面若紧跟 `/` `.` `:` `\\` 就不算（那是路径、文件名或网址，如「看下 /etc/hosts」「/tmp/a.txt」）。引用行（`>` 开头，右键「引用」带进来的 别人的话）里的也不算。认出来的名字是否真是技能由调用方判定。 按出现先后返回区间 [start, end)（含 /）与名字。 | apps/desktop/src/main/services/chat.ts:6002、apps/desktop/src/renderer/src/redesign/composer-editor.ts:204 |

### `apps/desktop/src/shared/update.ts`（33 行，0 个条目）


合计：10 个文件，28 个条目。
