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

## 0.8.24：从供应商获取模型及长度

现象：0.8.23 的「新增 Chat Completions 提供方」只有手填模型名，没有向供应商查询模型列表。0.8.24 在同一表单加入「获取模型列表」、名称过滤和模型选择，保留手填兜底。版本递增，不覆盖 0.8.23。

实现位置：`server.mjs:44` 登记 `list-provider-models`；`lib/model-discovery.mjs:7` 解析供应商响应、`:24` 发起获取；`client.mjs:1087` 是表单内的获取/选择组件；`lib/desktop-models.mjs:141` 保存长度。获取调用与对话共用 `lib/model-selection.mjs` 的 `readCredential` / `resolveCustomEndpoint` 和 `lib/custom-model-network.mjs:61` 的直连传输。没有访问宿主模型目录，也没有回退请求。

请求为 `GET {规范化 Base URL}/models`，有凭据时使用 `Authorization: Bearer`。表单新填 Key 只发往插件服务端并用于本次请求，获取操作不保存 Key；点击保存才按既有方式保存到当前用户/Profile 的服务端凭据。已有 Key 由服务端按相同 provider + Base URL 读取，前端只见「已设置」。不同地址、不同账号不能复用原 Key。错误不回传上游正文，避免上游回显凭据；模型 ID 回显当前 Key 时整批拒绝。无自动跳转，响应上限 2 MiB，获取超时 15 秒。

支持 `{data:[{id,...}]}` 与裸数组。仅接受实际返回的正安全整数，忽略未知字段、无效条目和重复 ID：

| 返回字段 | 表单/桌面记录 | 含义 |
| --- | --- | --- |
| context_length / max_model_len / context_window / top_provider.context_length（按序取首个有效值） | contextWindow | 上下文总长度 |
| max_output_tokens / max_completion_tokens / top_provider.max_completion_tokens | maxOutput | 最大输出长度 |
| max_input_tokens | maxInput | 最大输入长度，不等同总上下文 |

OpenAI 官方 `/models` 的标准响应只提供基本模型信息，不保证长度；OpenRouter 的模型目录有 `context_length` 和 `top_provider` 等元数据。兼容代理是否透传这些字段，以该地址实测返回为准。缺失时显示「未提供，可手动填写」，不会按模型名查表或猜数值。切换模型或修改地址会清掉旧的长度草稿；手动填写仍可保存。长度仅用于本插件展示和记录，不增加/更改 `/chat/completions` 的 `max_tokens`、`max_completion_tokens` 或其他负载字段。

网络边界不变：公网 HTTPS 在通过 DNS 公网地址检查后可请求；本机/内网/HTTP 需管理员将**完整 Base URL** 精确加入 `modelTrustedBases`，沿用上方批准脚本和配置位置。`/models` 与 `/chat/completions` 共用同一批准项，不需另加 `/models`，不允许通配。只读桌面配置依旧免网络批准。401/403 明确报 Key/权限错误，404 提示检查 Base URL 或手填，超时/非 JSON 明确报错；空数组显示空列表，不当作成功选中模型。

### Windows 升级与自检

1. 将 `studio-plugin-deva-0.8.24.tgz` 下载到目标机并解包。通过 Studio 官方插件安装入口安装解包目录；或者管理员在 PowerShell 使用官方 API（`STUDIO_API_TOKEN` 仅在当前进程设置，勿贴到聊天或写文件）：

   ```powershell
   tar -xzf .\studio-plugin-deva-0.8.24.tgz
   $studio = 'http://localhost:3000' # 换成这台设备的实际 Studio 地址
   $headers = @{ Authorization = "Bearer $env:STUDIO_API_TOKEN" }
   $registry = Invoke-RestMethod "$studio/api/studio/plugins" -Headers $headers
   $body = @{ source = (Resolve-Path .\package).Path; revision = $registry.revision; trusted = $true; pluginId = 'deva'; expectedVersion = '0.8.24' } | ConvertTo-Json
   Invoke-RestMethod "$studio/api/studio/plugins/install" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
   Remove-Item Env:STUDIO_API_TOKEN
   ```

