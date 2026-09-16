# M8 Private Master Production Cutover Plan

## Scope

Move the production Phase7C runtime source boundary to the canonical private repository only after source, runtime, and safety evidence are all proven. This plan does not change trading strategy logic, risk logic, bot mode semantics, account mode, or ARM semantics.

## Non-negotiable invariants

```text
PRODUCTION_MUTATION=NONE during preflight
BOT_RUNTIME_MUTATION=NONE during preflight
TRADING_LOGIC_MUTATION=NONE
MODE_MUTATION=NONE during preflight
ARM_MUTATION=NONE during preflight
ORDER_MUTATION=NONE
POSITION_MUTATION=NONE
LIVE_TEST_ORDER=NONE
HTTP_METHODS=GET_ONLY during preflight
```

The cutover itself is a separate, explicit production mutation and MUST NOT run unless every preflight gate below is PASS.

## Canonical source and runtime contracts

Canonical private repository:

```text
thiennguyen3004931-sudo/xauusd-ai-master-core
```

Accepted M7 baseline merge:

```text
144c123dd7905a4c52522435747572448d798d84
```

Canonical runtime-source attestation:

```text
scripts/lib/phase7c-runtime-source-attestation.ps1
```

Canonical production recovery/deploy path:

```text
scripts/recover-phase7c-runtime-ready-stable-deploy-local.ps1
```

Canonical guarded LIVE account switch remains separate from this source cutover:

```text
scripts/switch-phase7c-live-guarded-local.ps1
```

M8 MUST NOT invoke the guarded LIVE account switch merely to perform a source cutover. Account-mode switching requires its own explicit approval and confirmation boundary.

## Phase 1 — source-complete gate

Target source MUST satisfy all of the following before production mutation:

```text
ORIGIN=canonical private repository
BRANCH=main
HEAD=exact approved 40-char SHA
TREE=exact approved tree SHA when supplied
WORKTREE=CLEAN
M7_ACCEPTED_BASELINE=PASS
```

The M8 preflight fails closed if any condition is missing or mismatched.

## Phase 2 — current production runtime coherence

Before changing production source, the currently running runtime generation MUST be internally coherent.

The canonical deployment manifest is read from:

```text
.runtime/phase7c-source-attestation/deployment.json
```

All canonical runtime component attestations MUST match the same deployment identity:

```text
api
lifecycle-broker
supervisor
trend
sideway
telegram
regime-notifier
```

For every component, the canonical runtime-source library must prove the same:

```text
deploymentId
sourceCommit
sourceTree
```

Required verdict:

```text
CURRENT_RUNTIME_COMPONENT_ATTESTATION=EXACT
CURRENT_RUNTIME_SOURCE_COHERENCE=PASS
```

A missing or stale component attestation blocks cutover. M8 does not repair or synthesize evidence.

## Phase 3 — production safety gate

The read-only M8 preflight MUST prove:

```text
BOT_MODE=PAUSE
LIVE_EXECUTION_ARMED=FALSE
LIFECYCLE_RUNNING=TRUE
LIFECYCLE_READY=TRUE
MT5_BRIDGE_HEALTH=PASS
XAUUSD_POSITIONS=0
XAUUSD_PENDING_ORDERS=0
```

If account mode is LIVE, canonical ARM state MUST be DISARMED.

No test order is allowed to create evidence.

## Phase 4 — run read-only M8 preflight

Run from canonical private `main` after the exact approved candidate has been merged and checked out locally:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\security\preflight-private-cutover.ps1 `
  -ExpectedCommit <APPROVED_PRIVATE_MAIN_SHA> `
  -ExpectedTree <APPROVED_PRIVATE_MAIN_TREE>
