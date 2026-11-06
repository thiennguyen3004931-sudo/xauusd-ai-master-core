/**
 * P0 #176 / #160: SOURCE-ONLY synthetic anti-rollback contract.
 * This helper has no disk/network/broker/MT5 access and must never be wired
 * into a customer or production execution path. A signed proof and an old
 * checkpoint can both be replayed if the checkpoint itself is restorable.
 *
 * The caller must obtain and authenticate the pinned witness key + latest
 * monotonic checkpoint from a separate, non-rollbackable authority. These
 * inputs cannot establish their own provenance. Even on a matching proof,
 * brokerExecutionAllowed is ALWAYS false.
 */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const DOMAIN = 'XAUUSD-FOLLOWER-JOURNAL-WITNESS-V2\n';
const CHECKPOINT_DOMAIN = 'XAUUSD-FOLLOWER-JOURNAL-CHECKPOINT-V1\n';
const exact = (obj, fields) => obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).length === fields.length && fields.every(field => Object.hasOwn(obj, field));
const canonical = v => typeof v === 'string' && v.length > 0 && v.trim() === v;
const safeCounter = v => Number.isSafeInteger(v) && v >= 0;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const blocked = reasonCode => Object.freeze({ evidenceMatched: false, brokerExecutionAllowed: false, reasonCode });
const BINDING_FIELDS = ['licenseId', 'installationId', 'mt5Login', 'brokerServer', 'allowedSymbols'];
const SNAPSHOT_FIELDS = ['binding', 'maxSequence', 'journalDigestSha256', 'pendingReservedCount'];
const STATEMENT_FIELDS = [
  'schemaVersion', 'authorityKeyId', 'keyEpoch', 'checkpointRevision', 'requestNonce', 'issuedAt', 'expiresAt',
  ...SNAPSHOT_FIELDS,
];
const CHECKPOINT_FIELDS = [...SNAPSHOT_FIELDS, 'keyEpoch', 'checkpointRevision'];
const ROOT_FIELDS = ['keyId', 'keyEpoch', 'publicKeyPem', 'publicKeySha256'];
const CHECKPOINT_PROOF_FIELDS = [
  'schemaVersion', 'checkpointKeyId', 'checkpointKeyEpoch', 'requestNonce', 'issuedAt', 'expiresAt',
  ...CHECKPOINT_FIELDS,
];
const FLOOR_FIELDS = [...CHECKPOINT_FIELDS, 'checkpointKeyEpoch'];

