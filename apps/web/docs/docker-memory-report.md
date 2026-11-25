# Docker 构建与内存改造证据

2026-11-25，分支 deva_web。未 commit、push、部署、构建 Docker 镜像或启动容器。
只在工作区内启动并终止了隔离的 Node 冒烟进程。原有未跟踪文件未修改。

## 必做清单

- [x] 原始 compose、build override、Dockerfile、根 .dockerignore、README、依赖清单：完整原文保存于根 `.tmp/docker-memory/before.txt`，不是事后重构的摘录。
- [x] 核查 scripts/redeploy.sh 与 out/OPS.md：二者原本不存在，原始证据标记 missing；没有虚构脚本内容。README 提到的 image.yml 也不存在，已注明并提供直接 Compose 用法。
- [x] 保留并收紧已有多阶段：仅复制 renderer、Web dist、生产网关产物、node-pty；移除整个 apps/web/src 拷贝。builder 清理安装 store/cache，runtime 从独立基础镜像开始。
- [x] ARG 安装并发/下载并发/Node 堆，以及对应 Compose args、README、.env.example。
- [x] .dockerignore 补 .git、嵌套临时目录、缓存、本地环境和数据；源码 COPY 缩至 desktop/web。DEVA_COMMIT/DEVA_REF 传入版本元数据，不依赖 .git。
- [x] 只编译 renderer + Web，不跑 Electron main/preload、手机端。
- [x] 评估 filter：不拆安装依赖。Web 清单 dependencies/devDependencies 均为 0；desktop 为 12/28，relay 为 0/3，relay-node 为 1/4。Web 借用 hoisted desktop 工具链及 relay-node 的 esbuild；单独 filter Web 不能构建。保留冻结锁文件与既有安装方式，避免未经隔离安装验证的过滤声明。未声称减少了安装依赖数量。
- [x] 非 Swarm mem_limit/memswap_limit、Node old-space、shm 均可调。
- [x] watchtower 900 秒轮询、cleanup=true、scope=deva、enable 白名单、镜像和 pull_policy 保持；不以限制 watcher 进程可靠性换资源指标。
- [x] 默认 project=web、volume=web_deva-data，通过解析断言验证；没有设置新的顶层 name。
- [x] 基础 Compose 与叠加 Compose 官方解析及自定义环境覆盖测试通过。
- [x] 文档、变量示例、报告与原始证据落盘。
- [ ] 完整 Docker build、镜像层/压缩大小、容器 node_modules、Chromium RSS 峰值：本机 daemon 不可用，未实测。需服务器复验，不构成已部署验收。

## 改前与改后

| 项目 | 原始状态 | 当前状态 |
|---|---|---|
| 构建阶段 | 已有 builder/runtime 两阶段 | 保留两阶段并缩小产物边界 |
| 编译目标 | desktop main、preload、renderer、mobile，再 Web | renderer，再 Web |
| 安装范围 | workspace 冻结安装 | 相同；未虚报依赖数量下降 |
| 安装生命周期并发 | 未显式限定 | 1，可调 |
| 下载并发 | 未显式限定 | 4，可调 |
| 构建 Node old-space | 未显式限定 | 768 MiB，可调 |
| 容器 RAM | 无显式上限 | 1280 MiB / 1342177280 B |
| RAM + swap | 无显式上限 | 1280 MiB；默认禁用该容器 swap |
| 运行 Node old-space | 无显式上限 | 每进程 256 MiB，worker 继承 |
| /dev/shm | 1 GiB | 256 MiB / 268435456 B，容量下降 75% |
| 网关+Web 源码拷贝 | 19 文件，163396 B | 3 个生成 JS 文件，75040 B，减少 88356 B（54.1%） |
| 最终独立 npm 包 | node-pty + 平台包 | 相同，当前 ARM64 本地副本 2 包/16 文件/113407 B |
| watchtower | 900 秒，cleanup=true | 相同 |
| 项目 / 数据卷 | web / web_deva-data | 相同 |

源码字节、包字节均为本机产物测量，不等于镜像层大小或 RSS。当前安装目录总计
22376 文件、504879022 B；它在改造前也未整体进入 runtime。renderer 为 3353959 B。
原始 runtime 已无整套 devDependencies、pnpm store、Electron 二进制、C++ 编译器；
原始多带的是整个 Web src。React 等虽声明为 devDependencies，其运行代码被打入 renderer，
不能错误删掉。Node 官方基础镜像自带的 npm/Corepack 未移除；Chromium、字体、Git、bash、less、
procps、tzdata 保留以支持浏览器、中文/emoji 与终端功能。APT 索引前后均清理。

