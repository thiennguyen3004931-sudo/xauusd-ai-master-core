# Legacy Phase7C Self-Hosted Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three remaining legacy Phase7C workflows from GitHub-hosted runners to the proven private Windows self-hosted runner without changing any acceptance logic.

**Architecture:** Preserve every existing job name, trigger, step, command, timeout, shell contract, and security gate. Change only the `runs-on` selectors to `[self-hosted, Windows, X64, xauusd-core-ci]`, then require exact-head GREEN evidence from real self-hosted execution.

**Tech Stack:** GitHub Actions, Windows self-hosted runner, PowerShell 7.6.6, Windows PowerShell 5.1, Node.js 24, pnpm 10.18.0, Python 3.12.

**Spec:** `docs/superpowers/specs/2026-09-17-legacy-phase7c-self-hosted-migration-design.md`

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
- `WORKFLOW_SECURITY_DOWNGRADE=NONE`.
- `PS7_GATE_REMOVED=FALSE`.
- `PS5_FALLBACK_USED_TO_BYPASS_PS7=FALSE`.
- Do not modify PR #9, PR #7, or merge PR #10.

---

### Task 1: Capture RED hosted-runner evidence

**Files:**
- Existing: `.github/workflows/phase7c-canonical-pr-gate.yml`
- Existing: `.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml`
- Existing: `.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml`

**Interfaces:**
- Consumes: existing `ubuntu-latest` / `windows-latest` runner selectors.
- Produces: exact RED run/job evidence showing pre-step hosted-runner failure.

- [ ] **Step 1: Open a Draft PR from `ci/migrate-legacy-phase7c-self-hosted` to `main` before runner-selector changes.**
- [ ] **Step 2: Capture the three legacy workflow run IDs and job IDs.**
- [ ] **Step 3: Verify failures occur before substantive workflow steps execute.**

### Task 2: Apply minimal runner-selector migration

**Files:**
- Modify: `.github/workflows/phase7c-canonical-pr-gate.yml`
- Modify: `.github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml`
- Modify: `.github/workflows/phase7c-web-live-arm-demo-auto-ci.yml`

**Interfaces:**
- Consumes: proven runner labels `[self-hosted, Windows, X64, xauusd-core-ci]` and PS7 capability `7.6.6`.
- Produces: identical jobs executed on the private self-hosted Windows runner.

- [ ] **Step 1: Replace every `runs-on: ubuntu-latest` with `runs-on: [self-hosted, Windows, X64, xauusd-core-ci]`.**
- [ ] **Step 2: Replace every `runs-on: windows-latest` with `runs-on: [self-hosted, Windows, X64, xauusd-core-ci]`.**
- [ ] **Step 3: Preserve every `shell: pwsh` and `shell: powershell` step unchanged.**
- [ ] **Step 4: Preserve all build/test/source-contract commands and job/check names unchanged.**
- [ ] **Step 5: Commit only the three workflow migrations.**

### Task 3: Capture exact-head GREEN evidence

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: migrated workflow head.
- Produces: run/job logs proving all legacy gates execute on `XAUUSD-CORE-CI-WIN`.

- [ ] **Step 1: Require runner labels `self-hosted`, `Windows`, `X64`, `xauusd-core-ci` on each migrated job.**
- [ ] **Step 2: Require non-empty executed steps for all jobs.**
- [ ] **Step 3: Require both PowerShell 7 and Windows PowerShell 5.1 source contracts to pass wherever both existed before migration.**
- [ ] **Step 4: Require Linux-origin Node/build jobs to pass on the self-hosted Windows runner without deleting or weakening commands.**
- [ ] **Step 5: Require canonical private self-hosted CI to pass at the same exact head.**

### Task 4: Review diff and hold merge

**Files:**
- Review only.

**Interfaces:**
- Produces: migration acceptance checkpoint.

- [ ] **Step 1: Verify migration diff changes only runner selectors plus this spec/plan documentation.**
- [ ] **Step 2: Verify no `continue-on-error`, skipped gate, deleted test, shell downgrade, public allowlist, Gitleaks, trading/runtime, ARM, order, or position mutation.**
- [ ] **Step 3: Keep the migration PR Draft/unmerged until exact-head GREEN evidence is complete.**
- [ ] **Step 4: After GREEN, update/rebase PR #9 separately so it can consume the new main topology before any merge decision.**
