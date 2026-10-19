<#
.SYNOPSIS
  Share this machine's Backstages with people outside your network, in one command.

.DESCRIPTION
  Starts Postgres/Redis if needed, opens Cloudflare tunnels for the web app and
  the API, points both apps at the public URLs, rebuilds what depends on them,
  starts the API and web, and prints the link to send.

  Quick mode (default): free *.trycloudflare.com URLs. No account needed, but
  the URLs change every run (and Atlassian OAuth needs its callback updated).

  Named mode: stable URLs on your own domain via a Cloudflare named tunnel.
  Create the tunnel once in Cloudflare Zero Trust (Networks -> Tunnels), add two
  public hostnames - web -> http://localhost:3000, api -> http://localhost:3001 -
  and pass its token plus the two URLs. Nothing changes between runs, so the
  link you share keeps working.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\share.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\share.ps1 -TunnelToken $env:CF_TUNNEL_TOKEN `
    -WebUrl https://chat.example.com -ApiUrl https://chat-api.example.com

.NOTES
  Uses the portable toolchain in .toolchain (Node, pnpm, Postgres, Redis,
  cloudflared). Logs go to .toolchain\logs. Processes keep running after the
  script exits; run scripts\share.ps1 -Stop to shut everything down.
#>
[CmdletBinding()]
param(
  [string]$TunnelToken = $env:BACKSTAGES_TUNNEL_TOKEN,
  [string]$WebUrl = $env:BACKSTAGES_WEB_URL,
  [string]$ApiUrl = $env:BACKSTAGES_API_URL,
  [switch]$SkipApiBuild,
  [switch]$Stop
)

# Not 'Stop': in Windows PowerShell 5.1 a native tool writing to stderr (pnpm and
# prisma both do) would then abort the script. Every step checks its own result.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$TC = Join-Path $Root '.toolchain'
$Logs = Join-Path $TC 'logs'
New-Item -ItemType Directory -Force $Logs | Out-Null

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Listening($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function StopPort($port) {
  $ids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
  foreach ($id in $ids) { Stop-Process -Id $id -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

if (-not (Test-Path (Join-Path $TC 'env.ps1'))) { Fail "Toolchain not found at $TC" }
. (Join-Path $TC 'env.ps1')

$cloudflared = Join-Path $TC 'cloudflared.exe'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $node -or -not $pnpm) { Fail 'node/pnpm not on PATH after loading .toolchain\env.ps1' }

if ($Stop) {
  Say 'Stopping web, API and tunnels'
  StopPort 3000; StopPort 3001
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
  Say 'Stopped (Postgres/Redis left running).'
  exit 0
}

$named = [bool]$TunnelToken
if ($named -and (-not $WebUrl -or -not $ApiUrl)) { Fail 'Named mode needs -WebUrl and -ApiUrl (the tunnel hostnames).' }
if (-not (Test-Path $cloudflared)) { Fail "cloudflared.exe not found in $TC" }

# ---- 1. Database + Redis ------------------------------------------------------
if (-not (Listening 5432)) {
  Say 'Starting Postgres'
  & pg_ctl -D $env:PGDATA -l (Join-Path $TC 'data\pg.log') start | Out-Null
}
if (-not (Listening 6379)) {
  Say 'Starting Redis'
  $redis = (Get-ChildItem $TC -Recurse -Filter redis-server.exe | Select-Object -First 1).FullName
  Start-Process $redis -ArgumentList '--port 6379 --save ""' -WindowStyle Hidden
}
$deadline = (Get-Date).AddSeconds(30)
while (-not ((Listening 5432) -and (Listening 6379))) {
  if ((Get-Date) -gt $deadline) { Fail 'Postgres/Redis did not start' }
  Start-Sleep -Milliseconds 500
}

# ---- 2. Tunnels -----------------------------------------------------------------
Say 'Restarting Cloudflare tunnel(s)'
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Start-Sleep -Milliseconds 500
# Background processes are launched through `cmd /c ... > log` rather than
# Start-Process -Redirect*: the latter makes children inherit this script's
# output handles, so anything capturing the script's output would hang until
# the tunnels/servers exit.
function Start-Detached([string]$dir, [string]$command, [string]$log) {
  Start-Process cmd.exe -WorkingDirectory $dir -WindowStyle Hidden -ArgumentList '/c', "$command > `"$log`" 2>&1"
}

