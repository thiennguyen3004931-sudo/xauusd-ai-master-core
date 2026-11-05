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

function validBinding(binding) {
  if (!exact(binding, BINDING_FIELDS)) return false;
  if (!canonical(binding.licenseId) || !canonical(binding.installationId) ||
      !canonical(binding.brokerServer) || !Number.isSafeInteger(binding.mt5Login) ||
      binding.mt5Login <= 0 || !Array.isArray(binding.allowedSymbols) ||
      binding.allowedSymbols.length < 1 ||
      binding.allowedSymbols.some(symbol => !canonical(symbol))) return false;
  const uniqueSorted = [...new Set(binding.allowedSymbols)].sort();
  return uniqueSorted.length === binding.allowedSymbols.length &&
    uniqueSorted.every((symbol, index) => symbol === binding.allowedSymbols[index]);
}
function validSnapshot(x, fields) {
  return exact(x, fields) && validBinding(x.binding) &&
    safeCounter(x.maxSequence) && safeCounter(x.pendingReservedCount) &&
    hash(x.journalDigestSha256);
}
function sameBinding(a, b) {
  return BINDING_FIELDS.every(field => field === 'allowedSymbols'
    ? JSON.stringify(a[field]) === JSON.stringify(b[field]) : a[field] === b[field]);
}
function signedBytes(s) {
  return Buffer.from(DOMAIN + JSON.stringify([
    s.schemaVersion, s.authorityKeyId, s.keyEpoch, s.checkpointRevision, s.requestNonce,
    s.issuedAt, s.expiresAt, ...BINDING_FIELDS.map(field => s.binding[field]),
    s.maxSequence, s.journalDigestSha256, s.pendingReservedCount,
  ]), 'utf8');
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
  if (!exact(trustedWitnessRoot, ROOT_FIELDS) || !canonical(trustedWitnessRoot.keyId) ||
      !Number.isSafeInteger(trustedWitnessRoot.keyEpoch) || trustedWitnessRoot.keyEpoch < 1 ||
      typeof trustedWitnessRoot.publicKeyPem !== 'string' ||
      !trustedWitnessRoot.publicKeyPem.includes('BEGIN PUBLIC KEY') ||
      !hash(trustedWitnessRoot.publicKeySha256)) {
    return blocked('PINNED_WITNESS_ROOT_REQUIRED');
  }
  if (!validSnapshot(trustedCheckpoint, CHECKPOINT_FIELDS) ||
      !safeCounter(trustedCheckpoint.checkpointRevision) ||
      !Number.isSafeInteger(trustedCheckpoint.keyEpoch) || trustedCheckpoint.keyEpoch < 1) {
    return blocked('INDEPENDENT_CHECKPOINT_REQUIRED');
  }
  const s = witnessProof.statement;
  if (s.schemaVersion !== 2 || s.authorityKeyId !== trustedWitnessRoot.keyId ||
      s.keyEpoch !== trustedWitnessRoot.keyEpoch ||
      s.keyEpoch < trustedCheckpoint.keyEpoch) return blocked('WITNESS_ROOT_OR_EPOCH_MISMATCH');
  if (!safeCounter(s.checkpointRevision)) return blocked('WITNESS_CHECKPOINT_REVISION_INVALID');
  if (!canonical(expectedNonce) || expectedNonce.length < 16 || expectedNonce.length > 256 ||
      s.requestNonce !== expectedNonce) return blocked('WITNESS_NONCE_MISMATCH');
  if (!safeCounter(nowMs) || !safeCounter(s.issuedAt) || !safeCounter(s.expiresAt) ||
      s.issuedAt > nowMs || s.expiresAt <= nowMs ||
      s.expiresAt - s.issuedAt > 30_000 || s.expiresAt <= s.issuedAt) {
    return blocked('WITNESS_EXPIRED_OR_INVALID');
  }
  if (!sameBinding(localJournal.binding, s.binding) ||
      !sameBinding(trustedCheckpoint.binding, s.binding)) return blocked('FOLLOWER_BINDING_MISMATCH');
  try {
    const key = createPublicKey(trustedWitnessRoot.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return blocked('WITNESS_KEY_INVALID');
    const keyDer = key.export({ format: 'der', type: 'spki' });
    if (createHash('sha256').update(keyDer).digest('hex') !== trustedWitnessRoot.publicKeySha256) {
      return blocked('WITNESS_KEY_PIN_MISMATCH');
    }
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(witnessProof.signatureBase64)) {
      return blocked('WITNESS_SIGNATURE_INVALID');
    }
    const sig = Buffer.from(witnessProof.signatureBase64, 'base64');
    if (sig.length !== 64 || sig.toString('base64') !== witnessProof.signatureBase64 ||
        !verifySignature(null, signedBytes(s), key, sig)) {
      return blocked('WITNESS_SIGNATURE_INVALID');
    }
  } catch {
    return blocked('WITNESS_SIGNATURE_INVALID');
  }
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

export const FOLLOWER_WITNESS_DOMAIN = DOMAIN;
