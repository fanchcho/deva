# 附录：预加载桥（apps/desktop/src/preload） 函数级说明

本附录由主文档 `PROJECT-MAP.md` §3 引用，收录 **2** 个源码文件中的 **15** 个函数 / 方法 / IPC 处理器，逐条给出位置、签名、说明与调用方。

列说明：

- **位置**：`文件:行号`，行号为声明（`function` / `const x =` / `ipcMain.handle` 等）所在行。
- **类型**：TypeScript 编译器 API 判定 —— 函数声明、箭头函数、类方法、对象字面量方法、构造器、`ipcMain.handle/on` 处理器。
- **导出**：是否带 `export`。Web 版经 `__listChannels()` 暴露的通道不算 `export`，以 IPC 处理器条目体现。
- **签名**：参数与返回类型（`async` 前缀表示异步）。
- **说明**：优先取源码 JSDoc / 行上注释；无注释时给出函数体摘要（以「代码：」开头）；仍无法概括时如实写明。
- **被调用处**：对整个工作区（主进程、渲染层、preload、Web 版、脚本）做静态调用扫描，再逐条回到该行校验名字确实以调用形式出现；`get` / `start` / `listener` 这类高频短名仅保留同文件引用，以避开同名误匹配。空着表示静态扫描未发现调用，不等于运行时不执行 —— IPC 处理器、事件回调、成员方法天然经框架或接口间接调用。

| # | 位置 | 名字 | 类型 | 导出 | 签名 | 说明 | 被调用处 |
|---:|---|---|---|---|---|---|---|

### `apps/desktop/src/preload/index.d.ts`（9 行，0 个条目）


### `apps/desktop/src/preload/index.ts`（1510 行，15 个条目）

| 1 | `apps/desktop/src/preload/index.ts:929` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, on:boolean)` → `void` | 代码：`cb(on)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 2 | `apps/desktop/src/preload/index.ts:998` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, skills:SkillRecord[])` → `void` | 代码：`cb(skills)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 3 | `apps/desktop/src/preload/index.ts:1075` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, view:McpServerView)` → `void` | 代码：`cb(view)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 4 | `apps/desktop/src/preload/index.ts:1209` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, payload:ChatEventPayload)` → `void` | 代码：`cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 5 | `apps/desktop/src/preload/index.ts:1215` | `listener` | 箭头函数 | 否 | `listener()` → `void` | 代码：`cb()` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 6 | `apps/desktop/src/preload/index.ts:1232` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, payload:TerminalDataPayload)` → `void` | 代码：`cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 7 | `apps/desktop/src/preload/index.ts:1238` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, payload:TerminalExitPayload)` → `void` | 代码：`cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 8 | `apps/desktop/src/preload/index.ts:1314` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, reqId:string, text:string)` → `void` | 代码：`cb(reqId, text)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 9 | `apps/desktop/src/preload/index.ts:1355` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, tasks:TaskRecord[])` → `void` | 代码：`cb(tasks)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 10 | `apps/desktop/src/preload/index.ts:1364` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, payload:{ sessionId?: string; pane?: 'tasks' })` → `void` | 代码：`cb(payload)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 11 | `apps/desktop/src/preload/index.ts:1409` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, state:BrowserUiState)` → `void` | 代码：`cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 12 | `apps/desktop/src/preload/index.ts:1428` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, frame:BrowserLiveFrame)` → `void` | 代码：`cb(frame)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 13 | `apps/desktop/src/preload/index.ts:1457` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, state:UpdateState)` → `void` | 代码：`cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 14 | `apps/desktop/src/preload/index.ts:1487` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, state:RemoteState)` → `void` | 代码：`cb(state)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |
| 15 | `apps/desktop/src/preload/index.ts:1492` | `listener` | 箭头函数 | 否 | `listener(_e:unknown, ev:BotScanEvent)` → `void` | 代码：`cb(ev)` | 静态扫描未检出（箭头函数，多作为回调内联传入） |

合计：2 个文件，15 个条目。
