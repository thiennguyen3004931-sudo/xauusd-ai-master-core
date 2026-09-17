# Private Legacy CI Self-Hosted Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three remaining private Phase7C workflows from GitHub-hosted runners to the proven Windows self-hosted runner while preserving all existing test commands and dual PowerShell shell coverage.

**Architecture:** Add a static fail-closed topology/command-retention contract and wire it into the canonical private self-hosted CI. Capture RED on the unchanged hosted topology, then change only the `runs-on` lines in the three scoped workflows and require exact-head GREEN from both the canonical private CI and the migrated workflows.

**Tech Stack:** GitHub Actions, Windows self-hosted runner, Node 24, pnpm 10.18.0, PowerShell 7.6.6, Windows PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-09-17-private-self-hosted-legacy-ci-migration-design.md`

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
- `PS7_GATE_REMOVED=FALSE`.
- `PS5_FALLBACK_USED_TO_BYPASS_PS7=FALSE`.
- Do not modify or merge PR #9, PR #7, or PR #10.
- Do not revive PR #8.
- Do not merge this migration until exact-head acceptance is GREEN.

---

### Task 1: RED migration contract

**Files:**
- Create: `scripts/security/private-legacy-workflow-self-hosted-migration.test.mjs`
- Modify: `.github/workflows/private-master-core-ci.yml`

**Interfaces:**
- Consumes the three in-scope workflow YAML files as UTF-8 text.
- Produces a fail-closed static verdict that hosted runner labels are absent, expected self-hosted job counts are present, dual-shell coverage remains, and critical command strings remain.

- [ ] **Step 1: Add the failing static migration contract**

Require these exact workflow job counts after migration:

```text
phase7c-canonical-pr-gate.yml = 2 self-hosted jobs
phase7c-live-arm-orphan-reconciliation-ci.yml = 3 self-hosted jobs
phase7c-web-live-arm-demo-auto-ci.yml = 2 self-hosted jobs
```

The test must fail on current `main` because the files still contain `ubuntu-latest` and `windows-latest`.

- [ ] **Step 2: Wire the test into canonical private CI**

Add immediately after the static private CI contract:

```yaml
- name: Legacy workflow self-hosted migration contract
  run: node --test scripts/security/private-legacy-workflow-self-hosted-migration.test.mjs
```

- [ ] **Step 3: Open a Draft PR against `main` and capture exact RED evidence**

Expected RED reason:

```text
RED_TARGET: hosted runner label remains
```

Do not modify `runs-on` until a real self-hosted RED run is captured.

---

### Task 2: Minimal GREEN topology migration

**Files:**
- Modify: `.github/workflows/phase7c-canonical-pr-gate.yml`
- Modify: `.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml`
- Modify: `.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml`

**Interfaces:**
- Consumes the proven runner labels `[self-hosted, Windows, X64, xauusd-core-ci]` and installed PowerShell 7.6.6 capability.
- Produces the same workflow tests/builds on self-hosted Windows infrastructure.

- [ ] **Step 1: Replace only hosted runner labels**

For every job in the three workflow files, replace `ubuntu-latest` or `windows-latest` with:

```yaml
runs-on: [self-hosted, Windows, X64, xauusd-core-ci]
```

Do not alter job identifiers, step names, commands, PowerShell shell declarations, Node version, pnpm version, timeouts, permissions, or triggers.

- [ ] **Step 2: Verify the static migration contract becomes GREEN**

Expected:

```text
HOSTED_RUNNER_LABELS=0
SELF_HOSTED_JOB_COUNT=7
PWSH_COVERAGE=PRESERVED
POWERSHELL_51_COVERAGE=PRESERVED
```

- [ ] **Step 3: Review the diff**

The three legacy workflow files may only have `runs-on` changes. The only other changes in the PR are the migration spec, plan, static contract, and one new canonical private CI contract step.

---

### Task 3: Exact-head execution acceptance

**Files:**
- Review only.

**Interfaces:**
- Produces exact run/job evidence from the final PR head.

- [ ] **Step 1: Require `Private Master Core Self-Hosted CI` success**
- [ ] **Step 2: Require all migrated Canonical PR Gate jobs to execute on self-hosted and succeed**
- [ ] **Step 3: Require all migrated LIVE Arm Orphan Reconciliation jobs to execute on self-hosted and succeed**
- [ ] **Step 4: Require all migrated Web LIVE Arm + DEMO Auto jobs to execute on self-hosted and succeed**
- [ ] **Step 5: Confirm no production/trading/runtime mutation and keep PR unmerged until all project acceptance conditions are satisfied**

Any source/test failure is investigated as a real regression; no gate is removed, skipped, or marked `continue-on-error` to force GREEN.