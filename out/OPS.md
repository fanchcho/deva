# Deva Web 部署与更新运维说明

一句话：**镜像由 CI 构建并推到 `ghcr.io/sqfcyily/deva`，服务器只拉镜像；watchtower 轮询
registry 的 digest，变了就 pull + 重建容器。** 服务器上没有源码也能更新。

> 物理事实：watchtower 只监视**镜像仓库里的 digest 变化**，它看不到宿主机上的源码文件。
> 所以「改源码 → 自动更新」必须先把源码变成新镜像：主链路靠 CI，备用链路靠
> `scripts/redeploy.sh` 在服务器本地构建。watchtower 只负责「新镜像已经在 registry 里」
> 之后的拉取与重启。

---

## 1. 更新链路

```
                         ┌──────────────────────────────────────────────┐
                         │ (A) 主链路：源码 → 镜像 → registry → 服务器  │
                         └──────────────────────────────────────────────┘

  git push (main / feat/plugin-deva-agent / v*)
        │
        ▼
  .github/workflows/image.yml
    ├─ out/check-versions.mjs           （desktop = web 版本，单一事实源）
    ├─ docker buildx build (linux/amd64)
    └─ docker push ghcr.io/sqfcyily/deva:latest / :edge / :sha-<短sha> / :<version>

        ghcr.io 里的 digest 变了
        │
        ▼
  服务器: containrrr/watchtower:1.7.1 (WATCHTOWER_SCOPE=deva)
    ├─ 每 900s 检查一次 scope=deva 且 enable=true 的容器
    ├─ digest 不同 → docker pull → 用新镜像重建 deva-web 容器
    └─ WATCHTOWER_CLEANUP=true → 删掉旧镜像

                         ┌──────────────────────────────────────────────┐
                         │ (B) 备用链路：服务器本地源码 → 本地镜像      │
                         └──────────────────────────────────────────────┘

  服务器上的 checkout 改了源码
        │
        ▼
  scripts/redeploy.sh
    ├─ docker compose -f docker-compose.yml -f docker-compose.build.yaml build deva-web
    └─ docker compose ... up -d  →  deva-web:local  →  容器重建

  注意：这条链路产出的镜像只在本地，不会进 registry，watchtower 看不见它。
        下次 watchtower 发现 registry digest 变化时，会用远程镜像把本地构建覆盖掉。
```

两条链路的取舍：

| | A：CI → registry → watchtower | B：`scripts/redeploy.sh` |
|---|---|---|
| 触发 | `git push` 后自动 | 手动执行 |
| 延迟 | CI 构建时间 + 轮询间隔（默认 900s 内） | 本地构建时间（几分钟） |
| 服务器需要源码 | 不需要 | 需要 |
| 产出镜像在哪 | ghcr.io | 仅本机 |
| 适合 | 正常迭代、多机部署 | 紧急热修、registry 不可用时 |

---

## 2. 首次部署

前提：docker 24+ 与 compose v2 插件（或独立 `docker-compose`）。

```bash
git clone https://github.com/sqfcyily/deva.git
cd deva/apps/web

# 必设：管理员初始密码（不设则首启随机生成并打印到日志）
export DEVA_WEB_ADMIN_PASSWORD='换成你的强密码'
# 可选：工程目录、端口、轮询间隔
export DEVA_PROJECTS_DIR=/srv/projects
export DEVA_WEB_PORT=7080
export WATCHTOWER_POLL_INTERVAL=900

docker compose up -d          # 不带 --build：只拉 ghcr 镜像，不在服务器上编译
docker compose ps             # deva-web 应为 healthy（start-period 20s）
docker compose logs -f watchtower   # 首次会打印 scope/过滤条件与轮询间隔
```

首次启动若日志里有「初始管理员密码」，用它登录后到 `/admin` 建用户。

**卷名注意**：compose 的 project name 取目录名（`apps/web` → `web`），所以数据卷实际叫
`web_deva-data`。不要把 compose 顶层的 `name` 改成别的值，否则会挂上一个空的新卷，
看起来像「用户数据全丢了」。

**私有包的情况**见第 5 节；`ghcr.io/sqfcyily/deva` 目前是公开包，首次部署不需要凭据。

---

## 3. 改源码后怎么更新

### 3.1 主链路（推荐）：push → CI 构建 → watchtower 自动拉取

```bash
# 本地改源码后
git push origin main            # 或 feat/plugin-deva-agent
```

CI 的 `image.yml` 会构建并推送 `ghcr.io/sqfcyily/deva:latest`（`main`）或 `:edge`
（`feat/plugin-deva-agent`）。之后 watchtower 在下一个轮询周期内（默认 ≤15 分钟）发现
digest 变化并重建容器。

想立刻生效，不等轮询：

```bash
cd apps/web
docker compose pull deva-web && docker compose up -d
```

管理页 `/admin` 的「版本更新」卡片显示的也是这条命令。

### 3.2 备用链路：服务器本地构建

```bash
# 在服务器上的仓库里改完源码，或先 git pull
scripts/redeploy.sh            # 构建 + 重启 + 等健康检查
scripts/redeploy.sh --pull     # 先 git pull --ff-only
```

等价的手工命令：

```bash
cd apps/web
docker compose -f docker-compose.yml -f docker-compose.build.yaml up -d --build
```

默认 `docker compose up -d` **不会**本地构建（`build` 段只存在于
`docker-compose.build.yaml` 覆盖层里），避免在服务器上误触发几分钟的编译。

---

## 4. 回滚

每个推送都会打 `sha-<短sha>` tag，回滚就是指定 tag 重新 up：

```bash
cd apps/web
export DEVA_WEB_IMAGE=ghcr.io/sqfcyily/deva:sha-1a2b3c4
docker compose pull deva-web && docker compose up -d
```

