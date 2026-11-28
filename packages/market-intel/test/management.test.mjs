import { test } from "node:test";
import assert from "node:assert/strict";
import { managementPlan, MANAGEMENT_PLAN_VERSION } from "../src/index.mjs";
import { barsFromPath, M15_MS } from "./helpers.mjs";

const buy = {
  role: "PRIMARY", direction: "BUY", entry: 2000, stopLoss: 1992, takeProfit1: 2020, takeProfit2: 2045,
  rr1: 2.5, rr2: 5.6, invalidation: { price: 1990, text: "H1 đóng dưới 1990" },
};
const sell = { ...buy, direction: "SELL", entry: 2000, stopLoss: 2008, takeProfit1: 1980, takeProfit2: 1955, invalidation: { price: 2010, text: "H1 đóng trên 2010" } };

// M15 rising zig-zag that ends above the entry, so confirmed higher lows exist above 2000.
const upBars = barsFromPath(200, (i) => 1990 + 0.25 * i + 4 * Math.sin((2 * Math.PI * i) / 16), { periodMs: M15_MS, wick: 0.3 });
const downBars = barsFromPath(200, (i) => 2010 - 0.25 * i + 4 * Math.sin((2 * Math.PI * i) / 16), { periodMs: M15_MS, wick: 0.3 });

test("plan is advisory only and versioned", () => {
  const p = managementPlan(buy, { m15: upBars });
  assert.equal(p.version, MANAGEMENT_PLAN_VERSION);
  assert.deepEqual(p.safety, { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
  assert.ok(p.notes.some((n) => /không phải lệnh/i.test(n)));
  assert.ok(p.notes.some((n) => /chưa.*kiểm chứng|backtest/i.test(n)));
});

test("BUY: BE step uses the bot default +6 -> entry and only tightens", () => {
  const p = managementPlan(buy, { m15: upBars });
  const be = p.stopSteps[0];
  assert.equal(be.id, "BREAK_EVEN");
  assert.equal(be.triggerPrice, 2006);
  assert.equal(be.newStop, 2000);
  assert.ok(be.newStop > buy.stopLoss);
});

test("custom BE trigger/offset are reflected (SELL mirror)", () => {
  const p = managementPlan(sell, { m15: downBars, breakEvenTriggerPrice: 8, breakEvenOffsetPrice: 1 });
  assert.equal(p.stopSteps[0].triggerPrice, 1992);
  assert.equal(p.stopSteps[0].newStop, 1999);
  assert.ok(p.stopSteps[0].newStop < sell.stopLoss);
});

test("partials: 1/3 at +10 (bot rule), 1/3 at TP1, rest runs to TP2; volumes follow the lot", () => {
  const p = managementPlan(buy, { m15: upBars, lot: 0.12 });
  assert.deepEqual(p.partials.map((x) => x.id), ["PLUS_10", "TP1", "TP2"]);
  assert.deepEqual(p.partials.map((x) => x.price), [2010, 2020, 2045]);
  const fractions = p.partials.map((x) => x.fraction);
  assert.ok(Math.abs(fractions.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(p.partials.map((x) => x.lot), [0.04, 0.04, 0.04]);
});

test("TP1 closer than +10: half at TP1, half runs (no +10 step before TP1)", () => {
  const near = { ...buy, takeProfit1: 2008, takeProfit2: 2030 };
  const p = managementPlan(near, { m15: upBars, lot: 0.06 });
  assert.deepEqual(p.partials.map((x) => x.id), ["TP1", "TP2"]);
  assert.deepEqual(p.partials.map((x) => x.lot), [0.03, 0.03]);
});

test("after TP1 the stop locks part of the move and never loosens", () => {
  const p = managementPlan(buy, { m15: upBars });
  const lock = p.stopSteps.find((s) => s.id === "AFTER_TP1");
  assert.ok(lock && lock.newStop > p.stopSteps[0].newStop && lock.newStop < buy.takeProfit1, JSON.stringify(lock));
});

test("trailing: current candidate is below the latest confirmed M15 higher low (BUY) / above lower high (SELL)", () => {
  const b = managementPlan(buy, { m15: upBars });
  const trail = b.stopSteps.find((s) => s.id === "TRAIL_M15_SWING");
  assert.ok(trail, "trail step missing");
  assert.ok(trail.currentCandidate !== null && (trail.currentCandidate > buy.entry && trail.currentCandidate < upBars.at(-1).close), JSON.stringify(trail));
  const s = managementPlan(sell, { m15: downBars });
  const t2 = s.stopSteps.find((x) => x.id === "TRAIL_M15_SWING");
  assert.ok(t2.currentCandidate !== null && (t2.currentCandidate < sell.entry && t2.currentCandidate > downBars.at(-1).close), JSON.stringify(t2));
});

test("exit warning reuses the scenario invalidation", () => {
  const p = managementPlan(buy, { m15: upBars });
  assert.match(p.exit.text, /1990/);
});

test("TP1 nearer than the BE trigger: steps ordered by distance and BE dropped as it would loosen", () => {
  const near = { ...buy, takeProfit1: 2005, takeProfit2: 2020 };
  const p = managementPlan(near, { m15: upBars });
  const fixed = p.stopSteps.filter((s) => s.triggerPrice !== null);
  assert.deepEqual(fixed.map((s) => s.id), ["AFTER_TP1"]);
  assert.equal(fixed[0].newStop, 2002.5);
});
