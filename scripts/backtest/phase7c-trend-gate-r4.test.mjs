// Round 4 research helpers: causal library-state gate, acceptance thresholds, chart (synthetic, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import { PLAN, acceptanceOf, libraryStateLookup, renderEquitySvg, withTrendOnly } from "./phase7c-trend-gate-r4.mjs";

const H1 = 3_600_000;
const bars = (n, step, from, slope) => Array.from({ length: n }, (_, i) => {
  const o = from + i * slope;
  return { openTime: i * step, closeTime: (i + 1) * step, open: o, high: o + Math.abs(slope) + 1, low: o - 1, close: o + slope, tickVolume: 1, spreadPoints: 20 };
});

test("plan is the pre-registered one", () => {
  assert.equal(new Date(PLAN.splitAt).toISOString().slice(0, 10), "2025-12-31");
  assert.equal(PLAN.baselineKey, "BE6/OFF0/SL10/TPoff");
  assert.equal(PLAN.minTrainTrades, 20);
});

test("library state is causal: unknown before history, uses only bars closed at the time asked", () => {
  const h1 = bars(400, H1, 2000, 1.5);
  const h4 = bars(100, 4 * H1, 2000, 6);
  const stateAt = libraryStateLookup({ h4, h1 });
  assert.equal(stateAt(0), null); // nothing closed yet
  const late = stateAt(400 * H1);
  assert.equal(stateAt(400 * H1 + 1), late);
  // changing a bar that is not closed yet at the asked time does not change the answer
  const h1b = h1.map((b, i) => (i === 399 ? { ...b, close: 1000, low: 999 } : b));
  assert.equal(libraryStateLookup({ h4, h1: h1b })(399 * H1), libraryStateLookup({ h4, h1 })(399 * H1));
  const gate = withTrendOnly(() => "UPTREND");
  assert.equal(gate("BUY", 1), true);
  assert.equal(gate("SELL", 1), false);
  assert.equal(withTrendOnly(() => null)("BUY", 1), false);
  assert.equal(withTrendOnly(() => "SIDEWAY")("BUY", 1), false);
});

test("acceptance needs every work-order threshold", () => {
  const ok = { trades: 30, profitFactor: 1.21, expectancyUsd: 0.1, avgR: 0.01 };
  const folds = (n) => Array.from({ length: 6 }, (_, i) => ({ test: { netUsd: i < n ? 1 : -1 } }));
  assert.equal(acceptanceOf(ok, folds(4)).pass, true);
  assert.equal(acceptanceOf(ok, folds(3)).pass, false);
  assert.equal(acceptanceOf({ ...ok, profitFactor: 1.2 }, folds(6)).pass, false);
  assert.equal(acceptanceOf({ ...ok, trades: 29 }, folds(6)).pass, false);
  assert.equal(acceptanceOf(ok, [{ test: null }, ...folds(4)]).positiveFolds, 4);
});

test("equity chart renders every series with its final value", () => {
  const svg = renderEquitySvg({ current: [[1, -5], [2, -5]], gateDefault: [[1, 3]], candidate: [[2, 4]], trendOnlyExploratory: [] });
  assert.match(svg, /^<svg/);
  assert.match(svg, /Hiện tại: -10 USD/);
  assert.match(svg, /cấu hình chọn: 4 USD/);
});
