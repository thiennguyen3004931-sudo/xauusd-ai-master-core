param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [ValidateSet("SELF_MANAGED", "COPY_FOLLOWER")][string]$ProductMode = "SELF_MANAGED",
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "XAUUSD\CustomerAgent\customer-agent-v1")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression

if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') {
  throw "CUSTOMER_INSTALL_EXPECTED_SHA256_INVALID"
}
$zip = [IO.Path]::GetFullPath($ZipPath)
$target = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "CUSTOMER_INSTALL_ZIP_MISSING" }
if (Test-Path -LiteralPath $target) {
  throw "CUSTOMER_INSTALL_ALREADY_EXISTS: do not overwrite existing identity/private keys"
}

$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
  throw "CUSTOMER_INSTALL_NODE_24_REQUIRED"
}
$actualZipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualZipHash -cne $ExpectedSha256) { throw "CUSTOMER_INSTALL_CHECKSUM_MISMATCH" }

# Audit entry paths before extraction. No absolute paths, parent traversals or
# symlink entries are permitted, even inside an otherwise checksum-verified ZIP.
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  foreach ($entry in $archive.Entries) {
    $relative = $entry.FullName.Replace('\', '/')
    if (
      [string]::IsNullOrWhiteSpace($relative) -or
      $relative.StartsWith('/') -or
      $relative.Contains(':') -or
      $relative -match '(^|/)\.\.?(/|$)' -or
      $relative -match '//'
    ) {
      throw "CUSTOMER_INSTALL_UNSAFE_ZIP_ENTRY"
    }
    $fileKind = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    if ($fileKind -eq 0xA000) { throw "CUSTOMER_INSTALL_SYMLINK_FORBIDDEN" }
  }
} finally {
  $archive.Dispose()
}

$parent = Split-Path -Parent $target
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$staging = Join-Path $parent (".xauusd-customer-install-" + [guid]::NewGuid().ToString("N"))
$committed = $false
try {
  Expand-Archive -LiteralPath $zip -DestinationPath $staging
  $manifest = Join-Path $staging "release-manifest.sha256"
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "CUSTOMER_INSTALL_MANIFEST_MISSING"
  }

  $verified = @{}
  foreach ($line in (Get-Content -LiteralPath $manifest -Encoding UTF8)) {
    if ($line -cnotmatch '^([0-9a-f]{64})  ([^:\r\n]+)$') {
      throw "CUSTOMER_INSTALL_MANIFEST_INVALID"
    }
    $hash = $Matches[1]
    $relative = $Matches[2].Replace('\', '/')
    if (
      $relative.StartsWith('/') -or $relative -match '(^|/)\.\.?(/|$)' -or
      $relative -eq 'release-manifest.sha256' -or
      $verified.ContainsKey($relative)
    ) {
      throw "CUSTOMER_INSTALL_MANIFEST_UNSAFE"
    }
    $filePath = Join-Path $staging $relative
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      throw "CUSTOMER_INSTALL_MANIFEST_ENTRY_MISSING"
    }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash) {
      throw "CUSTOMER_INSTALL_MANIFEST_CHECKSUM_MISMATCH"
    }
    $verified[$relative] = $true
  }
  if ($verified.Count -eq 0) { throw "CUSTOMER_INSTALL_MANIFEST_EMPTY" }

  foreach ($file in (Get-ChildItem -LiteralPath $staging -Recurse -File)) {
    $relative = $file.FullName.Substring($staging.Length).TrimStart([char[]]"\/").Replace('\', '/')
    if ($relative -ne "release-manifest.sha256" -and -not $verified.ContainsKey($relative)) {
      throw "CUSTOMER_INSTALL_UNLISTED_FILE"
    }
    if (
      $relative -match '(^|/)src/' -or
      $relative -match 'strategy-engine|risk-engine|execution-engine|mt5-broker' -or
      $relative -match '(^|/)\.env($|\.)|\.pem$|\.key$'
    ) {
      throw "CUSTOMER_INSTALL_PRIVATE_SOURCE_FORBIDDEN"
    }
  }

  $template = if ($ProductMode -eq "SELF_MANAGED") {
    "config/self-managed.example.json"
  } else {
    "config/copy-follower.example.json"
  }
  foreach ($required in @("README.md", "acceptance-record.template.md", $template, "bin/generate-installation-identity.mjs", "bin/activate-customer-agent.mjs")) {
    if (-not (Test-Path -LiteralPath (Join-Path $staging $required) -PathType Leaf)) {
      throw "CUSTOMER_INSTALL_REQUIRED_FILE_MISSING"
    }
  }
  Copy-Item -LiteralPath (Join-Path $staging $template) -Destination (Join-Path $staging "config/customer-agent.json")
  if (Test-Path -LiteralPath $target) { throw "CUSTOMER_INSTALL_ALREADY_EXISTS" }
  Move-Item -LiteralPath $staging -Destination $target
  $committed = $true
  Write-Host "CUSTOMER_INSTALL_PACKAGE=PASS"
  Write-Host "CUSTOMER_INSTALL_MANIFEST_ENTRIES=$($verified.Count)"
  Write-Host "CUSTOMER_INSTALL_PRODUCT_MODE=$ProductMode"
  Write-Host "CUSTOMER_INSTALL_LOCATION=$target"
  Write-Host "CUSTOMER_INSTALL_TRADING_EXECUTION=NOT_INCLUDED"
  Write-Host "CUSTOMER_INSTALL_NEXT=configure gateway/grant/account, then generate local identity and activate"
} finally {
  if (-not $committed -and (Test-Path -LiteralPath $staging)) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}
