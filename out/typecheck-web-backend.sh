#!/usr/bin/env bash
# 已知限制的复现脚本：apps/web/src/backend/index.ts 无法脱离 esbuild 别名单独做类型检查。
# 它从 'electron' 引入 setEventSink / __invoke / __send / __listChannels，
# 这 4 个成员只存在于 Web 版 electron-shim.mjs，不存在于电子类型声明 @types/electron。
# 期望输出：4 条 TS2305，退出码 2。
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1
config="$root/.tmp/tsc-web/tsconfig.json"
mkdir -p "$root/.tmp/tsc-web"
trap 'rm -rf "$root/.tmp"' EXIT
cat > "$config" <<JSON
{
  "extends": "../../apps/desktop/tsconfig.node.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "baseUrl": "../..",
    "paths": { "@deva/*": ["apps/desktop/src/*"] }
  },
  "include": ["../../apps/web/src/backend/index.ts"]
}
JSON
"$root/node_modules/.bin/tsc" --noEmit -p "$config"
echo "exit=$?"
