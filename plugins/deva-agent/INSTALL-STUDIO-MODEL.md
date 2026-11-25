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

## 0.8.22：模型页可保存，但会话显示 Deva 0

2026-11-25 新截图实际显示：Windows config 路径、cpa / cn:deepseek-v4.1-flash、127.0.0.1:7863、xhigh、可点保存和两个身份绑定；Key 框空白，图中未看到「已设置」。第二图 Deva 计数 0、Agent 默认模型勾选、底部无模型。不能由输入框空白断言凭据不存在，必须读 get-model-selection 的 hasApiKey。

根因是 0.8.21 的运行/目录路径仍在 lib/model-selection.mjs:109 使用 sharedDevaPath；保存已支持 sharedDevaWritePath 本机激活账号，运行却不支持。未配置 sharedDevaUserId 的等价夹具实际返回：页面 desktopWriteRequired=false、目录 models=[]、readCustomModel=null。该分支未发网络请求，因此没有上游 HTTP 状态码。私网批准在更后面的 createCustomModel，是另一道门。

注册点 server.mjs:126 → lib/agent.mjs:194 的 global.listModels → lib/model-selection.mjs:274。只发布一个稳定 id=deva-direct（当前默认路由），不发布所有 19 个桌面选项。实际目录接口 GET /api/studio/agents/plugin%3Adeva%2Fdeva/models；本机 0.8.21 已配置 owner，实际返回 ready、1 个模型，证明宿主能列插件模型。未取得 Windows 宿主接口或其渲染源码，不能宣称直接观察到那台机器的过滤过程。

0.8.22 改法：目录只读投影，不因 owner、Key、网络批准而消失；Agent 从可信 plugin.identity 注入 desktopActivationUserId（lib/agent.mjs:226），运行与保存共用本机账号/目录边界。显式 owner 仍优先。无访问权限、失效默认引用或身份绑定明确报错；上游 401/403 说明 Studio Key 是否设置及修正位置。无 Key 不是必然错误，允许不要求认证的本机服务。

默认路由在运行时先解析当前身份的 personas/<id>.md model，再使用 config activeModelId。因此截图默认小码酱应解析 cpa/deepseek；切到 Deva 身份可能解析 glm，不能把全局默认与身份覆盖混同。请求由插件直连 Base URL + /chat/completions（lib/studio-model.mjs:45、lib/custom-model-network.mjs:60），不是宿主模型网关；127.0.0.1 是 Studio 服务所在机器。

### 管理员精确批准（可执行，不需重启 Studio）

升级到 0.8.22 后，在目标 Windows 机器解包安装包，使用 Node 20+。管理员在当前 PowerShell 进程设置 STUDIO_API_TOKEN（不要贴到聊天或写入配置文件）；用实际 Studio 地址替换下面的地址：

```powershell
node .\package\scripts\approve-model-base.mjs "http://localhost:3000" "http://127.0.0.1:7863/v1"
Remove-Item Env:STUDIO_API_TOKEN
```

脚本经官方 GET /api/studio/plugins → PATCH /api/studio/plugins/deva 写入合并后的 modelTrustedBases，并 GET 读回校验；保留其他配置，使用 revision 防并发覆盖。拒绝通配、带认证信息/查询/片段的地址，只批准完整规范化 URL。403 表示当前 token 不是有权管理员，没有伪造批准。不自动设置 owner，也不收集模型 Key。成功输出 approvedBase 和 revisionBefore/revisionAfter。此操作只证明批准已生效，不代表网络端口连通。

也可在 Studio 插件 Deva 配置中保留原数组并加入：

```json
{"modelTrustedBases":["http://127.0.0.1:7863/v1"]}
```

本机单用户账号无需再专门配置 sharedDevaUserId；自定义 sharedDevaHome、其他 OS 用户或管理员显式 owner 场景仍按提示设置正确账号，不能自动信任任意目录。

### Windows 升级与真正通话验收

1. 通过官方插件安装入口安装 0.8.22，核对 active/enabled，关闭重开模型页和会话选择器，点击刷新。目录应 ready、models 中有 deva-direct / cn:deepseek-v4.1-flash，不再是 Deva 0。
2. Network 中 POST /api/studio/plugins/deva/invoke，body={"kind":"rpc","name":"get-model-selection"}：核对 modelRef、hasApiKey、needsNetworkApproval。目标机 hasApiKey 尚未由开发环境读取，不冒称缺失。
3. 执行上述精确批准；重开模型页，needsNetworkApproval 应消失。若代理要求 Key，在模型页填入并保存，重新读 hasApiKey=true。Key 不会从桌面 safeStorage 自动复制。
4. `Test-NetConnection 127.0.0.1 -Port 7863` 验证监听；端口通不等于模型可用。
5. 用小码酱身份、Agent 默认模型发送「仅回复 DEVA_CHAT_OK，不调用工具」。必须看到真实回复，并在代理日志确认 POST /v1/chat/completions、model=cn:deepseek-v4.1-flash。xhigh 若被上游 400/422 拒绝，页面改默认强度再测，不自动降档。
6. 本机官方 Chat Run 实测可以使用 agent_id=plugin:deva/deva、source=coding_agent、mode=global；尽管当前 OpenAPI agent_id enum 未列插件 id，实际接口接受。不得把其他 agent 的回答当成成功。

回滚仍使用官方 PATCH action=rollback 并带实时 revision，回到 previousVersion；或重装备份 0.8.21 包。回滚会恢复目录/运行授权断层；不要回滚桌面 config 或密钥。批准记录可由管理员从 modelTrustedBases 精确删除对应项，保留其他地址。

验证限制：Windows 真接口、角色、7863 端口与 Key 状态未实测；本机真实 Studio 对话和受控 HTTP/SSE 夹具分开记录，后者不等于 Windows 代理已通。没有真实 UI 渲染截图。

## 0.8.23：Studio 窄面板布局

模型页沿用真实入口「桌面默认模型 → 新增 Chat Completions 提供方」，新增状态显示独立标题与取消操作。当前插件只支持该自定义 Chat Completions 表单：地址、单个模型名、Key、强度；没有宿主式供应商类型切换、独立供应商名称或批量模型增删编辑器，本次未新增这些数据能力。

模型页限定单列、所有字段上置标签，控件和操作按钮最小 40px，窄面板按钮纵排，宽面板操作两列。地址/模型名提供可换行完整预览，目录路径及错误文本可任意断行；没有 overflow:hidden 遮挡内容。操作区保留在文档流，可滚动到达，不遮最后一个字段。深色主题、字号、焦点及禁用状态沿用宿主 token。客户端仍为自包含模块，兼容 Studio Blob 加载，不引入 UI 依赖。

升级：通过官方插件安装接口/入口安装 0.8.23，无需重启 Studio；关闭重开 Deva 模型页，选择「新增 Chat Completions 提供方」，320–520px 面板应显示单列字段、40px 保存/取消按钮和可换行 URL/模型预览。填写地址和模型名，保存后应回显桌面选择；取消应恢复原选择而不写文件。Key 仍仅显示已设置状态，网络批准与运行解析不变。

本机 Chromium 的 320/360/420/768 等价宽度截图和量测另存报告；harness 使用真实 client.mjs/样式与真实 readModelSelection/saveModelSelection，仅替换宿主 RPC 传输、账号存储和通知接口，并使用隔离 config。不是 Studio/Windows 真机验收。宿主面板宽度因无授权 Desktop 浏览器未知。回滚使用官方插件 rollback 或重装备份 0.8.22；不回滚用户 config。
