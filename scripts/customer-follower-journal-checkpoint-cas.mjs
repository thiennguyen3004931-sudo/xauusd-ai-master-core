// Review-only model. The adapter must serialize and durably commit a transition
// in a separate trust domain. The test adapter models only a separate directory.
import { createFollowerCanonicalJournalSnapshot } from './customer-follower-journal-canonical-state.mjs';

const denied = reasonCode => Object.freeze({ ok: false, brokerExecutionAllowed: false, reasonCode });
const sameBinding = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSnapshot = (a, b) => sameBinding(a.binding, b.binding) &&
  a.maxSequence === b.maxSequence && a.pendingReservedCount === b.pendingReservedCount &&
  a.journalDigestSha256 === b.journalDigestSha256;

function identifyTransition(journalBefore, journalAfter, before, after) {
  if (!sameBinding(before.binding, after.binding)) return null;
  const oldRows = new Map(journalBefore.records.map(row => [row.sequence, row]));
  const changes = journalAfter.records.filter(row => {
    const old = oldRows.get(row.sequence);
    return !old || old.commandId !== row.commandId || old.state !== row.state;
  });
  if (changes.length !== 1) return null;
  const [row] = changes;
  const old = oldRows.get(row.sequence);
  if (journalAfter.records.length === oldRows.size + 1 &&
      row.sequence > before.maxSequence && row.state === 'RESERVED' &&
      before.pendingReservedCount === 0) {
    return { kind: 'RESERVE', row };
  }
  if (journalAfter.records.length === oldRows.size && old?.commandId === row.commandId &&
      old.state === 'RESERVED' && row.state === 'DISPATCHED' && before.pendingReservedCount === 1) {
    return { kind: 'CONFIRM', row };
  }
  return null;
}

/**
 * Advance a synthetic checkpoint over a single, already committed journal
 * change. The after-image never replaces a missing checkpoint or one with a
 * different predecessor. A test confirmation is only a stand-in for evidence
 * from the broker, which must be authenticated independently in a real system.
 */
export async function advanceSyntheticFollowerCheckpoint({
  adapter, bindingKey, expectedRevision, journalBefore, journalAfter, syntheticConfirmation,
} = {}) {
  if (!adapter || typeof adapter.transact !== 'function' ||
      typeof bindingKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(bindingKey) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      expectedRevision === Number.MAX_SAFE_INTEGER) {
    return denied('FOLLOWER_CHECKPOINT_REQUEST_INVALID');
  }

  let before, after, change;
  try {
    before = createFollowerCanonicalJournalSnapshot(journalBefore);
    after = createFollowerCanonicalJournalSnapshot(journalAfter);
    change = identifyTransition(journalBefore, journalAfter, before, after);
  } catch {
    return denied('FOLLOWER_CHECKPOINT_JOURNAL_INVALID');
  }
  if (!change) return denied('FOLLOWER_CHECKPOINT_TRANSITION_DENIED');
  if (change.kind === 'CONFIRM' && (syntheticConfirmation?.commandId !== change.row.commandId ||
      syntheticConfirmation?.sequence !== change.row.sequence || syntheticConfirmation?.confirmed !== true)) {
    return denied('FOLLOWER_CHECKPOINT_CONFIRMATION_REQUIRED');
  }

  try {
    let proposed;
    const result = await adapter.transact(bindingKey, previous => {
      if (!previous || !Number.isSafeInteger(previous.keyEpoch) || previous.keyEpoch < 1) {
        return { commit: false, decision: denied('FOLLOWER_CHECKPOINT_UNAVAILABLE') };
      }
      if (previous.checkpointRevision !== expectedRevision) {
        return { commit: false, decision: denied('FOLLOWER_CHECKPOINT_CAS_CONFLICT') };
      }
      if (!sameSnapshot(previous, before)) {
        return { commit: false, decision: denied('FOLLOWER_CHECKPOINT_PREDECESSOR_MISMATCH') };
      }
      proposed = Object.freeze({
        ...after, keyEpoch: previous.keyEpoch, checkpointRevision: expectedRevision + 1,
      });
      return { commit: true, next: proposed, decision: { ok: true } };
    });
    if (result?.committed === true && result.decision?.ok === true && proposed) {
      return Object.freeze({
        ok: true, brokerExecutionAllowed: false, reasonCode: 'SYNTHETIC_FOLLOWER_CHECKPOINT_COMMITTED',
        checkpoint: proposed,
      });
    }
    if (result?.decision?.ok === false && result.decision.brokerExecutionAllowed === false) {
      return result.decision;
    }
  } catch {
    // A timeout or lost commit response cannot authorize a retry or dispatch.
  }
  return denied('FOLLOWER_CHECKPOINT_TRANSACTION_UNCERTAIN');
}
