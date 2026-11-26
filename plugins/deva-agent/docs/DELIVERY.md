# 0.8.37 交付与升级：Git 推送不等于插件安装

`fanchcho/deva` 的 `develop-agent` 保存插件源码。目标 Studio 必须通过插件管理安装新目录；本机热装、Git push、刷新页面均不会自动替另一台 Studio 升级插件。

## 最小安装路径

拿到制备好的 0.8.37 成品 ZIP 后，在**运行 Studio 服务的机器**解压，得到含 `plugin.json`、`client.mjs`、`server.mjs` 的 `package` 目录。在目标 Studio 的插件中心为 Deva 执行升级，安装来源填写该目录的绝对路径，确认信任。首次安装才使用安装插件并启用。

ZIP/TGZ 是运输格式，不能把压缩文件路径直接填作安装来源。若浏览器在 Windows、Studio 服务在容器中，Windows 下载目录不是服务端目录：必须先把 package 放进容器能访问的挂载目录，再填写容器内绝对路径。

无需升级或重启 Studio 宿主。完成插件升级后重新进入 **Agent 管理 → Deva → 模型**。只用这一条目视自检：顶部应显示 `Deva 0.8.37 · 候选 … 个 · …`；零候选也应显示原因。看不到该版本行，不能当作新客户端已经生效。

已有仓库和脚本环境时也可运行仓库的 `scripts/install-deva-agent.mjs --package <绝对目录>`，凭据按安装手册安全提供；不要在聊天、命令参数或报告中粘贴 token。普通仓库 URL 不等于可安装插件根目录。

## 镜像与 CI 边界

本仓库 `.github/workflows/image.yml:25` 仅自动响应 main、feat/plugin-deva-agent、v* tag 和 PR，另支持手动触发；develop-agent 的普通 push 不触发该镜像发布。

该工作流使用 `apps/web/Dockerfile`，生成的是 Deva Web 应用镜像。其 runtime COPY 不含 `plugins/deva-agent`。这不是 Ekko Studio 宿主镜像，也不是 Studio 插件安装动作。不要期待重建此镜像或 watchtower 拉取后，另一套 Studio 的插件注册表自动升级。

`apps/web/docker-compose.yml:16` 默认指向上游 `ghcr.io/sqfcyily/deva:latest`；fork 工作分支 push 不会更新这个上游镜像。以上仅为源码定义，不代表用户实际采用此 compose。

2026-11-26 可访问的 Linux Studio 使用挂载数据目录中的热装插件；Windows 的进程、镜像、安装路径和客户端仍未获得证据。不能将 Linux 成功或零日志解释为 Windows 已修好或没有操作。

## 产物核对

0.8.37 功能提交：`2cc1b01db0ca3b658cf0add38094300a2fb0c672`。
该版本 client.mjs SHA256：`bc8c2116a565fa5cad02daa33d46e8460f6a458a4f98a5f6ea320bb0b4ac70e3`。
顶部状态、零候选文案、首次挂载离屏滚动已包含在此提交。后续纯文档提交不改变客户端字节。
