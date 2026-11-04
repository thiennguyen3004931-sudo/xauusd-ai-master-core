param(
  [Parameter(Mandatory = $true)] [string]$ProjectRoot,
  [Parameter(Mandatory = $true)] [string]$ExpectedMainCommit,
  [string]$CanonicalPreflightPath = ""
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedMainCommit = $ExpectedMainCommit.Trim().ToLowerInvariant()
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if ($ExpectedMainCommit -notmatch '^[0-9a-f]{40}$') {
  throw 'ExpectedMainCommit must be an exact 40-character Git SHA.'
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
  throw 'ProjectRoot is unavailable.'
}
if ([string]::IsNullOrWhiteSpace($CanonicalPreflightPath)) {
  $CanonicalPreflightPath = Join-Path $PSScriptRoot 'preflight-phase7c-production-readonly-local.ps1'
}
$CanonicalPreflightPath = [System.IO.Path]::GetFullPath($CanonicalPreflightPath)
if (-not (Test-Path -LiteralPath $CanonicalPreflightPath -PathType Leaf)) {
  throw 'Canonical production read-only preflight is unavailable.'
}

Write-Host 'FINAL_STRATEGY_RUNTIME_READINESS_READ_ONLY=TRUE'
Write-Host 'FINAL_STRATEGY_DEPLOYMENT_MUTATION=NONE'
Write-Host 'FINAL_STRATEGY_BOT_MODE_MUTATION=NONE'
Write-Host 'FINAL_STRATEGY_ARM_MUTATION=NONE'
Write-Host 'FINAL_STRATEGY_ORDER_MUTATION=NONE'
Write-Host 'FINAL_STRATEGY_POSITION_MUTATION=NONE'
Write-Host 'FINAL_STRATEGY_ACCOUNT_SWITCH=NONE'

$stdout = Join-Path ([System.IO.Path]::GetTempPath()) ("phase7c-final-strategy-" + [guid]::NewGuid().ToString('N') + '.out')
$stderr = Join-Path ([System.IO.Path]::GetTempPath()) ("phase7c-final-strategy-" + [guid]::NewGuid().ToString('N') + '.err')
try {
  $args = @(
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File', $CanonicalPreflightPath,
    '-ProjectRoot', $ProjectRoot,
    '-ExpectedMainCommit', $ExpectedMainCommit,
    '-TimeoutSeconds', '12'
  )
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $text = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { '' }
  $errText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }

  function Read-Key([string]$Name) {
    $match = [regex]::Match($text, "(?m)^" + [regex]::Escape($Name) + "=(.*)$")
    if (-not $match.Success) { return '' }
    return $match.Groups[1].Value.Trim()
  }

  foreach ($required in @(
    'READ_ONLY=TRUE',
    'HTTP_METHODS=GET_ONLY',
    'GIT_MUTATION=NONE',
    'MODE_MUTATION=NONE',
    'ARM_MUTATION=NONE',
    'ORDER_MUTATION=NONE',
    'POSITION_MUTATION=NONE',
    'LIVE_TEST_ORDER=NONE'
  )) {
    if (-not $text.Contains($required)) {
      throw "Canonical preflight missing read-only safety marker: $required"
    }
  }

  if ($proc.ExitCode -notin @(0,2)) {
    throw "Canonical preflight unexpected exit=$($proc.ExitCode); stderrPresent=$(-not [string]::IsNullOrWhiteSpace($errText))"
  }

  $expected = Read-Key 'EXPECTED_MAIN'
  $localHead = Read-Key 'LOCAL_HEAD'
  $deploymentSource = Read-Key 'DEPLOYMENT_SOURCE_COMMIT'
  $botMode = Read-Key 'BOT_MODE'
  $arm = Read-Key 'ARM'
  $positions = Read-Key 'XAUUSD_POSITIONS'
  $pending = Read-Key 'XAUUSD_PENDING_ORDERS'
  $runtimeOverall = Read-Key 'RUNTIME_SOURCE_OVERALL'
  $classification = Read-Key 'PREFLIGHT_CLASSIFICATION'
  $blockedBy = Read-Key 'BLOCKED_BY'

  if ([string]::IsNullOrWhiteSpace($classification)) {
    throw 'Canonical preflight classification is unavailable.'
  }

  $targetExact = (
    $expected -eq $ExpectedMainCommit -and
    $localHead -eq $ExpectedMainCommit -and
    $deploymentSource -eq $ExpectedMainCommit -and
    $runtimeOverall -eq 'EXACT_MATCH'
  )
  $flat = $positions -eq '0' -and $pending -eq '0'
  $readyWithoutArmMutation = (
    $targetExact -and
    $flat -and
    $botMode -eq 'PAUSE' -and
    $arm -eq 'DISARMED' -and
    $classification -eq 'NO_RECOVERY_REQUIRED'
  )

  Write-Host "FINAL_STRATEGY_EXPECTED_MAIN=$expected"
  Write-Host "FINAL_STRATEGY_PRODUCTION_HEAD=$localHead"
  Write-Host "FINAL_STRATEGY_DEPLOYMENT_SOURCE=$deploymentSource"
  Write-Host "FINAL_STRATEGY_RUNTIME_SOURCE_OVERALL=$runtimeOverall"
  Write-Host "FINAL_STRATEGY_BOT_MODE=$botMode"
  Write-Host "FINAL_STRATEGY_ARM=$arm"
  Write-Host "FINAL_STRATEGY_XAUUSD_POSITIONS=$positions"
  Write-Host "FINAL_STRATEGY_XAUUSD_PENDING_ORDERS=$pending"
  Write-Host "FINAL_STRATEGY_PREFLIGHT_CLASSIFICATION=$classification"
  Write-Host "FINAL_STRATEGY_BLOCKED_BY=$blockedBy"
  Write-Host "FINAL_STRATEGY_TARGET_EXACT=$($targetExact.ToString().ToUpperInvariant())"
  Write-Host "FINAL_STRATEGY_DEPLOYMENT_READY_WITHOUT_ARM_MUTATION=$($readyWithoutArmMutation.ToString().ToUpperInvariant())"
  Write-Host 'FINAL_STRATEGY_RAW_ACCOUNT_IDENTITY_PRINTED=FALSE'
} finally {
  Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
}
