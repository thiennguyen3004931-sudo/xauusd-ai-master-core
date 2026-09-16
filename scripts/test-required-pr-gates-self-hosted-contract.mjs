import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const SELF_HOSTED = "runs-on: [self-hosted, Windows, X64, xauusd-core-ci]";
const SAME_REPO_GUARD = "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const EXACT_HEAD_REF = "ref: ${{ github.event.pull_request.head.sha || github.sha }}";

const workflows = [
  {
    path: ".github/workflows/phase7c-canonical-pr-gate.yml",
    expectedJobs: 2,
  },
  {
    path: ".github/workflows/public-private-boundary-ci.yml",
    expectedJobs: 1,
  },
  {
    path: ".github/workflows/phase7c-web-live-arm-demo-auto-ci.yml",
    expectedJobs: 2,
  },
  {
    path: ".github/workflows/phase7c-live-arm-orphan-reconciliation-ci.yml",
    expectedJobs: 3,
  },
];

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

test("required PR gates run only on the canonical self-hosted Windows runner and pin the exact PR head", () => {
  for (const workflow of workflows) {
    const source = read(workflow.path);
    const runsOnLines = source.match(/^\s*runs-on:.*$/gm) ?? [];

    assert.equal(
      runsOnLines.length,
      workflow.expectedJobs,
      `${workflow.path}: unexpected job count`,
    );
    for (const line of runsOnLines) {
      assert.equal(
        line.trim(),
        SELF_HOSTED,
        `${workflow.path}: hosted runner remains: ${line.trim()}`,
      );
    }

    assert.equal(
      count(source, SAME_REPO_GUARD),
      workflow.expectedJobs,
      `${workflow.path}: every self-hosted job must reject fork PR execution`,
    );
    assert.equal(
      count(source, EXACT_HEAD_REF),
      workflow.expectedJobs,
      `${workflow.path}: every job must checkout the exact head`,
    );
  }
});

test("public/private boundary keeps full-history Gitleaks evidence without Docker or bash-only commands", () => {
  const source = read(".github/workflows/public-private-boundary-ci.yml");

  assert.match(source, /fetch-depth:\s*0/);
  assert.match(source, /classify-repository\.test\.mjs/);
  assert.match(source, /validate-credential-remediation\.test\.mjs/);
  assert.match(source, /check-public-change-freeze\.mjs/);
  assert.match(source, /gitleaks_8\.24\.2_windows_x64\.zip/);
  assert.match(source, /gitleaks(?:\.exe)? detect/);
  assert.match(source, /--log-opts=--all/);
  assert.match(source, /validate-credential-remediation\.mjs/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(source, /docker\s+run/i);
  assert.doesNotMatch(source, /mkdir\s+-p/i);
});