function validBinding(binding) {
  if (!exact(binding, BINDING_FIELDS)) return false;
  if (!canonical(binding.licenseId) || !canonical(binding.installationId) ||
      !canonical(binding.brokerServer) || !Number.isSafeInteger(binding.mt5Login) ||
      binding.mt5Login <= 0 || !Array.isArray(binding.allowedSymbols) ||
      binding.allowedSymbols.length < 1 ||
      Array.from(binding.allowedSymbols).some(symbol => !canonical(symbol))) return false;
  const uniqueSorted = [...new Set(binding.allowedSymbols)].sort();
  return uniqueSorted.length === binding.allowedSymbols.length &&
    uniqueSorted.every((symbol, index) => symbol === binding.allowedSymbols[index]);
}
function validSnapshot(x, fields) {
  return exact(x, fields) && validBinding(x.binding) &&
    safeCounter(x.maxSequence) && safeCounter(x.pendingReservedCount) &&
    hash(x.journalDigestSha256);
}
function validCheckpoint(x, fields = CHECKPOINT_FIELDS) {
  return validSnapshot(x, fields) && safeCounter(x.checkpointRevision) &&
    Number.isSafeInteger(x.keyEpoch) && x.keyEpoch >= 1;
}
function validPinnedRoot(root) {
  return exact(root, ROOT_FIELDS) && canonical(root.keyId) &&
    Number.isSafeInteger(root.keyEpoch) && root.keyEpoch >= 1 &&
    typeof root.publicKeyPem === 'string' && root.publicKeyPem.includes('BEGIN PUBLIC KEY') &&
    hash(root.publicKeySha256);
}
function validNonce(nonce) {
  return canonical(nonce) && nonce.length >= 16 && nonce.length <= 256;
}
function freshWindow(nowMs, issuedAt, expiresAt) {
  return safeCounter(nowMs) && safeCounter(issuedAt) && safeCounter(expiresAt) &&
    issuedAt <= nowMs && expiresAt > nowMs && expiresAt - issuedAt <= 30_000;
}
function sameBinding(a, b) {
  return BINDING_FIELDS.every(field => field === 'allowedSymbols'
    ? JSON.stringify(a[field]) === JSON.stringify(b[field]) : a[field] === b[field]);
}
function snapshotTuple(s) {
  return [...BINDING_FIELDS.map(field => s.binding[field]), s.maxSequence, s.journalDigestSha256,
    s.pendingReservedCount];
}
function signedBytes(s) {
  return Buffer.from(DOMAIN + JSON.stringify([
    s.schemaVersion, s.authorityKeyId, s.keyEpoch, s.checkpointRevision, s.requestNonce,
    s.issuedAt, s.expiresAt, ...snapshotTuple(s),
  ]), 'utf8');
}
function checkpointSignedBytes(s) {
  return Buffer.from(CHECKPOINT_DOMAIN + JSON.stringify([
    s.schemaVersion, s.checkpointKeyId, s.checkpointKeyEpoch, s.requestNonce, s.issuedAt,
    s.expiresAt, s.keyEpoch, s.checkpointRevision, ...snapshotTuple(s),
  ]), 'utf8');
}
function signatureFailure(root, message, signatureBase64) {
  try {
    const key = createPublicKey(root.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return 'KEY_INVALID';
    const keyDer = key.export({ format: 'der', type: 'spki' });
    if (createHash('sha256').update(keyDer).digest('hex') !== root.publicKeySha256) {
      return 'KEY_PIN_MISMATCH';
    }
    if (signatureBase64.length !== 88 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(signatureBase64)) {
      return 'SIGNATURE_INVALID';
    }
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== signatureBase64 ||
        !verifySignature(null, message, key, signature)) return 'SIGNATURE_INVALID';
    return null;
  } catch {
    return 'SIGNATURE_INVALID';
  }
}

function authenticateWitness({
  localJournal, witnessProof, trustedWitnessRoot, trustedCheckpoint,
  expectedNonce, nowMs,
} = {}) {
  if (!validSnapshot(localJournal, SNAPSHOT_FIELDS)) return 'LOCAL_JOURNAL_INVALID';
  if (!witnessProof || !validSnapshot(witnessProof.statement, STATEMENT_FIELDS) ||
      typeof witnessProof.signatureBase64 !== 'string') return 'WITNESS_PROOF_REQUIRED';
  if (!validPinnedRoot(trustedWitnessRoot)) return 'PINNED_WITNESS_ROOT_REQUIRED';
  if (!validCheckpoint(trustedCheckpoint)) return 'INDEPENDENT_CHECKPOINT_REQUIRED';
  const s = witnessProof.statement;
  if (s.schemaVersion !== 2 || s.authorityKeyId !== trustedWitnessRoot.keyId ||
      s.keyEpoch !== trustedWitnessRoot.keyEpoch ||
      s.keyEpoch < trustedCheckpoint.keyEpoch) return 'WITNESS_ROOT_OR_EPOCH_MISMATCH';
  if (!safeCounter(s.checkpointRevision)) return 'WITNESS_CHECKPOINT_REVISION_INVALID';
  if (!validNonce(expectedNonce) || s.requestNonce !== expectedNonce) return 'WITNESS_NONCE_MISMATCH';
  if (!freshWindow(nowMs, s.issuedAt, s.expiresAt)) return 'WITNESS_EXPIRED_OR_INVALID';
  if (!sameBinding(localJournal.binding, s.binding) ||
      !sameBinding(trustedCheckpoint.binding, s.binding)) return 'FOLLOWER_BINDING_MISMATCH';
  const witnessFailure = signatureFailure(trustedWitnessRoot, signedBytes(s), witnessProof.signatureBase64);
  if (witnessFailure) return 'WITNESS_' + witnessFailure;
  // A signed statement alone is replayable: it must agree with a separately
  // authenticated latest checkpoint, including revision and digest.
  if (s.checkpointRevision < trustedCheckpoint.checkpointRevision) return 'WITNESS_CHECKPOINT_REVISION_ROLLBACK';
  if (s.checkpointRevision > trustedCheckpoint.checkpointRevision) return 'CHECKPOINT_REVISION_BEHIND_WITNESS';
  if (s.maxSequence < trustedCheckpoint.maxSequence) return 'WITNESS_HIGH_WATER_ROLLBACK';
  if (s.maxSequence > trustedCheckpoint.maxSequence) return 'CHECKPOINT_BEHIND_WITNESS';
  if (s.journalDigestSha256 !== trustedCheckpoint.journalDigestSha256 ||
      s.pendingReservedCount !== trustedCheckpoint.pendingReservedCount) {
    return 'WITNESS_CHECKPOINT_FORK';
  }
  return null;
}

