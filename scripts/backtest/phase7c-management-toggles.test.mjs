// Backtest page toggles — each management feature can be switched off or re-parameterised in the replay
// simulator while the defaults stay the frozen Phase 7C baseline (synthetic bars, no MT5, no orders).
import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_CONFIG, simulate } from "./phase7c-management-sim.mjs";

const T0 = Date.UTC(2026, 0, 5, 1, 0);
const M5 = 5 * 60_000;

function world(path, { ma50 = null } = {}) {
  const m5 = path.map(([open, high, low, close], i) => ({
    openTime: T0 + i * M5, closeTime: T0 + (i + 1) * M5, open, high, low, close, tickVolume: 1, spreadPoints: 0,
  }));
  const m15 = [];
  for (let i = 0; i + 2 < m5.length; i += 3) {
    const b = m5.slice(i, i + 3);
    m15.push({
      openTime: b[0].openTime, closeTime: b[2].closeTime, open: b[0].open,
      high: Math.max(...b.map((x) => x.high)), low: Math.min(...b.map((x) => x.low)), close: b[2].close, tickVolume: 3, spreadPoints: 0,
    });
  }
  const pre = {
    regimes: m15.map(() => ({ regime: "TRENDING", confidence: 80, recommendedMode: "TREND", atr: 5, range: null })),
    m15St: m15.map(() => "BUY"),
    m5St: m5.map(() => "BUY"),
    ma20: m15.map(() => null),
    ma50: m15.map((_, k) => (ma50 ? ma50(k) : null)),
    trendSignals: m15.map((_, k) => (k === 0 ? { side: "BUY", patternExtreme: 1991, pattern: "ENGULFING" } : null)),
  };
  return { m5, m15, pre };
}

const flat = (p) => [p, p, p, p];
const noCost = { commissionPerLotRoundTurn: 0, slippagePrice: 0, strategies: ["TREND"] };
// BUY signal at the close of bar 2; entry 2000 at bar 3 open; stop 1990 (10 away).
const lead = [flat(2000), flat(2000), flat(2000)];
const near = (a, b) => Math.abs(a - b) < 1e-6;
const run = (path, config, opts) => simulate({ ...world(path, opts), config: { ...noCost, ...config } });

// +10.5 then a drop to 1985: baseline = partial 0.01 @ +10 (+10) + runner 0.02 stopped at FastMove 2000.5 (+1).
const PARTIAL_PATH = [...lead, [2000, 2010.5, 1999, 2010], [2010, 2010, 1985, 1985], flat(1985)];

test("toggle defaults are the production behaviour", () => {
  assert.equal(BASELINE_CONFIG.breakEvenEnabled, true);
  assert.equal(BASELINE_CONFIG.partialEnabled, true);
  assert.equal(BASELINE_CONFIG.partialFraction, 1 / 3);
  assert.equal(BASELINE_CONFIG.fastMoveEnabled, true);
  assert.equal(BASELINE_CONFIG.m5TrailEnabled, true);
  assert.equal(BASELINE_CONFIG.runnerExitsEnabled, true);
  const [t] = run(PARTIAL_PATH, {});
  assert.ok(near(t.pnlUsd, 11), String(t.pnlUsd));
});

test("break-even OFF: the stop stays at the initial stop", () => {
  const path = [...lead, [2000, 2006.5, 1999, 2004], [2004, 2004, 1989, 1990], flat(1990)];
  assert.equal(run(path, {})[0].exitReason, "STOP_AFTER_BE");
  const [t] = run(path, { breakEvenEnabled: false });
  assert.equal(t.exitReason, "STOP_LOSS");
  assert.equal(t.breakEvenApplied, false);
  assert.ok(near(t.pnlUsd, -30), String(t.pnlUsd));
});

test("partial OFF: nothing is closed at +10, the whole lot follows the stop", () => {
  const [t] = run(PARTIAL_PATH, { partialEnabled: false });
  assert.equal(t.partialApplied, false);
  // 0.03 lot exits at the FastMove stop 2000.5 -> +0.5 x 0.03 x 100
  assert.ok(near(t.pnlUsd, 1.5), String(t.pnlUsd));
});

test("partial fraction and trigger are configurable", () => {
  const [half] = run(PARTIAL_PATH, { volume: 0.04, partialFraction: 0.5 });
  // 0.02 @ +10 = 20; runner 0.02 @ +0.5 = 1
  assert.ok(near(half.pnlUsd, 21), String(half.pnlUsd));
  const [early] = run(PARTIAL_PATH, { partialTriggerPrice: 8 });
  // 0.01 @ +8 = 8; runner 0.02 @ +0.5 = 1
  assert.ok(near(early.pnlUsd, 9), String(early.pnlUsd));
});

test("FastMove OFF: the runner stays at break-even", () => {
  const [t] = run(PARTIAL_PATH, { fastMoveEnabled: false });
  assert.ok(near(t.pnlUsd, 10), String(t.pnlUsd)); // partial +10, runner 0 at entry
});

test("FastMove activation / giveback are configurable", () => {
  const [t] = run(PARTIAL_PATH, { fastMoveActivationPrice: 8, fastMoveGivebackPrice: 5 });
  // runner stop = peak 2010.5 - 5 = 2005.5 -> 0.02 x 5.5 x 100 = 11; + partial 10
  assert.ok(near(t.pnlUsd, 21), String(t.pnlUsd));
});

test("M5 structure trail OFF: no swing-low stop after the partial", () => {
  const path = [
    ...lead,
    [2000, 2010.5, 1999, 2010], // partial
    [2010, 2014, 2008, 2013],
    [2013, 2015, 2005, 2014], // swing low 2005 confirmed by the next bar
    [2014, 2016, 2007, 2015],
    [2015, 2015, 1990, 1990],
    flat(1990),
  ];
  const [on] = run(path, { fastMoveEnabled: false });
  const [off] = run(path, { fastMoveEnabled: false, m5TrailEnabled: false });
  // trail ON: runner stop 2005 - 1 = 2004 -> +4 x 0.02 x 100 = 8; + partial 10
  assert.ok(near(on.pnlUsd, 18), String(on.pnlUsd));
  // trail OFF: runner stays at entry -> partial only
  assert.ok(near(off.pnlUsd, 10), String(off.pnlUsd));
});

test("runner exits OFF: no MA50 exit on the M15 close", () => {
  const path = [...lead, [2000, 2010.5, 1999, 2009], flat(2008), flat(2008), [2008, 2008, 1990, 1990], flat(1990)];
  const ma50 = () => 2009; // M15 #1 closes at 2008 < MA50 -> runner exit
  const [on] = run(path, {}, { ma50 });
  assert.equal(on.exitReason, "RUNNER_TREND_MA50");
  assert.ok(near(on.pnlUsd, 26), String(on.pnlUsd)); // 10 + 0.02 x 8 x 100
  const [off] = run(path, { runnerExitsEnabled: false }, { ma50 });
  assert.notEqual(off.exitReason, "RUNNER_TREND_MA50");
  assert.ok(near(off.pnlUsd, 11), String(off.pnlUsd)); // FastMove stop 2000.5
});