2. 核对版本 0.8.24、`status=active`、`enabled=true`；关闭重开 Deva 模型页，无需重启 Studio。原默认模型与「已设置」应保留。
3. 在原「新增 Chat Completions 提供方」填写 Base URL 与 Key，点击「获取模型列表」。若选择已有提供方且显示已设置，可直接使用服务端保存的 Key。127.0.0.1:7863 地址未批准时按上方步骤精确批准；先确认 Studio 服务确实运行在这台 Windows 上。
4. 输入关键词过滤并选择模型。模型名回填，有长度则显示真实数值，没有则显示未提供；仍可手填。保存后重新打开应保留模型与已填写长度，Key 框保持空白且显示已设置。
5. 开发者工具 Network 中核对 `POST /api/studio/plugins/deva/invoke`，`kind=rpc,name=list-provider-models` 的结果只有模型和长度，没有 Key；随后 `get-model-selection` 应回显保存的 `modelName`、可选长度及 `hasApiKey=true`。不要导出包含新填 Key 的请求体。
6. 下一轮用 Agent 默认模型发送一句普通消息，在代理端确认 `POST /v1/chat/completions` 的 model 正确并收到真实回答；本轮只有 mock 端点验证此负载，没有代替 Windows 代理验收。身份有单独模型绑定时仍优先使用身份绑定。

回滚：读取实时 registry revision，经官方 `PATCH /api/studio/plugins/deva` 发送 `{"revision":当前值,"action":"rollback"}` 回到 previousVersion，或重装备份 0.8.23 包。不要回滚用户 config/凭据；长度是可选模型字段，旧插件忽略它们。回滚后获取列表入口消失，手填继续可用。

本轮验证边界：真实 Chromium 加载原始 client.mjs 和样式；桥接夹具替换宿主 RPC 传输、账号/存储、通知和外部模型服务，读取/保存/获取逻辑均调用真实服务端函数。它不是 Studio/Windows 真机。真实 Studio 热装和 RPC 单独记录在交付报告；Windows 的实际布局、代理返回字段、角色和连通性必须在该设备验收。

## 0.8.25：新增提供方的显式保存与重开验收

本轮独立复测：0.8.24 的新增路径在隔离 Chromium/真实服务端函数中能新增 provider.models、设置 activeModelId 并重开读回，不能把用户设备的失败武断归为“仅回填没有落盘”。目标机保存 RPC/路径/写权限未取得，实际失败原因仍待该设备核对。

确认的缺陷：旧 client.mjs 保存请求发出前清空 Key；请求被拒后模型名尚在但凭据草稿已丢，重试可能存成无 Key 模型。本轮改为成功读回后才清空，失败保留草稿。发现列表旁新增「保存所选模型并设为默认」，与底部保存走同一逻辑；保存后独立 get-model-selection 核验引用、模型名、默认下拉及凭据状态，不一致明确报错，不显示成功。不会把 Key 写入日志或 config.json。

桌面端对照（只读）：ModelSettings.tsx:244 通过 provider.listModels 获取清单，:308 confirmAdd 批量添加所选或手动单个 ID；store/models.tsx:258/265 的 addModel/addModels 写启用模型，:316 新增 custom provider，:204 每次状态变更经 config.set 写整个 models 段。preload/index.ts:685 → main/services/config.ts:95/65，顶层浅合并后 writeFileAtomic 写 config.json。设置默认是 store/models.tsx:225 的独立 setActiveModel(pid,mid)。Key 经 secrets:set，用 safeStorage 加密到 secrets.json，不在 provider 明文保存。

插件本轮保持单选保存，不新增批量启停编辑器；与 Desktop 共用 provider/models/activeModelId 结构，保存同时设默认。Desktop ModelDef 只有 contextWindow/maxOutput，没有独立 maxInput；插件 maxInput 是额外记录字段，桌面不展示它。Desktop 的 maxOutput 有运行语义，插件对话不因记录长度而改变负载。

**双端同时编辑边界**：Desktop main/services/config.ts:39 缓存读取，:65 setConfig 从内存副本整份写回；renderer/store/models.tsx:204 还会整块替换 models。桌面进程在插件修改后写配置，存在覆盖插件新值的路径。插件无权刷新另一个 Electron 进程内存，本轮不改宿主/桌面；使用插件编辑时先退出独立 Deva 桌面应用，保留 Studio 运行。仅立即读回不能保证未来不被另一进程覆盖。

Windows 自检：安装 0.8.25，关闭重开 Studio 的 Deva 模型页；下拉选新增 → 填 URL/Key → 获取 → 点模型 → 点击列表旁保存所选模型。重开后默认下拉应选中该模型，hasApiKey=true。核对页面显示的 config 路径；PowerShell 读取该路径的 models.providers 和 activeModelId，前后比较。保存失败请保留页面错误与 save-model-selection 的 HTTP 状态/错误体（不要导出含 Key 的请求体），以及 get-model-selection 的 desktopWriteRequired、desktopWriteMessage、desktopConfigPath。正确所有者字段是 sharedDevaUserId，不是 sharedDevUserId。网络批准仍只约束获取/直连；本地保存仍需写权限，批准网络不授予文件写权限。

