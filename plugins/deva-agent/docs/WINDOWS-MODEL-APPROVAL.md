# Windows 安装和批准本机模型地址

将 studio-plugin-deva-0.8.39.tgz 解压到固定目录。在 Studio 插件中心使用本地插件安装入口选择解压后的 package 目录；不同 Studio 版本入口名称可能不同。安装后进入 Agent 管理 → Deva → 模型，左侧仅显示“模型”，顶部只显示候选数和阶段。

Studio 0.8.30 已验证批准入口：模型页右上角“管理插件” → Deva 详情 → “配置” → modelTrustedBases → “保存”。该字段是 JSON 数组，不是整个对象；保留原数组内容，追加 `"http://127.0.0.1:7863/v1"`。保存立即生效，无需重启。模型页“怎么批准”提供的对象用于说明字段，不应把整个对象粘进数组输入框。

脚本备用路径（Node.js 20+；在包含 tgz 的目录执行）：

```powershell
tar -xzf .\studio-plugin-deva-0.8.39.tgz
node .\package\scripts\approve-model-base.mjs "https://<你的Studio地址>" "http://127.0.0.1:7863/v1"
Test-NetConnection 127.0.0.1 -Port 7863
```

管理员 token 通过预先设置的 STUDIO_API_TOKEN 环境变量提供，不放进命令参数。脚本使用官方 GET /api/studio/plugins 读取完整配置和revision，再PATCH /api/studio/plugins/deva追加地址，并GET读回确认；保留其他配置，拒绝通配符。

批准必须在那台 Windows 对应的 Studio 实例上执行。127.0.0.1 指 Studio 服务所在机器；如果 Studio 在 Docker/WSL/远程服务器，Windows 自己的Test-NetConnection成功不等于Studio能访问。批准仅授权指定完整地址，不能启动服务、打开端口或修复Key。

这是安全策略，模型页面不能自行批准。批准后重新进入模型页再获取模型；地址必须与批准项一致。Windows真机未在本次Linux环境验证。

## 数据目录与交付路径

本机已核实注册配置保存在 `<Studio数据目录>/plugins/global/state.json` 的 records 中。Windows默认形态为 `C:/Users/<用户名>/.hermes-web-ui/plugins/global/state.json`；若设置 HERMES_WEB_UI_HOME 或安装器采用不同数据目录，必须以该实例实际目录为准。本任务无法读取用户Windows，不能保证默认路径就是那台机器的绝对路径。不要手工修改state.json（有revision及热加载约束），用上述管理员配置页或官方脚本。

推荐ZIP解压到 `C:/DevaPlugin/0.8.39/`，其 `package` 目录可作为Studio本地安装来源；tgz与ZIP内容相同。版本只在插件详情/清单与包名查看，导航仅“模型”。
