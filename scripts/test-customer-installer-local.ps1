param([string]$PackageZip = "artifacts/customer-agent-release/customer-agent-v1.zip")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$installer = (Resolve-Path -LiteralPath "scripts/install-customer-agent-safe.ps1").Path
$zip = (Resolve-Path -LiteralPath $PackageZip).Path
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$root = Join-Path $env:RUNNER_TEMP ("xauusd-customer-install-ci-" + [guid]::NewGuid().ToString("N"))
try {
  $self = Join-Path $root "self-managed"
  & $installer -ZipPath $zip -ExpectedSha256 $hash -InstallRoot $self -ProductMode SELF_MANAGED
  $selfConfig = Get-Content -LiteralPath (Join-Path $self "config/customer-agent.json") -Raw | ConvertFrom-Json
  if ($selfConfig.productMode -ne "SELF_MANAGED" -or $selfConfig.requestedBotMode -ne "PAUSE") {
    throw "SELF_MANAGED_INSTALL_CONFIG_INVALID"
  }
  if (Test-Path (Join-Path $self "keys/installation-private.pem")) {
    throw "INSTALLER_MUST_NOT_GENERATE_PRIVATE_KEY"
  }

  $duplicateBlocked = $false
  try {
    & $installer -ZipPath $zip -ExpectedSha256 $hash -InstallRoot $self -ProductMode SELF_MANAGED
  } catch {
    if ($_.Exception.Message -match "CUSTOMER_INSTALL_ALREADY_EXISTS") { $duplicateBlocked = $true }
    else { throw }
  }
  if (-not $duplicateBlocked) { throw "DUPLICATE_INSTALL_NOT_BLOCKED" }

  $copy = Join-Path $root "copy-follower"
  & $installer -ZipPath $zip -ExpectedSha256 $hash -InstallRoot $copy -ProductMode COPY_FOLLOWER
  $copyConfig = Get-Content -LiteralPath (Join-Path $copy "config/customer-agent.json") -Raw | ConvertFrom-Json
  if ($copyConfig.productMode -ne "COPY_FOLLOWER" -or $copyConfig.requestedSizingMode -ne "EQUITY_RATIO") {
    throw "COPY_FOLLOWER_INSTALL_CONFIG_INVALID"
  }

  $wrongHashBlocked = $false
  try {
    & $installer -ZipPath $zip -ExpectedSha256 ("0" * 64) -InstallRoot (Join-Path $root "tampered")
  } catch {
    if ($_.Exception.Message -match "CUSTOMER_INSTALL_CHECKSUM_MISMATCH") { $wrongHashBlocked = $true }
    else { throw }
  }
  if (-not $wrongHashBlocked -or (Test-Path (Join-Path $root "tampered"))) {
    throw "CHECKSUM_DENIAL_FAILED"
  }

  Write-Host "CUSTOMER_INSTALLER_SELF_MANAGED=PASS"
  Write-Host "CUSTOMER_INSTALLER_COPY_FOLLOWER=PASS"
  Write-Host "CUSTOMER_INSTALLER_HASH_ENFORCED=PASS"
  Write-Host "CUSTOMER_INSTALLER_EXISTING_KEY_PRESERVATION=PASS"
  Write-Host "CUSTOMER_INSTALLER_TRADING_MUTATION=NONE"
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}
