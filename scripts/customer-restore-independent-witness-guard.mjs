/**
 * P0 #176, PURE SYNTHETIC REVIEW HELPER ONLY.
 *
 * Two DIFFERENT signature roots must validate a fresh candidate and a
 * separately obtained high-water witness. This cannot establish that either
 * trusted root is independently administered, the witness is non-rollbackable,
 * or a live customer Gateway is safe to start. Never wire into live startup.
 *
 * No filesystem, network, Gateway, MT5, key issuance, or customer mutation.
 */
import { createPublicKey } from "node:crypto";
import { verifySignedRestoreAuthority } from "./customer-restore-authority-signed-proof.mjs";

const reject = reasonCode => Object.freeze({
  evidenceMatched: false, customerAuthorizationAllowed: false, reasonCode,
});
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A result of evidenceMatched=true is a synthetic cross-proof comparison,
 * NOT an admission decision, release signature or license activation.
 *
 * The trustedWitnessPublicKeys and witnessProof MUST in reality be sourced
 * from a separate durable, anti-rollback, independently administered trust
 * domain. Caller-supplied keys alone do not supply that security boundary.
 */
export function compareRestoreWithIndependentWitness({
  restored, operatorProof, trustedOperatorPublicKeys,
  witnessProof, trustedWitnessPublicKeys, expectedNonce, nowMs,
} = {}) {
  if (!object(restored) || !object(operatorProof) || !object(witnessProof) ||
      !object(operatorProof.statement) || !object(witnessProof.statement) ||
      !object(trustedOperatorPublicKeys) || !object(trustedWitnessPublicKeys) ||
      typeof expectedNonce !== "string" || expectedNonce.length < 16 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return reject("INDEPENDENT_WITNESS_REQUIRED");
  }
  const operatorKeyId = operatorProof.statement.authorityKeyId;
  const witnessKeyId = witnessProof.statement.authorityKeyId;
  if (typeof operatorKeyId !== "string" || typeof witnessKeyId !== "string" ||
      !Object.hasOwn(trustedOperatorPublicKeys, operatorKeyId) ||
      !Object.hasOwn(trustedWitnessPublicKeys, witnessKeyId)) {
    return reject("INDEPENDENT_WITNESS_ROOT_UNAVAILABLE");
  }
  // Reject accidentally using the same key material in both proof roles,
  // even if it is aliased under different IDs or PEM whitespace.
  try {
    const operatorKey = createPublicKey(trustedOperatorPublicKeys[operatorKeyId]);
    const witnessKey = createPublicKey(trustedWitnessPublicKeys[witnessKeyId]);
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

  const operatorDecision = verifySignedRestoreAuthority({
    restored,
    statement: operatorProof.statement,
    signatureBase64: operatorProof.signatureBase64,
    trustedPublicKeys: trustedOperatorPublicKeys,
    expectedNonce, nowMs,
  });
  if (!operatorDecision.allowed) {
    return reject("OPERATOR_PROOF_" + operatorDecision.reasonCode);
  }

  // Compare the FULL operator statement (not only customer SQLite) to a
  // separately signed current witness. An old operator file plus old customer
  // copy passes the first check but MUST fail against a newer witness.
  const witnessDecision = verifySignedRestoreAuthority({
    restored: operatorProof.statement,
    statement: witnessProof.statement,
    signatureBase64: witnessProof.signatureBase64,
    trustedPublicKeys: trustedWitnessPublicKeys,
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
