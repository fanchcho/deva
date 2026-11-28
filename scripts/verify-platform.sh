#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tmp/full-scan-optimization/risks/platform
export TMPDIR="$PWD/.tmp/full-scan-optimization/risks/platform"
pnpm test:desktop
node --test plugins/deva-agent/tests/macos-keychain.test.mjs
pnpm --filter @deva/desktop exec electron ../../scripts/platform-native-smoke.cjs
echo 'PASS platform suite; expected credential read/write and native PTY: darwin'
