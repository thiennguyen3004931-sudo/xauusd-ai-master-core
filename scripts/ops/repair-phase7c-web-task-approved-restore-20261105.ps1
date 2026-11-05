# Restore only the existing Web task to the already-active Windows user and existing LIVE profile.
# PAUSE, DISARMED, flat, source and task provenance gates are mandatory. No password or key is written.
param([switch]$Apply,[string]$OperatorConfirmation='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($Apply -and $OperatorConfirmation -cne 'CONFIRM_WEB_TASK_RESTORE_ONLY_PAUSE_DISARMED') { throw 'WEB_REPAIR_RESTORE_CONFIRMATION_REQUIRED' }
$root='F:\Project\XAUUSD_AI_MASTER\xauusd-ai-master'
$source='196a8420ff008548773f5d385cf5785a9f84e297'
$runtime=Join-Path $root '.runtime'
$taskName='XAUUSD-Phase7B-Web'
$taskPath='\'
. (Join-Path $PSScriptRoot 'phase7c-web-task-repair-plan.ps1')
function Resolve-WebPrincipalSid([string]$Value) {
  if ($Value -match '^S-\d-(?:\d+-)+\d+$') { return ([Security.Principal.SecurityIdentifier]::new($Value)).Value }
  return ([Security.Principal.NTAccount]::new($Value)).Translate([Security.Principal.SecurityIdentifier]).Value
}
$receipt=Join-Path ([IO.Path]::GetTempPath()) ('web-task-repair-precheck-'+[guid]::NewGuid().ToString('N')+'.json')
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-phase7c-web-recovery-eligibility-readonly.ps1') -ProductionRoot $root -ExpectedSource $source -ReceiptPath $receipt
  if ($LASTEXITCODE -ne 0) { throw 'WEB_REPAIR_PRECHECK_UNAVAILABLE' }
  $precheck=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($precheck.preRecoveryChecksPass -isnot [bool] -or $precheck.preRecoveryChecksPass -ne $true -or @($precheck.blockerCodes).Count -ne 0) { throw 'WEB_REPAIR_PRECHECK_BLOCKED' }
  $modePath=Join-Path $runtime 'phase7c-bot-mode.json'
  $modeDigest=(Get-FileHash -LiteralPath $modePath -Algorithm SHA256).Hash
  if ((Get-Content -LiteralPath $modePath -Raw | ConvertFrom-Json).mode -cne 'PAUSE') { throw 'WEB_REPAIR_MODE_NOT_PAUSE' }
  if (Test-Path -LiteralPath (Join-Path $runtime 'phase7c-executors\phase7c-execution.lock')) { throw 'WEB_REPAIR_EXECUTION_BARRIER_NOT_DRAINED' }

  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $currentSid=$identity.User.Value
  $sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
  if (-not $identity.IsAuthenticated -or $currentSid -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or $sessionId -le 0) { throw 'WEB_REPAIR_ACTIVE_USER_REQUIRED' }
  if ((Resolve-WebPrincipalSid $identity.Name) -ne $currentSid) { throw 'WEB_REPAIR_CURRENT_USER_IDENTITY_UNVERIFIABLE' }
  $ownShell=0
  foreach ($shell in @(Get-CimInstance Win32_Process -Filter ("Name='explorer.exe' AND SessionId="+$sessionId) -ErrorAction Stop)) {
    $owner=Invoke-CimMethod -InputObject $shell -MethodName GetOwnerSid -ErrorAction Stop
    if ([int]$owner.ReturnValue -eq 0 -and [string]$owner.Sid -eq $currentSid) { $ownShell++ }
  }
  if ($ownShell -lt 1) { throw 'WEB_REPAIR_CURRENT_USER_DESKTOP_REQUIRED' }

  $task=Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  if ([string]$task.State -ne 'Ready' -or [string]$task.Principal.LogonType -ne 'Interactive' -or -not [string]::IsNullOrWhiteSpace([string]$task.Principal.GroupId)) { throw 'WEB_REPAIR_UNEXPECTED_TASK_CONTEXT' }
  $actions=@($task.Actions)
  if ($actions.Count -ne 1) { throw 'WEB_REPAIR_TASK_ACTION_COUNT_INVALID' }
  $trustedPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $command=([string]$actions[0].Execute).Trim('"')
  if ($command -ieq 'powershell.exe') { $command=[string](Get-Command powershell.exe -CommandType Application).Source }
  if ($command -ine $trustedPowerShell) { throw 'WEB_REPAIR_POWERSHELL_NOT_TRUSTED' }
  $oldSid=''
  $principalUnmapped=$false
  try { $oldSid=Resolve-WebPrincipalSid ([string]$task.Principal.UserId) }
  catch {
    $errorObject=$_.Exception
    for ($depth=0;$depth -lt 4 -and $null -ne $errorObject;$depth++) {
      if ($errorObject -is [Security.Principal.IdentityNotMappedException]) { $principalUnmapped=$true;break }
      $errorObject=$errorObject.InnerException
    }
    if (-not $principalUnmapped) { throw 'WEB_REPAIR_OLD_PRINCIPAL_UNVERIFIABLE' }
  }
  if (-not $principalUnmapped -and $oldSid -ne $currentSid) { throw 'WEB_REPAIR_VALID_DIFFERENT_PRINCIPAL_REJECTED' }

  $cfg=Get-Content -LiteralPath (Join-Path $runtime 'phase7c-executor-task-config.json') -Raw | ConvertFrom-Json
  if ([string]$cfg.accountMode -cne 'LIVE') { throw 'WEB_REPAIR_ACCOUNT_CONTEXT_NOT_LIVE' }
  $liveEnv=[string]$cfg.envFile
  if (-not [IO.Path]::IsPathRooted($liveEnv)) { $liveEnv=Join-Path $root $liveEnv }
  $liveEnv=(Resolve-Path -LiteralPath $liveEnv).Path
  if (-not $liveEnv.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'WEB_REPAIR_LIVE_PROFILE_OUTSIDE_PROJECT' }
  $oldEnv=Read-Phase7CWebActionValue ([string]$actions[0].Arguments) 'BridgeEnv'
  if (-not [IO.Path]::IsPathRooted($oldEnv) -or -not (Test-Path -LiteralPath $oldEnv -PathType Leaf)) { throw 'WEB_REPAIR_OLD_PROFILE_UNVERIFIABLE' }
  . (Join-Path $root 'scripts\lib\phase7c-account-mode.ps1')
  $liveInfo=Assert-Phase7CAccountEnv -EnvFile $liveEnv -AccountMode 'LIVE' -RequireTrading
  $oldKey=Get-Phase7CEnvValue $oldEnv 'MT5_API_KEY'
  if ([string]::IsNullOrWhiteSpace($oldKey) -or $oldKey -cne [string]$liveInfo.apiKey) { throw 'WEB_REPAIR_EXISTING_CREDENTIAL_CONTEXT_CHANGED' }
  $oldKey=$null;$liveInfo=$null

  $beforeXml=Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  $planParameters=@{
    TaskXml=$beforeXml
    CurrentUserSid=$currentSid
    LiveEnvPath=$liveEnv
    ExpectedLauncher=(Join-Path $root 'scripts\run-phase7b-web-autostart.ps1')
    ExpectedRuntime=$runtime
    ExpectedPowerShell=$trustedPowerShell
  }
  $plan=New-Phase7CWebTaskRepairPlan @planParameters
  $scheduler=New-Object -ComObject 'Schedule.Service'
  [void]$scheduler.Connect()
  $registered=$scheduler.GetFolder('\').GetTask($taskName)
  if ([int]($registered.GetInstances(0).Count) -ne 0) { throw 'WEB_REPAIR_RUNNING_INSTANCE_REJECTED' }
  $beforeSecurity=[string]$registered.GetSecurityDescriptor(7)
  if ([string]::IsNullOrWhiteSpace($beforeSecurity)) { throw 'WEB_REPAIR_TASK_ACCESS_DESCRIPTOR_UNVERIFIABLE' }
  # TASK_VALIDATE_ONLY validates XML without registering or starting a task.
  $null=$scheduler.GetFolder('\').RegisterTask($taskName,$plan.plannedXml,1,$currentSid,$null,3,$null)
  $repairRequired=$principalUnmapped -or ([IO.Path]::GetFullPath($oldEnv) -ine $liveEnv)
  Write-Host 'WEB_TASK_REPAIR_PLAN_STATUS=PASS'
  Write-Host 'WEB_TASK_REPAIR_NEW_PRINCIPAL=ALREADY_ACTIVE_RUNNER_USER'
  Write-Host 'WEB_TASK_REPAIR_NEW_PROFILE=EXISTING_VALIDATED_LIVE_PROFILE'
  Write-Host 'WEB_TASK_REPAIR_CREDENTIAL_VALUE_CHANGE=NONE'
  Write-Host 'WEB_TASK_REPAIR_ALLOWED_XML_FIELDS=Principal.UserId,Exec.Arguments'
  Write-Host ("WEB_TASK_REPAIR_REQUIRED="+$repairRequired)
  if (-not $Apply) { Write-Host 'WEB_TASK_REPAIR_DRY_RUN=True';exit 0 }

  $freshXml=Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  if ((Get-Phase7CWebTaskXmlDigest $freshXml) -cne $plan.beforeDigest -or (Get-FileHash -LiteralPath $modePath -Algorithm SHA256).Hash -cne $modeDigest) { throw 'WEB_REPAIR_STATE_CHANGED_BEFORE_APPLY' }
  if (Test-Path -LiteralPath (Join-Path $runtime 'phase7c-executors\phase7c-execution.lock')) { throw 'WEB_REPAIR_EXECUTION_BARRIER_CHANGED' }
  if ($repairRequired) {
    $backupDir=Join-Path $runtime 'phase7b-web-recovery-backups'
    $null=New-Item -ItemType Directory -Path $backupDir -Force
    $backupBase='web-task-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText((Join-Path $backupDir ($backupBase+'.xml')),$beforeXml,[Text.Encoding]::Unicode)
    [IO.File]::WriteAllText((Join-Path $backupDir ($backupBase+'.sddl')),$beforeSecurity,[Text.Encoding]::ASCII)
    # UPDATE only; preserve the ACL and suppress registration-trigger execution.
    # A null SDDL preserves the existing descriptor on updates (MS-TSCH 3.2.5.4.4).
    $taskUpdate=4
    $dontAddPrincipalAce=16
    $ignoreRegistrationTriggers=32
    $flags=$taskUpdate -bor $dontAddPrincipalAce -bor $ignoreRegistrationTriggers
    $null=$scheduler.GetFolder('\').RegisterTask($taskName,$plan.plannedXml,$flags,$currentSid,$null,3,$null)
    Write-Host 'WEB_TASK_REPAIR_BACKUP_WRITTEN=True'
    Write-Host 'WEB_TASK_REPAIR_DEFINITION_UPDATE=WEB_TASK_ONLY'
  }
  $afterTask=Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  $afterXml=Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  $afterSecurity=[string]$scheduler.GetFolder('\').GetTask($taskName).GetSecurityDescriptor(7)
  if ((Resolve-WebPrincipalSid ([string]$afterTask.Principal.UserId)) -ne $currentSid -or ([string](@($afterTask.Actions)[0].Arguments)) -cne $plan.newArguments) { throw 'WEB_REPAIR_POST_CONTEXT_MISMATCH' }
  if (-not (Test-Phase7CWebTaskOnlyApprovedFields $beforeXml $afterXml)) { throw 'WEB_REPAIR_UNEXPECTED_POST_XML_CHANGE' }
  if ($afterSecurity -cne $beforeSecurity) { throw 'WEB_REPAIR_TASK_ACCESS_DESCRIPTOR_CHANGED' }
  Write-Host 'WEB_TASK_REPAIR_OTHER_XML_FIELDS_UNCHANGED=True'
  Write-Host 'WEB_TASK_REPAIR_TASK_ACCESS_DESCRIPTOR_UNCHANGED=True'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'recover-phase7c-web-task-guarded-local.ps1') -ProductionRoot $root -ExpectedSource $source -OperatorConfirmation 'START_WEB_TASK_ONLY_PAUSE_DISARMED' -TimeoutSeconds 120
  if ($LASTEXITCODE -ne 0) { throw 'WEB_REPAIR_CANONICAL_RECOVERY_NOT_ACCEPTED' }
  $ui=Invoke-WebRequest -Method Get -Uri 'http://127.0.0.1:5717/phase7b-ops' -UseBasicParsing -TimeoutSec 8
  if ([int]$ui.StatusCode -ne 200) { throw 'WEB_REPAIR_UI_NOT_READY' }
  Write-Host 'WEB_TASK_REPAIR_RECOVERY_STATUS=PASS'
  Write-Host 'WEB_TASK_REPAIR_FINAL_MODE=PAUSE'
  Write-Host 'WEB_TASK_REPAIR_FINAL_ARM=DISARMED'
  Write-Host 'WEB_TASK_REPAIR_UI_HTTP=200'
} catch {
  Write-Host 'WEB_TASK_REPAIR_RECOVERY_STATUS=BLOCKED'
  Write-Host 'WEB_TASK_REPAIR_AUTOMATIC_ARM_OR_MODE_RESTORE=NONE'
  $code=[string]$_.Exception.Message
  if ($code -match '^WEB_REPAIR_[A-Z_]+$') { Write-Host ("WEB_TASK_REPAIR_REASON="+$code) }
  else { Write-Host 'WEB_TASK_REPAIR_REASON=UNEXPECTED_WINDOWS_OPERATION_ERROR' }
  exit 1
} finally {
  if (Test-Path -LiteralPath $receipt -PathType Leaf) { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
}
