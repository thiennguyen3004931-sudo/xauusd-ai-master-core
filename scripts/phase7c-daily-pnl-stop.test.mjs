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

test("file path comes from env, else <cwd>/.runtime/phase7c-daily-pnl-stop.json", () => {
  assert.equal(resolveDailyPnlStopFile({ [DAILY_PNL_STOP_FILE_ENV]: "/x/y.json" }, "/repo"), path.resolve("/x/y.json"));
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

// ---- Runtime wiring (source contract) ----

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
}

test("TREND controller checks the daily stop before submitting and never closes positions for it", () => {
  const source = read("scripts/run-phase7b-demo-controller.ts");
  assert.match(source, /from "\.\/phase7c-daily-pnl-stop\.mjs"/);
  const submit = sliceBetween(source, "async function submitTrendEntry(", "\nasync function ");
  const gate = submit.indexOf("checkDailyPnlStopBeforeEntry(");
  const order = submit.indexOf('"/v1/orders"');
  assert.ok(gate >= 0, "TREND submit must call checkDailyPnlStopBeforeEntry");
  assert.ok(order < 0 || gate < order, "gate must run before the order request");
  assert.ok(gate < submit.indexOf("resolveDailyRecoveryPlan("), "gate must run before daily recovery planning");
  assert.match(submit, /journal\("ENTRY_DAILY_PNL_STOP_BLOCK"/);
  assert.doesNotMatch(source, /DAILY_PNL_STOP[\s\S]{0,200}closeAll\(/);
});

test("SIDEWAY controller checks the daily stop before submitting and never closes positions for it", () => {
  const source = read("scripts/run-phase7c-sideway-controller.mjs");
  assert.match(source, /from "\.\/phase7c-daily-pnl-stop\.mjs"/);
  const gate = source.indexOf("checkDailyPnlStopBeforeEntry(");
  assert.ok(gate >= 0, "SIDEWAY must call checkDailyPnlStopBeforeEntry");
  assert.ok(gate < source.indexOf("const dailyRecovery = await resolveDailyRecoveryPlan("), "gate before daily recovery");
  assert.ok(gate < source.indexOf('bridgeRequest("POST", "/v1/orders"'), "gate before order request");
  assert.match(source, /journal\("ENTRY_DAILY_PNL_STOP_BLOCK"/);
  assert.doesNotMatch(source, /DAILY_PNL_STOP[\s\S]{0,200}closeAll\(/);
});

test("API exposes read/save/status routes backed by the shared module", () => {
  const service = read("apps/api/src/services/phase7c-daily-pnl-stop.service.ts");
  assert.match(service, /phase7c-daily-pnl-stop\.mjs/);
  assert.match(service, /checkDailyPnlStopBeforeEntry|evaluateDailyPnlStop/);
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
