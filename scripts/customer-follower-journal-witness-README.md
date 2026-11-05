# COPY_FOLLOWER journal witness — P0 review-only contract (#176, #160)

The pure function `compareFollowerJournalWithWitness` and its Node test suite model **negative** security decisions for a future independently witnessed COPY_FOLLOWER command journal. Neither is used by `CustomerFollowerExecutionAdapter`, the local demo runner, Master bot, customer Gateway or MT5. The comparator has no database, network or broker I/O. The suite uses temporary SQLite files, synthetic identities and ephemeral signing keys.

A synthetic statement is signed using the distinct `XAUUSD-FOLLOWER-JOURNAL-WITNESS-V2` domain. It binds the specific license, installation, MT5 login, broker server and sorted allowed symbols, a journal high-water sequence, a digest of the *whole canonical journal state*, unresolved reservation count, key epoch, checkpoint revision, request nonce and validity window. A separately supplied **pinned witness key** and **trusted high-water checkpoint** are compared with the local journal snapshot. A signed revision must equal the authenticated checkpoint revision. Mismatch, stale nonce/time, invalid signature or key pin, old sequence, same-sequence journal fork, newer local state that the witness has not observed, wrong follower binding and unresolved reservations fail closed.

## Synthetic canonical journal digest (review specification only)

`createFollowerCanonicalJournalSnapshot` in `scripts/customer-follower-journal-canonical-state.mjs` is a pure, deterministic **in-memory** candidate for the complete follower journal digest. It accepts an exact binding and an array of exact `{commandId, sequence, state}` rows (`RESERVED` or `DISPATCHED`), rejects duplicate IDs/sequences and invalid bindings, sorts by sequence and derives the max sequence and unresolved count rather than trusting caller-supplied counters. SHA-256 is domain-separated with `XAUUSD-FOLLOWER-JOURNAL-SNAPSHOT-V1` and includes schema version, full customer/installation/MT5/server/symbol scope, every row, state, max sequence and unresolved count.

Its dedicated synthetic tests establish deterministic row-order normalization, same-sequence fork detection, state transition changes and malformed-row denial. The witness-comparison suite also tests an actual **synthetically computed full-rowset digest**, proving that a same-sequence command fork fails against a separately provided checkpoint. The entire helper is **NOT wired to SQLite, the follower dispatcher, the Gateway or MT5**; no runtime code uses it.

**Critical limits:** a valid digest of an old local database is still valid. These in-memory rows are not independently authenticated, the code does not atomically snapshot the real SQLite/WAL database, and no external durable monotonic authority exists. A future implementation requires authenticated on-host journal reads, a defined consistent snapshot boundary and a separately controlled checkpoint CAS before any broker side effect. This specification is not a restore, release, risk or trading authorization.

## Disposable SQLite/WAL regression

The witness suite uses SQLite's native engine with a synthetic fixture matching the [draft follower journal schema](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/blob/3753fb2440a466711262f5b428872395cc19a269/packages/customer-follower-state/src/sqlite-command-journal.ts). Two connections verify that one read transaction observes a consistent snapshot across a WAL writer commit. An online backup taken before `RESERVED` becomes `DISPATCHED` verifies that the older database and its replayed proof fail against the newer synthetic checkpoint even when `maxSequence` is identical. A future authority needs an independent checkpoint revision that advances on each accepted journal state transition, including transitions with unchanged `maxSequence`.

The SQLite fixture models the local journal only. Both checkpoint and proof are constructed by the tests. The hosted synthetic workflow asserts that the checked-out commit matches the PR head.

## Checkpoint transition and recovery model

`advanceSyntheticFollowerCheckpoint` recomputes both journal digests and accepts one legal change at a time. It checks the expected revision and exact predecessor inside the adapter transaction, then advances the checkpoint by one. A new reservation appends a unique command at a greater sequence. Clearing a reservation requires a synthetic confirmation matching its command ID and sequence. The maximum sequence can stay the same while the revision and digest advance.