想回滚到某个正式版本：`DEVA_WEB_IMAGE=ghcr.io/sqfcyily/deva:0.1.16`。

更精确的方式是用 digest（image 名后接 `@sha256:...`，CI 的 job summary 会打印）：

```bash
export DEVA_WEB_IMAGE=ghcr.io/sqfcyily/deva@sha256:0123abcd...
docker compose up -d
```

注意 watchtower 的行为：它比对的是**容器当前所用那个 tag** 的 digest，不是 `latest`。

- 若你回滚时只 `docker compose up -d` 而未设 `DEVA_WEB_IMAGE`，容器仍用 `latest`，
  watchtower 会在下个周期把它拉回最新；
- 若你把 `DEVA_WEB_IMAGE` 固定成某个 `sha-xxxxxxx`，watchtower 就只盯这个 tag。
  CI 不会重写已存在的 sha tag（同一 commit 的 digest 固定），所以容器会稳定停在旧版本，
  直到你改回 `latest` 或删掉 `DEVA_WEB_IMAGE`。

想暂时完全不自动更新：`docker compose stop watchtower`（`up -d` 会把它拉起来，需要长期停用就
在 compose 里注释掉该服务，或改 `restart: "no"`）。

---

## 5. 私有包与凭据

`ghcr.io` 上的包默认继承仓库可见性。仓库是 public 时包也是 public，watchtower 匿名即可拉。
若把包设成 private，服务器侧需要凭据。两种做法：

### 5.1 最省事：把包设为 public

GitHub → 个人/组织 → Packages → `deva` → Package settings → Change visibility → Public。
之后不需要任何配置，watchtower 直接能拉。

### 5.2 挂只读凭据

在服务器上 `docker login ghcr.io -u <用户名> --password-stdin`（用一个只有
`read:packages` 权限的 PAT），生成 `~/.docker/config.json`，然后在
`apps/web/docker-compose.yml` 里取消 watchtower 那段挂载的注释：

```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ${HOME}/.docker/config.json:/config.json:ro
    environment:
      DOCKER_CONFIG: /config
```

> 注意：`WATCHTOWER_REGISTRY_AUTH` 这个环境变量在 watchtower 1.7.1 里**不存在**。
> 它的凭据来源就是 `DOCKER_CONFIG` 指向目录下的 `config.json`（默认找 `/config.json`）。
> compose 里的 `DOCKER_CONFIG: /config` 已经预留好，取消挂载注释即可生效。

凭据只读挂载即可：watchtower 只读这份文件，不会回写。

拉取失败的最典型报错是 `401 Unauthorized` / `denied`，见第 6 节。

---

## 6. 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| watchtower 日志一直 `Session done`，容器没变 | registry 里 digest 没变（CI 没推成功，或推的是别的 tag） | 看 `image.yml` 的运行结论；`docker pull ghcr.io/sqfcyily/deva:latest` 手工确认 digest |
| 刚 push，等了几分钟还没动 | GitHub CDN / registry 缓存，加上轮询间隔 | 手工 `docker compose pull deva-web && docker compose up -d`；或调小 `WATCHTOWER_POLL_INTERVAL` |
| `401 Unauthorized` / `denied` | 包是 private 且没给凭据 | 见第 5 节：改 public 或挂 `config.json` |
| watchtower 把自己的容器也重启了 | watchtower 自己也在 scope/enable 白名单里 | 本仓库的 compose 已避免：watchtower 只带 scope label，不带 `enable=true` |
| watchtower 更新了别的栈的容器 | 没有 scope 隔离，或 scope 写错 | 本仓库两侧都设了 `WATCHTOWER_SCOPE=deva`；别的栈要用不同 scope |
| 容器起来了但 `/healthz` 不通 | 端口/反代/`DEVA_WEB_ROOTS` 配置问题 | `docker compose logs deva-web`；健康检查见 Dockerfile 的 `HEALTHCHECK` |
| `EACCES: mkdir '/data/audit'` | 数据卷属主是 root | `docker compose up -d --force-recreate`（entrypoint 会修属主后降权） |
| 更新后数据"没了" | 换了 project name，挂到了新空卷 | 卷名是 `web_deva-data`；不要改 compose 顶层 `name` |

---

## 7. 依赖级联重启（watchtower 的已知边界）

watchtower 更新容器时**不会**级联重启 `depends_on` 依赖它的容器。

- 本栈目前只有 `deva-web` 一个应用容器，`watchtower` 不参与业务，因此没有实际影响。
- 若以后加入独立数据库/缓存容器，且 `deva-web` 通过 `depends_on` 依赖它：数据库镜像更新后，
  `deva-web` 不会自动重连或重启。要么给 watchtower 开 `--rolling-restart`（受
  `WATCHTOWER_ROLLING_RESTART=true` 控制，且它与 `depends_on` 有兼容性限制），要么把这个
  场景交给 `scripts/redeploy.sh` 这样的编排脚本处理。

---

## 8. 本机无法自证的部分（如实标注）

以下内容只能在有 docker daemon 的机器 / GitHub runner 上验证，本仓库的本地环境（无 daemon、
无 buildx、无 compose 插件）只做了静态校验：

1. **镜像实际构建与推送**：`image.yml` 在 runner 上跑，本地无 run id 可查。
2. **watchtower 真实拉取与重启**：需要真实 registry + 运行中的容器。
3. **healthcheck 在容器内的表现**：`HEALTHCHECK` 命令在镜像里，本地无法执行。
4. **compose 的运行时行为**（`pull_policy`、scope 过滤、label 白名单）：本地只验证了
   `docker compose config`（用独立 compose v2.40.3 二进制）能正确解析。
