# Customer release candidate evidence — 2026-10-25 (UTC)

Scope: **source and CI evidence only**. This record does not attest a customer machine, DEMO broker execution, or LIVE authorization. Historical snapshot; refresh on any subsequent accepted `main` commit.

| Evidence | Observed result |
| --- | --- |
| Private Core repository | `thiennguyen3004931-sudo/xauusd-ai-master-core` (private) |
| Accepted main SHA at assessment | `197803efee5ab2c718c65076d1a9dcb16fe1319f` |
| Public distribution SHA pinned by core | `bdf6dd163afed23d3e5d2079ab5fc94132b2c0bd` |
| Canonical PR Gate on main | [PASS / 40199166805](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/40199166805) |
| Customer Final Production Acceptance on main | [PASS / 40199166825](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/40199166825) |
| Customer Deployment + Follower Execution Acceptance on main | [PASS / 40199166792](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/40199166792) |
| Private Master Core CI | [PASS on PR #157 head `b8da4dcb4ea60cfe80cf81601803bf9e962d4f6c` / 40192112004](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/40192112004); **not a run attesting final main SHA** |
| Release artifact | [`xauusd-customer-agent-v1`, ID 12601917570](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/40199166792/artifacts/12601917570) |
| GitHub artifact archive SHA-256 | `c389c3d55bfa5012b89747d712755afb2a15fcd298cdac5c40a4f8ae3ecaf918` (GitHub-reported digest, not independently recomputed locally) |
| Package internal manifest | 21 entries checked in workflow, `CUSTOMER_RELEASE_VERIFIED_MANIFEST_ENTRIES=21` |
| Artifact retention expiry | 2026-11-24 14:13 UTC (per GitHub metadata) |
| Official GitHub Release | **Not found as of review** |
| Inner customer ZIP digest | **NOT RECORDED IN THIS SNAPSHOT**: independently hash the extracted inner ZIP before customer handoff |
| Customer machine verification / sign-off | **NOT DONE** |
| Real follower MT5 bridge and DEMO order acceptance | **NOT DONE** (`REAL_CUSTOMER_MT5_BRIDGE_BINDING=NONE`, `MT5_LIVE_EXECUTION=NONE` in workflow) |

## Required release decisions

1. Before shipment, obtain and verify the exact final-main Private Master Core CI evidence; PR-head PASS is not a substitute for an exact-SHA run.
2. Independently download the artifact and verify outer digest, inner ZIP hash, each manifest entry, extra-file rejection, and prohibited-data boundary. Avoid recording any tokens/keys.
3. Publish an immutable, signed versioned customer release only after owner approval. Document version, rollback target, digest, expiry and support scope.
4. Use `customer-release/acceptance-record.template.md` per installation. Package CI `PASS` is not a customer installation sign-off.
5. Each later change invalidates this snapshot as a current candidate. Never copy evidence onto a new SHA without verifying again.

## Safety

`BOT_MODE_MUTATION=NONE`; `ARM_MUTATION=NONE`; `MT5_MUTATION=NONE`; `ORDER_MUTATION=NONE`; `POSITION_MUTATION=NONE`; `LIVE_TEST_ORDER=NONE`.
