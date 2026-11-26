& {
  $roots = @($env:HERMES_WEB_UI_HOME, $env:HERMES_WEBUI_STATE_DIR, (Join-Path $env:USERPROFILE '.hermes-web-ui')) | Where-Object { $_ } | Select-Object -Unique
  $found = 0
  foreach ($root in $roots) {
    $versions = Join-Path $root 'plugins/global/versions'
    if (!(Test-Path -LiteralPath $versions)) { Write-Output "No versions directory: $versions"; continue }
    foreach ($dir in Get-ChildItem -LiteralPath $versions -Directory) {
      $pkg = Join-Path $dir.FullName 'package'
      $manifest = Join-Path $pkg 'plugin.json'
      if (!(Test-Path -LiteralPath $manifest)) { continue }
      try {
        $m = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
        if ($m.id -ne 'deva') { continue }
        $found++
        [pscustomobject]@{ directory=$pkg; version=$m.version; clientSha256=(Get-FileHash -LiteralPath (Join-Path $pkg 'client.mjs') -Algorithm SHA256).Hash } | ConvertTo-Json -Compress
        $events = @(Get-ChildItem -Path (Join-Path $pkg 'diagnostics/model-ui.jsonl*') -File -ErrorAction SilentlyContinue | ForEach-Object {
          Get-Content -LiteralPath $_.FullName | ForEach-Object {
            try { $e = $_ | ConvertFrom-Json; if ($e.side -eq 'client' -or $e.phase -eq 'client-delivery') { $e | Select-Object time,version,side,phase,method,userId,profile,endpoint,clientVersion,clientSha256,count,element,top,height,viewportHeight,inViewport } } catch {}
          }
        })
        if ($events.Count -eq 0) { Write-Output 'client/delivery events: 0' }
        else { $events | Sort-Object time | Select-Object -Last 15 | ForEach-Object { $_ | ConvertTo-Json -Compress } }
      } catch { Write-Output "Cannot inspect plugin directory: $pkg" }
    }
  }
  Write-Output "Deva installation directories found: $found (historical directories are not proof of active version)"
}
