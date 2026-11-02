/**
 * Strict restore-proof key lifecycle gate (P0 #176).
 *
 * The caller MUST supply an independently authenticated keyring AND a
 * separately durable trusted epoch (KMS/HSM/operator authority). Merely
 * putting both values in a restorable customer database defeats this gate.
 * No network, filesystem, secret-key access, customer activation or MT5 I/O.
 */
import { verifySignedRestoreAuthority } from "./customer-restore-authority-signed-proof.mjs";

const deny = reasonCode => Object.freeze({ allowed: false, reasonCode });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const safeMs = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

/**
 * Verifies a nonce-bound Ed25519 restore proof against a time-limited,
 * explicitly ACTIVE key and an independently pinned keyring epoch.
 *
 * A PASS is ONLY a cryptographic/counter comparison; it never authorizes
 * Gateway startup, trading, restore, customer release or live access.
 */
export function verifyRestoreAuthorityWithKeyLifecycle({
  restored, statement, signatureBase64, keyring,
  trustedKeyringEpoch, expectedNonce, nowMs,
} = {}) {
  try {
    if (!safeMs(nowMs) || !Number.isSafeInteger(trustedKeyringEpoch) ||
        trustedKeyringEpoch < 1) return deny("AUTHORITY_TRUST_ANCHOR_MISSING");
    if (!exactKeys(keyring, ["epoch", "keys"]) || !object(keyring.keys) ||
        !Number.isSafeInteger(keyring.epoch) || keyring.epoch < 1) {
      return deny("AUTHORITY_KEYRING_INVALID");
    }
    if (keyring.epoch < trustedKeyringEpoch) return deny("AUTHORITY_KEYRING_ROLLBACK");
    if (keyring.epoch > trustedKeyringEpoch) return deny("AUTHORITY_KEYRING_UNVERIFIED_EPOCH");
    if (!object(statement) || typeof statement.authorityKeyId !== "string" ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(statement.authorityKeyId)) {
      return deny("AUTHORITY_SIGNER_ID_INVALID");
    }
    if (!Object.hasOwn(keyring.keys, statement.authorityKeyId)) {
      return deny("AUTHORITY_SIGNING_KEY_UNKNOWN");
    }
    const entry = keyring.keys[statement.authorityKeyId];
    if (!exactKeys(entry, ["publicKeyPem", "status", "notBeforeMs", "notAfterMs"]) ||
        typeof entry.publicKeyPem !== "string" || !entry.publicKeyPem ||
        entry.publicKeyPem.length > 8192 ||
        !safeMs(entry.notBeforeMs) || !safeMs(entry.notAfterMs) ||
        entry.notAfterMs <= entry.notBeforeMs ||
        (entry.status !== "ACTIVE" && entry.status !== "REVOKED")) {
      return deny("AUTHORITY_SIGNING_KEY_INVALID");
    }
    if (entry.status !== "ACTIVE") return deny("AUTHORITY_SIGNING_KEY_REVOKED");
    if (!safeMs(statement.issuedAt) || !safeMs(statement.expiresAt) ||
        statement.issuedAt < entry.notBeforeMs ||
        statement.expiresAt > entry.notAfterMs ||
        nowMs < entry.notBeforeMs || nowMs >= entry.notAfterMs) {
      return deny("AUTHORITY_SIGNING_KEY_OUTSIDE_VALIDITY");
    }
    // No untrusted fallback key, including on lookup or signature failure.
    const trustedPublicKeys = Object.create(null);
    trustedPublicKeys[statement.authorityKeyId] = entry.publicKeyPem;
    return verifySignedRestoreAuthority({
      restored, statement, signatureBase64, trustedPublicKeys,
      expectedNonce, nowMs,
    });
  } catch {
    return deny("AUTHORITY_KEYRING_UNAVAILABLE");
  }
}
