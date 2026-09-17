# Self-Hosted PowerShell 7 Capability Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap and prove PowerShell 7 on the canonical Windows self-hosted runner before migrating any legacy hosted Phase7C workflow.

**Architecture:** Use the existing Draft PR #10 diagnostic workflow on `[self-hosted, Windows, X64, xauusd-core-ci]`. The workflow starts under built-in Windows PowerShell 5.1, installs the official `Microsoft.PowerShell` package with the already-proven `winget` capability only when `pwsh` is absent, rediscovers the actual installed executable, adds its directory to `GITHUB_PATH`, then proves both direct `pwsh` execution and a real GitHub Actions `shell: pwsh` step. No repository checkout, trading/runtime source execution, or production mutation is allowed.

**Tech Stack:** GitHub Actions, Windows self-hosted runner, Windows PowerShell 5.1, winget, PowerShell 7.

**Spec:** `docs/superpowers/specs/2026-09-17-self-hosted-pwsh-bootstrap-design.md`

## Global Constraints

- `PRODUCTION_MUTATION=NONE`.
- `BOT_RUNTIME_MUTATION=NONE`.
- `MODE_MUTATION=NONE`.
- `ARM_MUTATION=NONE`.
- `TASK_MUTATION=NONE`.
- `PROCESS_MUTATION=NONE`.
- `ORDER_MUTATION=NONE`.
- `POSITION_MUTATION=NONE`.
- `LIVE_TEST_ORDER=NONE`.
- `TRADING_LOGIC_MUTATION=NONE`.
- `RISK_LOGIC_MUTATION=NONE`.
- `ORDER_LOGIC_MUTATION=NONE`.
- `ALLOWLIST_MUTATION=NONE`.
- `GITLEAKS_MUTATION=NONE`.
- Do not remove or weaken PowerShell 7 gates.
- Do not use Windows PowerShell 5.1 as a replacement for PowerShell 7 acceptance.
- Do not modify PR #9 or PR #7.
- Keep PR #10 Draft and unmerged.

---

### Task 1: Preserve the proven RED diagnostic evidence

**Files:**
- Existing: `.github/workflows/self-hosted-pwsh-capability-probe.yml`

**Interfaces:**
- Consumes: runner labels `[self-hosted, Windows, X64, xauusd-core-ci]`.
- Produces: exact RED capability evidence from the existing self-hosted run.

- [x] **Step 1: Run the read-only capability probe**

Accepted RED evidence:

```text
HEAD=ad28d40b2b08ba67ff9996cc183ae6ef3763ffce
RUN=35185120011
JOB=105085420167
RUNNER=XAUUSD-CORE-CI-WIN
POWERSHELL_51_VERSION=5.1.26100.9444
PWSH_FOUND=FALSE
PWSH_COMMON_PATH_EXISTS=FALSE
WINGET_FOUND=TRUE
CHOCO_FOUND=FALSE
FAIL=PWSH_CAPABILITY_MISSING
```

- [x] **Step 2: Confirm the failure is infrastructure capability, not source regression**

The runner executed real steps and failed exactly at `PowerShell 7 capability`. No trading/runtime source was checked out or executed.

---

### Task 2: Bootstrap PowerShell 7 on the diagnostic branch

**Files:**
- Modify: `.github/workflows/self-hosted-pwsh-capability-probe.yml`

**Interfaces:**
- Consumes: built-in Windows PowerShell 5.1 plus `winget`.
- Produces: a discovered PowerShell 7 executable, later-step PATH exposure through `GITHUB_PATH`, and fail-closed bootstrap verdicts.

- [ ] **Step 1: Guard the job to the diagnostic PR branch**

Require:

```yaml
if: github.event.pull_request.head.ref == 'diag/self-hosted-pwsh-capability'
```

This prevents unrelated PRs from attempting runner package installation.

- [ ] **Step 2: Replace the absence-only probe with bootstrap-or-reuse logic**

Under `shell: powershell`, implement:

