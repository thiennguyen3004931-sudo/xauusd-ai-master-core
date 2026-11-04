import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(process.cwd(), ".github", "workflows", "phase7c-final-strategy-runtime-readiness-readonly.yml");
const workflow = readFileSync(workflowPath, "utf8");

for (const required of [
  "Phase7C Final Strategy Runtime Readiness Read-Only",
  "preflight-phase7c-production-readonly-local.ps1",
  "Read-only current-main runtime target check",
  "READ_ONLY_DIAGNOSTIC=TRUE",
  "DEPLOYMENT_MUTATION=NONE",
  "BOT_MODE_MUTATION=NONE",
  "ARM_MUTATION=NONE",
  "MT5_ORDER_MUTATION=NONE",
  "ACCOUNT_SWITCH=NONE",
  "FINAL_STRATEGY_TARGET_EXACT",
  "FINAL_STRATEGY_DEPLOYMENT_READY_WITHOUT_ARM_MUTATION",
  "$arm -eq 'DISARMED'",
  "$botMode -eq 'PAUSE'",
  "$positions -eq '0'",
  "$pending -eq '0'",
]) {
  assert.ok(workflow.includes(required), `missing runtime-readiness safety contract: ${required}`);
}

for (const forbidden of [
  "DISARM_LIVE",
  "ARM_LIVE",
  "lifecycle/stop",
  "lifecycle/start",
  "switch-phase7c-account-mode-local.ps1",
  "rollout-phase7c-production-source-transition-local.ps1",
  "recover-phase7c-runtime-ready-stable-deploy",
  "/v1/orders",
  "/v1/positions/",
  "-Method Post",
  "-Method Patch",
  "-Method Put",
  "-Method Delete",
  "git reset --hard",
  "git checkout main",
  "git pull",
  "git merge",
]) {
  assert.equal(
    workflow.includes(forbidden),
    false,
    `read-only runtime-readiness workflow must not contain mutation primitive: ${forbidden}`,
  );
}

assert.match(
  workflow,
  /EXPECTED_MAIN:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\|\|\s*github\.sha\s*\}\}/,
  "read-only diagnostic must pin expected source to PR base/main SHA",
);
assert.match(
  workflow,
  /persist-credentials:\s*false/,
  "diagnostic checkout must not retain GitHub write credentials",
);
assert.match(
  workflow,
  /RedirectStandardOutput/,
  "canonical preflight raw output should be captured instead of directly printing account identifiers",
);
assert.match(
  workflow,
  /Remove-Item -LiteralPath \$stdout,\$stderr/,
  "captured raw preflight files must be removed",
);

console.log("PHASE7C_FINAL_STRATEGY_RUNTIME_READINESS_READONLY_CONTRACT=PASS");
