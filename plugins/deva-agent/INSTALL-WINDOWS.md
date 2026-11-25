> 0.8.21 模型保存和当前安装入口见 [模型页修复与安装](INSTALL-STUDIO-MODEL.md)。默认从仓库目录安装；下文旧版本资产仅作历史部署参考。

# Windows 上使用 Deva：Electron 桌面端与 Ekko Studio 插件

核验日期：2026-11-25。**Deva 桌面端、Ekko Studio Windows 宿主、Deva Agent 插件是三个不同产物。**

| 载体 | 源码支持 | 有构建产物 | 实际验证过 |
| --- | --- | --- | --- |
| Deva Electron | 有 Windows x64 打包链：根 `package.json:25` → `apps/desktop/package.json:19–22` → `apps/desktop/electron-builder.yml:36–62`（NSIS + ZIP）；`.github/workflows/release.yml:28–33,65–82` 在 Windows runner 构建。 | [官方 Deva v0.1.17](https://github.com/sqfcyily/deva/releases/tag/v0.1.17) 有 `Deva-0.1.17-setup.exe`、`Deva-0.1.17-portable.zip` 和更新元数据。 | **Windows 真机安装、启动、源码打包、更新、卸载未实测。** 仅核对发行资产和代码。 |
| Ekko Studio Windows 宿主 + Deva Agent | Studio 有 Windows Electron 和 npm Web CLI，插件安装器能走 Windows 原生绝对路径；Deva 有可复制的 JS 成品，但 Bash、MCP、共享模型有边界。 | [官方 Studio v0.8.30](https://github.com/EKKOLearnAI/ekko-studio/releases/tag/v0.8.30) 有 x64、arm64 两个 Windows exe；插件另为有 manifest 的 JS 成品，不是 Windows 专用 exe。 | **Windows 宿主和插件未实测。** 本轮同版本 Linux Studio 真实 API 已测本地目录安装、启用、升级、回滚。 |

本轮发行资产证据：[Deva](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/release-deva.json>) · [Studio](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/release-studio.json>)。以下 PowerShell 步骤按源码和资产编写，**均未在 Windows 实际执行**。

## A. Deva Electron 桌面端

### 安装与启动

Windows x64 选以下一种。安装版是按用户安装、可选目录，从开始菜单启动。便携 ZIP 用单独目录，默认仍与安装版共享用户数据。

```powershell
$download = Join-Path $env:USERPROFILE 'Downloads'
$base = 'https://github.com/sqfcyily/deva/releases/download/v0.1.17'
$file = Join-Path $download 'Deva-0.1.17-setup.exe'
Invoke-WebRequest "$base/Deva-0.1.17-setup.exe" -OutFile $file
if ((Get-FileHash $file -Algorithm SHA256).Hash -ne '904ab7774af3ccc2e8996bf1092bc7385f06e9ad724454758fea7fd6a53393e8') { throw 'SHA-256 mismatch' }
Start-Process -FilePath $file -Wait
```

```powershell
$file = Join-Path $env:USERPROFILE 'Downloads\Deva-0.1.17-portable.zip'
Invoke-WebRequest 'https://github.com/sqfcyily/deva/releases/download/v0.1.17/Deva-0.1.17-portable.zip' -OutFile $file
if ((Get-FileHash $file -Algorithm SHA256).Hash -ne '9c1f3f3d4fef5f161d8a857f96078ddeb6a6b9530787d276c022d01fdb28b5a7') { throw 'SHA-256 mismatch' }
$out = Join-Path $env:LOCALAPPDATA 'DevaPortable-0.1.17'
Expand-Archive -LiteralPath $file -DestinationPath $out
$exe = Join-Path $out 'Deva\Deva.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Deva.exe not found' }
Start-Process -FilePath $exe
```

依据：`README.md:80–96`、`apps/desktop/electron-builder.yml:36–62`、`apps/desktop/scripts/portable-zip.cjs:30` 起（外层 `Deva\`）。不用为已编译 exe 装 Node。启动后在设置确认版本，配置模型 Base URL/模型名并在 UI 中重录 API Key；在扩展设置新增、启用、测试 MCP；在角色页创建或导入 Markdown。stdio 用本机可执行文件的绝对路径与参数，HTTP/SSE 用目标服务地址。身份文件默认在 `%USERPROFILE%\.deva\personas`。

```powershell
$homeDir = if ($env:DEVA_HOME) { $env:DEVA_HOME } else { Join-Path $env:USERPROFILE '.deva' }
Get-Item -LiteralPath $homeDir
Get-Process -Name Deva -ErrorAction SilentlyContinue
```

如果设置了 `DEVA_HOME`，检查的值必须与 Deva 进程自己的环境一致；从开始菜单启动不一定继承当前 PowerShell 的临时变量。

### 源码构建、更新、卸载、回滚

源码构建需 Git、Node ≥20、pnpm 10.8.0 与 npm/Electron 下载源。原生依赖若找不到预编译件，按实际构建错误准备 Windows 工具链；不是现成 exe 的依赖。依据：根 `README.md:331–341`、`package.json:7,25`、`.github/workflows/release.yml:65–82`。

```powershell
git clone --branch v0.1.17 --depth 1 https://github.com/sqfcyily/deva.git deva-desktop
Set-Location deva-desktop
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm package:win
Get-ChildItem .\apps\desktop\dist
```

- 安装版用应用检查更新，或运行官方同架构新安装器；便携版退出旧进程后解压新目录、启动新版。更新源是上游 Release（`apps/desktop/src/main/services/updater.ts:4–12,21,192–205`），不是插件 Git tag。
- 升级/回滚前退出窗口和托盘，备份必要的非密钥数据并保留旧安装器；旧程序不保证能读新数据格式。安装版从 Windows「已安装的应用」卸载；便携版退出后移除程序目录。不要把卸载等同于删除 `.deva`。系统凭据由 Electron safeStorage/DPAPI 处理，目标机重录，不承诺复制密文后跨用户/跨机器解密（`apps/desktop/src/main/services/secrets.ts:9–10,21–54,63–91`）。

## B. Windows 上的 Ekko Studio 和 Deva Agent

### 1. 安装宿主

从 [Studio v0.8.30 官方发行](https://github.com/EKKOLearnAI/ekko-studio/releases/tag/v0.8.30) 选与系统匹配的资产，以下是 x64 例；arm64 改对应文件名和发行摘要。从开始菜单启动应用；安装目录由安装器决定，不是插件 source 目录。

```powershell
$file = Join-Path $env:USERPROFILE 'Downloads\Ekko.Studio-0.8.30-x64.exe'
Invoke-WebRequest 'https://github.com/EKKOLearnAI/ekko-studio/releases/download/v0.8.30/Ekko.Studio-0.8.30-x64.exe' -OutFile $file
if ((Get-FileHash $file -Algorithm SHA256).Hash -ne 'f75eb3c8d783f302943615e050a2330511b4b6708164511f6efe09c893133eb8') { throw 'SHA-256 mismatch' }
Start-Process -FilePath $file -Wait
```

也可使用官方 **npm Web CLI**，Node ≥23，Hermes 依赖按[官方 README](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/README.md)准备。不要与已有 Electron/Studio 服务占同一端口或同时写同一数据根：

```powershell
npm.cmd install -g ekko-studio@0.8.30
ekko-studio-web.cmd start --port 8648 --no-open
Invoke-RestMethod 'http://127.0.0.1:8648/health' | Select-Object status,webui_version
```

依据：[Studio package.json:2–13](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/package.json#L2-L13) 和 [CLI:354–445,630–656](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/bin/hermes-web-ui.mjs#L354-L445)。CLI 示例端口不是 Electron 的固定端口。用目标 Studio **超级管理员**登录；Agent 执行 token 不替代管理员身份。

### 2. 在运行 Studio 的机器解包后安装

建议在 Linux/WSL 或有构建条件的主机按 [INSTALL.md](INSTALL.md) 生成并校验 tgz，再传到 Windows 宿主。浏览器所在电脑和服务端不是同一个概念。PowerShell 在服务端做：

```powershell
$tgz = Join-Path $env:USERPROFILE 'Downloads\studio-plugin-deva-0.8.17.tgz'
Get-Command tar.exe -ErrorAction Stop
$out = Join-Path $env:LOCALAPPDATA 'DevaStudioPackages\0.8.17'
New-Item -ItemType Directory -Path $out -Force | Out-Null
tar.exe -xzf $tgz -C $out
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
$source = (Resolve-Path -LiteralPath (Join-Path $out 'package')).Path
Get-Item (Join-Path $source 'plugin.json'),(Join-Path $source 'package.json'),(Join-Path $source 'server.mjs'),(Join-Path $source 'client.mjs')
$source
```

在 Studio「插件中心 → 安装插件」粘贴最后打印的 `C:\…\package`，确认信任、安装，再启用。**输入是目录绝对路径，不是浏览器上传 tgz。** 到 Agent 管理检查 Deva 和版本，登录态点击未实测。也可从有安装器源码的目录，用 `node scripts/install-deva-agent.mjs --package "$source"`（配置 `STUDIO_URL` 和目标超管凭据），随后加 `--check`；此分支不启动 npm。Windows 未实测。

用 Web CLI 的 loopback 端口时，PowerShell API 方案如下（替换地址及超管名；Electron 或远程 Studio 用实际地址）。口令仅在子进程环境中短暂使用，不写盘，不在开启会话追踪时输入：

```powershell
$env:STUDIO_URL = 'http://127.0.0.1:8648'
$creds = Get-Credential -UserName 'admin' -Message '目标 Studio 超级管理员'
try {
    $env:STUDIO_ADMIN_PASSWORD = $creds.GetNetworkCredential().Password
    node scripts/install-deva-agent.mjs --username $creds.UserName --password-env STUDIO_ADMIN_PASSWORD --package "$source"
    if ($LASTEXITCODE -ne 0) { throw 'Plugin install failed' }
    node scripts/install-deva-agent.mjs --username $creds.UserName --password-env STUDIO_ADMIN_PASSWORD --package "$source" --check
    if ($LASTEXITCODE -ne 0) { throw 'Plugin verification failed' }
} finally {
    Remove-Item Env:STUDIO_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable creds -ErrorAction SilentlyContinue
}
```

本仓库安装器的 `--ref` 直接 spawn `npm`，没有 `npm.cmd` 适配，且 prepack 测试可能依赖 Bash（`scripts/install-deva-agent.mjs:48–56,88–112`）；不要把 Windows 原生从 ref 构建当已验证。Studio 宿主自身对远端 npm 安装使用 Windows shim，二者不是同一代码：[官方 installer.ts:43–67](https://github.com/EKKOLearnAI/ekko-studio/blob/v0.8.30/packages/server/src/modules/studio/services/plugins/installer.ts#L43-L67)。

### 3. 设置、升级和卸载

- **模型**：下文安装步骤按 0.8.17 写成。0.8.18 取消私有模型配置；桌面共享要求 Studio 能校验 POSIX 文件归属，本轮未启用或验收 Windows 共享模型。不要把旧「私有直连」操作当成 0.8.18 的配置方式。
- **身份**：从 Deva 身份页添加，或迁入审阅过的 Markdown；宿主运行用户决定 home；别照搬 Linux 工作区绝对路径。**MCP**：按目标机重填 stdio 程序和参数，优先原生 exe（或 `node.exe` 加已安装脚本），也可配置 Streamable HTTP；不要假定 `npx.cmd` 可被无 shell 的 spawn 直接执行。秘密通过目标环境和适当的凭据方案配置，不复制整份 MCP 文件。
- 保留旧版可信成品。升级用插件详情的「升级」，指定预制新目录并再次确认信任；「重载」不取新版本。检查版本、active/enabled 以及 registry revision。回滚用插件中心「回滚」或重新安装可信旧目录。卸载在插件中心操作，不手改注册表，不假定删掉 Profile 数据。宿主自身卸载分开：桌面安装版走 Windows 设置，Web CLI 先 `ekko-studio-web.cmd stop` 再 `npm.cmd uninstall -g ekko-studio`。不混用生产数据目录试验。

## 平台边界

| 检查项 | 结论 |
| --- | --- |
| Home、APPDATA、盘符 | 桌面用 Electron `app.getPath('home')`（`apps/desktop/src/main/services/config.ts:17–31`），插件用 `sharedDevaHome > DEVA_HOME > homedir()/.deva`（`lib/deva-fs.mjs:29–38`）。不是 APPDATA 默认根；旧 Electron `userData` 是密文迁移来源。用 `C:\Deva\package`，不是盘符相对 `C:Deva\package`；[Linux 上 Node 的 win32 路径模拟](</home/agent/shared_workspace/deva/.tmp/deva-audit-restart.9K7A8k/windows-path-probe.txt>)分别返回 true / false。避免只差大小写的 ID；JS 字符串匹配与 Windows 常见文件系统大小写规则不可等同。 |
| 权限、原子写 | 插件仅在有 UID 的平台检查 owner/chmod，Windows 要靠 NTFS ACL，不能宣称 `0700/0600` 等价。入口/链接检查及同目录临时文件、fsync、rename 见 `lib/deva-fs.mjs:50–145`；桌面写入见 `apps/desktop/src/main/services/atomic-write.ts:10` 起。Windows 句柄占用、junction、网络盘与 ACL 未实测。 |
| Shell 与程序启动 | 桌面优先 Git for Windows 的 Bash，缺失回落 cmd（`apps/desktop/src/main/services/exec-policy.ts:12–60`）；插件 `lib/tools.mjs:568–594` 直接 `bash -lc`，Windows 有 taskkill 分支但没有 cmd 回落；须从实际 Studio 服务 PATH 找到 Bash。插件 stdio 直接 spawn 命令（`lib/mcp.mjs:235`）。 |

**未实测：** Windows PowerShell 执行、安装器/ZIP 启动、原生源码打包、登录态插件 UI、Windows 下 npm 子进程/Bash/MCP 与文件权限、Windows 上实际升级和回滚，以及真实第二台设备。Linux 对照不能代替这些项目。
