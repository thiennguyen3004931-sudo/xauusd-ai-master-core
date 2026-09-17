# Private Legacy CI Self-Hosted Migration Design

## Purpose

Migrate the three remaining private Phase7C workflows away from GitHub-hosted runners to the already-proven canonical Windows self-hosted runner without weakening their tests, shells, or safety contracts.

## Proven prerequisite

PowerShell 7 capability was proven on the target runner before this migration:

```text
RUNNER=XAUUSD-CORE-CI-WIN
RUNNER_VERSION=2.337.0
POWERSHELL_51_VERSION=5.1.26100.9444
PWSH_VERSION=7.6.6
PWSH_DIRECT_EXECUTION=PASS
PWSH_ACTIONS_SHELL=PASS
PROBE_RUN=35186137537
PROBE_JOB=105088493138
PROBE_CONCLUSION=SUCCESS
```

## Migration scope

Exactly these workflows are in scope:

```text
.github/workflows/phase7c-canonical-pr-gate.yml
.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml
.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml
```

All jobs in those workflows migrate to:

```yaml
runs-on: [self-hosted, Windows, X64, xauusd-core-ci]
```

Former Linux Node/build jobs remain logically identical; their pnpm, node, git and action steps execute on Windows. Existing PowerShell contract jobs continue to execute both `shell: pwsh` and `shell: powershell` where currently specified.

## Non-goals

This migration does not:

- change trading, risk, order, FastMove, M5, SEMI, Trend, Sideway, ARM, AUTO, lifecycle, account, task, process, position, or production behavior;
- alter test commands or expected trading semantics;
- remove PowerShell 7 coverage;
- replace PowerShell 7 with Windows PowerShell 5.1;
- change Gitleaks or repository allowlists;
- modify PR #9, PR #7, or PR #10;
- revive PR #8;
- merge automatically.

## TDD contract

Before changing any `runs-on`, add a static migration contract that fails on the current hosted topology. The RED contract must prove at least one in-scope workflow still contains `ubuntu-latest` or `windows-latest`.

GREEN requires all three workflow files to satisfy all of the following:

1. no `ubuntu-latest` remains;
2. no `windows-latest` remains;
3. every existing job targets `[self-hosted, Windows, X64, xauusd-core-ci]`;
4. existing job identifiers remain present;
5. existing critical command strings remain present;
6. dual-shell Windows contracts retain both `shell: pwsh` and `shell: powershell`;
7. canonical PR gate remains present and continues to run its Linux-originated Node/build regression content, now on Windows self-hosted infrastructure.

The new migration contract is wired into `Private Master Core Self-Hosted CI` so RED/GREEN evidence runs on the canonical self-hosted acceptance path.

## Safety invariants

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
PR10_MUTATION=NONE
PR8_REVIVAL=FALSE
```

## Acceptance

Acceptance requires a fresh exact-head run of `Private Master Core Self-Hosted CI` with the migration contract GREEN plus successful execution of the migrated workflow jobs on `XAUUSD-CORE-CI-WIN`. Hosted-runner acquisition failures are not accepted as source evidence. No merge occurs while required project acceptance remains red.