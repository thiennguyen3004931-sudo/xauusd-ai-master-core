// Phase 7C daily loss limit / daily profit target ("bot nghỉ hết ngày").
// No MT5, no orders: pure unit tests of the shared gate plus source wiring checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DAILY_PNL_STOP_FILE_ENV,
  checkDailyPnlStopBeforeEntry,
  checkDailyPnlStopViaControlApi,
  createDefaultDailyPnlStopState,
  evaluateDailyPnlStop,
  readDailyPnlStopConfig,
  resolveDailyPnlStopFile,
  summarizeDailyPnl,
  validateDailyPnlStopState,
} from "./phase7c-daily-pnl-stop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const DAY_START = Date.UTC(2026, 10, 25, 0, 0, 0);
const NOW = DAY_START + 10 * 3_600_000;

function config(patch = {}) {
  return {
    version: 1,
    updatedAt: "2026-11-25T00:00:00.000Z",
    updatedBy: "web-control-center",
    enabled: true,
    unit: "USD",
    dailyLossLimit: 100,
    dailyProfitTarget: 150,
    ...patch,
  };
}

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p7c-daily-stop-"));
  const file = path.join(dir, "phase7c-daily-pnl-stop.json");
  if (content !== undefined) fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

test("default state is OFF so the frozen baseline is unchanged", () => {
  const state = createDefaultDailyPnlStopState();
  assert.equal(state.enabled, false);
  assert.equal(state.dailyLossLimit, null);
  assert.equal(state.dailyProfitTarget, null);
  const result = evaluateDailyPnlStop({ config: state, dayStartTime: DAY_START, realizedPnl: -10_000, floatingPnl: 0, accountBalance: 1_000 });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "DISABLED");
});

test("missing config file reads as the virtual OFF default", () => {
  const read = readDailyPnlStopConfig(tempFile());
  assert.equal(read.valid, true);
  assert.equal(read.persisted, false);
  assert.equal(read.state.enabled, false);
});

test("file path: explicit env > PHASE7C_RUNTIME_ROOT > PHASE7B_DEMO_WORK_DIR/.. > <cwd>/.runtime", () => {
  assert.equal(resolveDailyPnlStopFile({ [DAILY_PNL_STOP_FILE_ENV]: "/x/y.json", PHASE7C_RUNTIME_ROOT: "/rt" }, "/repo"), path.resolve("/x/y.json"));
  assert.equal(resolveDailyPnlStopFile({ PHASE7C_RUNTIME_ROOT: "/rt" }, "/repo"), path.resolve("/rt", "phase7c-daily-pnl-stop.json"));
  assert.equal(resolveDailyPnlStopFile({ PHASE7B_DEMO_WORK_DIR: "/rt/phase7b-demo" }, "/repo"), path.resolve("/rt", "phase7c-daily-pnl-stop.json"));
  assert.equal(resolveDailyPnlStopFile({}, "/repo"), path.resolve("/repo", ".runtime", "phase7c-daily-pnl-stop.json"));
});

test("validation: units, positive limits, caps, enabled needs at least one limit", () => {
  assert.equal(validateDailyPnlStopState(config()).valid, true);
  assert.equal(validateDailyPnlStopState(config({ dailyProfitTarget: null })).valid, true, "loss only");
  assert.equal(validateDailyPnlStopState(config({ dailyLossLimit: null })).valid, true, "profit only");
  assert.equal(validateDailyPnlStopState(config({ unit: "PERCENT", dailyLossLimit: 3, dailyProfitTarget: 5 })).valid, true);
  assert.equal(validateDailyPnlStopState(config({ enabled: false, dailyLossLimit: null, dailyProfitTarget: null })).valid, true);

  for (const bad of [
    config({ unit: "EUR" }),
    config({ dailyLossLimit: 0 }),
    config({ dailyLossLimit: -5 }),
    config({ dailyProfitTarget: Number.NaN }),
    config({ dailyLossLimit: "100" }),
    config({ unit: "PERCENT", dailyLossLimit: 60 }),
    config({ dailyLossLimit: 2_000_000 }),
    config({ dailyLossLimit: null, dailyProfitTarget: null }),
    config({ enabled: "yes" }),
    { ...config(), extra: true },
  ]) {
    assert.equal(validateDailyPnlStopState(bad).valid, false, JSON.stringify(bad));
  }
});

