import test from "node:test";
import assert from "node:assert/strict";
import { inspectTrackedPath } from "./check-private-secrets.mjs";

test("tracked private-key and credential filenames are rejected", () => {
  for (const filePath of [
    "keys/master-signing.pem",
    "keys/device-private.key",
    "config/prod.env",
    ".env",
    ".env.production",
    "certs/customer.p12",
    "certs/customer.pfx",
    "ssh/id_rsa",
    "ssh/id_ed25519",
    "config/private-key.json",
    "config/signing-key.json",
    "config/customer-credential.json",
  ]) {
    assert.equal(inspectTrackedPath(filePath), "REJECT", filePath);
  }
});

test("safe documentation and explicit examples are allowed", () => {
  for (const filePath of [
    "docs/public/SECURITY-BOUNDARY.md",
    "docs/private/SELF-HOSTED-CI.md",
    "config/app.env.example",
    "scripts/security/check-private-secrets.test.mjs",
  ]) {
    assert.equal(inspectTrackedPath(filePath), "ALLOW", filePath);
  }
});
