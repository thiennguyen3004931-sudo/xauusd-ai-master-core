# Read-only startup diagnostics. Never print environment values or event messages.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = 'F:\Project\XAUUSD_AI_MASTER\xauusd-ai-master'
$runtime = Join-Path $root '.runtime'
function Flag([string]$Name, [bool]$Value) { Write-Host ("WEB_STARTUP_" + $Name + '=' + $Value) }
function ActionValue([string]$Text, [string]$Name) {
  $pattern = '(?i)(?:^|\s)-' + [regex]::Escape($Name) + '\s+(?:"([^"]*)"|''([^'']*)''|([^\s]+))(?=\s|$)'
  $match = [regex]::Match($Text, $pattern)
  if (-not $match.Success) { return '' }
  foreach ($index in @(1,2,3)) { if ($match.Groups[$index].Success) { return [string]$match.Groups[$index].Value } }
  return ''
}
try {
  $task = Get-ScheduledTask -TaskName 'XAUUSD-Phase7B-Web'
  $taskInfo = Get-ScheduledTaskInfo -TaskName 'XAUUSD-Phase7B-Web'
  $taskState = [string]$task.State
  if ($taskState -notin @('Ready','Running','Disabled','Queued')) { $taskState = 'UNKNOWN' }
  Write-Host "WEB_STARTUP_TASK_STATE=$taskState"
  Write-Host ("WEB_STARTUP_TASK_EXIT_HEX=0x{0:X8}" -f [uint32]$taskInfo.LastTaskResult)
  Write-Host ("WEB_STARTUP_TASK_LAST_RUN_UTC=" + $taskInfo.LastRunTime.ToUniversalTime().ToString('o'))
  $actions = @($task.Actions)
  Flag 'ONE_TASK_ACTION' ($actions.Count -eq 1)
  if ($actions.Count -ne 1) { throw 'UNEXPECTED_ACTION_COUNT' }
  $arguments = [string]$actions[0].Arguments
  $workDirArg = ActionValue $arguments 'WorkDir'
  $envArg = ActionValue $arguments 'BridgeEnv'
  Flag 'WORKDIR_ARG_CANONICAL' ($workDirArg.TrimEnd('\') -ieq $runtime.TrimEnd('\'))
  Flag 'WORKDIR_ARG_EXISTS' ((-not [string]::IsNullOrWhiteSpace($workDirArg)) -and (Test-Path -LiteralPath $workDirArg -PathType Container))
  Flag 'BRIDGE_ENV_ARG_EXPLICIT' (-not [string]::IsNullOrWhiteSpace($envArg))
  if ([string]::IsNullOrWhiteSpace($envArg)) { $envArg = Join-Path $root 'packages\mt5-broker\bridge\.env.phase7b-demo' }
  $envExists = Test-Path -LiteralPath $envArg -PathType Leaf
  Flag 'BRIDGE_ENV_EXISTS' $envExists
  try {
    $cfg = Get-Content -LiteralPath (Join-Path $runtime 'phase7c-executor-task-config.json') -Raw | ConvertFrom-Json
    $executorEnv = [string]$cfg.envFile
    if (-not [IO.Path]::IsPathRooted($executorEnv)) { $executorEnv = Join-Path $root $executorEnv }
    Flag 'BRIDGE_ENV_MATCHES_EXECUTOR_ENV' ([IO.Path]::GetFullPath($envArg) -ieq [IO.Path]::GetFullPath($executorEnv))
  } catch { Flag 'EXECUTOR_ENV_COMPARISON_AVAILABLE' $false }
  if ($envExists) {
    $envText = Get-Content -LiteralPath $envArg -Raw
    $key = [regex]::Match($envText, '(?m)^\s*MT5_API_KEY\s*=\s*(.*?)\s*$')
    $keyValue = if ($key.Success) { $key.Groups[1].Value.Trim().Trim('"').Trim("'") } else { '' }
    Flag 'BRIDGE_API_KEY_FIELD_PRESENT' $key.Success
    Flag 'BRIDGE_API_KEY_MEETS_LAUNCHER_LENGTH' ($keyValue.Length -ge 16)
    $keyValue = $null; $envText = $null; $key = $null
  }
  foreach ($settingName in @('AllowDemandStart','DisallowStartIfOnBatteries','StopIfGoingOnBatteries','RunOnlyIfIdle','RunOnlyIfNetworkAvailable','StartWhenAvailable','Enabled')) {
    try { Flag ('TASK_SETTING_' + $settingName.ToUpperInvariant()) ([bool]$task.Settings.$settingName) }
    catch { Flag ('TASK_SETTING_' + $settingName.ToUpperInvariant() + '_OBSERVATION_AVAILABLE') $false }
  }
  $logonType = [string]$task.Principal.LogonType
  if ($logonType -notin @('None','Password','S4U','Interactive','Group','ServiceAccount','InteractiveOrPassword','InteractiveToken')) { $logonType = 'UNKNOWN' }
  Write-Host "WEB_STARTUP_TASK_LOGON_TYPE=$logonType"
  try {
    $batteries = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStatus -ErrorAction Stop)
    Flag 'BATTERY_POWER_STATUS_AVAILABLE' ($batteries.Count -gt 0)
    if ($batteries.Count -gt 0) { Flag 'BATTERY_POWER_ONLINE' (@($batteries | Where-Object { -not [bool]$_.PowerOnline }).Count -eq 0) }
  } catch { Flag 'BATTERY_POWER_STATUS_AVAILABLE' $false }
  try {
    $taskEvents = @(Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-TaskScheduler/Operational'; StartTime=$taskInfo.LastRunTime.AddMinutes(-1) } -MaxEvents 100 -ErrorAction SilentlyContinue | Where-Object {
      $xml = [xml]$_.ToXml()
      @($xml.Event.EventData.Data | Where-Object { [string]$_.Name -eq 'TaskName' -and [string]$_.InnerText -in @('XAUUSD-Phase7B-Web','\XAUUSD-Phase7B-Web') }).Count -gt 0
    })
    Flag 'TASK_SCHEDULER_EVENTS_PRESENT' ($taskEvents.Count -gt 0)
    Write-Host ('WEB_STARTUP_TASK_SCHEDULER_EVENT_IDS=' + (@($taskEvents | ForEach-Object { [int]$_.Id } | Sort-Object -Unique) -join ','))
    $eventText = ($taskEvents | ForEach-Object { [string]$_.Message }) -join "`n"
    foreach ($category in ([ordered]@{
      REQUEST_REFUSED='0x800710e0|2147946720|operator or administrator has refused'
      BATTERY='batter|AC power'
      IDLE='idle'
      LOGON='not logged|logon failure|logon type|no logged'
      NETWORK='network'
      DEMAND_START='on demand|demand start'
      INSTANCE='already running|existing instance'
      CREDENTIAL='credential|password|logon failure'
    }).GetEnumerator()) { Flag ('TASK_SCHEDULER_CATEGORY_' + $category.Key) ([bool]($eventText -match $category.Value)) }
    $eventText=$null; $taskEvents=$null
  } catch { Flag 'TASK_SCHEDULER_EVENT_OBSERVATION_AVAILABLE' $false }
  $accountPath = Join-Path $runtime 'phase7c-account-mode.json'
  Flag 'ACCOUNT_STATE_EXISTS' (Test-Path -LiteralPath $accountPath -PathType Leaf)
  try {
    $account = Get-Content -LiteralPath $accountPath -Raw | ConvertFrom-Json
    Flag 'ACCOUNT_STATE_JSON_VALID' $true
    Flag 'ACCOUNT_STATE_VERSION_ONE' ([int]$account.version -eq 1)
    Flag 'ACCOUNT_STATE_LIVE' ([string]$account.accountMode -eq 'LIVE')
    Flag 'ACCOUNT_STATE_LIVE_CONTEXT_CONSISTENT' ([string]$account.accountMode -eq 'LIVE' -and [bool]$account.liveExecutionEnabled)
  } catch { Flag 'ACCOUNT_STATE_VALIDATION_AVAILABLE' $false }
  foreach ($relative in @('phase7c-source-attestation\deployment.json')) {
    $manifest = Join-Path $runtime $relative
    Flag 'DEPLOYMENT_MANIFEST_EXISTS' (Test-Path -LiteralPath $manifest -PathType Leaf)
    try { $null = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json; Flag 'DEPLOYMENT_MANIFEST_JSON_VALID' $true }
    catch { Flag 'DEPLOYMENT_MANIFEST_JSON_VALID' $false }
  }
  Flag 'WEB_DIST_INDEX_EXISTS' (Test-Path -LiteralPath (Join-Path $root 'apps\web\dist\index.html') -PathType Leaf)
  foreach ($relative in @('scripts\run-phase7b-api-runtime-local.ps1','scripts\lib\phase7b-windows-job-object.ps1','scripts\lib\phase7c-runtime-source-attestation.ps1','scripts\lib\phase7b-web-source-attestation.ps1')) {
    $label = [IO.Path]::GetFileNameWithoutExtension($relative).Replace('-','_').ToUpperInvariant()
    Flag ($label + '_EXISTS') (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)
  }
  foreach ($port in @(3711,5717)) {
    $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    Flag ("PORT_" + $port + '_LISTENING') ($listener.Count -gt 0)
  }
  try { $ui = Invoke-WebRequest -Method Get -Uri 'http://127.0.0.1:5717/phase7b-ops' -UseBasicParsing -TimeoutSec 5; Write-Host ("WEB_STARTUP_UI_HTTP=" + [int]$ui.StatusCode) }
  catch { Write-Host 'WEB_STARTUP_UI_HTTP=UNREACHABLE' }
  try {
    $life = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3711/api/v1/phase7c/lifecycle' -TimeoutSec 5
    Flag 'API_REACHABLE' $true
    Flag 'API_RUNNING' ([bool]$life.running)
    Flag 'API_READY' ([bool]$life.ready)
    Flag 'API_MODE_PAUSE' ([string]$life.mode.mode -eq 'PAUSE')
  } catch { Flag 'API_LIFECYCLE_OBSERVATION_AVAILABLE' $false }
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Host ("WEB_STARTUP_FREE_MEMORY_MB=" + [math]::Floor([double]$os.FreePhysicalMemory / 1024))
    Write-Host ("WEB_STARTUP_POWERSHELL_PROCESS_COUNT=" + @(Get-Process powershell -ErrorAction SilentlyContinue).Count)
  } catch { Flag 'HOST_RESOURCE_OBSERVATION_AVAILABLE' $false }
  $categories = [ordered]@{
    MISSING_PATH = 'cannot find path|cannot find drive|bridge env missing|launcher not found|helper not found|library not found'
    API_KEY_MISSING = 'requires a valid MT5_API_KEY'
    ACCOUNT_CONTEXT = 'requires canonical account-mode state|state version 1|account/live-execution context is inconsistent'
    JOB_OBJECT = 'AssignProcessToJobObject|SetInformationJobObject|CreateJobObject|Win32Error'
    PROCESS_INIT = '-1073741502|0xc0000142'
    MEMORY = 'out of memory|ENOMEM|heap limit|insufficient system resources'
    ACCESS = 'EACCES|EPERM|access is denied'
  }
  foreach ($logName in @('Microsoft-Windows-PowerShell/Operational','Application')) {
    $label = if ($logName -eq 'Application') { 'APPLICATION' } else { 'POWERSHELL' }
    try {
      $events = @(Get-WinEvent -FilterHashtable @{ LogName=$logName; StartTime=$taskInfo.LastRunTime.AddMinutes(-1); Level=@(2,3) } -MaxEvents 40 -ErrorAction SilentlyContinue)
      Flag ($label + '_ERROR_EVENTS_PRESENT') ($events.Count -gt 0)
      $messages = ($events | ForEach-Object { [string]$_.Message }) -join "`n"
      foreach ($category in $categories.GetEnumerator()) { Flag ($label + '_CATEGORY_' + $category.Key) ([bool]($messages -match $category.Value)) }
      $messages = $null; $events = $null
    } catch { Flag ($label + '_EVENT_OBSERVATION_AVAILABLE') $false }
  }
  Write-Host 'WEB_STARTUP_DIAGNOSTIC_STATUS=COLLECTED'
} catch {
  Write-Host 'WEB_STARTUP_DIAGNOSTIC_STATUS=INCOMPLETE'
  exit 1
}
Write-Host 'WEB_STARTUP_TASK_MODE_ARM_ORDER_MUTATION=NONE'
Write-Host 'WEB_STARTUP_HTTP_METHODS=GET_ONLY'