若提示保存后读回不一致，退出独立桌面端并重试；若重开仍丢失，应检查哪一进程在重写该 config。目标 Windows/cpa/角色/面板本轮未实测。回滚通过官方安装 API 重装备份 0.8.24（或 previousVersion 确为 0.8.24 时 rollback），不回滚 config 或凭据。

### 0.8.26 桌面内容自检（含 Windows）

打开模型页，先核对桌面默认模型下拉和读取诊断，再点「获取模型列表」。该按钮重新读取桌面配置；「刷新远端模型列表」才发起网络请求。无 Key 或远端失败仍可选择已有模型并保存。

Windows 请比较桌面与 Studio 进程的 AI_UPPER_HOME / DEVA_HOME，以及运行账号的用户目录。若 Studio 在另一机器，默认 ~/.deva 指的是 Studio 服务器，无法读取 Windows 本地配置；必须使用在该设备运行的宿主或明确配置其可访问的 sharedDevaHome。核对页面 path、exists、stat、providerCount、modelCount；不存在、权限拒绝或 JSON 错误均按页面诊断处理，不要提交 secrets.json 或 API Key。**0.8.44 起**：同一 OS 用户、同一台机器上，插件会在服务端按需只读解密桌面 `secrets.json` 里同一 provider 的密文（Windows DPAPI CurrentUser；明文只在内存、不写回、不进日志、不回前端），因此桌面端存过的 Key 不必在 Studio 再填一遍。跨用户/跨机器仍不可解，页面会给出原因码（`dpapi-failed` 等）与确切路径；此时手填即可。

### 0.8.50 macOS 钥匙串诊断

模型页新增「钥匙串诊断」按钮：只读枚举 `security list-keychains` / `default-keychain` / `dump-keychain`（不带 -d，只读属性），显示 keychain 路径、用户、genp 总数、匹配的 service/account，以及 `secrets.json` 每条的长度/前缀/`likelyFormat`。若显示 `likelyFormat=win-gcm`，说明这份 v10 密文是 Windows 生成的，macOS 密码学上解不开——请在 Mac 桌面端重存一次，或在模型页填一次。`mac-keychain-item-invisible` 表示条目存在但当前进程读不到密码，请点系统「允许」后重试，或手填。

### 0.8.49 Windows 桌面密钥解密（safeStorage v10）

Windows 上 Electron safeStorage 使用 `v10` + AES-256-GCM，AES 密钥由 DPAPI 保护后放在 `<userData>/Local State` 的 `os_crypt.encrypted_key`（base64 带 `DPAPI` 前缀）。插件按两层解密；诊断字段：

- `decryptCode=local-state-missing`：找不到 Local State（`%APPDATA%\<App>\Local State` 等候选）→ 确认桌面端启动过、Studio 与桌面同一 Windows 用户；
- `encrypted-key-invalid`：`os_crypt.encrypted_key` 缺失/不是 DPAPI 格式；
- `key-unprotect-failed`：DPAPI 解不开该密钥（用户/机器或文件损坏）；
- `gcm-auth-failed`：v10 载荷 GCM 校验失败（Local State 密钥与密文不匹配，桌面端重装常导致）；
- `blob-not-dpapi`：密文既不是 v10 也不是合法 DPAPI blob（`0x80131501` 参数无效属于这一类的表现，**不代表**跨用户）；
- `foreign-blob-proven`：仅当同一台机器、不同 Windows 用户被规范化确证时才出现。

`aclReadable`/`fileOwner` 按真实可读性与规范化 owner 判定；`XY-L275\XYXNY` 与 `xy-l275\xyxny` 视为同一用户。

### 0.8.48 macOS 桌面密钥解密

macOS 上插件现在能直接从 Keychain 取 Electron safeStorage 主密钥解密 `~/.deva/secrets.json`（`v10` + AES-128-CBC）。看不出来源时按 `decryptCode` 处理：

