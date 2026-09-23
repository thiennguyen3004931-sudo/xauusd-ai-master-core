$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WorkflowPath = Join-Path $ProjectRoot '.github\workflows\auto-live-event-monitor.yml'
$MonitorPath = Join-Path $ProjectRoot 'scripts\ops\auto-live-event-monitor.ps1'

if (-not (Test-Path -LiteralPath $WorkflowPath)) {
  throw "AUTO LIVE monitor workflow missing: $WorkflowPath"
}
if (-not (Test-Path -LiteralPath $MonitorPath)) {
  throw "AUTO LIVE monitor script missing: $MonitorPath"
}

$Workflow = Get-Content -LiteralPath $WorkflowPath -Raw
$Monitor = Get-Content -LiteralPath $MonitorPath -Raw

[void][scriptblock]::Create($Monitor)

function Assert-Literal {
  param([string]$Source, [string]$Text, [string]$Label)
  if ($Source.IndexOf($Text, [System.StringComparison]::Ordinal) -lt 0) {
    throw "Missing AUTO LIVE monitor contract literal: $Label"
  }
}

function Assert-Match {
  param([string]$Source, [string]$Pattern, [string]$Label)
  if ($Source -notmatch $Pattern) {
    throw "Missing AUTO LIVE monitor contract pattern: $Label"
  }
}

function Assert-NotMatch {
  param([string]$Source, [string]$Pattern, [string]$Label)
  if ($Source -match $Pattern) {
    throw "Forbidden AUTO LIVE monitor pattern: $Label"
  }
}

Assert-Literal $Workflow "name: AUTO LIVE Read-Only Event Monitor" 'workflow identity'
Assert-Literal $Workflow "cron: '2-52/10 * * * *'" 'staggered schedule A'
Assert-Literal $Workflow "cron: '7-57/10 * * * *'" 'staggered schedule B'
Assert-Literal $Workflow 'issues: write' 'issue-only persistence permission'
Assert-Literal $Workflow 'contents: read' 'read-only repository content permission'
Assert-Literal $Workflow 'runs-on: [self-hosted, Windows, X64, xauusd-core-ci]' 'canonical self-hosted runner labels'
Assert-Literal $Workflow 'scripts/test-auto-live-event-monitor-source.ps1' 'static safety contract executes before monitor'
Assert-Literal $Workflow '$notify = $false' 'validation defaults to no persistence'
Assert-Literal $Workflow "github.event_name }}' -eq 'schedule'" 'schedule event detection'
Assert-Literal $Workflow '$notify = $true' 'scheduled persistence enabled'
Assert-Literal $Workflow "inputs.notify }}' -eq 'true'" 'manual notify opt-in'
Assert-Literal $Workflow 'EXPECTED_SOURCE_COMMIT: 4aeff4e62c5acecb85c8c344184f962fd7121928' 'pinned production source'
Assert-Literal $Workflow "MONITOR_ISSUE_NUMBER: '28'" 'canonical event ledger issue'
Assert-Literal $Workflow 'MONITOR_PRODUCTION_READ_ONLY=TRUE' 'read-only safety summary'
Assert-Literal $Workflow 'cancel-in-progress: true' 'latest-wins concurrency'
if ($Workflow.Contains('feat/auto-live-event-monitor-77f13bbd')) { throw 'Stale AUTO LIVE monitor branch trigger must be removed.' }
Assert-Literal $Workflow 'MONITOR_PRODUCTION_HTTP_METHODS=GET_ONLY' 'GET-only safety summary'
Assert-Literal $Workflow 'MONITOR_MODE_MUTATION=NONE' 'mode mutation forbidden'
Assert-Literal $Workflow 'MONITOR_ARM_MUTATION=NONE' 'ARM mutation forbidden'
Assert-Literal $Workflow 'MONITOR_ORDER_MUTATION=NONE' 'order mutation forbidden'
Assert-Literal $Workflow 'MONITOR_POSITION_MUTATION=NONE' 'position mutation forbidden'

Assert-Literal $Monitor '[switch]$Notify' 'explicit persistence switch'
Assert-Literal $Monitor "Write-Host 'MONITOR_NOTIFY=FALSE'" 'dry-run evidence'
Assert-Literal $Monitor "Write-Host 'MONITOR_REPOSITORY_MUTATION=NONE'" 'dry-run repository safety'
Assert-Literal $Monitor 'MONITOR_PRODUCTION_HTTP_METHODS=GET_ONLY' 'runtime GET-only evidence'
Assert-Literal $Monitor 'MONITOR_PRODUCTION_MUTATION=NONE' 'runtime production safety evidence'

$NotifyGuardIndex = $Monitor.IndexOf('if (-not $Notify)', [System.StringComparison]::Ordinal)
$IssueReadIndex = $Monitor.IndexOf('$issue = Invoke-GitHubJson -Method Get', [System.StringComparison]::Ordinal)
if ($NotifyGuardIndex -lt 0 -or $IssueReadIndex -lt 0 -or $NotifyGuardIndex -ge $IssueReadIndex) {
  throw 'Notify=false guard must exit before any GitHub issue persistence path.'
}

