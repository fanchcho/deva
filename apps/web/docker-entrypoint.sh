#!/bin/sh
# 容器以 root 起步，只做一件事：把数据目录的属主修正成运行用户，然后降权执行。
#
# 为什么需要：/data 可能是 named volume（首次创建时从镜像继承属主），也可能是
# 宿主 bind mount（root 所有）。应用以 node(1000) 运行，遇到 root 属主就会
# EACCES: mkdir '/data/audit'。
set -e

DATA_DIR="${DEVA_WEB_DATA:-/data}"
APP_USER="${DEVA_RUN_USER:-node}"

# 没有显式配置时用 UTF-8，否则终端里的中文文件名会变成 ???。
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

if [ "$(id -u)" = "0" ]; then
  if uid="$(id -u "$APP_USER" 2>/dev/null)"; then
    gid="$(id -g "$APP_USER")"
    mkdir -p "$DATA_DIR" 2>/dev/null || true
    owner="$(stat -c %u "$DATA_DIR" 2>/dev/null || echo missing)"
    if [ "$owner" != "$uid" ]; then
      echo "[entrypoint] $DATA_DIR 属主 uid=$owner，修正为 $APP_USER($uid:$gid)" >&2
      if ! chown -R "$uid:$gid" "$DATA_DIR" 2>/dev/null; then
        echo "[entrypoint] WARN: chown 失败（NFS / rootless / 只读挂载？）。手动修：" >&2
        echo "[entrypoint]   docker compose run --rm --user root --entrypoint chown deva-web -R $uid:$gid $DATA_DIR" >&2
      fi
    fi
    # 工程目录 bind mount：Docker 自动创建的空目录默认 root 所有，这里只处理「空目录」，
    # 不动已有文件，避免递归 chown 用户的真实工程。
    PROJECTS_DIR="/projects"
    if [ -d "$PROJECTS_DIR" ] && [ -z "$(ls -A "$PROJECTS_DIR" 2>/dev/null)" ] \
       && [ "$(stat -c %u "$PROJECTS_DIR" 2>/dev/null)" = "0" ]; then
      chown "$uid:$gid" "$PROJECTS_DIR" 2>/dev/null || true
    fi
    if command -v setpriv >/dev/null 2>&1; then
      exec setpriv --reuid="$uid" --regid="$gid" --init-groups "$@"
    fi
    exec su -s /bin/sh "$APP_USER" -c 'exec "$0" "$@"' sh "$@"
  fi
  echo "[entrypoint] WARN: 用户 $APP_USER 不存在，继续以 root 运行" >&2
fi

exec "$@"
