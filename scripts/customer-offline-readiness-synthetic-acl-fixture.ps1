# Synthetic-only Windows runner fixture. NEVER use against a real customer directory.
# The only ACL modifications this helper can make are under a tightly named
# temporary directory created by a test. It does not read any key file content.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [switch]$InjectEveryone
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$stage = 'WINDOWS'
try {
if ($env:OS -ne 'Windows_NT') { throw 'SYNTHETIC_ACL_WINDOWS_ONLY' }
$stage = 'GUARD'

$rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\','/'))
$tempFull = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]@('\','/'))
$leaf = Split-Path -Path $rootFull -Leaf
$parent = Split-Path -Path $rootFull -Parent
if ($parent -ine $tempFull -or $leaf -notmatch '^xauusd-offline-positive-[A-Za-z0-9]+$') {
  throw 'SYNTHETIC_ACL_FIXTURE_ROOT_REQUIRED'
}

$keys = Join-Path $rootFull 'keys'
$dpapi = Join-Path $keys 'installation-private.dpapi'
$stage = 'FIXTURE_FILES'
foreach ($itemPath in @($rootFull, $keys, $dpapi)) {
  $item = Get-Item -LiteralPath $itemPath -Force -ErrorAction Stop
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'SYNTHETIC_ACL_REPARSE_PATH_FORBIDDEN'
  }
}
if (-not (Get-Item -LiteralPath $keys).PSIsContainer -or
    (Get-Item -LiteralPath $dpapi).PSIsContainer) {
  throw 'SYNTHETIC_ACL_FIXTURE_SHAPE_INVALID'
}

$stage = 'CURRENT_USER_SID'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$adminsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$everyoneSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$full = [System.Security.AccessControl.FileSystemRights]::FullControl

$stage = 'ACL_SETUP'
foreach ($itemPath in @($keys, $dpapi)) {
  $acl = Get-Acl -LiteralPath $itemPath -ErrorAction Stop
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) {
    [void]$acl.RemoveAccessRuleSpecific($rule)
  }
  $acl.SetOwner($currentSid)
  foreach ($sid in @($currentSid, $systemSid, $adminsSid)) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, $full, $allow))
  }
  if ($InjectEveryone.IsPresent -and $itemPath -eq $dpapi) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
      $everyoneSid, [System.Security.AccessControl.FileSystemRights]::Read, $allow
    ))
  }
  $stage = 'ACL_APPLY'
  Set-Acl -LiteralPath $itemPath -AclObject $acl -ErrorAction Stop
  $stage = 'ACL_SETUP'
}
Write-Output 'SYNTHETIC_TEMP_ONLY_ACL_FIXTURE=PASS'
} catch {
  # Stage-only sanitized diagnostics: no absolute paths, account SIDs or Windows errors.
  [Console]::Error.WriteLine('SYNTHETIC_ACL_FIXTURE_BLOCKED_STAGE=' + $stage)
  exit 2
}