```

Expected terminal verdicts:

```text
READ_ONLY=TRUE
HTTP_METHODS=GET_ONLY
GIT_MUTATION=NONE
TASK_MUTATION=NONE
PROCESS_MUTATION=NONE
MODE_MUTATION=NONE
ARM_MUTATION=NONE
ORDER_MUTATION=NONE
POSITION_MUTATION=NONE
LIVE_TEST_ORDER=NONE
TARGET_SOURCE_VERIFIED=PASS
CURRENT_RUNTIME_SOURCE_COHERENCE=PASS
RUNTIME_SAFETY_STATE=PASS
CUTOVER_READY=TRUE
PRODUCTION_CUTOVER=NOT_PERFORMED
M8_PRIVATE_CUTOVER_PREFLIGHT=PASS
```

`TARGET_ALREADY_RUNNING=FALSE` is allowed before the source cutover. It means the candidate source is verified but production is still on the previous coherent runtime generation.

`TARGET_ALREADY_RUNNING=TRUE` means no source cutover is required; proceed only to post-cutover verification.

## Phase 5 — explicit production cutover

This phase is forbidden until:

```text
M8_PRIVATE_CUTOVER_PREFLIGHT=PASS
CUTOVER_READY=TRUE
```

The approved exact private-main commit becomes the canonical expected source for the existing guarded recovery/deploy path:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\recover-phase7c-runtime-ready-stable-deploy-local.ps1 `
  -ExpectedCommit <APPROVED_PRIVATE_MAIN_SHA>
```

This is the first production-mutating step in M8. It must be executed only under an explicit cutover decision.

Do not ARM. Do not change PAUSE. Do not create a test order.

## Phase 6 — mandatory post-cutover proof

After the canonical deploy/recovery completes, production is not accepted until fresh evidence proves all of the following:

```text
RUNTIME_SOURCE_COMMIT=<APPROVED_PRIVATE_MAIN_SHA>
RUNTIME_SOURCE_TREE=<APPROVED_PRIVATE_MAIN_TREE>
RUNTIME_COMPONENT_ATTESTATION=EXACT
BOT_MODE=PAUSE
LIVE_EXECUTION_ARMED=FALSE
XAUUSD_POSITIONS=0
XAUUSD_PENDING_ORDERS=0
```

The running source must therefore equal the merged and approved private source by both commit and tree, not merely by branch name or deployment timestamp.

Required acceptance state:

```text
PRIVATE_SOURCE=MERGED_APPROVED
RUNNING_SOURCE=EXACT_PRIVATE_SOURCE
SOURCE_EQUIVALENCE=PASS
POST_CUTOVER_SAFETY=PASS
M8_PRODUCTION_CUTOVER=PASS
```

## Failure and rollback rules

### Preflight failure

If any read-only preflight gate fails:

```text
CUTOVER_READY=FALSE
PRODUCTION_CUTOVER=NOT_PERFORMED
```

Stop. Diagnose only. Do not repair production merely to force M8 green.

### Cutover failure before exact target attestation

Use the canonical runtime recovery path and the previously recorded production deployment identity. Preserve:

```text
PAUSE
DISARMED
FLAT XAUUSD
```

Do not resume AUTO/TREND/SIDEWAY merely because services recover.

### Partial or mixed source generation

If any component attestation does not match the target deployment identity, source equivalence is failed:

```text
SOURCE_EQUIVALENCE=FAIL
M8_PRODUCTION_CUTOVER=FAIL
```

The runtime must remain PAUSE/DISARMED while canonical recovery converges the generation. Never accept a mixed generation.

## Completion definition

M8 is complete only when all of the following are proven with fresh evidence:

```text
PRIVATE_MAIN=exact approved merged commit
PRIVATE_TREE=exact approved tree
CURRENT/RUNNING_DEPLOYMENT=target private commit/tree
ALL_7_COMPONENT_ATTESTATIONS=EXACT
BOT_MODE=PAUSE
LIVE_EXECUTION_ARMED=FALSE
XAUUSD_POSITIONS=0
XAUUSD_PENDING_ORDERS=0
SOURCE_EQUIVALENCE=PASS
PRODUCTION_CUTOVER=PASS
```

M8 completion does not authorize ARM or trading. ARM remains a separate explicit production decision.
