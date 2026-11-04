/**
 * P0 #176, PURE SYNTHETIC REVIEW HELPER ONLY.
 *
 * Two DIFFERENT pinned signature roots and independently verified keyring
 * epochs must validate a fresh candidate and separately obtained high-water witness.
 * Witness signatures use a dedicated domain that cannot be replayed as
 * operator authority proofs. This cannot establish that either
 * trusted root is independently administered, the witness is non-rollbackable,
 * or a live customer Gateway is safe to start. Never wire into live startup.
 *
 * No filesystem, network, Gateway, MT5, key issuance, or customer mutation.
 */
import { createPublicKey } from "node:crypto";
import { verifyRestoreAuthorityWithKeyLifecycle, verifyRestoreWitnessWithKeyLifecycle } from "./customer-restore-authority-key-lifecycle.mjs";

const reject = reasonCode => Object.freeze({
  evidenceMatched: false, customerAuthorizationAllowed: false, reasonCode,
});
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A result of evidenceMatched=true is a synthetic cross-proof comparison,
 * NOT an admission decision, release signature or license activation.
 *
 * The witness keyring, its expected digest/epoch, and fresh witness proof MUST
 * come from a separately controlled, durable anti-rollback trust domain.
 * Caller-supplied pins and signatures alone do not supply that boundary.
 */
export function compareRestoreWithIndependentWitness({
  restored, operatorProof, operatorKeyring, operatorTrustedEpoch, operatorTrustedDigest,
  witnessProof, witnessKeyring, witnessTrustedEpoch, witnessTrustedDigest,
  expectedNonce, nowMs,
} = {}) {
  if (!object(restored) || !object(operatorProof) || !object(witnessProof) ||
      !object(operatorProof.statement) || !object(witnessProof.statement) ||
      !object(operatorKeyring) || !object(witnessKeyring) ||
      !object(operatorKeyring.keys) || !object(witnessKeyring.keys) ||
      typeof expectedNonce !== "string" || expectedNonce.length < 16 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return reject("INDEPENDENT_WITNESS_REQUIRED");
  }
  const operatorKeyId = operatorProof.statement.authorityKeyId;
  const witnessKeyId = witnessProof.statement.authorityKeyId;
  if (typeof operatorKeyId !== "string" || typeof witnessKeyId !== "string" ||
      !Object.hasOwn(operatorKeyring.keys, operatorKeyId) ||
      !Object.hasOwn(witnessKeyring.keys, witnessKeyId)) {
    return reject("INDEPENDENT_WITNESS_ROOT_UNAVAILABLE");
  }
  // Reject accidentally using the same key material in both proof roles,
  // even if it is aliased under different IDs or PEM whitespace.
  try {
    const operatorKey = createPublicKey(operatorKeyring.keys[operatorKeyId].publicKeyPem);
    const witnessKey = createPublicKey(witnessKeyring.keys[witnessKeyId].publicKeyPem);
    if (operatorKey.asymmetricKeyType !== "ed25519" ||
        witnessKey.asymmetricKeyType !== "ed25519" ||
        operatorKey.export({ type: "spki", format: "der" }).equals(
          witnessKey.export({ type: "spki", format: "der" }),
        )) {
      return reject("INDEPENDENT_WITNESS_ROOT_NOT_SEPARATE");
    }
  } catch {
    return reject("INDEPENDENT_WITNESS_ROOT_INVALID");
  }

  const operatorDecision = verifyRestoreAuthorityWithKeyLifecycle({
    restored,
    statement: operatorProof.statement,
    signatureBase64: operatorProof.signatureBase64,
    keyring: operatorKeyring, trustedKeyringEpoch: operatorTrustedEpoch,
    trustedKeyringSha256Hex: operatorTrustedDigest,
    expectedNonce, nowMs,
  });
  if (!operatorDecision.allowed) {
    return reject("OPERATOR_PROOF_" + operatorDecision.reasonCode);
  }

  // Compare the FULL operator statement (not only customer SQLite) to a
  // separately signed current witness. An old operator file plus old customer
  // copy passes the first check but MUST fail against a newer witness.
  const witnessDecision = verifyRestoreWitnessWithKeyLifecycle({
    restored: operatorProof.statement,
    statement: witnessProof.statement,
    signatureBase64: witnessProof.signatureBase64,
    keyring: witnessKeyring, trustedKeyringEpoch: witnessTrustedEpoch,
    trustedKeyringSha256Hex: witnessTrustedDigest,
    expectedNonce, nowMs,
  });
  if (!witnessDecision.allowed) {
    return reject("INDEPENDENT_WITNESS_" + witnessDecision.reasonCode);
  }
  return Object.freeze({
    evidenceMatched: true,
    customerAuthorizationAllowed: false,
    reasonCode: "SYNTHETIC_SEPARATE_WITNESS_MATCH_ONLY",
  });
}
