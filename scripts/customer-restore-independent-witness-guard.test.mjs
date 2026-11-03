import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { compareRestoreWithIndependentWitness as compare } from "./customer-restore-independent-witness-guard.mjs";
import { issueRestoreAuthorityProof } from "./customer-restore-authority-proof-issuer.mjs";
import { verifySignedRestoreAuthority } from "./customer-restore-authority-signed-proof.mjs";

const NOW = 1_800_000_000_000;
const NONCE = "synthetic-fresh-nonce-across-two-separate-authorities";
function pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}
const operatorKey = pair();
const witnessKey = pair();
const rogueKey = pair();
const active = Object.freeze({
  customerId: "synthetic-customer", installationId: "synthetic-installation",
  licenseId: "synthetic-license", grantId: "synthetic-grant",
  bindingEpoch: "synthetic-binding-1", authorizationState: "ACTIVE",
  revocationGeneration: 1, migrationGeneration: 1,
  challengeConsumptionGeneration: 1, auditHighWater: 1, tokenGeneration: 1,
});
const roots = Object.freeze({
  trustedOperatorPublicKeys: { operatorV1: operatorKey.publicKeyPem },
  trustedWitnessPublicKeys: { witnessV1: witnessKey.publicKeyPem },
});
function sign(authority, role, key, nonce = NONCE, at = NOW) {
  const proof = issueRestoreAuthorityProof({
    authority, authorityKeyId: role,
    privateKeyPem: key.privateKeyPem, requestNonce: nonce,
    nowMs: at, ttlMs: 10_000,
  });
  assert.equal(proof.ok, true);
  return proof;
}
function check(restored = active, options = {}) {
  return compare({
    restored,
    operatorProof: sign(active, "operatorV1", operatorKey),
    witnessProof: sign(active, "witnessV1", witnessKey),
    ...roots,
    expectedNonce: NONCE,
    nowMs: NOW + 1000,
    ...options,
  });
}
function denied(result, code) {
  assert.equal(result.evidenceMatched, false);
  assert.equal(result.customerAuthorizationAllowed, false);
  assert.equal(result.reasonCode, code);
}

test("two separately signed fresh matching synthetic proofs reconcile WITHOUT granting access", () => {
  const result = check();
  assert.deepEqual(result, {
    evidenceMatched: true,
    customerAuthorizationAllowed: false,
    reasonCode: "SYNTHETIC_SEPARATE_WITNESS_MATCH_ONLY",
  });
  assert.equal(Object.hasOwn(result, "allowed"), false);
  assert.equal(Object.hasOwn(result, "releaseAuthorized"), false);
});

for (const mode of ["SELF_MANAGED", "COPY_FOLLOWER"]) {
  test(mode + ": old customer backup plus rolled-back operator file is denied by latest independent witness", () => {
    const revokedAtWitness = {
      ...active, authorizationState: "REVOKED",
      revocationGeneration: 2, auditHighWater: 2,
    };
    // Attack restores BOTH customer and operator; old operator still signs ACTIVE.
    const oldOperatorProof = sign(active, "operatorV1", operatorKey);
    const oldCandidate = { ...active };
    assert.equal(verifySignedRestoreAuthority({
      restored: oldCandidate, statement: oldOperatorProof.statement,
      signatureBase64: oldOperatorProof.signatureBase64,
      trustedPublicKeys: roots.trustedOperatorPublicKeys,
      expectedNonce: NONCE, nowMs: NOW + 1000,
    }).allowed, true, "original single-proof check demonstrably accepts the combined rollback");

    const decision = check(oldCandidate, {
      operatorProof: oldOperatorProof,
      witnessProof: sign(revokedAtWitness, "witnessV1", witnessKey),
    });
    denied(decision, "INDEPENDENT_WITNESS_RESTORE_GENERATION_ROLLBACK");
  });
}

test("independent witness rejects restored challenge consumption and token rotation high-water rollback", () => {
  for (const counter of ["challengeConsumptionGeneration", "tokenGeneration", "migrationGeneration"]) {
    const newer = { ...active, [counter]: active[counter] + 1, auditHighWater: 2 };
    denied(check(active, {
      witnessProof: sign(newer, "witnessV1", witnessKey),
    }), "INDEPENDENT_WITNESS_RESTORE_GENERATION_ROLLBACK");
  }
});

test("newer customer/old operator proof cannot be reconciled by the separate witness", () => {
  const newer = { ...active, challengeConsumptionGeneration: 2, auditHighWater: 2 };
  denied(check(newer, {
    witnessProof: sign(newer, "witnessV1", witnessKey),
  }), "OPERATOR_PROOF_RESTORE_GENERATION_AHEAD_OF_AUTHORITY");
});

test("proofs with wrong witness signer and missing pinned root never reconcile", () => {
  denied(check(active, {
    witnessProof: sign(active, "witnessV1", rogueKey),
  }), "INDEPENDENT_WITNESS_AUTHORITY_SIGNATURE_INVALID");
  denied(check(active, {
    trustedWitnessPublicKeys: {},
  }), "INDEPENDENT_WITNESS_ROOT_UNAVAILABLE");
  denied(check(active, {
    witnessProof: undefined,
  }), "INDEPENDENT_WITNESS_REQUIRED");
});

test("same key under different IDs cannot masquerade as independent witness", () => {
  denied(check(active, {
    witnessProof: sign(active, "witnessV1", operatorKey),
    trustedWitnessPublicKeys: { witnessV1: operatorKey.publicKeyPem },
  }), "INDEPENDENT_WITNESS_ROOT_NOT_SEPARATE");
});

test("witness signature replay for a different nonce or after expiry is rejected", () => {
  denied(check(active, {
    witnessProof: sign(active, "witnessV1", witnessKey, "nonce-from-old-restore-request-123456"),
  }), "INDEPENDENT_WITNESS_AUTHORITY_NONCE_OR_VERSION_INVALID");
  denied(check(active, {
    nowMs: NOW + 10_000,
  }), "OPERATOR_PROOF_AUTHORITY_FRESHNESS_INVALID");
});

test("identity replacement, missing witness, and invalid root format all fail closed", () => {
  denied(check({ ...active, installationId: "another-synthetic-installation" }),
    "OPERATOR_PROOF_RESTORE_BINDING_MISMATCH");
  denied(check(active, { trustedWitnessPublicKeys: { witnessV1: "malformed-public-key" } }),
    "INDEPENDENT_WITNESS_ROOT_INVALID");
  denied(compare(), "INDEPENDENT_WITNESS_REQUIRED");
});

test("current revoked authority never grants customer access even if both signatures agree", () => {
  const revoked = { ...active, authorizationState: "REVOKED", revocationGeneration: 2, auditHighWater: 2 };
  denied(check(revoked, {
    operatorProof: sign(revoked, "operatorV1", operatorKey),
    witnessProof: sign(revoked, "witnessV1", witnessKey),
  }), "OPERATOR_PROOF_RESTORE_NOT_ACTIVE");
});
