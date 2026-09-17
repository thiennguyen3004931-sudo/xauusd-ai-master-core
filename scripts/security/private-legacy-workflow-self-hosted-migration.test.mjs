import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const workflowsDir = path.join(root, ".github", "workflows");
const selfHosted = "runs-on: [self-hosted, Windows, X64, xauusd-core-ci]";

const contracts = [
  {
    file: "phase7c-canonical-pr-gate.yml",
    expectedJobs: 2,
    required: [
      "canonical-linux:",
      "canonical-windows:",
      "shell: pwsh",
      "shell: powershell",
      "pnpm --filter @xauusd/api exec node --import tsx --test src/services/phase7c-runtime-source-attestation.service.test.ts",
      "node --test scripts/test-phase7c-canonical-pr-gate-contract.mjs",
      "node --test scripts/test-repository-workflow-pruning-contract.mjs",
      "pnpm --filter @xauusd/api... build",
      "pnpm --filter @xauusd/web... build",
      "git diff --check",
    ],
  },
  {
    file: "phase7c-live-arm-orphan-reconciliation-ci.yml",
    expectedJobs: 3,
    required: [
      "source-contract-windows:",
      "api-build:",
      "existing-live-arm-regression:",
      "shell: pwsh",
      "shell: powershell",
      ".\\scripts\\test-phase7c-live-arm-orphan-reconciliation-source.ps1",
      "pnpm --filter @xauusd/api... build",
      "node scripts/test-phase7b-api-node-production-runtime.mjs",
      ".\\scripts\\test-phase7c-web-live-arm-demo-auto-source.ps1",
    ],
  },
  {
    file: "phase7c-web-live-arm-demo-auto-ci.yml",
    expectedJobs: 2,
    required: [
      "source-safety-windows:",
      "api-web-build:",
      "shell: pwsh",
      "shell: powershell",
      ".\\scripts\\test-phase7c-web-live-arm-demo-auto-source.ps1",
      "pnpm --filter @xauusd/api... build",
      "node scripts/test-phase7b-api-node-production-runtime.mjs",
      "pnpm --filter @xauusd/web build",
    ],
  },
];

for (const contract of contracts) {
  test(`${contract.file} uses only canonical self-hosted runner labels`, () => {
    const filePath = path.join(workflowsDir, contract.file);
    assert.equal(fs.existsSync(filePath), true, `workflow missing: ${contract.file}`);
    const source = fs.readFileSync(filePath, "utf8");

    assert.equal(
      /runs-on:\s*(?:ubuntu-latest|windows-latest)/.test(source),
      false,
      `RED_TARGET: hosted runner label remains: ${contract.file}`,
    );

    const runLines = source.match(/^\s+runs-on:\s*.+$/gm) ?? [];
    assert.equal(
      runLines.length,
      contract.expectedJobs,
      `unexpected job/runner count in ${contract.file}`,
    );

    const selfHostedCount = runLines.filter((line) => line.trim() === selfHosted).length;
    assert.equal(
      selfHostedCount,
      contract.expectedJobs,
      `RED_TARGET: not every job uses canonical self-hosted labels: ${contract.file}`,
    );

    for (const required of contract.required) {
      assert.equal(
        source.includes(required),
        true,
        `migration changed or removed required contract content in ${contract.file}: ${required}`,
      );
    }
  });
}

test("migration covers exactly seven legacy workflow jobs", () => {
  let total = 0;
  for (const contract of contracts) {
    const source = fs.readFileSync(path.join(workflowsDir, contract.file), "utf8");
    total += (source.match(/^\s+runs-on:\s*\[self-hosted, Windows, X64, xauusd-core-ci\]\s*$/gm) ?? []).length;
  }
  assert.equal(total, 7, "RED_TARGET: SELF_HOSTED_JOB_COUNT must equal 7");
});
