# 设置页对齐范围（0.8.53）

manifest 的全部 agent-settings 页：identity、mcp、skills、model、memory。统一路由 `/studio/plugin-agent-settings/deva/<viewId>`，入口均为 client.mjs 的 mountContent，分派至 mountIdentity/mountMcp/mountSkills/mountModel/mountMemory；不存在独立通用页。

本轮只改呈现。身份默认/会话选择、身份编辑权限，模型 provider/绑定/密钥/网络审批，记忆 scope/类型/编辑/删除，技能目录注册/正文/只读/启停 RPC 均保留。

| 页面 | 参考与适用边界 | 修改与结论 |
|---|---|---|
| MCP | 用户第三张原版截图；历史 McpView-Cxq9R-fy.js:1 | 沿用上一轮工具 chips、N/N、立即开关；共用页头/分隔线基线。实机像素验收未验证 |
| Skill | 历史 SkillsView-BOfdYjgO.js:1，`/api/ekko/skills`，skills-layout/sidebar/main | 采用左列表右正文、窄屏纵排，启停 switch；原有目录注册卡和来源分组保留。仅已有功能的结构对齐，未达到完整 1:1：原版还有分类导航、搜索、导入等，不能在视觉任务中擅自扩展或更换现有功能语义 |
| 身份 | PersonView 管理 Studio Person/活动/工作流，不是 Deva persona 默认与会话选择 | 无等价参考，仅基线统一：补标准页头、统一卡片/按钮/状态。需 Deva 身份对应原版截图 |
| 模型 | ModelsView 管理全局渠道、认证和模型目录；插件编辑桌面默认/绑定及受控密钥 | 无等价参考，仅基线统一：补多语言标题，保留窄表单可读宽度及所有字段。需对应桌面模型设置页截图 |
| 记忆 | MemoryView-D_ZiZrG2 使用 `/api/ekko/memory` 图谱/列表/抽屉；插件读桌面记忆并按 scope 编辑 | 无等价参考，仅基线统一：页头与刷新、scope/新增工具条、卡片编辑表单、列表间距；需对应全局/角色/项目记忆页截图 |

共用视觉依据为已提供 MCP 截图：页头 16px/600，卡片 16px 内边距/8px 圆角、按钮 6px 圆角，输入/文本/边框/强调/错误均用宿主 token。缺失完整宿主 CSS，不能将这些尺寸称为从 bundle 提取的精确原版值。页头动作、空错误容器、focus、禁用开关及明暗 token 统一；所有字段留在原 DOM，未删保存/权限条件。

历史参考实际目录 `/home/agent/shared_workspace/deva/.tmp/deva-ui-origin/assets/`；均为压缩 JS 单行。它们只证明历史结构，当前 macOS 宿主一致性未验证。五页明暗 populated/empty/error HTML 来自实际 client 挂载的 DOM 桩及同一份 CSS；PNG 是这些 HTML 的 headless 渲染，不是 Studio 真机。加载期间动效/实际主题继承/中文字体/像素差异均未验证。

## 宿主面包屑边界

`PluginPageView-Bsu_7XTl.js:1` 的 `workspace-heading` 渲染 back-link（Agent 管理或插件）+ `/` + `manifest.name`。插件 iframe 无权安全移除此宿主外壳，本轮不使用 parent DOM 注入覆盖。

若用户要求取消重复标题，需要用户授权改宿主，最小模板提案（需真实源码后定位落补丁）：

```diff
 <header class="page-header workspace-header">
-  <div class="workspace-heading">... back-link / manifest.name ...</div>
+  <nav class="workspace-heading" aria-label="Breadcrumb">... back-link / manifest.name ...</nav>
 </header>
```

此提案只将外壳标记为导航，不删除返回入口；若要隐藏外壳，应由宿主为 agent-settings 提供显式选项并保留可访问返回导航。未提供虚假的插件 manifest 开关。信任/回滚的宿主阻塞见 STUDIO-MANAGEMENT-EVIDENCE.md。