test("corrupt config file is invalid (controllers fail closed)", () => {
  assert.equal(readDailyPnlStopConfig(tempFile("{not json")).valid, false);
  assert.equal(readDailyPnlStopConfig(tempFile(config({ unit: "EUR" }))).valid, false);
});

test("day P/L = realized trading deals of the broker day (net of fees) + floating of open XAUUSD positions", () => {
  const summary = summarizeDailyPnl({
    deals: [
      { isTradingDeal: true, magic: 270713, netPnl: -40 },
      { isTradingDeal: true, magic: 0, profit: -20, commission: -1, swap: 0, fee: 0 },
      { isTradingDeal: false, magic: 0, netPnl: 5_000 },
      { isTradingDeal: true, magic: 270714, netPnl: 12.5 },
    ],
    positions: [{ profit: -10, swap: -0.5, commission: 0 }],
  });
  assert.equal(summary.dealCount, 3);
  assert.equal(summary.realizedPnl, -48.5);
  assert.equal(summary.floatingPnl, -10.5);
  assert.equal(summary.dayPnl, -59);
});

test("USD loss limit blocks new entries at or below -limit", () => {
  const within = evaluateDailyPnlStop({ config: config(), dayStartTime: DAY_START, realizedPnl: -99.99, floatingPnl: 0, accountBalance: 5_000 });
  assert.equal(within.blocked, false);
  assert.equal(within.reason, "WITHIN_LIMITS");

  const hit = evaluateDailyPnlStop({ config: config(), dayStartTime: DAY_START, realizedPnl: -80, floatingPnl: -20, accountBalance: 5_000 });
  assert.equal(hit.blocked, true);
  assert.equal(hit.reason, "DAILY_LOSS_LIMIT_HIT");
  assert.equal(hit.lossLimitUsd, 100);
  assert.equal(hit.dayStartTime, DAY_START);
});

test("USD profit target blocks new entries at or above +target", () => {
  const hit = evaluateDailyPnlStop({ config: config(), dayStartTime: DAY_START, realizedPnl: 150, floatingPnl: 0, accountBalance: 5_000 });
  assert.equal(hit.blocked, true);
  assert.equal(hit.reason, "DAILY_PROFIT_TARGET_HIT");
  const below = evaluateDailyPnlStop({ config: config(), dayStartTime: DAY_START, realizedPnl: 149, floatingPnl: 0, accountBalance: 5_000 });
  assert.equal(below.blocked, false);
});

test("an unset side is not enforced", () => {
  const lossOnly = config({ dailyProfitTarget: null });
  assert.equal(evaluateDailyPnlStop({ config: lossOnly, dayStartTime: DAY_START, realizedPnl: 10_000, floatingPnl: 0, accountBalance: 5_000 }).blocked, false);
  const profitOnly = config({ dailyLossLimit: null });
  assert.equal(evaluateDailyPnlStop({ config: profitOnly, dayStartTime: DAY_START, realizedPnl: -10_000, floatingPnl: 0, accountBalance: 5_000 }).blocked, false);
});

test("percent limits use the balance at the start of the broker day", () => {
  // Balance now 9_700 after -300 realized today -> day-start balance 10_000; 3% = 300 USD.
  const pct = config({ unit: "PERCENT", dailyLossLimit: 3, dailyProfitTarget: 5 });
  const hit = evaluateDailyPnlStop({ config: pct, dayStartTime: DAY_START, realizedPnl: -300, floatingPnl: 0, accountBalance: 9_700 });
  assert.equal(hit.baseBalance, 10_000);
  assert.equal(hit.lossLimitUsd, 300);
  assert.equal(hit.profitTargetUsd, 500);
  assert.equal(hit.blocked, true);
  assert.equal(hit.reason, "DAILY_LOSS_LIMIT_HIT");

  const missingBalance = evaluateDailyPnlStop({ config: pct, dayStartTime: DAY_START, realizedPnl: 0, floatingPnl: 0, accountBalance: undefined });
  assert.equal(missingBalance.blocked, true);
  assert.equal(missingBalance.reason, "DATA_UNAVAILABLE");
});

test("invalid config fails closed when evaluated", () => {
  const result = evaluateDailyPnlStop({ config: config({ unit: "EUR" }), dayStartTime: DAY_START, realizedPnl: 0, floatingPnl: 0, accountBalance: 5_000 });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "CONFIG_INVALID");
});

