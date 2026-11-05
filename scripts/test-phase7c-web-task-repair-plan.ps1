# Synthetic only: XML transformations, no task registration, no production reads.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'ops\phase7c-web-task-repair-plan.ps1')
$fixture=@'
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>synthetic web task</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
<Principals><Principal id="Author"><UserId>OLDPC\missing-user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
<Settings><Enabled>true</Enabled><AllowStartOnDemand>true</AllowStartOnDemand><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
<Actions Context="Author"><Exec><Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File "C:\synthetic\scripts\run-phase7b-web-autostart.ps1" -WorkDir "C:\synthetic\.runtime" -BridgeEnv "C:\synthetic\demo.env" -ApiPort 3711 -WebPort 5717</Arguments><WorkingDirectory>C:\synthetic</WorkingDirectory></Exec></Actions>
</Task>
'@
$baseline=@{
 TaskXml=$fixture
 CurrentUserSid='S-1-5-21-100-200-300-1001'
 LiveEnvPath='C:\synthetic\live.env'
 ExpectedLauncher='C:\synthetic\scripts\run-phase7b-web-autostart.ps1'
 ExpectedRuntime='C:\synthetic\.runtime'
 ExpectedPowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
}
$count=0
function Assert([bool]$Value,[string]$Label) { if (-not $Value) { throw "SYNTHETIC_WEB_REPAIR_ASSERTION=$Label" } }
function Reject([hashtable]$Overrides,[string]$Label) {
 $parameters=$baseline.Clone()
 foreach($key in $Overrides.Keys){$parameters[$key]=$Overrides[$key]}
 $rejected=$false
 try { $null=New-Phase7CWebTaskRepairPlan @parameters } catch { if ($_.Exception.Message -like 'WEB_REPAIR_*') {$rejected=$true} else {throw} }
 Assert $rejected $Label
}
$plan=New-Phase7CWebTaskRepairPlan @baseline
Assert ($plan.currentUserSid -eq $baseline.CurrentUserSid) 'correct-user'
Assert ($plan.newArguments -match '-BridgeEnv "C:\\synthetic\\live.env" -ApiPort 3711 -WebPort 5717$') 'env-and-remaining-args'
Assert (Test-Phase7CWebTaskOnlyApprovedFields $fixture $plan.plannedXml) 'exactly-two-fields'
Assert ($fixture -match 'OLDPC\\missing-user' -and $fixture -match 'demo.env') 'input-preserved'
$count++
foreach($pair in @(@('HighestAvailable','LeastPrivilege'),@('<Enabled>true</Enabled>','<Enabled>false</Enabled>'),@('PT0S','PT1H'),@('<Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command>','<Command>cmd.exe</Command>'))){
 $drift=$plan.plannedXml.Replace($pair[0],$pair[1])
 Assert (-not (Test-Phase7CWebTaskOnlyApprovedFields $fixture $drift)) 'unapproved-field-drift'
 $count++
}
Reject @{CurrentUserSid='S-1-5-18'} 'no-system-fallback';$count++
Reject @{TaskXml=$fixture.Replace('InteractiveToken','Password')} 'no-password-logon-change';$count++
Reject @{TaskXml=$fixture.Replace('<UserId>OLDPC\missing-user</UserId>','<GroupId>BUILTIN\Users</GroupId>')} 'no-group-activation';$count++
Reject @{TaskXml=$fixture.Replace('-ApiPort 3711','-BridgeEnv "C:\other.env" -ApiPort 3711')} 'duplicate-env-rejected';$count++
Reject @{ExpectedRuntime='C:\other\.runtime'} 'foreign-runtime-rejected';$count++
Reject @{ExpectedLauncher='C:\other\launcher.ps1'} 'foreign-launcher-rejected';$count++
Reject @{LiveEnvPath=('C:\synthetic\bad"env')} 'argument-injection-rejected';$count++
# A new COM definition is in memory only. No RegisterTask/Run call occurs here.
$service=New-Object -ComObject 'Schedule.Service'
[void]$service.Connect()
$definition=$service.NewTask(0)
$definition.XmlText=$plan.plannedXml
Assert ([string]$definition.Principal.UserId -eq $baseline.CurrentUserSid) 'windows-schema-accepts-user'
Assert ([string]$definition.Actions.Item(1).Arguments -ceq $plan.newArguments) 'windows-schema-accepts-arguments'
$count++
Assert ([int]$definition.Principal.LogonType -eq 3 -and [int]$definition.Principal.RunLevel -eq 1 -and [string]$definition.Actions.Item(1).Path -ceq $baseline.ExpectedPowerShell) 'windows-schema-preserves-security-context-and-command'
$count++
Write-Host ("WEB_TASK_REPAIR_SYNTHETIC_CASES_PASS="+$count)
Write-Host 'WEB_TASK_REPAIR_SYNTHETIC_PRODUCTION_READS=NONE'
Write-Host 'WEB_TASK_REPAIR_SYNTHETIC_TASK_REGISTRATION=NONE'
