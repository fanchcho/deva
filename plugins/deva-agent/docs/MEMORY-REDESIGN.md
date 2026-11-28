# 记忆页统一列表（0.8.53）

入口：Studio → Agent 管理 → Deva → 记忆；manifest view id=`memory`，slot=`agent-settings`。

## 真实参照

本机 Studio 构建产物，只读核对：

- `/app/dist/client/assets/js/router-BKWzEY29.js`：`/hermes/memory`、`hermes.memory` 指向下列 MemoryView。
- `/app/dist/client/assets/js/MemoryView-Cm3KmJBJ.js`：`memory-sections` 下是三份文档（记忆、用户资料、Soul），每块 `section-header` 包含标题、修改时间、编辑入口；正文使用 MarkdownRenderer；`section-edit` 为原位 textarea 与取消/保存。
- `/app/dist/client/assets/css/MemoryView-gKJvC966.css`：内容 padding 20px；分区 gap 16px；header padding 10px 16px；标题 14px/600；修改时间 11px；正文 padding 16px；空态 13px muted italic；编辑器 13px、line-height 1.6、padding 12px、radius 6px；操作间距 8px。颜色来自宿主主题变量；<=768px 三块纵向排列。

该 Hermes 页实际是三份整篇文档的编辑器，没有逐条列表、scope badge 或逐条新增入口。不能把它描述成现成的单列表。此次按用户明确要求使用一个列表，借用真实页的文字密度、细边框、主题变量与同页编辑方式；不复制三块文档布局。

## 行为与兼容

- 一个 list 请求（省略 scope）返回全部可用层，每条带 scope/scopeLabel，按全局、当前角色、当前项目顺序展示，各层内部保持文件原顺序。
- 每行显示标题、作用域、最多两行正文预览，只保留「编辑」文字操作。页头新增；新增/编辑均在同页。编辑已有条目不能改变 scope；新增可选 scope。删除需确认，失败保留草稿与可见错误。
- 旧账号数据保留提示收进「旧记忆数据」展开项，不删除提示或旧数据。
- 无作用域切换 tab、分组标题、多层卡片。共用宿主明暗主题和既有设置页控件。无 npm 依赖与版本变动。
- 文件仍为 `~/.deva/memory.json`、`~/.deva/personas/memory/<personaId>.json`、`~/.deva/projects/<key>/memory.json`；`deva` 角色沿用既有 `general` 文件别名。合并仅发生于返回值，不写合并副本。
- scoped list 保持兼容；save/delete 必须提供 scope 并校验 ID。owner 检查、32/128 RPC 门禁、原子写与损坏保护代码未改变。全部可用层中任一层损坏时整体列表明确报错，不伪装成空列表或不完整成功。

## 验证与限制

新增测试覆盖三层同时显示/标识、一次请求、按 scope 增改删、跨层拒绝、owner、草稿保留、删除确认、加载/空态/错误态、主题变量。既有测试名与断言保留。

截图与交互采用离线 Chromium：执行真实 client.mount + 真实插件 CSS，加载本机 Studio `app-D9zeiodk.css` 的浅深主题；RPC 测试桥调用真实 memoryPage，DEVA_HOME 与 TMPDIR 均隔离在插件 `.tmp`。不是已安装 Studio 实例，不代表用户已看到新版本。真实 Studio 点击、Win/macOS 真机、桌面与插件同时写未验证。

本轮证据位于 `plugins/deva-agent/.tmp/memory-redesign/`：`render.mjs`、`render-evidence.json`、`before-{light,dark}.png`、`after-{light,dark}.png`、`editor-{light,dark}.png`、`error-draft-light.png`、测试/harness 日志和最终 REPORT.md。临时浏览器与字体复用工作区既有资源，不进入依赖或提交。
