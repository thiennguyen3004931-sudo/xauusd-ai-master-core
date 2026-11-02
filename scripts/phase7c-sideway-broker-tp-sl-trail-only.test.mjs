import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { transformPhase7CSidewayM5TrailingSource } from "./phase7c-m5-structural-trailing-source-adapter.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, "run-phase7c-sideway-controller.mjs"), "utf8");
const start = source.indexOf("async function managePosition(");
const end = source.indexOf("async function closeAll(", start);
assert.ok(start >= 0 && end > start, "SIDEWAY managed-position body required");
const managedSource = source.slice(start, end);

function syntheticCycle({ dailyMode = "SIDEWAY_NATIVE", quoteBid = 2500, quoteAsk = 2500.2 } = {}) {
  const actions = [];
  const events = [];
  const managed = {
    ticket: "synthetic-ticket-1", side: "BUY", entry: 2500,
    timeStopAt: 1, lastRegimeCloseChecked: 10, lastHoldM15Key: "",
    dailyMode, breakEvenApplied: false, fastMovePeakPrice: 2500,
    fastMoveStop: 2490, fastMoveAttempt: 0, breakEvenAttempt: 0,
    tp1: 2510, tp2: 2512, partialApplied: false, partialAttempt: 0,
    initialVolume: 0.03, expectedRemainingVolume: 0.03,
  };
  const state = { managed };
  const context = vm.createContext({
    state,
    brokerTpSlTrailOnly: true,
    maxHoldingMinutes: 180,
    maxQuoteAgeMs: 30000,
    maxM15AgeMs: 30000,
    FAST_MOVE_PROFIT_LOCK_ACTIVATION_PRICE: 10,
    FAST_MOVE_PROFIT_LOCK_GIVEBACK_PRICE: 10,
    symbol: "XAUUSD",
    regimeCandleCount: 320,
    Date: { now: () => 1000000000 },
    Number, Math,
    journal: (name, data) => events.push({ name, data }),
    saveState: () => {},
    controlGet: async () => { throw new Error("regime API must not be queried after fill"); },
    bridgeRequest: async (method, url, body) => {
      actions.push({ method, url, body });
      if (method === "POST") throw new Error("synthetic broker close prohibited");
      if (method !== "PATCH") throw new Error("unexpected method");
      return { success: true };
    },
    evaluateTimestampFreshness: () => ({ fresh: true }),
    recordManagementExitSideSample: () => {},
    roundPrice: (n, digits) => Number(n.toFixed(digits)),
    stopIsAtLeastAsTight: (side, current, target) => side === "BUY" ? current >= target : current <= target,
    stopStrictlyTightens: (side, prev, next) => side === "BUY" ? next > prev : next < prev,
    tightestKnownStop: (side, ...stops) => side === "BUY" ? Math.max(...stops) : Math.min(...stops),
    fastMoveProfitLockCandidate: ({ entry }) => ({ active: false, peakPrice: entry }),
    canonicalHoldReason: () => null,
  });
  vm.runInContext(managedSource + "\nthis.managePosition = managePosition;", context);
  const position = { ticket: managed.ticket, side: "LONG", entry: managed.entry, stopLoss: 2490, takeProfit: 2520, volume: 0.03 };
  const quote = { bid: quoteBid, ask: quoteAsk, timestamp: 1000000000 };
  const spec = { digits: 2, stopsLevelTicks: 0, freezeLevelTicks: 0, point: 0.01, minVolume: 0.01, volumeStep: 0.01 };
  return { context, managed, actions, events, position, quote, spec };
}

test("SIDEWAY entry checks remain unchanged; post-fill mode is locked without environment override", () => {
  const preEntry = source.slice(source.indexOf("async function cycle()"), source.indexOf("function readStrategyEntryConfigSnapshot()"));
  for (const expected of [
    'const permission = resolveSidewayPermission(activeMode, "SIDEWAY")',
    'evaluateStrategyEntryConditions({',
    'minimumRegimeConfidence:',
    'm5Confirmation:',
    'const finalPermission = resolveSidewayPermission(freshMode?.state?.mode, "SIDEWAY")',
    'ENTRY_FINAL_GATE_BLOCK',
    'ENTRY_SUBMIT',
    'stopLoss: executionPlan.stopLoss',
    'takeProfit: brokerTakeProfit',
  ]) assert.ok(preEntry.includes(expected), "entry safeguard not present: " + expected);
  assert.match(source, /const brokerTpSlTrailOnly = true;/);
  assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*(?:EXIT_POLICY|BROKER_TARGETS_ONLY|BROKER_TP_SL_TRAIL)/);
});

