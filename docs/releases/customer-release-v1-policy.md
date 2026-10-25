# Customer Release V1 — distribution and rollback policy

Status: **release candidate policy**, not an authorized LIVE trading release. Product modes: `SELF_MANAGED` and `COPY_FOLLOWER`. The shipped `customer-agent-v1.zip` contains neither proprietary Master source nor a usable customer MT5 execution bridge.

## Immutable release checklist

1. Select a reviewed `main` SHA and record its public contract lock.
2. Require Canonical Gate, Private Master Core CI and every relevant customer E2E/package workflow to PASS on the accepted change set. Record each run and SHA.
3. Build a customer package with exact dependency lock; require clean ZIP extraction, manifest SHA-256 verification, missing/extra-file rejection and zero private Master sources/credentials.
4. Download the GitHub artifact through an authenticated approved process. Hash **outer GitHub artifact archive** and **inner customer ZIP** separately. Compare outer digest with GitHub metadata, verify every inner manifest entry, and retain immutable masked evidence.
5. Create a release identifier (for example `customer-agent-v1.0.0-rc1`) and a signed manifest bound to product mode, source SHA, public contract, inner ZIP hash and release time. Signing private key must be provisioned outside GitHub, repository, customer ZIP and logs. Signature verification code and trusted public-key IDs may be distributed.
6. If signature infrastructure is absent, classify status `UNSIGNED_RC_NOT_FOR_CUSTOMERS`; a SHA-256 alone checks integrity against a trusted digest but does **not** authenticate the publisher. Do not assert signature PASS.
7. Release metadata must specify artifact retention expiry, known limitations, approved installation path, help/support, security incident escalation, and explicit DEMO/LIVE permission boundaries.
8. Each customer has their own installation identity, licensed grant, broker/account binding and **blank completed-on-site** acceptance record; never fill customer-specific tokens/keys into this repo.
9. Approve a customer for DEMO only after separate local-machine acceptance. LIVE requires a new explicit risk and operational go/no-go decision.

## Rollback

- Retain last verified signed package and public verification key; downgrade requires security compatibility and a new approved grant/session check.
- Do not restore an expired/revoked customer grant or reuse a retired installation key in rollback.
- For failed installation, restore only approved binaries/config (never move private keys between PCs), keep SELF_MANAGED at PAUSE, and re-verify exact account/broker/license.
- For COPY_FOLLOWER, require verified broker position reconciliation and no duplicate order on restart before resuming any execution. Never assume a failed HTTP acknowledgement means the broker rejected a trade.
- Preserve sanitized audit and rollback evidence. Do not roll back Master BOT_MODE/ARM or active trade management from a customer-agent package.
- Any package replacement changes SHA and requires a new evidence record. No mutable `latest.zip` alias as sole provenance.

## Release gates

| Gate | Owner and evidence | Status as of initial assessment |
| --- | --- | --- |
| Code/test/CI candidate | PR URLs, final SHA and jobs | Existing CI evidence recorded; refresh before release |
| Digest and internal manifest | Two independent hashes, full file list | Inner manifest passed CI; outer hash is GitHub-reported |
| Cryptographic release signature | Trusted verification, signature ID and detached signature | NOT IMPLEMENTED / NOT VERIFIED |
| Real customer SELF_MANAGED | Separate Windows machine acceptance + sign-off | NOT VERIFIED |
| COPY_FOLLOWER on MT5 DEMO | Segregated and explicitly approved broker demo E2E | NOT VERIFIED |
| Production LIVE | Separate approval and risk gating | NOT AUTHORIZED |

No release is declared final in this document. No BOT_MODE / ARM / MT5 / position / order changes.
