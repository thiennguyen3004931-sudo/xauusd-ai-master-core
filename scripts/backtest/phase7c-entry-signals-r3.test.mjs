// Round-3 entry-signal research — pins causality and the selection-null machinery (synthetic bars, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import { CANDIDATES_R3, aggregate, buildContextR3, buildSignals, lastClosedIndex, randomSignal, selectionNull } from "./phase7c-entry-signals-r3.mjs";

const T0 = Date.UTC(2026, 0, 5, 0, 0);
const M15 = 15 * 60_000;

function m15Series(n, seed = 3) {
  let x = seed;
  let p = 2000;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const o = p;
    const c = o + Math.sin(i / 30) * 2 + ((x % 1000) / 1000 - 0.5) * 7;
    out.push({ openTime: T0 + i * M15, closeTime: T0 + (i + 1) * M15, open: o, high: Math.max(o, c) + 1 + (x % 7) / 7, low: Math.min(o, c) - 1, close: c, tickVolume: 100 + (x % 300), spreadPoints: 30 });
    p = c;
  }
  return out;
}
const regimesFor = (n) => Array.from({ length: n }, (_, i) => ({ regime: i % 3 === 0 ? "RANGING" : "BREAKOUT" }));

test("every round-3 signal is causal: changing bars after k never changes the signal at or before k", () => {
  const n = 1600;
  const bars = m15Series(n);
  const cut = 1300;
  const mutated = bars.map((b, i) => (i > cut ? { ...b, close: b.close + 40, high: b.high + 55, low: b.low + 30, tickVolume: 5000 } : b));
  const ctxA = buildContextR3(bars, { regimes: regimesFor(n) });
  const ctxB = buildContextR3(mutated, { regimes: regimesFor(n) });
  let fired = 0;
  for (const c of CANDIDATES_R3) {
    const a = buildSignals(ctxA, c.signal).slice(0, cut + 1);
    const b = buildSignals(ctxB, c.signal).slice(0, cut + 1);
    assert.deepEqual(a, b, c.id);
    fired += a.filter(Boolean).length;
  }
  assert.ok(fired > 0, "synthetic series should trigger at least some signals");
});

test("H4 / D1 index only points at buckets that have fully closed", () => {
  const bars = m15Series(400);
  const H4 = 4 * 60 * 60_000;
  const h4 = aggregate(bars, H4);
  const idx = lastClosedIndex(bars, h4, H4);
  for (let k = 0; k < bars.length; k += 1) if (idx[k] >= 0) assert.ok(h4[idx[k]].openTime + H4 <= bars[k].closeTime);
});

test("round-3 candidates keep PAUSE locked and the TREND-only path", () => {
  for (const c of CANDIDATES_R3) {
    assert.deepEqual(c.config.strategies, ["TREND"], c.id);
    assert.notEqual(c.config.allowPause, true);
  }
});

test("random control is deterministic and roughly at the requested rate", () => {
  const ctx = buildContextR3(m15Series(5000));
  const a = buildSignals(ctx, randomSignal(4, 0.05));
  const b = buildSignals(ctx, randomSignal(4, 0.05));
  assert.deepEqual(a, b);
  const rate = a.filter(Boolean).length / 4800;
  assert.ok(rate > 0.03 && rate < 0.07, `rate ${rate}`);
});

test("selection null runs the same picker on random sets", () => {
  const mk = (pnl, i) => ({ entryTime: T0 + i * 3_600_000, exitTime: T0 + i * 3_600_000 + 1, pnlUsd: pnl, r: pnl / 10, side: "BUY", regime: "BREAKOUT" });
  const pool = new Map(Array.from({ length: 6 }, (_, s) => [`R${s}`, Array.from({ length: 300 }, (_, i) => mk(((i * (s + 3)) % 7) - 3, i))]));
  const out = selectionNull(pool, 3, T0, T0 + 300 * 3_600_000, 20);
  assert.equal(out.length, 20);
  for (const d of out) assert.ok(Number.isFinite(d.positiveFolds));
});
