# Self-Hosted PowerShell 7 Capability Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove whether the canonical Windows self-hosted runner can execute PowerShell 7 before migrating legacy hosted Phase7C workflows.

**Architecture:** Add a temporary, read-only GitHub Actions workflow that targets the existing `xauusd-core-ci` self-hosted Windows runner. The workflow uses Windows PowerShell 5.1 only as the diagnostic shell to locate and invoke `pwsh`; it does not substitute PowerShell 5.1 for any PS7 acceptance gate and does not touch trading/runtime state.

**Tech Stack:** GitHub Actions, Windows self-hosted runner, Windows PowerShell 5.1, PowerShell 7 capability detection.

**Spec:** `docs/superpowers/specs/2026-09-15-public-private-repository-split-design.md`

## Global Constraints

- `PRODUCTION_MUTATION=NONE`.
- `BOT_RUNTIME_MUTATION=NONE`.
- `MODE_MUTATION=NONE`.
- `ARM_MUTATION=NONE`.
- `ORDER_MUTATION=NONE`.
- `POSITION_MUTATION=NONE`.
- `LIVE_TEST_ORDER=NONE`.
- `TRADING_LOGIC_MUTATION=NONE`.
- `RISK_LOGIC_MUTATION=NONE`.
- `ORDER_LOGIC_MUTATION=NONE`.
- Do not remove or weaken PowerShell 7 gates.
- Do not use Windows PowerShell 5.1 as a replacement for PowerShell 7 acceptance.
- Do not modify PR #9.

---

### Task 1: Probe actual runner capability

**Files:**
- Create: `.github/workflows/self-hosted-pwsh-capability-probe.yml`

**Interfaces:**
- Consumes: runner labels `[self-hosted, Windows, X64, xauusd-core-ci]`.
- Produces: explicit evidence `PWSH_FOUND`, `PWSH_PATH`, and `PWSH_VERSION` or a fail-closed `PWSH_FOUND=FALSE` result.

- [ ] **Step 1: Add a pull-request-triggered read-only probe workflow**
- [ ] **Step 2: Open a Draft PR against `main` to obtain a real self-hosted run**
- [ ] **Step 3: Capture exact job/run evidence and logs**
- [ ] **Step 4: If `pwsh` is absent, stop before migration and design/bootstrap PS7 separately**
- [ ] **Step 5: If `pwsh` is present, proceed to a separate TDD-backed migration plan for legacy hosted checks**

### Task 2: Preserve repository boundaries

- [ ] **Step 1: Confirm the probe workflow performs no checkout-dependent production action**
- [ ] **Step 2: Confirm no public allowlist, Gitleaks, trading logic, runtime, ARM, order, or position file changes**
- [ ] **Step 3: Keep the probe PR Draft and unmerged; it is diagnostic evidence only**
