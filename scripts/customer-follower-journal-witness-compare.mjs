/**
 * P0 #176 / #160: SOURCE-ONLY, PURE synthetic anti-rollback contract.
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

/**
 * Verifies a request-bound, purpose-separated Ed25519 synthetic witness.
 * Passing means only that supplied *evidence is internally consistent*.
 * The trusted root/checkpoint MUST be independently authenticated and stored
 * outside the customer and operator backup/restore domain; caller assertions
 * are not evidence of independence. This function never authorizes trading.
 */
export function compareFollowerJournalWithWitness({
  localJournal, witnessProof, trustedWitnessRoot, trustedCheckpoint,
  expectedNonce, nowMs,
} = {}) {
  if (!validSnapshot(localJournal, SNAPSHOT_FIELDS)) return blocked('LOCAL_JOURNAL_INVALID');
  if (!witnessProof || !validSnapshot(witnessProof.statement, STATEMENT_FIELDS) ||
      typeof witnessProof.signatureBase64 !== 'string') return blocked('WITNESS_PROOF_REQUIRED');
  if (!validPinnedRoot(trustedWitnessRoot)) return blocked('PINNED_WITNESS_ROOT_REQUIRED');
  if (!validCheckpoint(trustedCheckpoint)) return blocked('INDEPENDENT_CHECKPOINT_REQUIRED');
  const s = witnessProof.statement;
  if (s.schemaVersion !== 2 || s.authorityKeyId !== trustedWitnessRoot.keyId ||
      s.keyEpoch !== trustedWitnessRoot.keyEpoch ||
      s.keyEpoch < trustedCheckpoint.keyEpoch) return blocked('WITNESS_ROOT_OR_EPOCH_MISMATCH');
  if (!safeCounter(s.checkpointRevision)) return blocked('WITNESS_CHECKPOINT_REVISION_INVALID');
  if (!validNonce(expectedNonce) || s.requestNonce !== expectedNonce) return blocked('WITNESS_NONCE_MISMATCH');
  if (!freshWindow(nowMs, s.issuedAt, s.expiresAt)) return blocked('WITNESS_EXPIRED_OR_INVALID');
  if (!sameBinding(localJournal.binding, s.binding) ||
      !sameBinding(trustedCheckpoint.binding, s.binding)) return blocked('FOLLOWER_BINDING_MISMATCH');
  const witnessFailure = signatureFailure(trustedWitnessRoot, signedBytes(s), witnessProof.signatureBase64);
  if (witnessFailure) return blocked('WITNESS_' + witnessFailure);
  // A signed statement alone is replayable: it must agree with a separately
  // authenticated latest checkpoint, including revision and digest.
  if (s.checkpointRevision < trustedCheckpoint.checkpointRevision) return blocked('WITNESS_CHECKPOINT_REVISION_ROLLBACK');
  if (s.checkpointRevision > trustedCheckpoint.checkpointRevision) return blocked('CHECKPOINT_REVISION_BEHIND_WITNESS');
  if (s.maxSequence < trustedCheckpoint.maxSequence) return blocked('WITNESS_HIGH_WATER_ROLLBACK');
  if (s.maxSequence > trustedCheckpoint.maxSequence) return blocked('CHECKPOINT_BEHIND_WITNESS');
  if (s.journalDigestSha256 !== trustedCheckpoint.journalDigestSha256 ||
      s.pendingReservedCount !== trustedCheckpoint.pendingReservedCount) {
    return blocked('WITNESS_CHECKPOINT_FORK');
  }
  if (localJournal.maxSequence < s.maxSequence) return blocked('LOCAL_JOURNAL_ROLLBACK');
  if (localJournal.maxSequence > s.maxSequence) return blocked('LOCAL_JOURNAL_AHEAD_OF_WITNESS');
  if (localJournal.journalDigestSha256 !== s.journalDigestSha256 ||
      localJournal.pendingReservedCount !== s.pendingReservedCount) {
    return blocked('LOCAL_JOURNAL_FORK');
  }
  if (s.pendingReservedCount !== 0) return blocked('UNRESOLVED_RESERVATIONS');
  return Object.freeze({
    evidenceMatched: true,
    brokerExecutionAllowed: false,
    reasonCode: 'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
  });
}