test("newly filled SIDEWAY with expired holding timer cannot be closed by TIME_STOP", async () => {
  const f = syntheticCycle();
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.deepEqual(f.actions, []);
  assert.equal(f.events.some(e => e.name === "POSITION_CLOSED"), false);
  assert.equal(f.events.some(e => e.name === "SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY"), true);
});

test("new M15 regime change after fill cannot trigger close or re-query regime", async () => {
  const f = syntheticCycle({ dailyMode: "SIDEWAY_NATIVE" });
  f.managed.lastRegimeCloseChecked = 0;
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.equal(f.actions.length, 0);
  assert.equal(f.events.some(e => e.name === "MANAGEMENT_REGIME_INVALIDATION"), false);
});

test("even after TP1/TP2 levels, controller does not issue a software close", async () => {
  const f = syntheticCycle({ quoteBid: 2530, quoteAsk: 2530.2 });
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.equal(f.actions.every(x => x.method === "PATCH" && x.url.includes("/positions/")), true);
  assert.equal(f.actions.some(x => x.method === "POST"), false);
  assert.equal(f.events.some(e => e.name === "PLUS10_PARTIAL_ONE_THIRD"), false);
});

test("after fill, +6 can move SL to entry but never submit CLOSE", async () => {
  const f = syntheticCycle({ quoteBid: 2507, quoteAsk: 2507.2 });
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.deepEqual(f.actions.map(x => x.method), ["PATCH"]);
  assert.equal(f.actions[0].body.stopLoss, f.managed.entry);
  assert.equal(f.managed.breakEvenApplied, true);
  assert.equal(f.events.some(e => e.name === "PLUS6_SL_TO_ENTRY"), true);
});

test("RECOVERY_TP also retains broker TP/SL and allows stop management", async () => {
  const f = syntheticCycle({ dailyMode: "RECOVERY_TP", quoteBid: 2507 });
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.deepEqual(f.actions.map(x => x.method), ["PATCH"]);
  assert.equal(f.events.some(e => e.name === "SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY"), true);
});

test("native broker stop/take-profit remain untouched; no false repeated hold alarms", async () => {
  const f = syntheticCycle();
  await f.context.managePosition(f.position, f.quote, f.spec);
  await f.context.managePosition(f.position, f.quote, f.spec);
  assert.deepEqual(f.actions, []);
  assert.equal(f.position.stopLoss, 2490);
  assert.equal(f.position.takeProfit, 2520);
  assert.equal(f.events.filter(x => x.name === "SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY").length, 1);
});

test("legacy early-close code is inaccessible under forced broker-target policy", () => {
  assert.match(managedSource, /if \(!brokerTpSlTrailOnly\)\s*\{\s*if \(Date\.now\(\) >= managed\.timeStopAt\)/);
  assert.match(managedSource, /if \(!brokerTpSlTrailOnly\)\s*\{\s*if \(managed\.dailyMode === "RECOVERY_TP"\)/);
  assert.match(managedSource, /if \(managed\.breakEvenApplied[\s\S]*?if \(!brokerTpSlTrailOnly\)\s*\{[\s\S]*?SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY/);
  assert.ok(managedSource.indexOf('SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY') < managedSource.indexOf('if (await closeFixedTpIfTriggered(position, quote)) return;', managedSource.indexOf('SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY')));
});

test("M5 structural SL adapter inserts stop-tightening before broker-only hold, without requiring partial close", () => {
  const transformed = transformPhase7CSidewayM5TrailingSource(source);
  assert.match(transformed, /managed\.partialApplied \|\| \(typeof brokerTpSlTrailOnly !== "undefined" && brokerTpSlTrailOnly\)/);
  const m5Tighten = transformed.indexOf('journal("SIDEWAY_M5_STRUCTURAL_SL_TIGHTEN"');
  const hold = transformed.indexOf('journal("SIDEWAY_HOLD_BROKER_TP_SL_TRAIL_ONLY"');
  assert.ok(m5Tighten > 0 && hold > m5Tighten,
    "M5 stop-tightening must be reachable before broker-only early return");
  const m5Success = transformed.lastIndexOf("if (response.success)", m5Tighten);
  assert.ok(m5Success > 0 && m5Success < m5Tighten);
  assert.ok(transformed.includes('previousStopLoss: position.stopLoss'));
});
