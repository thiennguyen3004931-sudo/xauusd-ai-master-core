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
    issuedAt = $Start.ToString('o')
    expiresAt = $End.ToString('o')
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
  [System.IO.File]::WriteAllText($path, '{"version":1,"status":"OFFLINE_EXPECTED","reason":"MAINTENANCE","issuedAt":"2026-10-25T00:00:00Z","expiresAt":"2026-10-25T01:00:00Z","unexpected":true}')
  Assert-LeaseState 'INVALID'
  Write-Host 'AUTO_LIVE_OFFLINE_LEASE_TEST=PASS'
  Write-Host 'PRODUCTION_MUTATION=NONE'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
