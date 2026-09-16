import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflowPaths = [
  ".github/workflows/phase7c-canonical-pr-gate.yml",
  ".github/workflows/public-private-boundary-ci.yml",
  ".github/workflows/phase7c-web-live-arm-demo-auto-ci.yml",
  ".github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml",
];

const read = (path) => fs.readFileSync(path, "utf8");

for (const path of workflowPaths) {
  test(`${path} uses only the canonical self-hosted Windows runner`, () => {
    const source = read(path);
    assert.equal(source.includes("ubuntu-latest"), false, `${path} must not use ubuntu-latest`);
    assert.equal(source.includes("windows-latest"), false, `${path} must not use windows-latest`);
    assert.match(source, /runs-on:\s*\[self-hosted, Windows, X64, xauusd-core-ci\]/);
  });
}

test("repository boundary preserves full-history secret scan and remediation validation", () => {
  const source = read(".github/workflows/public-private-boundary-ci.yml");
  for (const required of [
    "zricethezav/gitleaks:v8.24.2",
    "--redact",
    "--log-opts",
    "--all",
    "artifacts/security/gitleaks.json",
    "validate-credential-remediation.mjs",
    "security/credential-remediation.json",
  ]) {
    assert.equal(source.includes(required), true, `boundary must preserve ${required}`);
  }
});

test("canonical gate keeps both linux-equivalent and windows contract job names", () => {
  const source = read(".github/workflows/phase7c-canonical-pr-gate.yml");
  assert.equal(source.includes("canonical-pr-linux"), true);
  assert.equal(source.includes("canonical-pr-windows"), true);
});

test("web LIVE arm and orphan workflows retain their existing safety contract scripts", () => {
  const web = read(".github/workflows/phase7c-web-live-arm-demo-auto-ci.yml");
  const orphan = read(".github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml");
  assert.equal(web.includes("test-phase7c-web-live-arm-demo-auto-source.ps1"), true);
  assert.equal(web.includes("test-phase7b-api-node-production-runtime.mjs"), true);
  assert.equal(orphan.includes("test-phase7c-live-arm-orphan-reconciliation-source.ps1"), true);
  assert.equal(orphan.includes("test-phase7c-web-live-arm-demo-auto-source.ps1"), true);
  assert.equal(orphan.includes("test-phase7b-api-node-production-runtime.mjs"), true);
});
