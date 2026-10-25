# Read-only classifier for an explicit, short-lived operator maintenance declaration.
# Epoch milliseconds are used to avoid PowerShell 5.1 JSON date auto-parsing and locale ambiguity.
# This classifier never infers current bot/ARM/position state from an unavailable MT5 bridge.
function Get-AutoLiveOfflineLeaseState {
  param([Parameter(Mandatory = $true)][string]$ProductionRoot)

  $path = Join-Path $ProductionRoot '.runtime\ops\auto-live-monitor-offline-lease.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return 'ABSENT' }

  try {
    $record = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $names = @($record.PSObject.Properties.Name)
    if ($names.Count -ne 5 -or @($names | Where-Object { $_ -notin @('version', 'status', 'reason', 'issuedAtEpochMs', 'expiresAtEpochMs') }).Count -gt 0) {
      return 'INVALID'
    }
    if (($record.version -isnot [int] -and $record.version -isnot [long]) -or $record.version -ne 1 -or
        $record.status -cne 'OFFLINE_EXPECTED' -or
        $record.reason -cnotin @('PLANNED_SHUTDOWN', 'MAINTENANCE') -or
        ($record.issuedAtEpochMs -isnot [long] -and $record.issuedAtEpochMs -isnot [int]) -or
        ($record.expiresAtEpochMs -isnot [long] -and $record.expiresAtEpochMs -isnot [int])) {
      return 'INVALID'
    }
    $issued = [long]$record.issuedAtEpochMs
    $expires = [long]$record.expiresAtEpochMs
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $maxAgeMs = 24L * 60L * 60L * 1000L
    if ($issued -le 0 -or $issued -gt $now -or $expires -le $issued -or
        $expires -gt 5000000000000L -or ($expires - $issued) -gt $maxAgeMs) {
      return 'INVALID'
    }
    if ($expires -le $now) { return 'EXPIRED' }
    return 'VALID'
  } catch {
    # A corrupt or inaccessible lease must never hide a connectivity failure.
    return 'INVALID'
  }
}
