$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force .tmp/full-scan-optimization/risks/platform | Out-Null
$env:TEMP = (Resolve-Path .tmp/full-scan-optimization/risks/platform).Path
$env:TMP = $env:TEMP
pnpm test:desktop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test plugins/deva-agent/tests/windows-safe-storage.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm --filter '@deva/desktop' exec electron ../../scripts/platform-native-smoke.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'PASS platform suite; expected credential read/write and native PTY: win32'
