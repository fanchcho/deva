#!/usr/bin/env bash
# 第三轮收尾整体复跑：与 CI 三个 job（check / web-e2e / docker）同一套命令，另加本机静态校验。
# 用法：bash out/final-run.sh            （默认端口 7215）
#       PORT=7225 bash out/final-run.sh  （端口被占用时换一个）
# 依赖：已在仓库根执行过 pnpm install；pnpm 可用（本机若无 pnpm 命令，见 REPORT §8.1 的 corepack 说明）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

PORT="${PORT:-7215}"
OUT=out/logs/28-final-full-run-round3-close.txt
LOG="${TMPDIR:-/tmp}/deva-web-${PORT}.log"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm 不在 PATH。请先启用 corepack：corepack enable（或用 corepack pnpm 手动执行）。" >&2
  exit 127
fi

main() {
echo "# 第三轮收尾整体复跑（与 CI 三个 job 同命令，本地执行）"
echo "时间: $(date -Iseconds)  分支: $(git rev-parse --abbrev-ref HEAD)  HEAD: $(git rev-parse --short HEAD)"
echo

run() { # run <cmd...>
  echo "\$ $*"
  "$@" > /tmp/step.out 2>&1
  local rc=$?
  echo "exit=$rc"
  if [ $rc -ne 0 ]; then echo '--- 输出 ---'; tail -40 /tmp/step.out; fi
  echo
  return $rc
}

FAIL=0
run pnpm install --frozen-lockfile || FAIL=1
run pnpm lint || FAIL=1
run pnpm check:versions || FAIL=1
run pnpm test:desktop || FAIL=1
run pnpm typecheck || FAIL=1
run pnpm --filter @deva/web typecheck || FAIL=1
run pnpm build || FAIL=1
run pnpm --filter @deva/web build || FAIL=1

echo '$ node --check（已入库 js/mjs，排除构建产物）'
mapfile -t files < <(git ls-files '*.mjs' '*.js' | grep -v -E '^(apps/desktop/out|out|\.tmp)/' || true)
NCHECK=0
for f in "${files[@]}"; do
  node --check "$f" || { echo "语法错误: $f"; NCHECK=1; }
done
echo "checked=${#files[@]} fail=${NCHECK}"
echo
[ $NCHECK -ne 0 ] && FAIL=1

echo "# 起实例 PORT=$PORT"
rm -rf "${TMPDIR:-/tmp}/deva-final-$PORT"
DEVA_WEB_DATA="${TMPDIR:-/tmp}/deva-final-$PORT" DEVA_WEB_ADMIN_PASSWORD=ci-pass \
DEVA_UPDATE_CHECK_MINUTES=-1 PORT="$PORT" node apps/web/server.mjs > "$LOG" 2>&1 &
SRV=$!
READY=0
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" || true)
  if [ "$code" = "200" ]; then READY=1; break; fi
  sleep 1
done
echo "healthz=$READY (pid=$SRV)"
echo
if [ $READY -ne 1 ]; then FAIL=1; tail -40 "$LOG"; fi

BASE="http://127.0.0.1:$PORT"
echo '$ apps/web/test/smoke.mjs'
( cd apps/web && BASE="$BASE" ADMIN_USER=admin ADMIN_PASSWORD=ci-pass SMOKE_CREATE_USER=1 \
    node test/smoke.mjs ) > /tmp/smoke.out 2>&1
echo "exit=$?  $(grep -E 'RESULT' /tmp/smoke.out | tail -1)"

echo '# 启动自检（admin 首次登录触发；memory 那行没有用户前缀，按头部区段截取）'
head -40 "$LOG" | grep -E '^\[backend:admin\] \[backend\] .* ok$|^\[backend\] memory ok$' | sed 's/^/  /'
echo "  共 $(head -40 "$LOG" | grep -cE '^\[backend:admin\] \[backend\] .* ok$|^\[backend\] memory ok$') 个步骤 ok"
head -40 "$LOG" | grep -E '^\[backend:admin\] ready: ' | sed 's/^/  /'
echo

for script in probe git-e2e channel-coverage browse-check icon-check; do
  echo "\$ out/$script.mjs"
  BASE="$BASE" ADMIN_PASSWORD=ci-pass node "out/$script.mjs" > "/tmp/$script.out" 2>&1
  echo "exit=$?  $(grep -E 'RESULT' "/tmp/$script.out" | tail -1)"
done

for f in /tmp/smoke.out /tmp/probe.out /tmp/git-e2e.out /tmp/channel-coverage.out /tmp/browse-check.out /tmp/icon-check.out; do
  grep -q 'fail=0' "$f" || { echo "!! $f 有失败"; grep -E 'FAIL' "$f" | head -20; FAIL=1; }
done
echo
echo '# 合计（6 个脚本）'
for f in /tmp/smoke.out /tmp/probe.out /tmp/git-e2e.out /tmp/channel-coverage.out /tmp/browse-check.out /tmp/icon-check.out; do
  grep -E 'RESULT' "$f" | tail -1
done

kill "$SRV" 2>/dev/null
wait "$SRV" 2>/dev/null

echo
echo '# Docker 资产静态校验（本机无 daemon，只做静态断言；真构建见 CI 的 docker job）'
node out/docker-check.mjs > /tmp/docker-check.out 2>&1
echo "exit=$?  $(grep -E 'RESULT' /tmp/docker-check.out | tail -1)"
grep -q 'fail=0' /tmp/docker-check.out || { echo '!! Docker 静态校验有失败'; FAIL=1; tail -20 /tmp/docker-check.out; }
echo
echo '$ cd plugins/deva-agent && node --test tests/*.test.mjs'
( cd plugins/deva-agent && node --test tests/*.test.mjs 2>&1 | tail -12 )
echo
echo "OVERALL_FAIL=$FAIL"
return "$FAIL"
}

# 用管道同时落盘与回显；pipefail 下 ${PIPESTATUS[0]} 才是 main 的真实退出码
# （否则 FAIL 变量在管道子 shell 里赋值，外层取不到）。
main 2>&1 | tee "$OUT"
exit "${PIPESTATUS[0]}"
