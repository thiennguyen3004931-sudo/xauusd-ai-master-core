$ErrorActionPreference = 'Stop'
$module = Join-Path $PSScriptRoot 'ops\auto-live-offline-lease.ps1'
. $module
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('xauusd-monitor-lease-' + [guid]::NewGuid().ToString('N'))
$dir = Join-Path $root '.runtime\ops'
$path = Join-Path $dir 'auto-live-monitor-offline-lease.json'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
function Assert-LeaseState {
  param([string]$Expected)
  $actual = Get-AutoLiveOfflineLeaseState -ProductionRoot $root
  if ($actual -cne $Expected) { throw "LEASE_STATE_MISMATCH expected=$Expected actual=$actual" }
}
function Save-Lease {
  param([datetimeoffset]$Start, [datetimeoffset]$End, [string]$Reason = 'PLANNED_SHUTDOWN')
  $record = [ordered]@{
    version = 1
    status = 'OFFLINE_EXPECTED'
    reason = $Reason
    issuedAtEpochMs = $Start.ToUnixTimeMilliseconds()
    expiresAtEpochMs = $End.ToUnixTimeMilliseconds()
  }
  [System.IO.File]::WriteAllText($path, ($record | ConvertTo-Json -Depth 4))
}
try {
  Assert-LeaseState 'ABSENT'
  $now = [DateTimeOffset]::UtcNow
  Save-Lease -Start $now.AddMinutes(-2) -End $now.AddHours(1)
  Assert-LeaseState 'VALID'
  Save-Lease -Start $now.AddHours(-2) -End $now.AddHours(-1)
  Assert-LeaseState 'EXPIRED'
  Save-Lease -Start $now.AddMinutes(-2) -End $now.AddHours(25)
  Assert-LeaseState 'INVALID'
  Save-Lease -Start $now.AddMinutes(5) -End $now.AddHours(1)
  Assert-LeaseState 'INVALID'
  Save-Lease -Start $now.AddMinutes(-2) -End $now.AddHours(1) -Reason 'UNKNOWN'
  Assert-LeaseState 'INVALID'
  [System.IO.File]::WriteAllText($path, '{broken json')
  Assert-LeaseState 'INVALID'
  [System.IO.File]::WriteAllText($path, '{"version":1,"status":"OFFLINE_EXPECTED","reason":"MAINTENANCE","issuedAtEpochMs":1792886400000,"expiresAtEpochMs":1792890000000,"unexpected":true}')
  Assert-LeaseState 'INVALID'
  # Read-only monitoring must accept a deliberately disabled trading environment.
  # Trade execution validation must still reject it.
  $accountLib = Join-Path $PSScriptRoot 'lib\phase7c-account-mode.ps1'
  . $accountLib
  $fakeEnv = Join-Path $root 'synthetic-live.env'
  [System.IO.File]::WriteAllText($fakeEnv, @'
MT5_API_KEY=synthetic-in-memory-not-a-real-secret
MT5_BRIDGE_HOST=127.0.0.1
MT5_BRIDGE_PORT=8765
MT5_ALLOW_REAL_ACCOUNT=true
MT5_TRADING_ENABLED=false
MT5_MAGIC_NUMBER=270715
'@)
  $readOnlyConfig = Assert-Phase7CAccountEnv -EnvFile $fakeEnv -AccountMode LIVE
  if ($readOnlyConfig.tradingEnabled -ne $false -or $readOnlyConfig.bridgeHost -ne '127.0.0.1') {
    throw 'READ_ONLY_MONITOR_DISABLED_TRADING_ENV_MISMATCH'
  }
  $blockedExecution = $false
  try {
    $null = Assert-Phase7CAccountEnv -EnvFile $fakeEnv -AccountMode LIVE -RequireTrading
  } catch {
    $blockedExecution = $true
  }
  if (-not $blockedExecution) { throw 'TRADE_EXECUTION_GUARD_WEAKENED' }
  Write-Host 'READ_ONLY_MONITOR_DISABLED_TRADING_ENV=PASS'
  Write-Host 'AUTO_LIVE_OFFLINE_LEASE_TEST=PASS'
  Write-Host 'PRODUCTION_MUTATION=NONE'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
