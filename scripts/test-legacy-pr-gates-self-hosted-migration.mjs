import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const files = [
  ".github/workflows/phase7c-canonical-pr-gate.yml",
  ".github/workflows/public-private-boundary-ci.yml",
  ".github/workflows/phase7c-web-live-arm-demo-auto-ci.yml",
  ".github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml",
];

const read = (path) => fs.readFileSync(path, "utf8");

for (const path of files) {
  test(`${path} no longer depends on GitHub-hosted runners`, () => {
    const source = read(path);
    assert.equal(source.includes("ubuntu-latest"), false);
    assert.equal(source.includes("windows-latest"), false);
    assert.match(source, /runs-on:\s*\[self-hosted, Windows, X64, xauusd-core-ci\]/);
  });
}

test("canonical gate preserves Linux coverage through WSL Ubuntu with pinned Linux Node and pnpm", () => {
  const source = read(".github/workflows/phase7c-canonical-pr-gate.yml");
  assert.match(source, /wsl\.exe\s+-d\s+Ubuntu/);
  assert.match(source, /node-v24\.18\.0-linux-x64\.tar\.xz/);
  assert.match(source, /10\.18\.0/);
  assert.match(source, /Runtime source attestation service tests/);
  assert.match(source, /Structural and execution safety regressions/);
  assert.match(source, /Broker-native Fixed TP regressions/);
});

test("Windows PowerShell gates retain both PS7 and Windows PowerShell 5.1 execution", () => {
  for (const path of [
    ".github/workflows/phase7c-canonical-pr-gate.yml",
    ".github/workflows/phase7c-web-live-arm-demo-auto-ci.yml",
    ".github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml",
  ]) {
    const source = read(path);
    assert.match(source, /PowerShell-7\.6\.6-win-x64\.zip/);
    assert.match(source, /PORTABLE_PWSH/);
    assert.match(source, /Windows PowerShell 5\.1/);
  }
});

test("repository boundary keeps Gitleaks 8.24.2 full-history semantics without Docker daemon", () => {
  const source = read(".github/workflows/public-private-boundary-ci.yml");
  assert.equal(source.includes("docker run"), false);
  assert.match(source, /gitleaks_8\.24\.2_windows_x64\.zip/);
  assert.match(source, /--redact/);
  assert.match(source, /--log-opts/);
  assert.match(source, /--all/);
  assert.match(source, /validate-credential-remediation\.mjs/);
  assert.match(source, /redacted-gitleaks-report/);
});

test("migration remains CI-only and does not authorize production mutation", () => {
  const joined = files.map(read).join("\n");
  for (const forbidden of [
    "LIVE_EXECUTION_ARMED=ARMED",
    "BOT_MODE=AUTO",
    "LIVE_TEST_ORDER",
    "order_send",
    "positions_close",
  ]) {
    assert.equal(joined.includes(forbidden), false, `workflow migration must not contain ${forbidden}`);
  }
});