test("pre-entry check: OFF makes no broker calls at all", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return []; };
  const result = await checkDailyPnlStopBeforeEntry({
    filePath: tempFile(),
    historyEndTime: NOW,
    accountBalance: 5_000,
    fetchDayBoundary: fetcher,
    fetchDeals: fetcher,
    fetchPositions: fetcher,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "DISABLED");
  assert.equal(calls, 0);
});

test("pre-entry check: reads the broker day, counts deals from day start, blocks when hit", async () => {
  const seen = {};
  const result = await checkDailyPnlStopBeforeEntry({
    filePath: tempFile(config()),
    historyEndTime: NOW,
    accountBalance: 5_000,
    fetchDayBoundary: async () => ({ currentStartTime: DAY_START }),
    fetchDeals: async (fromMs, toMs) => { seen.fromMs = fromMs; seen.toMs = toMs; return [{ isTradingDeal: true, magic: 270713, netPnl: -120 }]; },
    fetchPositions: async () => [],
  });
  assert.deepEqual(seen, { fromMs: DAY_START, toMs: NOW });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "DAILY_LOSS_LIMIT_HIT");
  assert.equal(result.dayPnl, -120);
});

test("pre-entry check: a new broker day resumes automatically", async () => {
  const nextDay = DAY_START + 86_400_000;
  const result = await checkDailyPnlStopBeforeEntry({
    filePath: tempFile(config()),
    historyEndTime: nextDay + 60_000,
    accountBalance: 5_000,
    fetchDayBoundary: async () => ({ currentStartTime: nextDay }),
    fetchDeals: async (fromMs) => (fromMs >= nextDay ? [] : [{ isTradingDeal: true, netPnl: -500 }]),
    fetchPositions: async () => [],
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "WITHIN_LIMITS");
  assert.equal(result.dayStartTime, nextDay);
});

test("pre-entry check: broker data errors fail closed while enabled", async () => {
  const boom = async () => { throw new Error("bridge down"); };
  for (const override of [
    { fetchDayBoundary: boom },
    { fetchDayBoundary: async () => ({ currentStartTime: 0 }) },
    { fetchDeals: boom },
    { fetchDeals: async () => ({ not: "an array" }) },
    { fetchPositions: boom },
  ]) {
    const result = await checkDailyPnlStopBeforeEntry({
      filePath: tempFile(config()),
      historyEndTime: NOW,
      accountBalance: 5_000,
      fetchDayBoundary: async () => ({ currentStartTime: DAY_START }),
      fetchDeals: async () => [],
      fetchPositions: async () => [],
      ...override,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "DATA_UNAVAILABLE");
  }
});

test("pre-entry check: corrupt file blocks new entries", async () => {
  const result = await checkDailyPnlStopBeforeEntry({
    filePath: tempFile("{broken"),
    historyEndTime: NOW,
    accountBalance: 5_000,
    fetchDayBoundary: async () => ({ currentStartTime: DAY_START }),
    fetchDeals: async () => [],
    fetchPositions: async () => [],
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "CONFIG_INVALID");
});

// ---- Controller-side gate (control API is the authority) ----

const apiStatus = (status) => async () => ({ status });

test("controller gate: API OFF and local OFF -> allow (baseline)", async () => {
  const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile(), fetchStatus: apiStatus({ blocked: false, reason: "DISABLED" }) });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "DISABLED");
});

test("controller gate: API unreachable and local OFF -> allow (an API outage never changes old behaviour)", async () => {
  const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile(), fetchStatus: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "DISABLED");
});

test("controller gate: API unreachable and local ON -> block", async () => {
  const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: async () => { throw new Error("timeout"); } });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "DATA_UNAVAILABLE");
});

test("controller gate: API answers without a status -> local fallback", async () => {
  const off = await checkDailyPnlStopViaControlApi({ filePath: tempFile(), fetchStatus: async () => ({ status: null, statusError: "boom" }) });
  assert.equal(off.blocked, false);
  const on = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: async () => ({ status: null, statusError: "boom" }) });
  assert.equal(on.blocked, true);
});