function compareLocalJournal(localJournal, snapshot) {
  if (localJournal.maxSequence < snapshot.maxSequence) return blocked('LOCAL_JOURNAL_ROLLBACK');
  if (localJournal.maxSequence > snapshot.maxSequence) return blocked('LOCAL_JOURNAL_AHEAD_OF_WITNESS');
  if (localJournal.journalDigestSha256 !== snapshot.journalDigestSha256 ||
      localJournal.pendingReservedCount !== snapshot.pendingReservedCount) {
    return blocked('LOCAL_JOURNAL_FORK');
  }
  if (snapshot.pendingReservedCount !== 0) return blocked('UNRESOLVED_RESERVATIONS');
  return Object.freeze({
    evidenceMatched: true,
    brokerExecutionAllowed: false,
    reasonCode: 'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
  });
}

/**
 * Verifies a request-bound synthetic witness against an independently supplied
 * checkpoint. A match establishes evidence consistency only.
 */
export function compareFollowerJournalWithWitness(input = {}) {
  const failure = authenticateWitness(input);
  return failure ? blocked(failure) : compareLocalJournal(input.localJournal, input.witnessProof.statement);
}

function authenticateCheckpointProof({
  localJournal, witnessProof, checkpointProof, trustedWitnessRoot,
  trustedCheckpointRoot, trustedHighWaterFloor, expectedNonce, nowMs,
} = {}) {
  if (!validPinnedRoot(trustedCheckpointRoot)) return 'PINNED_CHECKPOINT_ROOT_REQUIRED';
  if (!validPinnedRoot(trustedWitnessRoot)) return 'PINNED_WITNESS_ROOT_REQUIRED';
  if (trustedWitnessRoot.publicKeySha256 === trustedCheckpointRoot.publicKeySha256) {
    return 'CHECKPOINT_AND_WITNESS_KEYS_MUST_DIFFER';
  }
  if (!validCheckpoint(trustedHighWaterFloor, FLOOR_FIELDS) ||
      !Number.isSafeInteger(trustedHighWaterFloor.checkpointKeyEpoch) ||
      trustedHighWaterFloor.checkpointKeyEpoch < 1) {
    return 'TRUSTED_CHECKPOINT_FLOOR_REQUIRED';
  }
  if (!exact(checkpointProof, ['statement', 'signatureBase64']) ||
      !validCheckpoint(checkpointProof.statement, CHECKPOINT_PROOF_FIELDS) ||
      typeof checkpointProof.signatureBase64 !== 'string') return 'CHECKPOINT_PROOF_REQUIRED';
  const s = checkpointProof.statement;
  if (s.schemaVersion !== 1 || s.checkpointKeyId !== trustedCheckpointRoot.keyId ||
      s.checkpointKeyEpoch !== trustedCheckpointRoot.keyEpoch) {
    return 'CHECKPOINT_ROOT_OR_EPOCH_MISMATCH';
  }
  if (!validNonce(expectedNonce) || s.requestNonce !== expectedNonce) return 'CHECKPOINT_NONCE_MISMATCH';
  if (!freshWindow(nowMs, s.issuedAt, s.expiresAt)) return 'CHECKPOINT_EXPIRED_OR_INVALID';
  if (!sameBinding(trustedHighWaterFloor.binding, s.binding)) return 'CHECKPOINT_FLOOR_BINDING_MISMATCH';
  const failure = signatureFailure(trustedCheckpointRoot, checkpointSignedBytes(s), checkpointProof.signatureBase64);
  if (failure) return 'CHECKPOINT_' + failure;

  const floor = trustedHighWaterFloor;
  if (s.checkpointRevision < floor.checkpointRevision || s.maxSequence < floor.maxSequence ||
      s.keyEpoch < floor.keyEpoch || s.checkpointKeyEpoch < floor.checkpointKeyEpoch) {
    return 'CHECKPOINT_FLOOR_ROLLBACK';
  }
  if (s.checkpointRevision === floor.checkpointRevision &&
      (s.maxSequence !== floor.maxSequence || s.keyEpoch !== floor.keyEpoch ||
       s.journalDigestSha256 !== floor.journalDigestSha256 ||
       s.pendingReservedCount !== floor.pendingReservedCount)) {
    return 'CHECKPOINT_FLOOR_FORK';
  }
  const trustedCheckpoint = {
    binding: { ...s.binding, allowedSymbols: [...s.binding.allowedSymbols] },
    maxSequence: s.maxSequence,
    journalDigestSha256: s.journalDigestSha256,
    pendingReservedCount: s.pendingReservedCount,
    keyEpoch: s.keyEpoch,
    checkpointRevision: s.checkpointRevision,
  };
  const witnessFailure = authenticateWitness({
    localJournal, witnessProof, trustedWitnessRoot, trustedCheckpoint, expectedNonce, nowMs,
  });
  if (witnessFailure) return witnessFailure;
  if (trustedWitnessRoot.keyEpoch !== s.keyEpoch) return 'CHECKPOINT_WITNESS_EPOCH_MISMATCH';
  return { ...trustedCheckpoint, checkpointKeyEpoch: s.checkpointKeyEpoch };
}

