# M3 Self-Hosted Private CI Design

## 1. Status and purpose

This design refines M3 from the approved Public / Private Repository Split so private CI can execute on `thiennguyen3004931-sudo/xauusd-ai-master-core` without depending on GitHub-hosted runner minutes.

Current blocker: GitHub Actions workflow runs are created for the private repository, but jobs terminate before any step executes (`steps=[]`). Therefore CI source correctness is not the proven failure; runner execution itself is not happening.

This design adds one repository-level Windows self-hosted runner and one canonical private Master/Core workflow. It is source/CI infrastructure only and does not authorize production rollout or trading-runtime mutation.

## 2. Relationship to the existing repository-split plan

The existing split plan already defines M3 Task 5 with these canonical responsibilities:

- `scripts/security/check-private-secrets.mjs`;
- `scripts/security/check-private-secrets.test.mjs`;
- `.github/workflows/private-master-core-ci.yml`;
- provenance verification;
- tracked-secret verification;
- build and regression verification.

This design does not replace or weaken those requirements. It adds the missing runner architecture needed for those checks to execute after GitHub-hosted minutes became unavailable.

Two status levels are therefore distinguished:

```text
SELF_HOSTED_CI_INFRA=PASS
```

means the private workflow is actually assigned to the self-hosted runner and executes real steps.

```text
M3_PRIVATE_CI=GREEN
```

requires the broader existing M3 contract as well: provenance, tracked-secret boundary, build, and accepted regression gates all pass. A green runner alone is not M3 completion.

## 3. Scope

### In scope

- repository-level self-hosted GitHub Actions runner for the private repository;
- Windows x64 development workstation as the runner host;
- dedicated runner label `xauusd-core-ci`;
- canonical workflow `.github/workflows/private-master-core-ci.yml`;
- static contract test for the workflow;
- exact dependency installation from the committed lockfile;
- workspace build;
- Phase7C targeted ownership/lifecycle regression;
- Telegram lifecycle regression;
- private bootstrap provenance verification when the M2 attestation files are present;
- tracked-secret boundary implementation and verification from the existing split plan;
- diff hygiene and exact-head evidence;
- documentation for runner registration, service lifecycle, verification, and safe removal.

### Out of scope

- production deployment or rollout;
- MT5 login/account changes;
- bot mode, ARM, task, process, order, or position mutation;
- LIVE test orders;
- migration of every legacy workflow to self-hosted;
- weakening or deleting unrelated failing tests;
- changing trading strategy, +6/+10, FastMove, M5, SEMI, Trend, Sideway, or risk behavior;
- storing production credentials, signing keys, MT5 secrets, Telegram secrets, or customer secrets on the runner for CI convenience.

## 4. Chosen architecture

```text
PRIVATE REPOSITORY
      |
      v
.github/workflows/private-master-core-ci.yml
      |
      | runs-on:
      |   self-hosted
      |   Windows
      |   X64
      |   xauusd-core-ci
      v
Dedicated Windows development runner
      |
      +--> checkout exact head
      +--> Node 24
      +--> pnpm 10.18.0
      +--> frozen install
      +--> provenance / tracked-secret gates
      +--> workspace build
      +--> scoped Phase7C regressions
      +--> broader M3 regression gate
      +--> diff hygiene
```

The runner is repository-scoped, not organization-scoped. It is installed on a development workstation, not on the production bot host.

## 5. Runner host contract

Required labels:

```text
self-hosted
Windows
X64
xauusd-core-ci
```

Registration requirements:

- register only against `thiennguyen3004931-sudo/xauusd-ai-master-core`;
- obtain the registration token interactively from GitHub; never commit or paste it into repository files;
- keep runner binaries and `_work` outside the repository worktree;
- first verify interactively, then optionally install the runner as a Windows service;
- service account must not have MT5 trading credentials, production deployment credentials, signing keys, Telegram bot secrets, or customer secrets;
- no `.env` or production config is copied into the runner directory;
- removing the runner must not affect bot runtime.

