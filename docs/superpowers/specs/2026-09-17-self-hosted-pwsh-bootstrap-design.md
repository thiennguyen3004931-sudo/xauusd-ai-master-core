# Self-Hosted PowerShell 7 Bootstrap Design

## Status and purpose

This design bootstraps PowerShell 7 on the dedicated private Windows self-hosted GitHub Actions runner only after the diagnostic probe proved that `pwsh` is absent. It exists solely to satisfy the existing dual-shell CI contract before any migration of legacy GitHub-hosted Phase7C workflows.

Accepted diagnostic evidence before this design:

```text
PR=10
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

## Scope

In scope:

- the existing diagnostic branch `diag/self-hosted-pwsh-capability` and Draft PR #10;
- installation of the official `Microsoft.PowerShell` package through the already-proven `winget` capability;
- adding the installed PowerShell 7 directory to later GitHub Actions steps through `GITHUB_PATH`;
- direct executable verification of PowerShell 7;
- a real GitHub Actions `shell: pwsh` step proving runner shell resolution;
- exact run/job evidence capture;
- keeping PR #10 Draft and unmerged because it is infrastructure diagnostics/bootstrap only.

Out of scope:

- production runtime or bot host changes;
- trading, risk, order, FastMove, M5, SEMI, Trend, Sideway, ARM, AUTO, mode, account, task, process, order, or position behavior;
- public repository allowlist changes;
- Gitleaks changes;
- migration of legacy hosted workflows in this PR;
- removal or weakening of PowerShell 7 checks;
- using Windows PowerShell 5.1 as a substitute for PowerShell 7 acceptance;
- merging PR #9 or PR #7.

## Chosen bootstrap architecture

The diagnostic workflow continues to execute first under built-in Windows PowerShell 5.1 because `pwsh` cannot be selected before it exists.

Bootstrap sequence:

```text
self-hosted Windows runner
  -> identify runner + Windows PowerShell 5.1
  -> locate existing pwsh
  -> if absent: require winget
  -> winget install --id Microsoft.PowerShell --exact
  -> require C:\Program Files\PowerShell\7\pwsh.exe
  -> append C:\Program Files\PowerShell\7 to GITHUB_PATH
  -> invoke pwsh.exe directly and require major version >= 7
  -> next workflow step uses shell: pwsh
  -> require PWSH_ACTIONS_SHELL=PASS
```

The workflow is guarded to the diagnostic PR branch so future unrelated pull requests do not mutate the runner by attempting package installation.

## Fail-closed rules

The bootstrap fails immediately if any of these conditions occurs:

- `winget` is absent when `pwsh` is absent;
- the package install command returns a non-zero exit code;
- the canonical PowerShell 7 executable path does not exist after installation;
- direct execution of the installed executable fails;
- the installed major version is below 7;
- a subsequent GitHub Actions `shell: pwsh` step cannot start or reports a version below 7.

No fallback to Windows PowerShell 5.1 is permitted for PowerShell 7 acceptance.

## Workflow safety boundary

The bootstrap workflow does not checkout repository source and does not execute trading/runtime scripts. It only inspects runner identity, installs/verifies the PowerShell runtime, and emits capability evidence.

Required invariants:

```text
PRODUCTION_MUTATION=NONE
BOT_RUNTIME_MUTATION=NONE
MODE_MUTATION=NONE
ARM_MUTATION=NONE
TASK_MUTATION=NONE
PROCESS_MUTATION=NONE
ORDER_MUTATION=NONE
POSITION_MUTATION=NONE
LIVE_TEST_ORDER=NONE
TRADING_LOGIC_MUTATION=NONE
RISK_LOGIC_MUTATION=NONE
ORDER_LOGIC_MUTATION=NONE
ALLOWLIST_MUTATION=NONE
GITLEAKS_MUTATION=NONE
PS7_GATE_REMOVED=FALSE
PS5_FALLBACK_USED_TO_BYPASS_PS7=FALSE
PR9_MUTATION=NONE
PR7_MUTATION=NONE
```

The runner software installation is the only authorized infrastructure mutation in this design.

## Acceptance

Bootstrap capability is accepted only from a fresh self-hosted run on `XAUUSD-CORE-CI-WIN` with non-empty executed steps and all of the following evidence:

```text
RUNNER_OS=Windows
RUNNER_ARCH=X64
RUNNER_NAME=XAUUSD-CORE-CI-WIN
POWERSHELL_51_VERSION=5.1.x
PWSH_FOUND=TRUE
PWSH_PATH=<actual executable path>
PWSH_VERSION=7.x-or-newer
PWSH_ACTIONS_SHELL=PASS
JOB_CONCLUSION=SUCCESS
```

A successful direct executable probe without a successful `shell: pwsh` step is insufficient because legacy workflows rely on GitHub Actions shell resolution.

## Post-acceptance boundary

After the capability probe passes, stop modifying PR #10. Keep it Draft and unmerged. Legacy hosted workflow migration proceeds only in a separate branch/PR with its own TDD plan and exact-head acceptance.