```powershell
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
$common = 'C:\Program Files\PowerShell\7\pwsh.exe'

if (-not $pwsh) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Error 'PWSH_BOOTSTRAP_BLOCKED_WINGET_MISSING'
    exit 1
  }

  & $winget.Source install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
  if ($LASTEXITCODE -ne 0) {
    Write-Error "PWSH_BOOTSTRAP_INSTALL_FAILED exit=$LASTEXITCODE"
    exit $LASTEXITCODE
  }

  Start-Sleep -Seconds 2
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
}

if (-not $pwsh -and (Test-Path -LiteralPath $common -PathType Leaf)) {
  $pwsh = Get-Item -LiteralPath $common
}

if (-not $pwsh) {
  Write-Error 'PWSH_BOOTSTRAP_EXECUTABLE_MISSING'
  exit 1
}

$pwshPath = [string]$pwsh.Source
if ([string]::IsNullOrWhiteSpace($pwshPath)) {
  $pwshPath = [string]$pwsh.FullName
}
if ([string]::IsNullOrWhiteSpace($pwshPath) -or -not (Test-Path -LiteralPath $pwshPath -PathType Leaf)) {
  Write-Error 'PWSH_BOOTSTRAP_EXECUTABLE_INVALID'
  exit 1
}

$pwshDir = Split-Path -Parent $pwshPath
$pwshDir | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
$version = & $pwshPath -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
if ($LASTEXITCODE -ne 0) {
  Write-Error 'PWSH_DIRECT_EXECUTION_FAILED'
  exit $LASTEXITCODE
}
$major = [int]($version -split '\.')[0]
if ($major -lt 7) {
  Write-Error "PWSH_VERSION_UNSUPPORTED version=$version"
  exit 1
}
Write-Host 'PWSH_FOUND=TRUE'
Write-Host "PWSH_PATH=$pwshPath"
Write-Host "PWSH_VERSION=$version"
Write-Host 'PWSH_DIRECT_EXECUTION=PASS'
```

- [ ] **Step 3: Add a real GitHub Actions PowerShell 7 shell acceptance step**

Add a subsequent workflow step:

```yaml
- name: PowerShell 7 Actions shell acceptance
  shell: pwsh
  run: |
    Write-Host "PWSH_ACTIONS_SHELL_VERSION=$($PSVersionTable.PSVersion.ToString())"
    if ($PSVersionTable.PSVersion.Major -lt 7) { exit 1 }
    Write-Host "PWSH_ACTIONS_SHELL=PASS"
```

This is mandatory because legacy workflows use `shell: pwsh`; direct executable success alone is insufficient.

- [ ] **Step 4: Commit the diagnostic bootstrap change**

Expected commit scope is only the diagnostic workflow plus this spec/plan documentation. No production, trading, security allowlist, or Gitleaks file may change.

---

### Task 3: Exact-head GREEN capability acceptance

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: Task 2 workflow at the exact PR #10 head.
- Produces: fresh run/job evidence proving PowerShell 7 is usable by GitHub Actions on `XAUUSD-CORE-CI-WIN`.

- [ ] **Step 1: Let the PR trigger execute on the self-hosted runner**

Require non-empty steps and runner labels:

```text
self-hosted
Windows
X64
xauusd-core-ci
```

- [ ] **Step 2: Capture exact GREEN logs**

Acceptance requires:

```text
RUNNER_OS=Windows
RUNNER_ARCH=X64
RUNNER_NAME=XAUUSD-CORE-CI-WIN
POWERSHELL_51_VERSION=5.1.x
PWSH_FOUND=TRUE
PWSH_PATH=<actual executable path>
PWSH_VERSION=7.x-or-newer
PWSH_DIRECT_EXECUTION=PASS
PWSH_ACTIONS_SHELL=PASS
JOB_CONCLUSION=SUCCESS
```

- [ ] **Step 3: Fail closed on any bootstrap or shell-resolution failure**

Do not migrate hosted workflows while the diagnostic job is red. Do not replace PowerShell 7 with Windows PowerShell 5.1.

---

### Task 4: Preserve repository and production boundaries

**Files:**
- Review only.

**Interfaces:**
- Produces: verified diagnostic-only diff and handoff boundary.

- [ ] **Step 1: Verify PR #10 remains Draft and unmerged**
- [ ] **Step 2: Confirm no public allowlist, Gitleaks, trading logic, runtime, ARM, order, position, Scheduled Task, or production file changes**
- [ ] **Step 3: Stop modifying PR #10 once GREEN is captured**
- [ ] **Step 4: Create a separate TDD-backed branch/PR for the three remaining legacy hosted workflows only after Task 3 is GREEN**

The later migration scope is exactly:

```text
.github/workflows/phase7c-canonical-pr-gate.yml
.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml
.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml
```

The later migration must preserve both PowerShell 7 and Windows PowerShell 5.1 contract execution.