Tests use the existing `FileAuthorityFixture` in a dedicated temporary directory, with an explicitly seeded checkpoint. A competing update or stale retry cannot overwrite the first committed revision. An absent or indeterminate commit result returns a blocked decision. Reopening the fixture can establish the stored revision for comparison only.

| Failure point | Required production handling |
| --- | --- |
| Local reservation committed, checkpoint absent or behind | Quarantine. Compare a fresh authoritative revision against the local WAL snapshot before any dispatch. |
| Checkpoint commit response lost | Quarantine. Read the authoritative revision and digest before recovery. A stale CAS must never be rebased and resent automatically. |
| Broker response missing or ambiguous | Preserve `RESERVED`. Require authoritative broker reconciliation for the exact command before finalizing or accepting another one. |
| Customer journal or proof restored from backup | Compare to an authenticated fresh authority response and the checkpoint held outside customer restore scope. Reject a lower revision or different digest. |

The production adapter must authenticate checkpoint reads and writes, serialize changes per binding, retain monotonic state outside customer and operator restore media, and preserve the root and key epoch through recovery. A local directory and a caller-supplied confirmation model behavior for review. They provide no authority isolation, broker evidence or operational durability attestation.

## Abrupt process exit evidence

Two Linux tests create disposable SQLite and checkpoint files, then start a separate Node worker. The worker commits a new WAL reservation and terminates itself with SIGKILL, either before or after the synthetic checkpoint transaction completes. It skips graceful SQLite close and application cleanup.

After the journal-only cut point, a new reader observes the committed reservation while the checkpoint retains its prior revision. The comparator returns `LOCAL_JOURNAL_AHEAD_OF_WITNESS`. After the checkpoint cut point, reopening both stores observes revision 1 and a matching digest, but the command remains RESERVED and returns `UNRESOLVED_RESERVATIONS`. A retry from revision 0 is rejected as a CAS conflict.

These two completed-commit cut points exercise local process-crash recovery on Linux. Windows recovery, machine power loss, failure during checkpoint file replacement and authenticated broker reconciliation require separate acceptance evidence. The test worker opens only paths created by the disposable fixtures.

## Security limitations — NOT satisfied by this PR

- There is **no independent monotonic authority service**, trusted remote read, KMS/HSM/TPM trust root, transport, operational checkpoint store, or key-rotation process. The unit tests explicitly demonstrate that rolling back the checkpoint **together** with the journal and proof is undetectable by a pure comparison.
- Additional synthetic negative proof: a substituted, self-consistent Ed25519 witness key **plus** rolled-back checkpoint and journal can also match inside the pure comparator. This explicitly demonstrates why the original trusted key fingerprint and latest checkpoint must come from an externally authenticated, independent non-rollbackable authority. **A local signature alone is not a trust root; even an internal match always returns `brokerExecutionAllowed=false`.**
- There is no canonical SQLite journal snapshotter, no hash definition for serialized SQLite rows, and no atomic handoff between a DB reservation and an independently durable witness. A fake caller-supplied journal digest is not sufficient for security. The future design must bind the actual canonical journal and persist the independent monotonic checkpoint **before any externally observable order**; crash, outage and uncertain broker reconciliation remain separate fail-closed requirements.
- A matching witness result has `evidenceMatched=true` and **always** `brokerExecutionAllowed=false`. No code consuming this helper may treat a match as authorization to enable the customer runtime, change BOT_MODE/ARM, or send MT5 orders.
- Do not merge this helper into an execution/admission path, distribute it as a production rollback solution, or mark #176, #160 or #166 complete based on green CI. An independent security review and controlled host/MT5 DEMO acceptance are outstanding.

To run tests in a disposable checkout: `node --test scripts/customer-follower-journal-witness-compare.test.mjs` (Node.js 24 in CI). Tests generate ephemeral Ed25519 keys and synthetic state only.
