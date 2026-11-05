# User-approved SEMI -> PAUSE and one canonical Web task start.
param(
  [string]$ProductionRoot = 'F:\Project\XAUUSD_AI_MASTER\xauusd-ai-master',
  [string]$ExpectedSource = '196a8420ff008548773f5d385cf5785a9f84e297',
  [string]$OperatorConfirmation = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$approval = 'USER_APPROVED_SEMI_TO_PAUSE_WEB_RECOVERY_20261105'
if ($OperatorConfirmation -cne $approval) { throw 'WEB_RECOVERY_APPROVAL_REQUIRED' }
if ($ProductionRoot.TrimEnd('\') -ine 'F:\Project\XAUUSD_AI_MASTER\xauusd-ai-master') { throw 'WEB_RECOVERY_ROOT_NOT_PINNED' }
if ($ExpectedSource -cne '196a8420ff008548773f5d385cf5785a9f84e297') { throw 'WEB_RECOVERY_SOURCE_NOT_PINNED' }

$precheck = Join-Path $PSScriptRoot 'check-phase7c-web-recovery-eligibility-readonly.ps1'
$recovery = Join-Path $PSScriptRoot 'recover-phase7c-web-task-guarded-local.ps1'
$pauseHelper = Join-Path $PSScriptRoot 'set-phase7c-pause-for-web-recovery.mjs'
$receipt = Join-Path ([IO.Path]::GetTempPath()) ('approved-web-recovery-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $precheck -ProductionRoot $ProductionRoot -ExpectedSource $ExpectedSource -ReceiptPath $receipt
  if ($LASTEXITCODE -ne 0) { throw 'WEB_RECOVERY_INITIAL_PRECHECK_ERROR' }
  $evidence = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  foreach ($field in @('productionHeadMatches','gitTrackedClean','taskWebReady','taskExecutorsRunning','persistedAccountLive','liveArmFileAbsent','relevantPortsUnbound','brokerHealthConnected','brokerLiveReal','brokerArmDisarmed','brokerXauFlat')) {
    if ($evidence.$field -isnot [bool] -or $evidence.$field -ne $true) { throw "WEB_RECOVERY_INITIAL_GATE_BLOCKED=$field" }
  }
  $modeFile = Join-Path $ProductionRoot '.runtime\phase7c-bot-mode.json'
  $before = Get-Content -LiteralPath $modeFile -Raw | ConvertFrom-Json
  $blockers = @($evidence.blockerCodes)
  if ([string]$before.mode -ceq 'SEMI') {
    if ($blockers.Count -ne 1 -or $blockers[0] -cne 'PERSISTED_BOT_MODE_NOT_PAUSE_OR_UNKNOWN') {
      throw 'WEB_RECOVERY_UNEXPECTED_PRECHECK_BLOCKERS'
    }
  } elseif ([string]$before.mode -ceq 'PAUSE') {
    if ($evidence.preRecoveryChecksPass -ne $true -or $blockers.Count -ne 0) { throw 'WEB_RECOVERY_PAUSE_PRECHECK_BLOCKED' }
  } else { throw 'WEB_RECOVERY_CURRENT_MODE_NOT_APPROVED' }

  $servicePath = Join-Path $ProductionRoot 'apps\api\src\services\phase7c-bot-mode.service.ts'
  $serviceBlob = (& git -C $ProductionRoot rev-parse "$($ExpectedSource):apps/api/src/services/phase7c-bot-mode.service.ts").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $serviceBlob -notmatch '^[a-f0-9]{40}$') { throw 'WEB_RECOVERY_MODE_SERVICE_PROVENANCE_UNAVAILABLE' }
  $modeDigest = (Get-FileHash -LiteralPath $modeFile -Algorithm SHA256).Hash.ToLowerInvariant()
  & node --experimental-strip-types $pauseHelper $modeFile $servicePath $serviceBlob $modeDigest $approval
  if ($LASTEXITCODE -ne 0) { throw 'WEB_RECOVERY_APPROVED_PAUSE_NOT_ACCEPTED' }

  # The canonical recovery helper repeats the complete fresh precheck and
  # performs only its already reviewed single Web Scheduled Task START.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $recovery -ProductionRoot $ProductionRoot -ExpectedSource $ExpectedSource -OperatorConfirmation 'START_WEB_TASK_ONLY_PAUSE_DISARMED' -TimeoutSeconds 120
  if ($LASTEXITCODE -ne 0) { throw 'WEB_RECOVERY_TASK_START_NOT_ACCEPTED' }

  $ui = Invoke-WebRequest -Method Get -Uri 'http://127.0.0.1:5717/phase7b-ops' -UseBasicParsing -TimeoutSec 8
  if ([int]$ui.StatusCode -ne 200) { throw 'WEB_RECOVERY_UI_NOT_READY' }
  Write-Host 'APPROVED_WEB_RECOVERY_STATUS=PASS'
  Write-Host 'APPROVED_WEB_RECOVERY_FINAL_MODE=PAUSE'
  Write-Host 'APPROVED_WEB_RECOVERY_FINAL_ARM=DISARMED'
  Write-Host 'APPROVED_WEB_RECOVERY_UI_HTTP=200'
  Write-Host 'APPROVED_WEB_RECOVERY_PRODUCTION_SOURCE_UNCHANGED=True'
} catch {
  Write-Host 'APPROVED_WEB_RECOVERY_STATUS=BLOCKED'
  Write-Host 'APPROVED_WEB_RECOVERY_AUTOMATIC_MODE_RESTORE=False'
  throw
} finally {
  if (Test-Path -LiteralPath $receipt -PathType Leaf) { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
}
