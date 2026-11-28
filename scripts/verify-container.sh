#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tmp/full-scan-optimization/risks
TASK_IMAGE="deva-risk-check:local"
TASK_CONTAINER="deva-risk-check-$$"
TASK_VOLUME="deva-risk-check-$$"
docker info
docker build -f apps/web/Dockerfile -t "$TASK_IMAGE" .
docker volume create "$TASK_VOLUME"
trap 'docker rm -f "$TASK_CONTAINER" >/dev/null 2>&1 || true; docker volume rm "$TASK_VOLUME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$TASK_CONTAINER" -v "$TASK_VOLUME:/data" -e DEVA_WEB_ADMIN_PASSWORD=synthetic-only -e DEVA_UPDATE_CHECK_MINUTES=-1 "$TASK_IMAGE"
for ((i=0;i<60;i++)); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$TASK_CONTAINER")
  [[ "$status" == healthy ]] && break
  sleep 2
done
[[ "$status" == healthy ]] || { docker logs "$TASK_CONTAINER"; exit 1; }
docker exec "$TASK_CONTAINER" sh -c 'test "$(stat -c %u /proc/1)" = 1000'
docker exec -u 1000 "$TASK_CONTAINER" sh -c 'touch /data/synthetic-write; test -w /data/synthetic-write'
echo 'PASS health=healthy pid1_uid=1000 volume_writable=true'
