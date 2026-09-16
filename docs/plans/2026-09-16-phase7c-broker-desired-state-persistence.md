# Phase7C Broker Desired Executor State Persistence Implementation Plan

> Scope: private source fix only. Production rollout is not authorized.

## Goal

Persist the lifecycle broker's operator-desired executor state across broker/Scheduled Task cold-starts without changing trading, risk, order, ARM, or AUTO logic.

## Safety invariants

- Production remains unchanged.
- Bot mode remains PAUSE during this source-only work.
- LIVE execution remains unarmed.
- Broker cold-start must enforce PAUSE before reading/restoring durable executor intent.
- Only durable `RUNNING` may restore executor supervision.
- Missing, corrupt, unsupported-version, or unknown desired-state data fails closed to `STOPPED`.
- Failed/rejected lifecycle requests must not persist a false successful intent.
- No production deploy, task repair, Scheduled Task hash update, ARM, AUTO, or live test order in this change.

## Files

- Modify: `scripts/test-phase7c-system-lifecycle-broker-source.ps1`
- Modify: `scripts/run-phase7c-executor-task-runner-local.ps1`

No trading-strategy files are in scope.

## Task 1 — TDD RED: durable-state source contract

Extend `scripts/test-phase7c-system-lifecycle-broker-source.ps1` so the current source fails for the missing behavior. Assertions must require:

1. A dedicated durable desired-state path under the lifecycle broker state directory.
2. Atomic durable persistence using the existing JSON atomic writer.
3. Closed state values: only `RUNNING` and `STOPPED` are accepted.
4. Missing/corrupt/unknown/unsupported durable state resolves to `STOPPED`.
5. Cold-start ordering is `Ensure-Phase7CBotPause` first, then durable intent restore.
6. Successful/NOOP START persists `RUNNING` before reporting the request successful/NOOP.
7. Successful/NOOP STOP persists `STOPPED` before reporting the request successful/NOOP.
8. Successful RESTART persists `RUNNING` before reporting success.
9. Rejected/failed START/RESTART paths do not persist `RUNNING`.
10. The existing recovery loop remains the executor restoration mechanism; no new launch subsystem is introduced.

Run the targeted source contract and capture an expected failure proving the test is exercising the missing durable-state behavior.

## Task 2 — Minimal implementation

In `scripts/run-phase7c-executor-task-runner-local.ps1`:

1. Add a durable desired-state file under `phase7c-lifecycle-broker/state`.
2. Add one validated reader that returns only `RUNNING` or `STOPPED`, failing closed to `STOPPED` for missing/corrupt/invalid data.
3. Add one validated atomic writer for `RUNNING`/`STOPPED`.
4. On successful/idempotent STOP, atomically persist `STOPPED`, then update in-memory state and complete the request.
5. On successful/idempotent START, atomically persist `RUNNING`, then update in-memory state and complete the request.
6. On successful RESTART, atomically persist `RUNNING`, then update in-memory state and complete the request.
7. Do not persist success intent from rejected/failed actions.
8. Cold-start sequence: enforce PAUSE first; then read durable desired state; assign the validated result to in-memory `desiredExecutorState`; publish broker status/heartbeat. Existing `Recover-SupervisorIfNeeded` performs restoration when the value is `RUNNING`.

## Task 3 — Targeted GREEN and regressions

Run:

- `scripts/test-phase7c-system-lifecycle-broker-source.ps1` under PowerShell 7.
- The same contract under Windows PowerShell 5.1.
- `scripts/test-phase7c-system-lifecycle-broker-contract.ps1` under both shells.
- PowerShell parse check for `scripts/run-phase7c-executor-task-runner-local.ps1`.

All must pass.

## Task 4 — Private/self-hosted CI and review

Run the existing private `Private Master Core Self-Hosted CI` at the exact branch head. This workflow is test/build-only and must retain `M7_PRODUCTION_CUTOVER=NOT_PERFORMED`.

Review `main...fix/phase7c-broker-desired-state-persistence` and confirm only the plan, lifecycle source contract, and lifecycle broker runner changed. Confirm no trading/risk/order/ARM/AUTO source is modified.

## Task 5 — PR and merge gate

Open PR to private `main` only after targeted GREEN and diff review.

Require relevant PR checks, including canonical lifecycle contracts and private self-hosted CI, to pass. Merge only when all required acceptance evidence is green.

After merge, stop. Do not deploy production. The runner file hash changes, so a later production rollout requires a separately authorized canonical task/recovery/hash gate with PAUSE + DISARMED + FLAT.
