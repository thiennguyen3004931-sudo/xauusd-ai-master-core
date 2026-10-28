# Customer SQLite recovery: independent revocation and anti-rollback authority (DRAFT)

Status: **DESIGN ONLY — P0 BLOCKED**. Parent: #176, #166, #169. Do not interpret this document as implemented or tested production behavior. This document does not enable customer activation, change a trading bot, or authorize release.

## Threat model and invariant

An old *physical* copy of the SQLite customer security DB may precede a license/grant revocation, challenge consumption, credential rotation, or installation migration. Restoring and opening that older copy can make an old authorization state appear valid even though in-place SQLite writes correctly refuse REVOKED -> ACTIVE (#177, proposed #178). WAL/FULL synchronization and database integrity checks do not solve this rollback.

**Invariant:** No restored SQLite snapshot may cause an entitlement, installation challenge, or API credential to become usable if an independently trusted authority has recorded it revoked, consumed, expired, superseded, or otherwise invalidated. UNKNOWN and UNAVAILABLE must fail closed for **new customer activation/access**. Historical audit sequence must not decrease after recovery.

## Required external trust boundary (not yet selected or implemented)

1. Choose a durable, independently administered append-only revocation authority **outside the customer SQLite DB and its backup/snapshot domain**. A second table/file copied with the SQLite DB is *not* independent.
2. Every authoritative event has a unique event ID, subject ID (license, grant, installation, challenge or token reference), operation, monotonic sequence/epoch, timestamp, previous-event hash and event digest. Avoid storing bearer tokens or private keys. Sign or otherwise authenticate batches using an independently controlled trust root.
3. Protect the external authority itself against rollback: durable, monotonic sequence or witnessed checkpoints, anti-replay, signer revocation/key rotation, and a verified latest-head witness. A chain of hashes without an externally anchored head is insufficient.
4. Define an explicit availability policy: if proof of the latest trusted state cannot be obtained, deny new activation/authorization/restore completion. Never substitute a stale local cached copy or an unsigned counter as authoritative.
5. Specify ordering/atomicity of revoke writes between the trusted authority and SQLite. Until the commit/ack and crash-window semantics are formally proven, do not enable an automatic dual-write implementation. Partial commits, retries, and duplicate events must remain safe and idempotent.
6. Protect recovery authority from a single local service operator or a compromised customer machine. Specify authorization, audit, two-person approval where feasible, access isolation, and key recovery before implementation.

## Suggested fail-closed recovery state machine

- `QUARANTINED`: restored database opened offline; prohibit customer Gateway activation and entitlement validation. No MT5 or BOT_MODE/ARM operations.
- `VERIFYING`: validate encrypted backup provenance, file hashes, consistent SQLite/WAL snapshot, schema, signed trusted external latest-head/epoch, complete event chain, and exact owner/installation identity. Reject ambiguous/missing evidence.
- `RECONCILING`: replay required authoritative revocations, grant supersessions, challenge consumption and credential invalidations transactionally into the isolated restored state; preserve audit monotonicity. No fallback to old ACTIVE records.
- `REVALIDATING`: independently verify state projections, revoked-ID non-resurrection, challenge single-use, token expiry/revocation, account bindings, and restart persistence.
- `ELIGIBLE_FOR_OPERATOR_REVIEW`: produce redacted evidence (source SHA, snapshot and authority hashes, baseline vs restored high-water, deterministic PASS/BLOCKED). **Not** authorization to activate, trade, ship, or deploy.
- On **any** error: `BLOCKED`. Never mark a restored database safe merely because `PRAGMA integrity_check` passes.

## Synthetic acceptance matrix (isolated temporary files; no customers or trading)

| Case | Expected |
| --- | --- |
| Normal ACTIVE -> REVOKED via license API and grant CAS | Revocation monotonic in-place |
| Physical SQLite backup made before revocation restored after later revoked event | BLOCKED before reconciliation; revoked license/grant never re-enabled afterward |
| Backup predates consumed installation challenge | Challenge cannot be consumed again |
| Backup predates installation migration/re-issue | Old installation/grant/license stays denied |
| Independent authority missing, stale, unavailable, tampered, wrong signer, or lower epoch | BLOCKED |
| Duplicate/replayed event, mismatched hash chain, rollback of external checkpoint | BLOCKED or verified idempotent replay; never older effective state |
| Crash before/after external commit or local SQLite commit | Documented deterministic fail-closed behavior and retry |
| WAL active during snapshot, partial/corrupt/truncated backup, wrong encryption key | BLOCKED |
| Restart after reconciliation | Same effective revoked state and monotonic audit |
| Token expiry/revoke/rotation and encrypted key recovery | Separate P0 gate, not accepted by this design |

Test every relevant entitlement type for both SELF_MANAGED and COPY_FOLLOWER, plus PAUSE/offline-mode behavior without creating a Gateway transport or connecting to MT5. Validate strict logs: no credentials, private key, bearer token, or real customer identifier.

## Engineering gates before code integration

- [ ] Decide authority custody, trust root, anti-rollback head/witness, monotonic transaction semantics and availability behavior; independent threat-model review.
- [ ] Define typed verification interface and fail-closed status; no unsafe default `allow`. Keep API surface separate from production runtime until tests are accepted.
- [ ] Add deterministic synthetic restore/rollback regressions; prove that the pre-revocation backup **fails** before independent authority reconciliation.
- [ ] Verify safe backup generation from SQLite WAL and independently encrypted, access-restricted artifact/keys; never use raw SQLite copy as a commercial backup.
- [ ] Implement and test explicit API token issuance/expiry/rotation/revocation with restart persistence. Do not conflate token state with grants.
- [ ] Pass all exact-PR-head CI checks; after merge, verify exact-main Canonical, Customer Follower and manual Private Master Core checks.
- [ ] Perform a separately authorized operator two-person restore drill on a controlled synthetic Windows environment, with audited evidence and rollback plan.
- [ ] Perform separate effective customer Windows ACL/DPAPI, signed-publisher artifact, and MT5 DEMO pilot acceptance before any customer distribution.

## Hard operational boundary

This design must **not** restore, snapshot, modify, or inspect any real customer database or credentials; must **not** change existing BOT_MODE, ARM, production account, Gateway deployment, trading strategy, LIVE/DEMO positions or MT5 orders. No real tokens, keys, identities or sensitive data may be committed or attached to GitHub issues/CI artifacts.