## 6. Canonical workflow contract

Canonical path:

```text
.github/workflows/private-master-core-ci.yml
```

Required runner selector:

```yaml
runs-on: [self-hosted, Windows, X64, xauusd-core-ci]
```

Required permissions:

```yaml
permissions:
  contents: read
```

No deployment environment, repository secret, production credential, signing key, or write permission is permitted in this first M3 workflow.

The workflow execution order is:

1. checkout exact PR/head with full history where provenance comparison requires it;
2. print only non-sensitive runner OS/architecture/name metadata;
3. setup Node.js 24;
4. setup pnpm 10.18.0;
5. `pnpm install --frozen-lockfile`;
6. run the static workflow contract test;
7. run tracked-secret tests and tracked-secret scan;
8. run private bootstrap attestation verification when M2 files are present; if the required M2 verifier/attestation is absent, the final M3 verdict must remain blocked rather than being silently skipped;
9. `pnpm build`;
10. run `scripts/test-phase7c-telegram-entry-resolution-lifecycle-contract.mjs`;
11. run Telegram regression suite:
    - `scripts/test-phase7c-telegram-lifecycle-observability-contract.mjs`;
    - `scripts/phase7c-trade-notifier-synthetic.test.mjs`;
    - `scripts/test-phase7c-hold-telegram-dedupe-contract.mjs`;
12. run the broader accepted private regression gate required by the repository-split M3 plan;
13. `git diff --check`;
14. verify no unexpected tracked worktree mutation remains.

## 7. Known baseline failures and gate semantics

Two unrelated baseline defects were proven while verifying PR #1:

- after a successful workspace build, root `pnpm test` currently reaches `@xauusd/signal-engine` and fails two existing `SignalPipeline` expectations (`WAIT` versus BUY/SELL);
- root `pnpm lint` currently fails because `apps/web/.ignored_node_modules` is tracked and ESLint traverses a TanStack package-local ESLint config that imports `@tanstack/eslint-config`.

These defects are not caused by the Phase7C ownership fix and are not fixed in this M3 runner change.

They must not be hidden or converted to ignored successes. The workflow may use the already accepted scoped Phase7C/Telegram regressions to prove runner execution during bring-up, but `M3_PRIVATE_CI=GREEN` cannot be claimed until the broader M3 regression contract is either green or the repository-split plan is explicitly revised in a separate approved change.

## 8. Tracked-secret boundary

The existing M3 plan requires:

```text
scripts/security/check-private-secrets.mjs
scripts/security/check-private-secrets.test.mjs
```

The test is written RED first. The implementation must reject tracked private-key/credential material by path and approved content signatures without printing secret values.

Minimum workflow commands:

```powershell
node --test scripts/security/check-private-secrets.test.mjs
node scripts/security/check-private-secrets.mjs --tracked
```

The runner workflow must not dump environment variables or secret-bearing files.

## 9. Provenance dependency

M3 depends on M2 bootstrap provenance. The existing split plan requires:

```text
security/private-bootstrap-attestation.json
scripts/security/verify-private-bootstrap.mjs
scripts/security/verify-private-bootstrap.test.mjs
```

If these files are not yet accepted, the self-hosted runner can still be brought online and can prove `SELF_HOSTED_CI_INFRA=PASS`, but `M3_PRIVATE_CI=GREEN` remains blocked.

Once present, the canonical workflow must run:

```powershell
node scripts/security/verify-private-bootstrap.mjs security/private-bootstrap-attestation.json
```

and fail closed on any provenance mismatch.

## 10. TDD / contract-first implementation

Create:

```text
scripts/security/private-master-core-ci-contract.test.mjs
```

before creating the workflow. The RED test must require:

- `.github/workflows/private-master-core-ci.yml` exists;
- `runs-on` contains `self-hosted`, `Windows`, `X64`, `xauusd-core-ci`;
- `contents: read` is present;
- Node is exactly 24;
- pnpm is exactly 10.18.0;
- install is exactly `pnpm install --frozen-lockfile`;
- tracked-secret gate is invoked;
- private bootstrap verifier is represented as a mandatory final-M3 dependency;
- `pnpm build` is invoked;
- Phase7C targeted contract is invoked;
- all three Telegram regression files are invoked;
- `git diff --check` is invoked;
- GitHub-hosted labels such as `ubuntu-latest`, `windows-latest`, and `macos-latest` are absent;
- production mutation commands and secret injection are absent.

Implementation sequence:

```text
RED static contract
-> minimal self-hosted workflow
-> GREEN static contract
-> register runner
-> actual GitHub job with non-empty steps
-> scoped CI evidence
-> broader M3 gates
```

## 11. Trigger strategy

The workflow uses these exact triggers:

- `pull_request` targeting `main`;
- `push` to `feat/m3-self-hosted-private-ci` during bring-up;
- `workflow_dispatch` for operator verification after the workflow exists on the default branch.

No public-repository or fork trigger is configured.

## 12. Security model

A self-hosted runner executes repository code on its host. Therefore:

- only trusted changes in this private repository may execute on it;
- no public/fork PR is allowed onto this runner;
- no production secrets are stored on the host for CI;
- `GITHUB_TOKEN` remains read-only;
- registration token is transient setup data and is never written to Git history, logs, screenshots, or documentation;
- workflow steps must not print complete environment blocks;
- no CI step may invoke production lifecycle, deployment, ARM, order, or position mutation scripts.

## 13. Safety invariants

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
```

Any command whose effect is not demonstrably source/build/test/read-only is excluded from this M3 change.

## 14. Acceptance evidence

### Self-hosted infrastructure accepted

`SELF_HOSTED_CI_INFRA=PASS` requires all of:

1. repository-level runner is `ONLINE`;
2. runner has label `xauusd-core-ci`;
3. workflow is assigned to that runner;
4. GitHub job step list is non-empty;
5. checkout/setup/test steps actually execute;
6. static workflow contract passes;
7. no production mutation or secret exposure occurs.

### Full M3 accepted

`M3_PRIVATE_CI=GREEN` additionally requires:

1. M2 provenance attestation verifier passes;
2. tracked-secret boundary passes;
3. frozen dependency install passes;
4. workspace build passes;
5. Phase7C targeted suite passes;
6. Telegram regression passes;
7. broader accepted private regression gate passes;
8. `git diff --check` passes;
9. no unexpected tracked worktree mutation remains;
10. existing PR #1 is not merged until relevant private CI evidence is green;
11. production remains untouched.

An offline runner, queued/unassigned job, empty step list, failed provenance, failed secret boundary, failed regression, or failed diff hygiene means the corresponding gate remains not green.

## 15. Legacy workflow policy

This change does not mass-edit existing workflows.

After the canonical private Master/Core gate executes successfully, legacy workflows may be migrated or consolidated only in separate reviewed changes. Existing tests are not weakened merely to make old workflows green.

## 16. Rollback and removal

Rollback is source/infrastructure-only:

- disable/remove `.github/workflows/private-master-core-ci.yml`;
- stop the Windows runner service;
- deregister the repository-level runner;
- delete the local runner directory after deregistration if no longer needed.

Rollback must not require any bot restart, MT5 change, trading-mode change, scheduled-task mutation, order mutation, or position mutation.

## 17. Completion definition

This design is implemented when the private repository has one canonical self-hosted execution path that can prove exact-head CI execution without GitHub-hosted minutes.

The runner layer may become green before the broader M3 status. M3 itself is complete only when the pre-existing repository-split M3 requirements are green as well.

M3 does not authorize M4 public sanitization unless the broader split acceptance sequence is satisfied, and it never authorizes production cutover.