# HTTP/2 over TCP 443: the default QUIC transport is unreliable on networks
# that throttle UDP.
# `call` first: cmd /c strips the outer quotes of a command that *starts* with a quote.
$cf = "call `"$cloudflared`" tunnel --no-autoupdate --protocol http2"
if ($named) {
  Start-Detached $Root "$cf run --token $TunnelToken" (Join-Path $Logs 'tunnel.log')
} else {
  $apiLog = Join-Path $Logs 'tunnel-api.log'
  $webLog = Join-Path $Logs 'tunnel-web.log'
  Remove-Item $apiLog, $webLog -ErrorAction SilentlyContinue
  Start-Detached $Root "$cf --url http://localhost:3001" $apiLog
  Start-Detached $Root "$cf --url http://localhost:3000" $webLog
  $pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 1
    $a = if (Test-Path $apiLog) { Select-String -Path $apiLog -Pattern $pattern | Select-Object -First 1 }
    $w = if (Test-Path $webLog) { Select-String -Path $webLog -Pattern $pattern | Select-Object -First 1 }
    if ((Get-Date) -gt $deadline) { Fail "Tunnel URLs did not appear - see $Logs\tunnel-*.log" }
  } while (-not $a -or -not $w)
  $ApiUrl = $a.Matches[0].Value
  $WebUrl = $w.Matches[0].Value
}
$WebUrl = $WebUrl.TrimEnd('/')
$ApiUrl = $ApiUrl.TrimEnd('/')
Say "Web: $WebUrl"
Say "API: $ApiUrl"

# ---- 3. Point both apps at the public URLs ----------------------------------------
function Set-EnvValues([string]$file, [hashtable]$values) {
  $lines = if (Test-Path $file) { [IO.File]::ReadAllLines($file) } else { @() }
  $seen = @{}
  $out = @(foreach ($line in $lines) {
    $m = [regex]::Match($line, '^([A-Z0-9_]+)=')
    if ($m.Success -and $values.ContainsKey($m.Groups[1].Value)) {
      $seen[$m.Groups[1].Value] = $true
      "$($m.Groups[1].Value)=$($values[$m.Groups[1].Value])"
    } else { $line }
  })
  foreach ($k in $values.Keys) { if (-not $seen[$k]) { $out += "$k=$($values[$k])" } }
  [IO.File]::WriteAllLines($file, [string[]]$out, (New-Object Text.UTF8Encoding $false))
}

$webEnv = Join-Path $Root 'apps\web\.env.local'
$previousWebEnv = if (Test-Path $webEnv) { [IO.File]::ReadAllText($webEnv) } else { '' }
Set-EnvValues (Join-Path $Root 'apps\api\.env') @{
  WEB_ORIGIN = $WebUrl
  PUBLIC_API_URL = $ApiUrl
  ATLASSIAN_REDIRECT_URI = "$ApiUrl/atlassian/callback"
}
Set-EnvValues $webEnv @{ NEXT_PUBLIC_API_URL = $ApiUrl; NEXT_PUBLIC_SOCKET_URL = $ApiUrl }
$webEnvChanged = $previousWebEnv -ne [IO.File]::ReadAllText($webEnv)

# ---- 4. Build -------------------------------------------------------------------------
Say 'Stopping any running web/API'
StopPort 3000; StopPort 3001
Start-Sleep -Seconds 1

Push-Location $Root
try {
  & $pnpm --filter '@backstages/shared' build *> (Join-Path $Logs 'build-shared.log')
  if ($LASTEXITCODE -ne 0) { Fail 'shared build failed' }
  if (-not $SkipApiBuild -or -not (Test-Path 'apps\api\dist\main.js')) {
    Say 'Building API'
    & $pnpm --filter '@backstages/api' build *> (Join-Path $Logs 'build-api.log')
    if ($LASTEXITCODE -ne 0) { Fail "API build failed - see $Logs\build-api.log" }
    & $pnpm --filter '@backstages/api' exec prisma migrate deploy *> (Join-Path $Logs 'migrate.log')
    if ($LASTEXITCODE -ne 0) { Fail "Migrations failed - see $Logs\migrate.log" }
  }
  # The API URL is baked into the web bundle, so rebuild whenever it changed.
  if ($webEnvChanged -or -not (Test-Path 'apps\web\.next\BUILD_ID')) {
    Say 'Building web (the API URL is baked in at build time)'
    & $pnpm --filter '@backstages/web' build *> (Join-Path $Logs 'build-web.log')
    if ($LASTEXITCODE -ne 0) { Fail "Web build failed - see $Logs\build-web.log" }
  } else {
    Say 'Web build is current - skipping'
  }
} finally { Pop-Location }

# ---- 5. Start ---------------------------------------------------------------------------
$path = "$(Split-Path $node);$(Split-Path $pnpm);$env:PATH"
Say 'Starting API and web'
Start-Detached (Join-Path $Root 'apps\api') "set `"PATH=$path`"&node dist\main.js" (Join-Path $Logs 'api.log')
Start-Detached (Join-Path $Root 'apps\web') "set `"PATH=$path`"&node node_modules\next\dist\bin\next start" (Join-Path $Logs 'web.log')

$deadline = (Get-Date).AddSeconds(90)
while (-not ((Listening 3000) -and (Listening 3001))) {
  if ((Get-Date) -gt $deadline) { Fail "API/web did not start - see $Logs\api.log and web.log" }
  Start-Sleep -Seconds 1
}

# ---- 6. Check it works from outside ----------------------------------------------------
Say 'Checking the public URLs'
$ok = $true
foreach ($u in @("$ApiUrl/health", $WebUrl)) {
  $status = $null
  for ($i = 0; $i -lt 15 -and -not $status; $i++) {
    try { $status = (Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 20).StatusCode } catch { Start-Sleep -Seconds 2 }
  }
  if ($status -eq 200) { Write-Host "    OK  $u" -ForegroundColor Green } else { Write-Host "    FAIL $u" -ForegroundColor Red; $ok = $false }
}
if (-not $ok) { Fail "Not reachable yet - check $Logs\tunnel*.log, api.log, web.log" }

Write-Host ''
Write-Host "  Share this link:  $WebUrl" -ForegroundColor Green
if (-not $named) {
  Write-Host '  (Quick-tunnel URLs change on every run. For a permanent link use a named tunnel - see docs/deploy.md.)' -ForegroundColor DarkGray
}
Write-Host "  Atlassian sign-in needs $ApiUrl/atlassian/callback in your Atlassian app's callback URLs." -ForegroundColor DarkGray
Write-Host "  Google / GitHub sign-in callbacks: $ApiUrl/auth/oauth/google/callback and $ApiUrl/auth/oauth/github/callback" -ForegroundColor DarkGray
Write-Host '  Stop everything with:  scripts\share.ps1 -Stop' -ForegroundColor DarkGray
