# Windows 模型保存修复（0.8.21）

0.8.20 修好了读取，但模型页根据 desktopWriteRequired 禁用保存，后端 sharedDevaPath 仍要求显式 sharedDevaUserId。Windows 无 getuid 已非读取失败原因；Linux 未配置账号也会拒写。正确配置项是 sharedDevaUserId，不是 sharedDevUserId。

0.8.21 保留只读镜像；保存授权与实际网络请求分离。未显式配置所有者时，只有宿主 PluginContext.identity.userId 与当前 RunContext.identity.userId 相同的账号可以自动保存，并且根必须是 os.homedir()/.deva、真实路径一致、目录与 config.json 不为符号链接、文件无硬链接。其他目录不能自动放行。显式 sharedDevaUserId 始终优先，不允许激活账号绕过它。宿主未提供激活账号时保持拒绝，并显示缺失原因。远程账号不能仅凭知道路径获得权限。

路径优先级 sharedDevaHome → Studio 进程 DEVA_HOME → os.homedir()/.deva；Windows 的 homedir 通常来自 USERPROFILE。DEVA_HOME 指向其他目录时需管理员显式指定所有者。远程 Linux Studio 不会读取另一台 Windows 的文件。

被拦提示列出实际 userId、sharedDevaUserId（unset 表示未配置）及 activationUserId。管理员确认账号与路径后在 Studio 插件配置中设置 sharedDevaUserId，保存配置，关闭并重新打开模型页。不知道账号时以页面返回值为准；缺失时说明宿主未提供，不能猜 1。实际直连 http://127.0.0.1:7863/v1 另需把完整地址加入 modelTrustedBases。保存模型本身无需批准此地址。运行授权与网络策略保持不变；API Key 仅在服务端按账号/Profile 存储，页面只收到 hasApiKey，桌面密文不会导出。

## 两条安装入口

在仓库根目录运行（Studio 登录 token 用环境变量传入；不得放命令行或提交）：

```powershell
$env:STUDIO_URL = 'http://127.0.0.1:8648'
# 先在当前进程安全设置 STUDIO_API_TOKEN
node scripts/install-deva-agent.mjs
node scripts/install-deva-agent.mjs --check
```

默认 source 是仓库 plugins/deva-agent 的绝对目录，不依赖 .tmp 解包。Studio 必须运行在能访问该目录的同一台机器。

npm pack 成品路径：

```powershell
New-Item -ItemType Directory -Force .tmp/deva-pack | Out-Null
npm.cmd pack ./plugins/deva-agent --pack-destination .tmp/deva-pack
New-Item -ItemType Directory -Force .tmp/deva-pack/unpacked | Out-Null
tar -xzf .tmp/deva-pack/studio-plugin-deva-0.8.21.tgz -C .tmp/deva-pack/unpacked
node scripts/install-deva-agent.mjs --package (Resolve-Path .tmp/deva-pack/unpacked/package).Path
```

--package 可指任何绝对解包目录，不要求 .tmp；这里 .tmp 仅用于示例临时产物。--ref 显式从已 fetch 的 Git ref 构建历史版本。安装器验证版本、revision、active、enabled；相同版本默认跳过更新，因此本次使用 0.8.21。0.8.18 tag 不变。

## Windows 真机自检（本机尚未执行）

1. 完整退出 Deva 桌面与托盘，升级后打开模型页；确认正在读取 C:\Users\YXXNY\.deva\config.json，默认为 cpa / cn:deepseek-v4.1-flash，地址 http://127.0.0.1:7863/v1。
2. 确认保存可点。为验证真正写盘，把强度从默认改为 high 再保存；无改动保存是幂等操作，mtime 不一定变化。
3. 在同一 Windows 用户 PowerShell 对比保存前后：

```powershell
$file = Join-Path $env:USERPROFILE '.deva/config.json'
Get-Item $file | Select-Object FullName,LastWriteTimeUtc,Length
$c = Get-Content $file -Raw | ConvertFrom-Json
$c.models.activeModelId
$c.models.activeEffort
$c.models.providers | Where-Object enabled | Select-Object id,name,apiHost
```

4. 应仍为 custom-1794383812625:cn:deepseek-v4.1-flash，强度变为 high，provider 数量及其他配置保留；再改回默认保存。被拒时按页面实际账号修正配置后重开页面。
5. 真正请求网关时单独批准完整地址，并在此 Windows 设备检查网关监听及请求结果。未批准时应显示地址和 modelTrustedBases，不应禁用保存。

验证边界：Linux 上缺少 getuid 的模拟不是 Windows 原生 ACL、注册表、大小写或 junction 测试；真实宿主角色切换及该 Windows 的 loopback 网关仍待真机验收。身份/MCP/页头与桌面源码未修改。
