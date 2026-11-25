param(
  [switch]$Apply,
  [switch]$Restore,
  [string]$BackupDir = "",
  [string[]]$TaskNames = @(
    "XAUUSD-Phase7B-Bridge",
    "XAUUSD-Phase7B-Web",
    "XAUUSD-Phase7C-Bridge",
    "XAUUSD-Phase7C-Forward-Dashboard",
    "XAUUSD-Phase7B-Bot",
    "XAUUSD-Phase7B-Core",
    "XAUUSD-Phase7B-Telegram"
  )
)

# One-click start only: remove the boot (AtStartup) and logon (AtLogOn) triggers from the XAUUSD
# bot scheduled tasks so nothing starts when Windows starts. The tasks stay registered and enabled,
# so the desktop shortcut "XAUUSD AI MASTER" (open-phase7c-control-center-local.ps1) can still start
# Bridge + Web on click, and the bot itself still starts only from the BAT BOT button.
#
#   Dry run (default, changes nothing):  .\scripts\set-phase7c-manual-start-only-local.ps1
#   Apply:                               .\scripts\set-phase7c-manual-start-only-local.ps1 -Apply
#   Undo from the backups of a run:      .\scripts\set-phase7c-manual-start-only-local.ps1 -Restore -BackupDir <dir>
#
# Safety: never stops, deletes or disables a task; never touches BOT_MODE, LIVE ARM, accounts,
# orders or positions; refuses to edit a task that is Running (stop the bot first, keep PAUSE).

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run PowerShell as Administrator to change XAUUSD scheduled task triggers."
}

if ($Apply -and $Restore) { throw "Use either -Apply or -Restore, not both." }

$AutoStartTriggerClasses = @("MSFT_TaskBootTrigger", "MSFT_TaskLogonTrigger")
# The SYSTEM lifecycle broker must keep its single AtStartup trigger: BAT BOT needs it READY, the
# desktop launcher cannot start a SYSTEM task, and every ownership/readiness check treats a missing
# boot trigger as TRIGGER drift. The broker never trades by itself; the bot still starts only on BAT BOT.
$KeepBootTriggerTasks = @("XAUUSD-Phase7C-Executors")

if ($Restore) {
  if (-not $BackupDir -or -not (Test-Path -LiteralPath $BackupDir -PathType Container)) {
    throw "-Restore needs -BackupDir pointing at a folder written by a previous -Apply run."
  }
  foreach ($file in Get-ChildItem -LiteralPath $BackupDir -Filter "*.xml") {
    $name = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -ne $existing -and [string]$existing.State -eq "Running") {
      Write-Host "PHASE7C_MANUAL_START_BLOCKED=TASK_RUNNING|TASK=$name"
      continue
    }
    $xml = Get-Content -LiteralPath $file.FullName -Raw
    $taskPath = if ($null -ne $existing) { $existing.TaskPath } else { "\" }
    Register-ScheduledTask -Xml $xml -TaskName $name -TaskPath $taskPath -Force -ErrorAction Stop | Out-Null
    Write-Host "PHASE7C_MANUAL_START_RESTORED=$name"
  }
  Write-Host "PHASE7C_MANUAL_START_MODE=RESTORED_FROM_BACKUP"
  exit 0
}

if (-not $BackupDir) {
  $BackupDir = Join-Path $ProjectRoot (".runtime\task-trigger-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}

$planned = 0
$changed = 0
$blocked = 0
foreach ($name in $TaskNames) {
  if ($KeepBootTriggerTasks -contains $name) {
    Write-Host "PHASE7C_MANUAL_START_TASK=$name|KEEP_BOOT_TRIGGER_REQUIRED"
    continue
  }
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    Write-Host "PHASE7C_MANUAL_START_TASK=$name|NOT_INSTALLED"
    continue
  }
  $all = @($task.Triggers)
  $autoStart = @($all | Where-Object { $AutoStartTriggerClasses -contains $_.CimClass.CimClassName })
  $keep = @($all | Where-Object { $AutoStartTriggerClasses -notcontains $_.CimClass.CimClassName })
  if ($autoStart.Count -eq 0) {
    Write-Host "PHASE7C_MANUAL_START_TASK=$name|ALREADY_MANUAL|STATE=$($task.State)"
    continue
  }
  $planned += 1
  $kinds = ($autoStart | ForEach-Object { $_.CimClass.CimClassName -replace "^MSFT_Task", "" }) -join ","
  Write-Host "PHASE7C_MANUAL_START_TASK=$name|REMOVE=$kinds|KEEP_OTHER_TRIGGERS=$($keep.Count)|STATE=$($task.State)"

  if (-not $Apply) { continue }

  if ([string]$task.State -eq "Running") {
    # Editing a running task is refused: keep PAUSE, close positions per runbook, stop the bot from
    # the Control Center, then run -Apply again. This script never stops anything itself.
    Write-Host "PHASE7C_MANUAL_START_BLOCKED=TASK_RUNNING|TASK=$name"
    $blocked += 1
    continue
  }

  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $backupFile = Join-Path $BackupDir "$name.xml"
  Export-ScheduledTask -TaskName $name -TaskPath $task.TaskPath -ErrorAction Stop |
    Out-File -LiteralPath $backupFile -Encoding unicode
  if (-not (Test-Path -LiteralPath $backupFile)) { throw "Backup was not written for $name; nothing changed." }

  $task.Triggers = $keep
  Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null

  $after = Get-ScheduledTask -TaskName $name -ErrorAction Stop
  $left = @($after.Triggers | Where-Object { $AutoStartTriggerClasses -contains $_.CimClass.CimClassName })
  if ($left.Count -ne 0) { throw "Task $name still has a boot/logon trigger after update. Restore from $BackupDir." }
  Write-Host "PHASE7C_MANUAL_START_CHANGED=$name|BACKUP=$backupFile"
  $changed += 1
}

$shortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XAUUSD AI MASTER.lnk"
$shortcutPresent = Test-Path -LiteralPath $shortcut
Write-Host "PHASE7C_MANUAL_START_DESKTOP_SHORTCUT=$(if ($shortcutPresent) { 'PRESENT' } else { 'MISSING_RUN_install-phase7c-desktop-control-local.ps1' })"

if (-not $Apply -and -not $Restore) {
  Write-Host "PHASE7C_MANUAL_START_MODE=DRY_RUN|TASKS_TO_CHANGE=$planned"
  Write-Host "PHASE7C_MANUAL_START_NEXT=RERUN_WITH_-Apply"
  exit 0
}

Write-Host "PHASE7C_MANUAL_START_MODE=APPLIED|CHANGED=$changed|BLOCKED=$blocked|BACKUP_DIR=$BackupDir"
if ($blocked -gt 0) { exit 3 }