Assert-Literal $Monitor 'Read-BridgeArray -Uri "$bridgeBase/v1/positions?symbol=XAUUSD"' 'position read endpoint'
Assert-Literal $Monitor 'Read-BridgeArray -Uri "$bridgeBase/v1/orders?symbol=XAUUSD"' 'pending-order read endpoint'
Assert-Literal $Monitor 'Invoke-RestMethod -Uri "$bridgeBase/health"' 'MT5 bridge health read'
Assert-Literal $Monitor "/api/v1/phase7c/lifecycle' -Method Get" 'lifecycle GET'
Assert-Literal $Monitor "/api/v1/phase7c-live-arm-control/capability' -Method Get" 'ARM capability GET'
Assert-Literal $Monitor "/api/v1/mt5/status?symbol=XAUUSD' -Method Get" 'MT5 status GET'
Assert-Literal $Monitor "/api/v1/phase7c/runtime-source-attestation/' -Method Get" 'runtime-source GET'
Assert-Literal $Monitor "/api/v1/phase7c/live-regime?symbol=XAUUSD&count=320' -Method Get" 'regime GET'
Assert-Literal $Monitor "/api/v1/phase7c/decision-monitor?symbol=XAUUSD' -Method Get" 'decision monitor GET'

Assert-NotMatch $Monitor '(?im)Invoke-(?:RestMethod|WebRequest)[^\r\n]*(?:127\.0\.0\.1|\$bridgeBase)[^\r\n]*-Method\s+(?:Post|Put|Patch|Delete)' 'production HTTP mutation'
Assert-NotMatch $Monitor '(?im)-Uri\s+[^\r\n]*(?:/v1/orders|phase7c-live-arm-control|bot-mode|auto-activation)[^\r\n]*-Method\s+(?:Post|Put|Patch|Delete)' 'trading/control mutation endpoint'

foreach ($EventMarker in @(
  'REGIME_OR_STRATEGY_CHANGED',
  'POSITION_OPENED',
  'POSITION_CLOSED',
  'POSITION_SET_CHANGED',
  'PENDING_ORDER_SET_CHANGED',
  'FASTMOVE_OR_M5_MANAGEMENT_STATE_CHANGED',
  'POSITION_OWNERSHIP_EVIDENCE_CHANGED',
  'POSITION_OWNERSHIP_ALERT',
  'TELEGRAM_NOT_READY',
  'ARM_LOST',
  'LIFECYCLE_NOT_READY',
  'MT5_NOT_HEALTHY',
  'RUNTIME_SOURCE_DRIFT',
  'AUTO_LIVE_STATE_CHANGED'
)) {
  Assert-Literal $Monitor $EventMarker "event marker $EventMarker"
}

foreach ($StateField in @(
  'sourceCommit',
  'productionHead',
  'botMode',
  'accountMode',
  'lifecycleRunning',
  'lifecycleReady',
  'telegramReady',
  'telegramStatus',
  'mt5Status',
  'armStatus',
  'liveExecutionArmed',
  'runtimeSourceOverall',
  'regime',
  'recommendedMode',
  'effectiveStrategy',
  'positionCount',
  'pendingOrderCount',
  'positionSignature',
  'pendingOrderSignature',
  'ownershipFingerprint',
  'ownershipAlertSignature',
  'managementFingerprint'
)) {
  Assert-Match $Monitor ("(?m)^\s*" + [regex]::Escape($StateField) + "\s*=") "state field $StateField"
}

$GitHubCalls = [regex]::Matches(
  $Monitor,
  '(?m)^\s*(?:\$[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?Invoke-GitHubJson\s+-Method\s+(Get|Post|Patch|Put|Delete)\s+-Uri\s+([^\r\n]+)'
)
if ($GitHubCalls.Count -ne 3) {
  throw "Expected exactly 3 GitHub issue persistence calls, found $($GitHubCalls.Count)."
}

$Methods = @($GitHubCalls | ForEach-Object { $_.Groups[1].Value })
if (($Methods -join ',') -ne 'Get,Post,Patch') {
  throw "Unexpected GitHub persistence methods: $($Methods -join ',')"
}

Assert-Literal $Monitor 'Invoke-GitHubJson -Method Get -Uri $issueUri' 'issue state read'
Assert-Literal $Monitor 'Invoke-GitHubJson -Method Post -Uri "$issueUri/comments"' 'event comment append'
Assert-Literal $Monitor 'Invoke-GitHubJson -Method Patch -Uri $issueUri' 'state marker update'
Assert-NotMatch $Monitor 'Invoke-GitHubJson\s+-Method\s+(?:Put|Delete)' 'unexpected GitHub mutation method'

Write-Host 'AUTO_LIVE_MONITOR_SOURCE_CONTRACT=PASS'
Write-Host 'PRODUCTION_HTTP_METHODS=GET_ONLY'
Write-Host 'PRODUCTION_MUTATION=NONE'