/**
 * Review-only verification of a checkpoint signed by a key distinct from the
 * witness key. Pins and the retained floor come from trusted state outside
 * the restore domain. The caller supplies a fresh nonce for each request.
 * Verification never changes the floor or authorizes broker execution.
 */
export function compareFollowerJournalWithCheckpointProof({
  localJournal, witnessProof, checkpointProof, trustedWitnessRoot,
  trustedCheckpointRoot, trustedHighWaterFloor, expectedNonce, nowMs,
} = {}) {
  if (!validPinnedRoot(trustedCheckpointRoot)) return blocked('PINNED_CHECKPOINT_ROOT_REQUIRED');
  if (!validPinnedRoot(trustedWitnessRoot)) return blocked('PINNED_WITNESS_ROOT_REQUIRED');
  if (trustedWitnessRoot.publicKeySha256 === trustedCheckpointRoot.publicKeySha256) {
    return blocked('CHECKPOINT_AND_WITNESS_KEYS_MUST_DIFFER');
  }
  if (!validCheckpoint(trustedHighWaterFloor, FLOOR_FIELDS) ||
      !Number.isSafeInteger(trustedHighWaterFloor.checkpointKeyEpoch) ||
      trustedHighWaterFloor.checkpointKeyEpoch < 1) {
    return blocked('TRUSTED_CHECKPOINT_FLOOR_REQUIRED');
  }
  if (!exact(checkpointProof, ['statement', 'signatureBase64']) ||
      !validCheckpoint(checkpointProof.statement, CHECKPOINT_PROOF_FIELDS) ||
      typeof checkpointProof.signatureBase64 !== 'string') return blocked('CHECKPOINT_PROOF_REQUIRED');
  const s = checkpointProof.statement;
  if (s.schemaVersion !== 1 || s.checkpointKeyId !== trustedCheckpointRoot.keyId ||
      s.checkpointKeyEpoch !== trustedCheckpointRoot.keyEpoch) {
    return blocked('CHECKPOINT_ROOT_OR_EPOCH_MISMATCH');
  }
  if (!validNonce(expectedNonce) || s.requestNonce !== expectedNonce) return blocked('CHECKPOINT_NONCE_MISMATCH');
  if (!freshWindow(nowMs, s.issuedAt, s.expiresAt)) return blocked('CHECKPOINT_EXPIRED_OR_INVALID');
  if (!sameBinding(trustedHighWaterFloor.binding, s.binding)) return blocked('CHECKPOINT_FLOOR_BINDING_MISMATCH');
  const failure = signatureFailure(trustedCheckpointRoot, checkpointSignedBytes(s), checkpointProof.signatureBase64);
  if (failure) return blocked('CHECKPOINT_' + failure);

  const floor = trustedHighWaterFloor;
  if (s.checkpointRevision < floor.checkpointRevision || s.maxSequence < floor.maxSequence ||
      s.keyEpoch < floor.keyEpoch || s.checkpointKeyEpoch < floor.checkpointKeyEpoch) {
    return blocked('CHECKPOINT_FLOOR_ROLLBACK');
  }
  if (s.checkpointRevision === floor.checkpointRevision &&
      (s.maxSequence !== floor.maxSequence || s.keyEpoch !== floor.keyEpoch ||
       s.journalDigestSha256 !== floor.journalDigestSha256 ||
       s.pendingReservedCount !== floor.pendingReservedCount)) {
    return blocked('CHECKPOINT_FLOOR_FORK');
  }
  const trustedCheckpoint = {
    binding: s.binding,
    maxSequence: s.maxSequence,
    journalDigestSha256: s.journalDigestSha256,
    pendingReservedCount: s.pendingReservedCount,
    keyEpoch: s.keyEpoch,
    checkpointRevision: s.checkpointRevision,
  };
  return compareFollowerJournalWithWitness({
    localJournal, witnessProof, trustedWitnessRoot, trustedCheckpoint, expectedNonce, nowMs,
  });
}

export const FOLLOWER_WITNESS_DOMAIN = DOMAIN;
export const FOLLOWER_CHECKPOINT_DOMAIN = CHECKPOINT_DOMAIN;
