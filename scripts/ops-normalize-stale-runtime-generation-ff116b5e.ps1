param(
  [Parameter(Mandatory = $true)] [string]$ProjectRoot,
  [Parameter(Mandatory = $true)] [string]$ExpectedCommit,
  [Parameter(Mandatory = $true)] [string]$ExpectedTree,
  [Parameter(Mandatory = $true)] [string]$ExpectedDeploymentId,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$ExpectedTree = $ExpectedTree.ToLowerInvariant()
$ExpectedDeploymentId = $ExpectedDeploymentId.ToLowerInvariant()
$TaskName = 'XAUUSD-Phase7C-Executors'

function Invoke-ControlGet([string]$Path) {
  Invoke-RestMethod -Uri "http://127.0.0.1:3711$Path" -Method Get -TimeoutSec 8
}
function Invoke-ControlPost([string]$Path, [object]$Body) {
  $json = $Body | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:3711$Path" -Method Post -ContentType 'application/json' -Body $json -TimeoutSec 55
}
function Assert-PauseDisarmed {
  $mode = Invoke-ControlGet '/api/v1/phase7c/bot-mode'
  if ([string]$mode.state.mode -ne 'PAUSE') { throw "Normalization requires PAUSE. actual=$($mode.state.mode)" }
  $arm = Invoke-ControlGet '/api/v1/phase7c-live-arm-control/capability'
  if ([string]$arm.accountMode -ne 'LIVE' -or [string]$arm.liveArmStatus -ne 'DISARMED' -or [bool]$arm.liveExecutionArmed) {
    throw 'Normalization requires LIVE ARM DISARMED.'
  }
}
function Test-CanonicalMarker([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  foreach ($marker in @(
    'run-phase7c-executor-task-runner-local.ps1',
    'run-phase7c-executors-local.ps1',
    'run-phase7c-trend-controller-local.ps1',
    'run-phase7c-trend-controller.mjs',
    'run-phase7c-sideway-controller-local.ps1',
    'run-phase7c-sideway-controller.mjs',
    'run-phase7c-sideway-locked.mjs',
    'run-phase7c-telegram-mode-controller-local.ps1',
    'run-phase7c-telegram-mode-controller.mjs',
    'run-phase7c-regime-notifier-local.ps1',
    'run-phase7c-regime-notifier.mjs',
    'run-phase7b-telegram-notifier.mjs'
  )) {
    if ($CommandLine.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}
function Read-BridgeArray([string]$Base,[hashtable]$Headers,[string]$Path) {
  $r = Invoke-WebRequest -Uri "$Base$Path" -Headers $Headers -Method Get -UseBasicParsing -TimeoutSec 8
  $raw = ([string]$r.Content).Trim()
  if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq '[]') { return @() }
  return @($raw | ConvertFrom-Json | Where-Object { $null -ne $_ })
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw 'ProjectRoot missing.' }
Push-Location $ProjectRoot
try {
  $branch = (& git branch --show-current).Trim()
  $head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
  $tree = (& git rev-parse "HEAD^{tree}").Trim().ToLowerInvariant()
  $dirty = @(& git status --porcelain)
  if ($branch -ne 'main' -or $head -ne $ExpectedCommit -or $tree -ne $ExpectedTree -or $dirty.Count -ne 0) {
    throw "Git guard failed. branch=$branch head=$head tree=$tree dirty=$($dirty.Count)"
  }
} finally { Pop-Location }
Write-Host 'PID_REUSE_NORMALIZE_GIT_GUARD=PASS'

Assert-PauseDisarmed
$lifecycle = Invoke-ControlGet '/api/v1/phase7c/lifecycle'
if ([bool]$lifecycle.running -or [bool]$lifecycle.ready) {
  throw "Expected stopped lifecycle before normalization. running=$($lifecycle.running) ready=$($lifecycle.ready)"
}
$att = Invoke-ControlGet '/api/v1/phase7c/runtime-source-attestation'
if ([string]$att.deployment.sourceCommit -ne $ExpectedCommit -or [string]$att.deployment.sourceTree -ne $ExpectedTree -or [string]$att.deployment.deploymentId -ne $ExpectedDeploymentId) {
  throw 'Runtime deployment identity changed.'
}

$configPath = Join-Path $ProjectRoot '.runtime\phase7c-executor-task-config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$workDir = [string]$config.workDir
if (-not [System.IO.Path]::IsPathRooted($workDir)) { $workDir = Join-Path $ProjectRoot $workDir }
$envFile = [string]$config.envFile
if (-not [System.IO.Path]::IsPathRooted($envFile)) { $envFile = Join-Path $ProjectRoot $envFile }
$accountLib = Join-Path $ProjectRoot 'scripts\lib\phase7c-account-mode.ps1'
. $accountLib
$envInfo = Assert-Phase7CAccountEnv -EnvFile $envFile -AccountMode 'LIVE' -RequireTrading
$bridgeBase = "http://$($envInfo.bridgeHost):$($envInfo.bridgePort)"
$bridgeHeaders = @{ 'x-mt5-api-key' = $envInfo.apiKey }
$health = Invoke-RestMethod -Uri "$bridgeBase/health" -Headers $bridgeHeaders -Method Get -TimeoutSec 8
if (-not [bool]$health.connected -or [string]$health.status -ne 'ok' -or [bool]$health.liveExecutionArmed) { throw 'Bridge safety guard failed.' }
$positions = @(Read-BridgeArray $bridgeBase $bridgeHeaders '/v1/positions?symbol=XAUUSD')
$orders = @(Read-BridgeArray $bridgeBase $bridgeHeaders '/v1/orders?symbol=XAUUSD')
if ($positions.Count -ne 0 -or $orders.Count -ne 0) { throw "Broker not flat. positions=$($positions.Count) orders=$($orders.Count)" }
Write-Host 'PID_REUSE_NORMALIZE_BROKER_FLAT=PASS'

Import-Module ScheduledTasks -ErrorAction Stop
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ([string]$task.State -ne 'Ready') { throw "Expected task Ready. actual=$($task.State)" }
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$instances = @($service.GetFolder('\').GetTask($TaskName).GetInstances(0))
if ($instances.Count -ne 0) { throw "Expected zero task instances. actual=$($instances.Count)" }

$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$canonicalMatches = @($allProcesses | Where-Object { Test-CanonicalMarker ([string]$_.CommandLine) })
if ($canonicalMatches.Count -ne 0) {
  $detail = @($canonicalMatches | ForEach-Object { "$($_.ProcessId):$($_.Name):$($_.CommandLine)" }) -join ' || '
  throw "Canonical executor process still exists; PID normalization blocked. $detail"
}

$runtimeDir = Join-Path $workDir 'phase7c-executors'
foreach ($name in @('supervisor','trend','sideway','trade-notifier','telegram-mode','regime-notifier')) {
  $pidPath = Join-Path $runtimeDir "$name.pid"
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { continue }
  $pidText = ([string](Get-Content -LiteralPath $pidPath -Raw)).Trim()
  if ($pidText -notmatch '^\d+$') { throw "Invalid PID file: $pidPath value=$pidText" }
  $pidValue = [int]$pidText
  $row = @($allProcesses | Where-Object { [int]$_.ProcessId -eq $pidValue })
  if ($row.Count -gt 1) { throw "Ambiguous PID identity: $pidValue" }
  if ($row.Count -eq 1) {
    $cmd = [string]$row[0].CommandLine
    if (Test-CanonicalMarker $cmd) { throw "PID $pidValue still belongs to canonical executor; normalization blocked." }
    if ([string]$row[0].Name -in @('powershell.exe','pwsh.exe','node.exe')) {
      throw "PID $pidValue belongs to scripting runtime and cannot be safely normalized. name=$($row[0].Name)"
    }
    Write-Host "PID_REUSE_NORMALIZE_UNRELATED=$name|PID=$pidValue|PROCESS=$($row[0].Name)"
  } else {
    Write-Host "PID_REUSE_NORMALIZE_DEAD=$name|PID=$pidValue"
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction Stop
  Write-Host "PID_REUSE_NORMALIZE_PID_FILE_REMOVED=$name"
}

Assert-PauseDisarmed
Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$heartbeatPath = Join-Path $workDir 'phase7c-lifecycle-broker\state\heartbeat.json'
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$newBrokerPid = 0
do {
  Start-Sleep -Milliseconds 500
  try {
    $hb = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
    $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$hb.updatedAt
    $candidate = [int]$hb.brokerPid
    if ($candidate -gt 0 -and $age -ge 0 -and $age -le 5000 -and $null -ne (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) {
      $newBrokerPid = $candidate
      break
    }
  } catch {}
} while ([DateTime]::UtcNow -lt $deadline)
if ($newBrokerPid -le 0) { throw 'Canonical task start did not create a fresh broker heartbeat.' }
Write-Host "PID_REUSE_NORMALIZE_FRESH_BROKER=PASS|PID=$newBrokerPid"

$lifecycle = Invoke-ControlGet '/api/v1/phase7c/lifecycle'
if (-not [bool]$lifecycle.running) {
  [void](Invoke-ControlPost '/api/v1/phase7c/lifecycle/start' @{})
}
$readyDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$stableSince = $null
do {
  Start-Sleep -Milliseconds 500
  try {
    $state = Invoke-ControlGet '/api/v1/phase7c/lifecycle'
    $ok = [bool]$state.running -and [bool]$state.ready -and [string]$state.mode.mode -eq 'PAUSE' -and [string]$state.accountMode.accountMode -eq 'LIVE'
    if ($ok) {
      if ($null -eq $stableSince) { $stableSince = [DateTime]::UtcNow }
      if (([DateTime]::UtcNow - $stableSince).TotalSeconds -ge 5) { break }
    } else { $stableSince = $null }
  } catch { $stableSince = $null }
} while ([DateTime]::UtcNow -lt $readyDeadline)
if ($null -eq $stableSince -or ([DateTime]::UtcNow - $stableSince).TotalSeconds -lt 5) { throw 'Lifecycle did not become stably READY.' }

Assert-PauseDisarmed
$positions = @(Read-BridgeArray $bridgeBase $bridgeHeaders '/v1/positions?symbol=XAUUSD')
$orders = @(Read-BridgeArray $bridgeBase $bridgeHeaders '/v1/orders?symbol=XAUUSD')
if ($positions.Count -ne 0 -or $orders.Count -ne 0) { throw 'Broker ceased to be flat during normalization.' }
Write-Host 'PID_REUSE_NORMALIZE_FINAL_MODE=PAUSE'
Write-Host 'PID_REUSE_NORMALIZE_FINAL_ARM=DISARMED'
Write-Host 'PID_REUSE_NORMALIZE_ORDER_MUTATION=NONE'
Write-Host 'PID_REUSE_NORMALIZE_POSITION_MUTATION=NONE'
Write-Host 'PID_REUSE_NORMALIZE_STATUS=PASS'
