# Studio 信任、升级与回滚边界

用户 2026-11-28 截图中的信任复选框属于宿主安装/升级表单。本工作区历史宿主快照可证明：

- controllers/plugins.ts:44-50：install 要求请求 trusted === true，然后调用 manager.install；trusted 没有传入记录。
- services/plugins/store.ts:21-28：全局登记存储 `<pluginsHome>/global/state.json`，records 按 manifest.id 索引，不是 SQLite 或浏览器 localStorage。
- services/plugins/manager.ts:111-115：安装记录含 manifest/directory/source/installedAt/enabled/config/previous，无 trusted。插件不能通过自己的 manifest 声明替用户授信。
- 历史 StudioPluginsView bundle 中信任绑定为内存 ref `ae.value`，安装请求携带 trusted。复选框重新挂载失去勾选不等于已安装插件丢失运行权限；是否运行由 enabled、runtimeIdentity、加载结果决定。
- manager.ts:162-165：rollback 从 previous 交换完整记录并取消 developmentDirectory，随后 replace 重载并写记录。snapshot 从 manifest.version 与 previous.manifest.version 得到版本文案。

这些是历史源码/构建快照证据，不是用户当前 macOS 安装的实时读值。真实记录与服务进程本轮按约束未操作。

## A 的宿主修复提案（需要用户授权改宿主）

不能用插件自签 trusted、偷偷写宿主 state 或自动勾选安全确认。最小完整变更需同时修改宿主 record 类型、安装控制器、manager 与表单：

```diff
// contracts/plugins.ts PluginRecord
+ trust?: { source: string; confirmedAt: number }
// manager.install: only after controller accepted input.trusted === true
+ trust: { source: pkg.source, confirmedAt: Date.now() },
// management snapshot: expose trust metadata (no secrets)
// StudioPluginsView: when opening upgrade form
- checked = false
+ checked = record.trust?.source === normalizedUpdateSource
// changing update source must clear checked; a different source needs explicit confirmation
```

这是最小设计补丁，非可直接套用的完整 diff：当前运行宿主源码/路径归一化函数未提供，不编造其实现。持久化键建议插件 id + 规范化安装来源；不能仅按 id 自动信任任意新路径。reload 和进程重启读取已有记录，升级须保留明确的来源匹配策略。影响面限安装确认与记录迁移；不改变 OS 权限。需宿主维护者确认产品语义并授权后才能实施/验证。

## B 的插件可修项与用户操作

连续发布多个内容不同但都叫 0.8.52 的包，回滚文案仍是 0.8.52，不能证明代码未回滚。本轮发布 0.8.53，并在每次 apply 记录 `loaded version=... clientSha256=...`，从可观察值区分两份代码。历史产物由宿主 install 的 previous 自动保留；没有插件自带版本历史 manifest 字段。

用户需在 macOS 实际宿主执行：升级 0.8.53 → 记录日志/version/hash → 回滚 0.8.52 → 重载并复核旧 hash → 再升级 0.8.53。若启用开发目录监听，回滚逻辑会取消该开发绑定；需确认 UI 是否又重新绑定源码。此链本轮未实测，不宣称修复了宿主回滚故障。无需凭版本文案相同给宿主代码打补丁。
