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

## B 的 macOS 真机核对清单（用户执行，尚未实测）

本清单只操作 Deva 插件的「版本与运行」面板，不需要重启整个 Studio，也不要编辑宿主登记文件。先备好两个内容固定的安装包或目录：待回滚的 0.8.52，以及包含本轮修改的 0.8.53。不要在测试过程中修改这两份包；0.8.53 的源码目录可为 `/Users/fanchunchun/hermes_plugin/deva/plugins/deva-agent`，但它不一定是宿主实际加载的安装目录。

**准备：留住旧版本证据。** 在第一次升级前，打开 Deva 的「版本与运行」和「日志」，记录当前版本、时间、实际加载目录，以及是否启用了开发目录绑定。实际加载目录应以宿主当前运行记录/加载日志中的路径为准；表单里的安装来源路径不能单独作为证据。如果界面只给来源路径，需先取得宿主的加载路径再继续判定，不能拿源码目录的 hash 冒充已加载代码的 hash。当前实际版本应为 0.8.52；若已经是 0.8.53，则先从宿主保留的上一版安装目录取得 0.8.52 的基线，勿把现有 0.8.53 标为旧版本。

在 macOS 终端定义下面的只读核对函数。每次将实际加载目录作为第一个参数传入；需要本机已有 `node` 和 macOS 自带的 `shasum`：

```sh
deva_check_package() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = fs.realpathSync(process.argv[1]);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
    console.log("directory=" + dir);
    console.log("id=" + manifest.id);
    console.log("version=" + pkg.version);
  ' "$1" || return
  shasum -a 256 "$1/client.mjs" "$1/server.mjs"
}

# 将下面的示例路径替换为宿主实际加载的安装目录，再执行。
deva_check_package '/实际加载的安装目录'
```

记录 0.8.52 输出为 `oldDirectory`、`oldClientSha256`、`oldServerSha256`，保留完整的 64 位 hash。核对输出中 `id=deva`、`version=0.8.52`，并确认该目录确实对应当前运行记录。**0.8.52 没有本轮新增的 `loaded version=... clientSha256=...` 日志，不能把“没有这条日志”判为回滚失败。**

**第 1 步：升级到 0.8.53。** 在 Deva 的「版本与运行」中选择准备好的 0.8.53 安装来源，按界面要求确认信任，点击「升级」，等待加载完成。界面应显示当前版本 0.8.53、可回滚版本 0.8.52。打开日志，只取本次升级时间之后的新记录，应看到形如 `deva: loaded version=0.8.53 clientSha256=<64 位 hash>` 的信息。对升级后实际加载目录执行核对函数，保存 `newDirectory`、`newClientSha256`、`newServerSha256`。成功条件是：日志版本和文件版本均为 0.8.53，日志 hash 等于该目录 `client.mjs` 的 hash，且新旧客户端 hash 不同；本轮服务端也有修改，服务端 hash 应不同。只有界面版本变化、不满足加载日志与文件对应关系，不算通过。

**第 2 步：回滚到 0.8.52。** 点击「回滚 0.8.52」，等待重新加载完成，记录操作时间。界面当前版本应变为 0.8.52；读取回滚后的实际加载目录并再次执行核对函数。成功条件是：版本为 0.8.52，客户端和服务端 hash 分别等于准备阶段保存的 `oldClientSha256`、`oldServerSha256`，且不同于 0.8.53 的对应 hash。宿主日志应表明本次旧包加载成功且无加载异常；不要把日志窗口中升级时遗留的 0.8.53 记录当作当前结果。若回滚取消了开发目录绑定，先保持该状态，不要立即把开发来源重新绑定回 0.8.53。

**第 3 步：重载后复核旧版本。** 在回滚完成后点击 Deva 的「重载」，再关闭并重开此面板。记录重载时间和新的加载记录，重新确认实际加载目录，执行核对函数。成功条件是：界面和文件版本仍为 0.8.52，两份文件 hash 仍等于旧基线，宿主本次加载路径仍指向旧包，且插件设置页能正常打开。只核对磁盘文件而没有本次加载路径/成功记录，不能证明运行代码已切换；若这些信息不可见，本步标为“加载证据不足”，不要填通过。

**第 4 步：再升级回 0.8.53。** 使用第 1 步同一份、未修改的 0.8.53 包再次点击「升级」，等待完成后再点击一次 Deva 的「重载」。取本次升级与重载后的新日志，应再次出现 `loaded version=0.8.53 clientSha256=...`。执行核对函数，成功条件是：界面/文件/日志版本均为 0.8.53，日志 hash 与文件 hash 一致，客户端和服务端 hash 分别等于第 1 步保存的新版本基线。若同样叫 0.8.53 却 hash 不同，应先检查是否换了安装来源或包被修改，不能视为成功恢复同一版本。

按下面表格保存每一步的输出或日志截图，路径填写完整绝对路径，hash 不截断：

| 阶段 | 操作时间 | 界面/文件版本 | 实际加载目录 | client SHA-256 | server SHA-256 | 本次加载日志证据 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 升级前旧版基线 | 待填 | 0.8.52 / 待核对 | 待填 | oldClientSha256 | oldServerSha256 | 待填 | 未验证 |
| 首次升级 | 待填 | 0.8.53 / 待核对 | 待填 | newClientSha256 | newServerSha256 | version/clientSha256 | 未验证 |
| 回滚 | 待填 | 0.8.52 / 待核对 | 待填 | 应等于旧基线 | 应等于旧基线 | 旧目录加载成功 | 未验证 |
| 回滚后重载 | 待填 | 0.8.52 / 待核对 | 待填 | 应等于旧基线 | 应等于旧基线 | 重载后的旧目录 | 未验证 |
| 再升级并重载 | 待填 | 0.8.53 / 待核对 | 待填 | 应等于新基线 | 应等于新基线 | 新 version/clientSha256 | 未验证 |

若没有「回滚 0.8.52」按钮、上一版不是 0.8.52、加载路径仍指向新代码、或重载后又恢复新版本，请保留该步时间、加载目录、版本、hash 与错误日志，标记为宿主回滚未通过。不要通过手工改版本号、覆盖安装目录或修改宿主 state 来制造通过结果。本清单验证插件重载链；整个 Studio 服务重启后的持久性仍需另行实机核对。
