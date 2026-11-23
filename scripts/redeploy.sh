#!/usr/bin/env bash
# 备用链路 B：用当前 checkout 的源码构建镜像并重启服务（不经过 registry / watchtower）。
#
# 主链路 A 是「CI 推镜像 → watchtower 拉新 digest」，适合「改完 push」；
# 这个脚本适合「在服务器上直接改源码、马上看效果」，或者 registry 不可用时的兜底。
#
# 用法（在仓库任意位置执行均可）：
#   scripts/redeploy.sh                # 构建 + 重启
#   scripts/redeploy.sh --pull         # 先 git pull --ff-only，再构建 + 重启
#   scripts/redeploy.sh --no-cache     # 跳过 Docker 层缓存（依赖变更异常时用）
#
# 做了什么：
#   1) 叠加 apps/web/docker-compose.build.yaml（默认 compose 只跑远程镜像，不构建）；
#   2) docker compose build deva-web → docker compose up -d；
#   3) 打印容器状态与健康检查结果。
# 不动的东西：deva-data 卷（用户/会话/审计）、/projects 挂载的宿主目录。
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SCRIPT")/.." && pwd)"
COMPOSE_DIR="$ROOT/apps/web"
cd "$COMPOSE_DIR"

PULL=0
NO_CACHE=""
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --no-cache) NO_CACHE="--no-cache" ;;
    -h|--help)
      sed -n '2,16p' "$SCRIPT" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数: $arg（可用: --pull / --no-cache / --help）" >&2
      exit 2
      ;;
  esac
done

# compose v2 插件优先，退回到独立的 docker-compose（老发行版 / 本机无插件时）。
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "找不到 docker compose（插件或独立二进制都没有）。" >&2
  exit 127
fi

if ! docker info >/dev/null 2>&1; then
  echo "连不上 docker daemon（权限或未启动）。先确认 'docker info' 能跑通。" >&2
  exit 1
fi

if [ "$PULL" = "1" ]; then
  echo "== git pull --ff-only"
  git -C "$ROOT" pull --ff-only
fi

FILES=(-f docker-compose.yml -f docker-compose.build.yaml)

echo "== docker compose build deva-web ${NO_CACHE}"
"${COMPOSE[@]}" "${FILES[@]}" build ${NO_CACHE} deva-web

echo "== docker compose up -d"
"${COMPOSE[@]}" "${FILES[@]}" up -d

echo "== 状态"
"${COMPOSE[@]}" "${FILES[@]}" ps

# 健康检查有 start-period=20s，立刻查可能还是 starting；这里等一小会儿再看一次。
echo "== 等待健康检查（最多 60s）"
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' deva-web 2>/dev/null || echo missing)"
  if [ "$status" = "healthy" ]; then break; fi
  if [ "$status" = "unhealthy" ]; then
    echo "容器 unhealthy，最近日志：" >&2
    docker logs --tail 50 deva-web >&2 || true
    exit 1
  fi
  sleep 2
done
echo "health=$status"

echo
echo "完成。回滚到 registry 里的某个 sha 版本："
echo "  DEVA_WEB_IMAGE=${DEVA_WEB_IMAGE:-ghcr.io/sqfcyily/deva}:sha-<短 sha> \\"
echo "    ${COMPOSE[*]} -f docker-compose.yml up -d    # 不带 build 覆盖文件，就不会本地构建"
