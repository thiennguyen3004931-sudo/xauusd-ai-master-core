import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAttestation, verifyAttestation } from "./customer-release-attestation.mjs";

const SCHEMA = "xauusd-customer-release-attestation/v1";
const sha = "197803efee5ab2c718c65076d1a9dcb16fe1319f";
const publicCommit = "bdf6dd163afed23d3e5d2079ab5fc94132b2c0bd";
const keyId = "test-ed25519-2026";
const issueDate = "2026-10-25T15:40:00.000Z";

test("signed package verifies only with pinned publisher key and exact bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "release-attestation-test-"));
  try {
    const zipPath = path.join(root, "customer-agent.zip");
    await writeFile(zipPath, Buffer.from("test-zip-fixture-not-for-distribution"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trusted = {
      schema: SCHEMA, signers: [{
        keyId,
        publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
      }]
    };
    const args = {
      zipPath, releaseId: "customer-agent-v1.0.0-rc1",
      sourceCommit: sha, publicContractCommit: publicCommit,
      signerKeyId: keyId, signedAt: issueDate,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    };
    const attestation = await createAttestation(args);
    const result = await verifyAttestation({ zipPath, attestation, trust: trusted });
    assert.equal(result.sourceCommit, sha);
    assert.equal(result.releaseId, args.releaseId);
    assert.equal(result.zipSha256, attestation.zipSha256);

    await assert.rejects(
      verifyAttestation({ zipPath, attestation, trust: { schema: SCHEMA, signers: [] } }),
      /RELEASE_SIGNER_NOT_TRUSTED/
    );
    await assert.rejects(
      verifyAttestation({ zipPath, attestation, trust: { ...trusted, signers: [...trusted.signers, ...trusted.signers] } }),
      /RELEASE_TRUST_SIGNER_INVALID/
    );
    await assert.rejects(
      verifyAttestation({ zipPath, attestation: { ...attestation, sourceCommit: "0".repeat(40) }, trust: trusted }),
      /RELEASE_SIGNATURE_INVALID/
    );
    await assert.rejects(
      verifyAttestation({ zipPath, attestation: { ...attestation, signerKeyId: "other" }, trust: trusted }),
      /RELEASE_SIGNER_NOT_TRUSTED/
    );
    await assert.rejects(
      verifyAttestation({ zipPath, attestation: { ...attestation, signatureBase64: "not base64" }, trust: trusted }),
      /RELEASE_SIGNATURE_FORMAT_INVALID/
    );
    await assert.rejects(
      verifyAttestation({ zipPath, attestation: { ...attestation, unexpected: true }, trust: trusted }),
      /RELEASE_ATTESTATION_FIELDS_INVALID/
    );
    const wrong = path.join(root, "other.zip");
    await writeFile(wrong, Buffer.from("tampered"));
    await assert.rejects(
      verifyAttestation({ zipPath: wrong, attestation, trust: trusted }),
      /RELEASE_ZIP_CHECKSUM_MISMATCH/
    );
    const altered = await createAttestation({ ...args, publicContractCommit: "f".repeat(40) });
    await assert.rejects(
      verifyAttestation({ zipPath, attestation: { ...altered, publicContractCommit: publicCommit }, trust: trusted }),
      /RELEASE_SIGNATURE_INVALID/
    );
    assert.ok((await readFile(zipPath)).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid release IDs, source SHAs and timestamps fail before any signing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "release-invalid-test-"));
  try {
    const zipPath = path.join(root, "test.zip");
    await writeFile(zipPath, Buffer.from("test"));
    const { privateKey } = generateKeyPairSync("ed25519");
    const base = {
      zipPath, releaseId: "customer-agent-v1.0.0",
      sourceCommit: sha, publicContractCommit: publicCommit,
      signerKeyId: keyId, signedAt: issueDate,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    };
    await assert.rejects(createAttestation({ ...base, sourceCommit: "latest" }), /RELEASE_BODY_INVALID/);
    await assert.rejects(createAttestation({ ...base, releaseId: "../package" }), /RELEASE_BODY_INVALID/);
    await assert.rejects(createAttestation({ ...base, signedAt: "yesterday" }), /RELEASE_BODY_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