新网关仍有 src/server 路径下两个**生成的运行模块**，用于保持 fork 与 backend.cjs 相对路径，
不是整个源码树。安装缓存清理降低 builder 层磁盘；缩小 COPY 降低上下文传输；跳过不需要的
编译与降低并发减少构建工作量，但构建峰值 RSS 没有测量。Node 堆限制不是进程 RSS 限制，
Chromium/Buffer/native/多用户 worker 都受容器总额共同约束。2 GiB 主机约余 768 MiB 给 OS、
watchtower、daemon 等；实际是否足够取决于工作负载，不保证重页面或并发多用户不会 OOM。
SHM 是按需占用，容量少 768 MiB 不表示实际 RSS 立即减少同等数字。

## 验证命令与结果

以下路径相对仓库根；原始输出保存在 `.tmp/docker-memory/`。

| 命令 | exit | 证据 |
|---|---:|---|
| docker compose version | 1 | commands.log：宿主缺 Compose 插件 |
| docker info --format '{{.ServerVersion}}' | 1 | commands.log：Cannot connect to Docker daemon |
| .tmp/docker-memory/bin/docker-compose version | 0 | 官方 Linux ARM64 Compose v2.39.4，工具仅下载在 .tmp |
| .tmp/docker-memory/bin/docker-compose -f apps/web/docker-compose.yml config --format json | 0 | compose-base.json、commands.log |
| 同上增加 -f apps/web/docker-compose.build.yaml | 0 | compose-build.json、commands.log |
| python3 .tmp/docker-memory/check-commands.py | 0 | 9 个变量自定义值断言通过，compose-override.json |
| 在 apps/desktop 执行 NODE_OPTIONS=--max-old-space-size=768 ../../node_modules/.bin/electron-vite build --config ../web/electron.renderer.config.mjs | 0 | renderer.log：2230 modules，5.73 秒；缺 main/preload 的警告符合专用配置预期 |
| NODE_OPTIONS=--max-old-space-size=768 node apps/web/build.mjs | 0 | web-build.log |
| NODE_OPTIONS=--max-old-space-size=256 DEVA_UPDATE_CHECK_MINUTES=-1 node .tmp/docker-memory/verify.mjs | 0 | verification.log、runtime-smoke.log：登录/页面/资源通过，worker 162 通道，退出 0 |
| node --check apps/web/build.mjs | 0 | 语法检查 |
| git diff --check | 0 | commands.log |

Node 验证在宿主 v24.22.1/ARM64、已有依赖上运行，打包 target=node20；不代替 Docker
Node 20 的干净安装与运行验证。测试运行目录的原生包软链指向工作区依赖，renderer manifest
指向工作区产物；Docker 保留对应 /src 绝对路径，但该布局未在容器内实际启动验证。
首次辅助脚本曾遇 Compose 数字字符串断言与重复复制软链问题，修正验证脚本后全部通过；
下载 Compose 时先取错 x86_64 架构，替换成 ARM64 后解析通过。没有把失败尝试算作成功。

## 文件范围

- .dockerignore：减少上下文、排除 Git/缓存/本地数据。
- apps/web/Dockerfile：可调构建预算、缩小源码 COPY、只构建 renderer、只复制运行产物。
- apps/web/electron.renderer.config.mjs：复用桌面 renderer 配置，避免复制配置或改桌面构建。
- apps/web/build.mjs：生成生产网关与 worker，支持外部 commit 元数据。
- apps/web/docker-compose.yml：可调 RAM、swap 总额、Node 堆、共享内存。
- apps/web/docker-compose.build.yaml：向本地覆盖构建透传 ARG。
- apps/web/.env.example 与 README.md：所有新增参数、缺失脚本说明、服务器验证命令。
- 本报告：证据、清单、限制。未创建提交，因此没有本次提交 hash。

## 服务器确认

README 的“小内存 Docker 配置”给出只读检查命令；先在实际部署使用新配置后运行：

```bash
docker stats --no-stream deva-web deva-watchtower
docker inspect deva-web --format 'memory={{.HostConfig.Memory}} swap_total={{.HostConfig.MemorySwap}} shm={{.HostConfig.ShmSize}} oom={{.State.OOMKilled}}'
docker exec deva-web sh -c 'echo "$NODE_OPTIONS"; du -sh /src/node_modules; cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak'
```

实际登录并打开 Chromium 页面后重复检查。镜像层使用 README 的 docker image inspect / history 命令。
更新配置必须由用户后续重建容器才生效；watchtower 仅替换镜像不会自动读取宿主编辑的 Compose。
本次不执行任何这些部署操作，不改既有数据卷，也不执行 down -v。

参考官方语义：[Compose](https://docs.docker.com/reference/compose-file/services/)、
[pnpm 10 settings](https://pnpm.io/10.x/settings)、
[Watchtower arguments](https://containrrr.dev/watchtower/arguments/)。
当前没有 Context7 工具或 smart-search skill，采用官方资料并检查本地 electron-vite API/CLI。
