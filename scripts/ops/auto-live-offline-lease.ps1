# Read-only classifier for an explicit, short-lived operator maintenance declaration.
# This file does not infer live bot/ARM/position state from a missing bridge.
function Get-AutoLiveOfflineLeaseState {
  param([Parameter(Mandatory = $true)][string]$ProductionRoot)

  $path = Join-Path $ProductionRoot '.runtime\ops\auto-live-monitor-offline-lease.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return 'ABSENT'
  }

  try {
    $record = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $names = @($record.PSObject.Properties.Name)
    if ($names.Count -ne 5 -or @($names | Where-Object { $_ -notin @('version', 'status', 'reason', 'issuedAt', 'expiresAt') }).Count -gt 0) {
      return 'INVALID'
    }
    if (($record.version -isnot [int] -and $record.version -isnot [long]) -or $record.version -ne 1 -or
        $record.status -cne 'OFFLINE_EXPECTED' -or
        $record.reason -cnotin @('PLANNED_SHUTDOWN', 'MAINTENANCE')) {
      return 'INVALID'
    }
    $issued = [DateTimeOffset]::MinValue
    $expires = [DateTimeOffset]::MinValue
    if ($record.issuedAt -isnot [string] -or $record.expiresAt -isnot [string] -or
        -not [DateTimeOffset]::TryParse([string]$record.issuedAt, [ref]$issued) -or
        -not [DateTimeOffset]::TryParse([string]$record.expiresAt, [ref]$expires)) {
      return 'INVALID'
    }
    $now = [DateTimeOffset]::UtcNow
    if ($issued.Offset -ne [TimeSpan]::Zero -or $expires.Offset -ne [TimeSpan]::Zero -or
        $issued -gt $now -or $expires -le $issued -or
        ($expires - $issued).TotalHours -gt 24) {
      return 'INVALID'
    }
    if ($expires -le $now) { return 'EXPIRED' }
    return 'VALID'
  } catch {
    # Corrupt/unreadable lease never hides connectivity failures.
    return 'INVALID'
  }
}
