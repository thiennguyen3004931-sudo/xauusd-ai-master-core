# M3 Self-Hosted Private CI Design

## 1. Status and purpose

This design implements the M3 requirement from the Public / Private Repository Split: establish private CI that can execute on the canonical private Master/Core repository without consuming GitHub-hosted runner minutes.

The current private repository is:

- `thiennguyen3004931-sudo/xauusd-ai-master-core`
- canonical base branch: `main`
- current M3 blocker: GitHub Actions workflow runs are created, but jobs terminate before any step executes (`steps=[]`), so private CI is not green and code execution on GitHub-hosted runners is not proven.

The approved objective is to add one canonical repository-level self-hosted Windows runner and one canonical private CI gate. This work is source/CI infrastructure only and does not authorize production rollout or trading-runtime mutation.

## 2. Scope

### In scope

- repository-level self-hosted GitHub Actions runner for the private repository;
- Windows x64 development workstation as the runner host;
- dedicated custom runner label `xauusd-core-ci`;
- one canonical M3 workflow that targets `[self-hosted, Windows, X64, xauusd-core-ci]`;
- exact dependency installation from committed lockfile;
- workspace build;
- Phase7C targeted ownership/lifecycle regression;
- Telegram lifecycle regression;
- private repository boundary/security contracts that are already available and runnable without production secrets;
- diff hygiene;
- evidence that the self-hosted runner actually executed workflow steps;
- documentation for registration, service lifecycle, verification, and safe removal.

### Out of scope

- production deployment or rollout;
- MT5 login/account changes;
- bot mode/ARM/task/process changes;
- order or position mutation;
- live test orders;
- moving every legacy workflow to self-hosted in this change;
- fixing unrelated baseline failures in `@xauusd/signal-engine`;
- fixing unrelated tracked `apps/web/.ignored_node_modules` lint behavior;
- adding production credentials, signing keys, MT5 secrets, Telegram secrets, or customer secrets to the runner/workflow;
- changing trading strategy, +6/+10, FastMove, M5, SEMI, Trend, Sideway, or risk behavior.

## 3. Chosen architecture

The private repository gets a single canonical M3 gate rather than converting the existing large workflow set in one migration.

```text
PRIVATE REPOSITORY
      |
      v
GitHub Actions workflow
      |
      | labels: self-hosted, Windows, X64, xauusd-core-ci
      v
Dedicated Windows development runner
      |
      +--> checkout exact PR/head
      +--> Node 24
      +--> pnpm 10.18.0
      +--> frozen install
      +--> workspace build
      +--> scoped Phase7C regressions
      +--> private boundary/security contracts
      +--> diff hygiene
```

The runner is registered at repository scope, not organization scope. It is not installed on the production bot host and must not have production runtime credentials.

## 4. Runner host contract

The runner host is a Windows x64 development workstation dedicated enough to avoid production coupling.

Required runner labels:

```text
self-hosted
Windows
X64
xauusd-core-ci
```

Runner registration requirements:

- register only against `thiennguyen3004931-sudo/xauusd-ai-master-core`;
- registration token is obtained interactively from GitHub and is never committed;
- runner files live outside the repository worktree;
- runner may run as a Windows service after first successful interactive verification;
- service account must not be granted MT5 trading credentials, production deployment credentials, private signing keys, Telegram bot secrets, or customer secrets;
- do not place `.env` or production config in the runner directory;
- runner working directories remain local build artifacts and are not committed;
- runner must be removable without affecting bot runtime.

## 5. Canonical workflow contract

Create one new workflow:

```text
.github/workflows/private-core-self-hosted-ci.yml
```

The job must use:

```yaml
runs-on: [self-hosted, Windows, X64, xauusd-core-ci]
```

Minimum permissions:

```yaml
permissions:
  contents: read
```

The workflow must not request deployment environments, repository secrets, production credentials, signing keys, or write permissions.

The canonical execution order is:

1. checkout exact workflow head;
2. assert runner OS/architecture and print only non-sensitive runner identity metadata;
3. setup Node.js 24;
4. setup pnpm 10.18.0;
5. `pnpm install --frozen-lockfile`;
6. `pnpm build`;
7. run `scripts/test-phase7c-telegram-entry-resolution-lifecycle-contract.mjs`;
8. run Telegram regression suite:
   - `scripts/test-phase7c-telegram-lifecycle-observability-contract.mjs`
   - `scripts/phase7c-trade-notifier-synthetic.test.mjs`
   - `scripts/test-phase7c-hold-telegram-dedupe-contract.mjs`;
9. run existing private/public-boundary and tracked-secret contracts that do not require secrets or production access;
10. `git diff --check`;
11. assert worktree cleanliness for tracked files after verification.