/**
 * Review-only verification with separately pinned signers and a retained
 * floor. Verification never changes the floor or authorizes broker execution.
 */
export function compareFollowerJournalWithCheckpointProof(input = {}) {
  const verified = authenticateCheckpointProof(input);
  return typeof verified === 'string' ? blocked(verified) : compareLocalJournal(input.localJournal, verified);
}

/**
 * Review-only model for verifying and retaining the floor in one transaction.
 * The fixture adapter serializes each binding and returns the callback's
 * decision only after the requested commit is acknowledged.
 */
export async function compareAndRetainSyntheticFollowerCheckpoint({ adapter, bindingKey, ...input } = {}) {
  if (!adapter || typeof adapter.transact !== 'function' ||
      typeof bindingKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(bindingKey)) {
    return blocked('CHECKPOINT_FLOOR_TRANSACTION_REQUIRED');
  }
  try {
    let proposal;
    const result = await adapter.transact(bindingKey, floor => {
      const verified = authenticateCheckpointProof({ ...input, trustedHighWaterFloor: floor });
      if (typeof verified === 'string') {
        proposal = { commit: false, decision: { ok: false, comparison: blocked(verified) } };
        return proposal;
      }
      // Keep independently verified evidence even if the local journal needs reconciliation.
      const decision = { ok: true, comparison: compareLocalJournal(input.localJournal, verified) };
      const advanced = verified.checkpointRevision > floor.checkpointRevision ||
        verified.checkpointKeyEpoch > floor.checkpointKeyEpoch;
      proposal = advanced ? { commit: true, next: verified, decision } : { commit: false, decision };
      return proposal;
    });
    if (proposal && result?.committed === proposal.commit && result.decision === proposal.decision) {
      return proposal.decision.comparison;
    }
  } catch {
    // A lost acknowledgement leaves the observation blocked until a fresh read.
  }
  return blocked('CHECKPOINT_FLOOR_TRANSACTION_UNCERTAIN');
}

export const FOLLOWER_WITNESS_DOMAIN = DOMAIN;
export const FOLLOWER_CHECKPOINT_DOMAIN = CHECKPOINT_DOMAIN;