1. `mac-keychain-item-missing`：钥匙串里没有 `<App> Safe Storage` 条目（桌面端被重装/换签名，或应用名不同）→ 在桌面端重新保存一次 Key，或在模型页手填一次。
2. `mac-keychain-denied` / `mac-keychain-no-session` / `mac-keychain-timeout`：keychain 需要授权但无法弹框（Studio 可能跑在无图形会话的守护进程里）→ 在已登录的桌面会话里打开 Studio 并在系统提示中允许访问，或手填一次。
3. `mac-key-mismatch`：钥匙串里的密钥与这份密文不匹配（桌面端重装后生成了新 Safe Storage 密钥）→ 桌面端重新保存该 Key。
4. `platform-unsupported`：Studio 服务端既不是 Windows 也不是 macOS（例如 Linux 容器），跨平台不可解 → 手填一次。

### 0.8.47 Windows 桌面密钥解密失败怎么判

模型页报「桌面有该提供方密文但解不开」时，先看 `keyDiagnostics` 里的 `decryptCode`，按三类处理：

1. **`decrypt-assembly-unavailable` / `decrypt-language-mode-restricted` / `decrypt-tool-missing` / `decrypt-roundtrip-failed` / `decrypt-output-invalid`**：Studio 所在 Windows 机器上的 PowerShell/DPAPI 工具链有问题（缺程序集、Constrained Language、或被组策略限制）。这是**环境问题**，不是 Key 无效；管理员修好 PowerShell 5.1 或 7 后可重试。
2. **`dpapi-foreign-blob`**：自检往返已成功（说明本机 DPAPI 正常），但这一个密文解不开——它属于**另一个 Windows 用户或另一台机器**。DPAPI 是用户级加密，**密码学上不可解，任何代码都绕不过去**：只能在模型页手动填一次（账号级，换 Profile/重启都保留），或由桌面端做显式交接（需改桌面端，本版本未实现）。
3. **`platform-unsupported`（含 container 标记）**：Studio 服务端不在那台 Windows 上（Linux/WSL/容器），同理不可解；把 Studio 部署到同一台 Windows 或手动填一次。

「获取模型列表」成功不代表对话可用：列表请求在没有 Key 时**不带 Authorization**，有的网关允许匿名列清单。页面会显示 `authProbe` 结论；以 `chat/completions` 的结果为准。

### 0.8.27 旧形态核对

若看到“不兼容的桌面模型配置字段”，记录诊断中的字段路径及 config.json 绝对路径，不要删除原配置或只复制 API Key。当前桌面读取的是 models.providers[].models[]、apiHost 和 models.activeModelId；provider/model/defaultModel/baseUrl 等别名未获当前桌面迁移代码支持，因此明确拒绝猜测转换。若实际桌面版本能读取这些形态，需要对应版本的读取代码或不含密钥的配置结构样本来补兼容。

## 0.8.30：确认进入插件模型页

入口是 Agent 管理 → Deva → 设置 → 模型 · Deva 0.8.30。hash 路由为 `/#/studio/plugin-agent-settings/deva/model`，不是 Studio 自带模型/供应商页。

侧栏标题来自 manifest，独立于插件 client 执行；正文顶部“Deva 0.8.30 · 模型客户端已加载”证明 mount 已执行。只有标题没有正文标记时，尚不能认为 RPC 已发出，须检查宿主 iframe/模块加载。正文加载后路径、条数及错误仍由真实 RPC 诊断返回，不猜路径或把未知计数写成零。

热装后重新加载 Studio 页面再从上述入口进入。标题与正文版本都应一致。若标题仍旧，刷新宿主目录；若标题新而正文旧或缺失，记录 iframe 加载错误。本版本只增加入口与加载阶段识别，不声称修复尚未复现的空白根因。插件无法在自身 JS 根本未执行时控制 iframe 正文，占位边界由宿主管理。

0.8.31 保留宿主桥接 `API Error 500` 中的 HTTP 状态码，错误不再显示成 HTTP 未知。独立真实宿主验证与原实例的用户页面故障是两项证据，不可互相替代。

只读命令行（不依赖页面）：`node scripts/list-desktop-models.mjs --studio http://127.0.0.1:8648`。认证从 STUDIO_TOKEN 环境变量读取，勿把凭据写命令参数或日志。支持 STUDIO_PROFILE。`--config` 指定实际文件；默认沿用插件路径解析。仅调用 get-model-selection，不调用保存/远端模型刷新。若使用现有认证 MCP 传输，可将刚收到的完整 JSON 响应送入 `--rpc-stdin`；此模式不是脚本自行联网，输出不应声称它自行完成了 HTTP 请求。两种模式均独立读取本地配置并打印 provider/model 引用，不输出Key。
