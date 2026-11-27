// Entry-signal research — pins causality of the candidate signals and the PAUSE lock (synthetic bars, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_CONFIG, simulate } from "./phase7c-management-sim.mjs";
import {
  CANDIDATES, CANDIDATES_ROUND2, aggregateH1, buildContext, buildSignals, ema, lastClosedH1Index, rsi, supertrendDirection,
} from "./phase7c-entry-signals.mjs";

const T0 = Date.UTC(2026, 0, 5, 0, 0);
const M5 = 5 * 60_000;
const M15 = 15 * 60_000;

function m15Series(n, seed = 1) {
  let x = seed;
  let p = 2000;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const drift = Math.sin(i / 40) * 1.5;
    const o = p;
    const c = o + drift + ((x % 1000) / 1000 - 0.5) * 6;
    out.push({ openTime: T0 + i * M15, closeTime: T0 + (i + 1) * M15, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, tickVolume: 1, spreadPoints: 30 });
    p = c;
  }
  return out;
}

test("baseline default keeps the production regime gate", () => {
  assert.equal(BASELINE_CONFIG.requireTrendMode, true);
});

test("every candidate signal is causal: changing bars after k never changes the signal at k", () => {
  const bars = m15Series(900);
  const ctxA = buildContext(bars);
  const cut = 700;
  const mutated = bars.map((b, i) => (i > cut ? { ...b, close: b.close + 50, high: b.high + 60, low: b.low + 40 } : b));
  const ctxB = buildContext(mutated);
  for (const c of [...CANDIDATES, ...CANDIDATES_ROUND2]) {
    const a = buildSignals(ctxA, c.signal).slice(0, cut + 1);
    const b = buildSignals(ctxB, c.signal).slice(0, cut + 1);
    assert.deepEqual(a, b, c.id);
  }
  assert.ok(CANDIDATES.some((c) => buildSignals(ctxA, c.signal).some(Boolean)), "synthetic series produces some signals");
});

test("H1 filter only reads hours that have fully closed", () => {
  const bars = m15Series(12);
  const h1 = aggregateH1(bars);
  const idx = lastClosedH1Index(bars, h1);
  // M15 #0..#2 close inside the first hour -> no closed H1; #3 closes the first hour
  assert.deepEqual([...idx.slice(0, 5)], [-1, -1, -1, 0, 0]);
  assert.equal(h1[0].close, bars[3].close);
});

test("indicator helpers seed correctly", () => {
  assert.deepEqual(ema([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.equal(rsi([1, 2, 3, 4], 2)[3], 100);
  const st = supertrendDirection(m15Series(50), 10, 3);
  assert.equal(st[8], null);
  assert.ok(st[9] === "BUY" || st[9] === "SELL");
});

function world(regime) {
  const m5 = Array.from({ length: 12 }, (_, i) => ({ openTime: T0 + i * M5, closeTime: T0 + (i + 1) * M5, open: 2000, high: 2000, low: 2000, close: 2000, tickVolume: 1, spreadPoints: 0 }));
  const m15 = [0, 3, 6, 9].map((i) => ({ ...m5[i], closeTime: m5[i + 2].closeTime }));
  const pre = {
    regimes: m15.map(() => regime),
    m15St: m15.map(() => "BUY"), m5St: m5.map(() => "BUY"),
    ma20: m15.map(() => null), ma50: m15.map(() => null),
    trendSignals: m15.map((_, k) => (k === 0 ? { side: "BUY", pattern: "X", patternExtreme: 1993 } : null)),
  };
  return { m5, m15, pre };
}

test("requireTrendMode=false opens in SIDEWAY regimes but still respects the PAUSE lock (REVERSAL / UNCERTAIN)", () => {
  const cfg = { strategies: ["TREND"], requireTrendMode: false };
  const ranging = { regime: "RANGING", confidence: 80, recommendedMode: "SIDEWAY", atr: 5, range: null };
  const reversal = { regime: "REVERSAL", confidence: 80, recommendedMode: "PAUSE", atr: 5, range: null };
  assert.equal(simulate({ ...world(ranging), config: { strategies: ["TREND"] } }).length, 0, "production gate blocks RANGING");
  assert.equal(simulate({ ...world(ranging), config: cfg }).length, 1);
  assert.equal(simulate({ ...world(reversal), config: cfg }).length, 0);
});
