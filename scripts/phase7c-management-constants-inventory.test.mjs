// T1 — Phase 7C management-constant inventory guard (source-only, no MT5).
// Asserts that every SL/BE/partial/FastMove/buffer constant listed in
// docs/operations/phase7c-management-constants-inventory.md still has the
// documented value in source, and that the document lists every entry.
// A failure means the inventory drifted: update the doc in a reviewed PR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/operations/phase7c-management-constants-inventory.md";

// [id, file, exact source snippet, scope]
export const INVENTORY = [
  // TREND runtime (run-phase7c-trend-account-mode.mjs -> run-phase7c-trend-controller.mjs -> run-phase7b-demo-controller.ts)
  ["TR-MIN-SL", "scripts/run-phase7b-demo-controller.ts", "const MIN_INITIAL_SL_PRICE = 6;", "RUNTIME"],
  ["TR-MAX-SL", "scripts/run-phase7b-demo-controller.ts", "const MAX_INITIAL_SL_PRICE = 10;", "RUNTIME"],
  ["TR-PULLBACK-WAIT", "scripts/run-phase7b-demo-controller.ts", "const pullbackWaitMinutes = 15;", "RUNTIME"],
  ["TR-FM-ACT", "scripts/run-phase7b-demo-controller.ts", "const FAST_MOVE_PROFIT_LOCK_ACTIVATION_PRICE = 10;", "RUNTIME"],
  ["TR-FM-GIVEBACK", "scripts/run-phase7b-demo-controller.ts", "const FAST_MOVE_PROFIT_LOCK_GIVEBACK_PRICE = 10;", "RUNTIME"],
  ["TR-BE-TRIGGER", "scripts/run-phase7b-demo-controller.ts", "if (!managed.breakEvenApplied && favorable >= managedBreakEvenTriggerPrice(managed)) {", "RUNTIME"],
  ["TR-BE-OFFSET", "scripts/run-phase7b-demo-controller.ts", "offsetPrice: breakEvenRule.breakEvenOffsetPrice,", "RUNTIME"],
  ["TR-PARTIAL", "scripts/run-phase7b-demo-controller.ts", "if (!managed.partialApplied && favorable >= 10) {", "RUNTIME"],
  ["TR-FIXED-TP-ON", "scripts/run-phase7b-demo-controller.ts", 'process.env.ZIQ_PHASE7C_TREND_FIXED_TP_ENABLED ?? "false"', "RUNTIME"],
  ["TR-FIXED-TP-DIST", "scripts/run-phase7b-demo-controller.ts", 'process.env.ZIQ_PHASE7C_TREND_FIXED_TP_DISTANCE ?? "0"', "RUNTIME"],
  ["SHARED-STRUCT-BUFFER", "scripts/phase7c-stop-monotonicity.mjs", "export const STRUCTURAL_STOP_BUFFER_PRICE = 1;", "RUNTIME"],
  // SIDEWAY runtime (run-phase7c-sideway-locked.mjs -> run-phase7c-sideway-account-mode.mjs -> run-phase7c-sideway-controller.mjs)
  ["SW-MIN-SL", "scripts/phase7c-sideway-logic.mjs", "const MIN_INITIAL_STOP_DISTANCE = 6;", "RUNTIME"],
  ["SW-MAX-SL", "scripts/phase7c-sideway-logic.mjs", "const MAX_INITIAL_STOP_DISTANCE = 10;", "RUNTIME"],
  ["SW-RANGE-BUFFER", "scripts/phase7c-sideway-logic.mjs", "const buffer = Math.max(atr * 0.25, brokerGap, point * 20);", "RUNTIME"],
  ["SW-TP1-LEGACY", "scripts/phase7c-sideway-logic.mjs", "const tp1 = side === \"BUY\" ? entry + 10 : entry - 10;", "RUNTIME_DISPLAY_ONLY"],
  ["SW-MIN-RR", "scripts/phase7c-sideway-logic.mjs", "if (rewardRisk < 1.2) {", "RUNTIME"],
  ["SW-FM-ACT", "scripts/run-phase7c-sideway-controller.mjs", "const FAST_MOVE_PROFIT_LOCK_ACTIVATION_PRICE = 10;", "RUNTIME"],
  ["SW-FM-GIVEBACK", "scripts/run-phase7c-sideway-controller.mjs", "const FAST_MOVE_PROFIT_LOCK_GIVEBACK_PRICE = 10;", "RUNTIME"],
  ["SW-BE-TRIGGER", "scripts/run-phase7c-sideway-controller.mjs", "if (!managed.breakEvenApplied && favorable >= managedBreakEvenTriggerPrice(managed)) {", "RUNTIME"],
  ["SW-BE-OFFSET", "scripts/run-phase7c-sideway-controller.mjs", "offsetPrice: breakEvenRule.breakEvenOffsetPrice,", "RUNTIME"],
  // T2 shared BE config (TREND + SIDEWAY + SEMI), env-overridable, snapshotted at entry
  ["BE-DEFAULT-TRIGGER", "scripts/phase7c-break-even-config.mjs", "export const DEFAULT_BREAK_EVEN_TRIGGER_PRICE = 6;", "RUNTIME"],
  ["BE-DEFAULT-OFFSET", "scripts/phase7c-break-even-config.mjs", "export const DEFAULT_BREAK_EVEN_OFFSET_PRICE = 0;", "RUNTIME"],
  // SEMI runtime (adapter injected into TREND controller)
  ["SEMI-INIT-SL", "scripts/phase7c-semi-trend-adoption-runtime.mjs", "const INITIAL_STOP_DISTANCE = 6;", "RUNTIME"],
  // Control API (runs beside the bot; plan / replay / display, does not send management commands)
  ["API-7C-MIN", "apps/api/src/services/phase7c.service.ts", "const MIN_STOP = 6;", "API_REPLAY"],
  ["API-7C-MAX", "apps/api/src/services/phase7c.service.ts", "const MAX_STOP = 10;", "API_REPLAY"],
  ["API-7C-BE", "apps/api/src/services/phase7c.service.ts", "const BREAK_EVEN_TRIGGER = 6;", "API_REPLAY"],
  ["API-7C-PARTIAL", "apps/api/src/services/phase7c.service.ts", "const PARTIAL_TRIGGER = 10;", "API_REPLAY"],
  ["API-MONITOR-BE", "apps/api/src/services/phase7c-decision-monitor.service.ts", "breakEvenTriggerDistance: 6,", "API_DISPLAY"],
  ["AUDIT-BE", "scripts/phase7c-decision-audit.mjs", "breakEvenTriggerDistance: 6,", "RUNTIME_DISPLAY_ONLY"],
  ["API-SEMI-PLAN-BE-R", "apps/api/src/services/phase7c-semi-trend-management-plan.service.ts", "const TREND_BREAK_EVEN_AT_R = 1;", "API_UNWIRED"],
  ["API-SEMI-PLAN-PARTIAL", "apps/api/src/services/phase7c-semi-trend-management-plan.service.ts", "const SEMI_PARTIAL_CLOSE_PRICE_GAIN = 10;", "API_UNWIRED"],
  ["API-7D-MIN", "apps/api/src/services/phase7d-management.service.ts", "const MIN_STOP = 6;", "API_RESEARCH"],
  ["API-7D-SCALE-P2", "apps/api/src/services/phase7d-daily-scale.service.ts", "const SECOND_PARTIAL_TRIGGER = 20;", "API_RESEARCH"],
  ["API-7E-BE", "apps/api/src/services/phase7e-realignment.service.ts", "const BREAK_EVEN_TRIGGER = 6;", "API_RESEARCH"],
  ["API-7E-ST-BE", "apps/api/src/services/phase7e-supertrend.service.ts", "const BREAK_EVEN_TRIGGER = 6;", "API_RESEARCH"],
  ["API-CF-GIVEBACK", "apps/api/src/services/phase7c-counterfactual-evaluator.service.ts", "const CURRENT_GIVEBACK_PRICE = 10;", "API_RESEARCH"],
  // Research-only
  ["RS-4C-BE-OFFSET", "packages/risk-engine/src/services/Phase4ShadowReplayService.ts", "breakEvenOffsetPrice: 0.1,", "RESEARCH"],
  ["RS-7B-BE", "packages/risk-engine/src/services/Phase7BDualPatternTrendRiderService.ts", "breakEvenTriggerPrice: 6,", "RESEARCH"],
  ["RS-FVG-AB-BE", "scripts/run-phase7b-fvg-ab-comparison.ts", "const BREAK_EVEN_TRIGGER = 6;", "RESEARCH"],
  ["RS-EXEC-ENGINE-BE", "packages/execution-engine/src/config/defaultExecutionEngineConfig.ts", "breakEvenOffsetTicks: 1,", "RESEARCH"],
  ["RS-STRATEGY-ENGINE-BE", "packages/strategy-engine/src/config/defaultStrategyEngineConfig.ts", "breakEvenAtR: 1,", "RESEARCH"],
];

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("every inventoried constant still has its documented value in source", () => {
  for (const [id, file, snippet] of INVENTORY) {
    assert.ok(read(file).includes(snippet), `${id}: '${snippet}' not found in ${file}`);
  }
});

test("inventory document exists and lists every entry with its file and scope", () => {
  assert.ok(fs.existsSync(path.join(root, DOC)), `${DOC} missing`);
  const doc = read(DOC);
  for (const [id, file, , scope] of INVENTORY) {
    const row = doc.split("\n").find((line) => line.startsWith(`| ${id} |`));
    assert.ok(row, `${id} row missing from ${DOC}`);
    assert.ok(row.includes(`\`${file}:`), `${id} row must cite ${file}:<line>`);
    assert.ok(row.includes(scope), `${id} row must be tagged ${scope}`);
  }
});

test("documented line numbers point at the snippet", () => {
  const doc = read(DOC);
  for (const [id, file, snippet] of INVENTORY) {
    const row = doc.split("\n").find((line) => line.startsWith(`| ${id} |`));
    const match = row?.match(new RegExp("`" + file.replaceAll(".", "\\.") + ":(\\d+)`"));
    assert.ok(match, `${id}: no line number`);
    const line = read(file).split("\n")[Number(match[1]) - 1] ?? "";
    assert.ok(line.includes(snippet.split("\n")[0].slice(0, 40)), `${id}: ${file}:${match[1]} is '${line.trim()}'`);
  }
});
