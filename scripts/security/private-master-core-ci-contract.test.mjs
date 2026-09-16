import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const workflowPath = path.join(
  repoRoot,
  ".github/workflows/private-master-core-ci.yml",
);

function readWorkflow() {
  assert.equal(
    fs.existsSync(workflowPath),
    true,
    "private-master-core-ci.yml must exist",
  );
  return fs.readFileSync(workflowPath, "utf8");
}

test("private Master/Core CI targets only the dedicated self-hosted Windows runner", () => {
  const source = readWorkflow();

  assert.match(
    source,
    /runs-on:\s*\[\s*self-hosted\s*,\s*Windows\s*,\s*X64\s*,\s*xauusd-core-ci\s*\]/,
  );
  assert.doesNotMatch(source, /ubuntu-latest|windows-latest|macos-latest/);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(
    source,
    /if:\s*github\.event_name\s*!=\s*[\"']pull_request[\"']\s*\|\|\s*github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/,
  );
});

test("private Master/Core CI checks out the exact trusted head", () => {
  const source = readWorkflow();

  assert.match(
    source,
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/,
  );
  assert.match(source, /git rev-parse HEAD/);
});

test("private Master/Core CI pins toolchain and runs the approved scoped gates", () => {
  const source = readWorkflow();

  assert.match(source, /node-version:\s*24/);
  assert.match(source, /version:\s*10\.18\.0/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  assert.match(source, /pnpm build/);
  assert.match(
    source,
    /scripts\/test-phase7c-telegram-entry-resolution-lifecycle-contract\.mjs/,
  );
  assert.match(
    source,
    /scripts\/test-phase7c-telegram-lifecycle-observability-contract\.mjs/,
  );
  assert.match(source, /scripts\/phase7c-trade-notifier-synthetic\.test\.mjs/);
  assert.match(source, /scripts\/test-phase7c-hold-telegram-dedupe-contract\.mjs/);
  assert.match(source, /scripts\/security\/check-private-secrets\.mjs --tracked/);
  assert.match(source, /node --test scripts\/security\/verify-private-bootstrap\.test\.mjs/);
  assert.match(source, /git diff --check/);
});

test("private Master/Core CI keeps infrastructure PASS separate from full M3 acceptance", () => {
  const source = readWorkflow();

  assert.match(
    source,
    /node scripts\/security\/verify-private-bootstrap\.mjs security\/private-bootstrap-attestation\.json/,
  );
  assert.match(source, /id:\s*m2_provenance/);
  assert.match(source, /id:\s*broader_regression/);
  assert.match(source, /continue-on-error:\s*true/);
  assert.match(source, /run:\s*pnpm test/);
  assert.match(source, /SELF_HOSTED_CI_INFRA=PASS/);
  assert.match(source, /M3_PRIVATE_CI=BLOCKED_M2_PROVENANCE/);
  assert.match(source, /M3_PRIVATE_CI=BLOCKED_BROADER_REGRESSION/);
  assert.match(source, /M3_PRIVATE_CI=GREEN/);
});

test("blocked M3 verdicts fail the GitHub check instead of returning success", () => {
  const source = readWorkflow();

  assert.match(
    source,
    /if \(\$provenance -ne "PASS"\) \{[\s\S]*?M3_PRIVATE_CI=BLOCKED_M2_PROVENANCE[\s\S]*?exit 1[\s\S]*?\}/,
  );
  assert.match(
    source,
    /if \(\$broader -ne "success"\) \{[\s\S]*?M3_PRIVATE_CI=BLOCKED_BROADER_REGRESSION[\s\S]*?exit 1[\s\S]*?\}/,
  );
});

test("private Master/Core CI contains no production mutation or secret wiring", () => {
  const source = readWorkflow();

  for (const forbidden of [
    /ubuntu-latest/i,
    /windows-latest/i,
    /macos-latest/i,
    /mt5.*password/i,
    /telegram.*token/i,
    /signing.*private/i,
    /production.*credential/i,
    /live.*test.*order/i,
    /arm.*live/i,
    /schtasks\s+\/(?:create|change|delete|run)/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
