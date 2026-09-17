# Legacy Phase7C Self-Hosted Migration Design

## Purpose

Migrate the three remaining legacy Phase7C GitHub Actions workflows from GitHub-hosted runners to the already-proven private Windows self-hosted runner without weakening any test, shell, security, or trading-safety contract.

## Proven prerequisite

PowerShell 7 capability was proven on the canonical runner before this migration:

```text
PROBE_PR=10
PROBE_HEAD=f229162fe05c8b56ae14a897006226ec53fa036c
PROBE_RUN=35186137537
PROBE_JOB=105088493138
RUNNER=XAUUSD-CORE-CI-WIN
RUNNER_VERSION=2.337.0
POWERSHELL_51_VERSION=5.1.26100.9444
PWSH_FOUND=TRUE
PWSH_VERSION=7.6.6
PWSH_DIRECT_EXECUTION=PASS
PWSH_ACTIONS_SHELL=PASS
JOB_CONCLUSION=SUCCESS
```

## Exact migration scope

Only these workflow files may change for runner migration:

```text
.github/workflows/phase7c-canonical-pr-gate.yml
.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml
.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml
```

The migration branch is:

```text
ci/migrate-legacy-phase7c-self-hosted
```

Base commit:

```text
62e93ce5545195dd6bf78570c9b5fc0f4b253399
```

## Chosen architecture

Replace every GitHub-hosted runner selector in the three workflows with the existing canonical runner labels:

```yaml
runs-on: [self-hosted, Windows, X64, xauusd-core-ci]
```

Preserve:

- workflow names;
- job identifiers;
- job display names/check names;
- triggers;
- permissions;
- timeouts;
- checkout steps;
- Node, pnpm, Python setup;
- every build/test/source-contract command;
- every `shell: pwsh` step;
- every `shell: powershell` step;
- diff hygiene and pruning gates.

No step may be deleted, skipped, weakened, or changed to `continue-on-error` to obtain GREEN.

## TDD acceptance sequence

### RED

Open the migration PR before changing runner selectors. The three legacy workflows are expected to retain GitHub-hosted selectors and therefore reproduce the current pre-step hosted-runner failure. Capture exact run/job evidence and verify no substantive test step executed.

### GREEN

Apply only the runner-selector migration. A fresh exact-head PR run must assign the canonical self-hosted runner and execute real steps. Each migrated workflow must complete successfully, or any source/build/test failure must be fixed without weakening the existing contract.

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
WORKFLOW_SECURITY_DOWNGRADE=NONE
PS7_GATE_REMOVED=FALSE
PS5_FALLBACK_USED_TO_BYPASS_PS7=FALSE
PR9_MUTATION=NONE
PR7_MUTATION=NONE
PR10_MERGE=NONE
```

## Merge boundary

This migration PR remains unmerged until exact-head GREEN evidence is captured for all three migrated workflows plus the canonical private self-hosted CI. PR #9 and PR #7 are not modified as part of this migration.