test("controller gate: API hit/invalid/unavailable statuses block, WITHIN_LIMITS allows", async () => {
  for (const reason of ["DAILY_LOSS_LIMIT_HIT", "DAILY_PROFIT_TARGET_HIT", "CONFIG_INVALID", "DATA_UNAVAILABLE"]) {
    const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: apiStatus({ blocked: true, reason }) });
    assert.equal(result.blocked, true, reason);
    assert.equal(result.reason, reason);
  }
  // A malformed "not blocked" with a hit reason still blocks.
  const inconsistent = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: apiStatus({ blocked: false, reason: "DAILY_LOSS_LIMIT_HIT" }) });
  assert.equal(inconsistent.blocked, true);
  const ok = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: apiStatus({ blocked: false, reason: "WITHIN_LIMITS", dayPnl: -20 }) });
  assert.equal(ok.blocked, false);
  // The API owns the config file the UI writes: it enforces even if this process has no local copy.
  const apiOnly = await checkDailyPnlStopViaControlApi({ filePath: tempFile(), fetchStatus: apiStatus({ blocked: true, reason: "DAILY_LOSS_LIMIT_HIT" }) });
  assert.equal(apiOnly.blocked, true);
});

test("controller gate: local ON while API says OFF -> block (different files)", async () => {
  const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile(config()), fetchStatus: apiStatus({ blocked: false, reason: "DISABLED" }) });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "DATA_UNAVAILABLE");
});

test("controller gate: corrupt local file blocks", async () => {
  const result = await checkDailyPnlStopViaControlApi({ filePath: tempFile("{broken"), fetchStatus: async () => { throw new Error("down"); } });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "CONFIG_INVALID");
});

// ---- Runtime wiring (source contract) ----

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
}

test("TREND controller asks the control API before submitting and never closes positions for it", () => {
  const source = read("scripts/run-phase7b-demo-controller.ts");
  assert.match(source, /from "\.\/phase7c-daily-pnl-stop\.mjs"/);
  const submit = sliceBetween(source, "async function submitTrendEntry(", "\nasync function ");
  const gate = submit.indexOf("checkDailyPnlStopViaControlApi(");
  assert.ok(gate >= 0, "TREND submit must call checkDailyPnlStopViaControlApi");
  assert.ok(gate < submit.indexOf("resolveDailyRecoveryPlan("), "gate must run before daily recovery planning");
  assert.match(submit, /journal\("ENTRY_DAILY_PNL_STOP_BLOCK"/);
  assert.match(source, /\/api\/v1\/phase7c\/daily-pnl-stop/);
  assert.doesNotMatch(source, /DAILY_PNL_STOP[\s\S]{0,200}closeAll\(/);
});

test("SIDEWAY controller asks the control API before submitting and never closes positions for it", () => {
  const source = read("scripts/run-phase7c-sideway-controller.mjs");
  assert.match(source, /from "\.\/phase7c-daily-pnl-stop\.mjs"/);
  const gate = source.indexOf("checkDailyPnlStopViaControlApi(");
  assert.ok(gate >= 0, "SIDEWAY must call checkDailyPnlStopViaControlApi");
  assert.ok(gate < source.indexOf("const dailyRecovery = await resolveDailyRecoveryPlan("), "gate before daily recovery");
  assert.ok(gate < source.indexOf('bridgeRequest("POST", "/v1/orders"'), "gate before order request");
  assert.match(source, /controlGet\("\/api\/v1\/phase7c\/daily-pnl-stop"\)/);
  assert.match(source, /journal\("ENTRY_DAILY_PNL_STOP_BLOCK"/);
  assert.doesNotMatch(source, /DAILY_PNL_STOP[\s\S]{0,200}closeAll\(/);
});

test("API status reads the canonical deal ledger, not raw bridge deal history", () => {
  const service = read("apps/api/src/services/phase7c-daily-pnl-stop.service.ts");
  assert.match(service, /phase7c-daily-pnl-stop\.mjs/);
  assert.match(service, /getPhase7CCanonicalDeals/);
  assert.doesNotMatch(service, /getMt5DealHistory|\/v1\/history\/deals/);
  const route = read("apps/api/src/routes/phase7c.route.ts");
  assert.match(route, /router\.get\("\/daily-pnl-stop"/);
  assert.match(route, /router\.post\("\/daily-pnl-stop"/);
});

test("Operations screen shows the daily stop card inside the compact section", () => {
  const compact = read("apps/web/src/ui/Phase7CControlCenterCompactSection.tsx");
  assert.match(compact, /<Phase7CDailyPnlStopCard \/>/);
  const card = read("apps/web/src/ui/Phase7CDailyPnlStopCard.tsx");
  assert.match(card, /Lỗ tối đa trong ngày/);
  assert.match(card, /Lãi mục tiêu trong ngày/);
  assert.match(card, /getPhase7CDailyPnlStop/);
  assert.match(card, /setPhase7CDailyPnlStop/);
});