The workflow intentionally does not use root `pnpm test` or root `pnpm lint` as M3 acceptance gates in this first canonical self-hosted gate because two unrelated baseline blockers have already been separately proven:

- `@xauusd/signal-engine` has two existing `SignalPipeline` expectation failures after a successful workspace build;
- `apps/web` lint traverses tracked `.ignored_node_modules` content and fails while loading a package-local TanStack ESLint config dependency.

Those baseline defects must remain separately tracked; they must not be hidden, weakened, or silently converted to passing checks in this M3 change.

## 6. TDD / contract-first implementation

Before adding the workflow, add a static contract test that reads `.github/workflows/private-core-self-hosted-ci.yml` and fails until the workflow satisfies the approved invariants.

The contract must prove at minimum:

- workflow file exists;
- `runs-on` includes `self-hosted`, `Windows`, `X64`, and `xauusd-core-ci`;
- `contents: read` is present;
- Node version is exactly 24;
- pnpm version is exactly 10.18.0;
- install uses `pnpm install --frozen-lockfile`;
- build uses `pnpm build`;
- Phase7C targeted contract is invoked;
- all three Telegram regression test files are invoked;
- `git diff --check` is invoked;
- forbidden production mutation commands are absent;
- forbidden secret/environment names are not added to the workflow;
- workflow does not use GitHub-hosted labels such as `ubuntu-latest`, `windows-latest`, or `macos-latest`.

Implementation order must be RED -> minimal workflow -> GREEN -> live self-hosted run evidence.

## 7. Safety invariants

The following remain hard requirements for all M3 work:

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

The CI workflow must not invoke scripts that mutate production lifecycle, scheduled tasks, bot mode, ARM state, orders, or positions.

Any command whose effect is not demonstrably read-only/build/test-only must be excluded from this first canonical gate.

## 8. Security model

A self-hosted runner executes repository code on the host, so the trust boundary is the private repository and authorized maintainers.

Security requirements:

- no public/fork pull request is permitted to gain execution on this runner;
- only trusted private-repository branches/PRs are used;
- no production secrets are stored on the host for CI convenience;
- GitHub Actions `GITHUB_TOKEN` permissions remain read-only unless a later separately approved task requires more;
- the workflow must not print environment variables, tokens, registration tokens, repository secrets, or file contents that may contain secrets;
- no persistent credential file is created inside the repository;
- runner registration token is treated as transient setup data and is never written to Git history or documentation output.

## 9. Trigger strategy

The canonical M3 workflow should support:

- `pull_request` targeting `main` for relevant private-core changes;
- `workflow_dispatch` for explicit operator verification after runner registration;
- optionally `push` to the dedicated M3 implementation branch during bring-up.

The first accepted run must be tied to an exact commit SHA and must show actual executed steps, not merely workflow creation.

## 10. Acceptance evidence

M3 self-hosted private CI is accepted only when all of the following are true:

1. repository-level runner is visible as `ONLINE` with label `xauusd-core-ci`;
2. canonical workflow is present on a reviewed private branch;
3. static workflow contract passes;
4. GitHub Actions job is assigned to the self-hosted runner;
5. workflow step list is non-empty and actual steps execute;
6. frozen dependency install succeeds;
7. workspace build succeeds;
8. Phase7C targeted suite passes 6/6;
9. Telegram regression passes 19/19;
10. selected boundary/security contracts pass;
11. `git diff --check` passes;
12. tracked worktree remains clean after verification;
13. no production secret or production mutation is introduced;
14. existing PR #1 remains unmerged until relevant CI evidence is green;
15. production remains untouched.

A failed runner registration, offline runner, queued job, missing label, empty step list, or failed verification means M3 remains `NOT_GREEN`.

## 11. Legacy workflow migration policy

This design does not mass-edit existing workflows.

After the canonical M3 gate is green, legacy workflows are handled separately:

- retain as-is when still useful and affordable;
- migrate selectively to the self-hosted runner when their security/scope is understood;
- consolidate redundant workflows only through separate reviewed changes;
- do not weaken existing tests merely to make old workflows green.

This keeps the M3 change small, reviewable, and reversible.

## 12. Rollback and removal

Rollback is source/infrastructure-only:

- disable or remove the canonical M3 workflow;
- stop the Windows runner service;
- remove the repository-level runner registration from GitHub;
- delete the local runner directory after deregistration if no longer needed.

Rollback must not require any bot restart, MT5 change, trading-mode change, task mutation, order mutation, or position mutation.

## 13. Completion definition

This design is complete when one canonical private CI path can execute on the self-hosted Windows runner and provide exact-head, non-production evidence for the accepted private Master/Core source.

M3 completion does not authorize M4 public sanitization by itself unless the broader repository-split acceptance sequence and private bootstrap/provenance requirements are also satisfied. It does not authorize production cutover; production remains a separate later decision.