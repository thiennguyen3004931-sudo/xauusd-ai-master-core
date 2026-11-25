// T3 — pins the conservative execution model of the Phase 7C replay simulator (synthetic bars, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_CONFIG, metrics, simulate } from "./phase7c-management-sim.mjs";
import { detectEntryPattern, parseMt5Csv } from "./phase7c-replay-data.mjs";

const T0 = Date.UTC(2026, 0, 5, 1, 0);
const M5 = 5 * 60_000;

// path: list of [open, high, low, close] per M5 bar, spread 0 unless given
function world(path, { spreadPoints = 0, signal = { side: "BUY", patternExtreme: 1991 } } = {}) {
  const m5 = path.map(([open, high, low, close], i) => ({
    openTime: T0 + i * M5, closeTime: T0 + (i + 1) * M5, open, high, low, close, tickVolume: 1, spreadPoints,
  }));
  const m15 = [];
  for (let i = 0; i + 2 < m5.length; i += 3) {
    const b = m5.slice(i, i + 3);
    m15.push({
      openTime: b[0].openTime, closeTime: b[2].closeTime, open: b[0].open,
      high: Math.max(...b.map((x) => x.high)), low: Math.min(...b.map((x) => x.low)), close: b[2].close, tickVolume: 3, spreadPoints,
    });
  }
  const pre = {
    regimes: m15.map(() => ({ regime: "TRENDING", confidence: 80, recommendedMode: "TREND", atr: 5, range: null })),
    m15St: m15.map(() => signal.side),
    m5St: m5.map(() => signal.side),
    ma20: m15.map(() => null),
    ma50: m15.map(() => null),
    trendSignals: m15.map((_, k) => (k === 0 ? { ...signal, pattern: "ENGULFING" } : null)),
  };
  return { m5, m15, pre };
}

const flat = (p) => [p, p, p, p];
const noCost = { commissionPerLotRoundTurn: 0, slippagePrice: 0, strategies: ["TREND"] };
// bars 0..2 form M15 #0 (signal at its close); entry at bar 3 open = 2000; structural stop 1991-1 = 1990 -> 10 away
const lead = [flat(2000), flat(2000), flat(2000)];

test("defaults are the frozen Phase 7C baseline", () => {
  assert.equal(BASELINE_CONFIG.breakEvenTriggerPrice, 6);
  assert.equal(BASELINE_CONFIG.breakEvenOffsetPrice, 0);
  assert.equal(BASELINE_CONFIG.maxInitialStopPrice, 10);
  assert.equal(BASELINE_CONFIG.fixedTpPrice, null);
  assert.equal(BASELINE_CONFIG.volume, 0.03);
  assert.deepEqual(BASELINE_CONFIG.trendRegimes, ["TRENDING", "BREAKOUT"]);
  assert.equal(BASELINE_CONFIG.maxEntrySpreadPrice, null);
});

test("STOP_FIRST: a bar that touches both the stop and +10 is a full stop-loss", () => {
  const w = world([...lead, [2000, 2011, 1989, 2005], flat(2005)]);
  const [t] = simulate({ ...w, config: noCost });
  assert.equal(t.exitReason, "STOP_LOSS");
  assert.equal(t.partialApplied, false);
  assert.ok(Math.abs(t.pnlUsd - -30) < 1e-6, String(t.pnlUsd)); // 10 x 0.03 lot x 100
  assert.ok(Math.abs(t.r - -1) < 1e-6);
});

test("BE +6 moves the stop to entry from the next bar; offset is honoured", () => {
  const path = [...lead, [2000, 2006.5, 1999, 2004], [2004, 2004, 1989, 1990], flat(1990)];
  const [base] = simulate({ ...world(path), config: noCost });
  assert.equal(base.exitReason, "STOP_AFTER_BE");
  assert.ok(Math.abs(base.pnlUsd) < 1e-6);
  const [offset] = simulate({ ...world(path), config: { ...noCost, breakEvenOffsetPrice: 2 } });
  assert.ok(Math.abs(offset.pnlUsd - 6) < 1e-6, String(offset.pnlUsd)); // +2 x 0.03 x 100
  const [late] = simulate({ ...world(path), config: { ...noCost, breakEvenTriggerPrice: 8 } });
  assert.equal(late.exitReason, "STOP_LOSS"); // never reached +8 -> original stop at 1990
});

test("TREND partial closes 1/3 (0.01 lot) at +10, runner keeps the rest", () => {
  const path = [...lead, [2000, 2010.5, 1999, 2010], [2010, 2010, 1985, 1985], flat(1985)];
  const [t] = simulate({ ...world(path), config: noCost });
  assert.equal(t.partialApplied, true);
  // partial: +10 x 0.01 x 100 = 10; FastMove 10/10 lifted the runner stop to peak-10 = 2000.5,
  // so the 0.02 runner exits at +0.5 -> +1. Total +11.
  assert.equal(t.exitReason, "STOP_AFTER_BE");
  assert.ok(Math.abs(t.pnlUsd - 11) < 1e-6, String(t.pnlUsd));
});

test("fixed TP closes the whole position at the target", () => {
  const path = [...lead, [2000, 2005, 1999, 2004], [2004, 2021, 2003, 2020], flat(2020)];
  const [t] = simulate({ ...world(path), config: { ...noCost, fixedTpPrice: 20 } });
  assert.equal(t.exitReason, "TAKE_PROFIT");
  assert.ok(Math.abs(t.pnlUsd - 60) < 1e-6, String(t.pnlUsd));
});

test("spread, slippage and commission are charged", () => {
  const path = [...lead, [2000, 2000, 1980, 1985], flat(1985)];
  const [t] = simulate({ ...world(path, { spreadPoints: 30 }), config: { commissionPerLotRoundTurn: 7, slippagePrice: 0.1, strategies: ["TREND"] } });
  // BUY at ask 2000.30 + 0.10 slip; stop = 1990 (structural, 10.4 away > cap -> pending) -> no immediate fill
  // so use a tighter extreme instead
  assert.ok(t === undefined || t.pnlUsd < 0);
  const w = world(path, { spreadPoints: 30, signal: { side: "BUY", patternExtreme: 1993 } });
  const [u] = simulate({ ...w, config: { commissionPerLotRoundTurn: 7, slippagePrice: 0.1, strategies: ["TREND"] } });
  // entry 2000.40, structural stop 1992 -> dist 8.4; stop 1992 filled at 1991.90; commission 0.21
  const expected = (1991.9 - 2000.4) * 3 - 0.21;
  assert.ok(Math.abs(u.pnlUsd - expected) < 1e-6, `${u.pnlUsd} vs ${expected}`);
});

test("metrics: PF, expectancy, average R and drawdown in USD and R", () => {
  const m = metrics([{ pnlUsd: 30, r: 1 }, { pnlUsd: -15, r: -0.5 }, { pnlUsd: -15, r: -0.5 }, { pnlUsd: 60, r: 2 }]);
  assert.equal(m.trades, 4);
  assert.equal(m.profitFactor, 3);
  assert.equal(m.expectancyUsd, 15);
  assert.equal(m.avgR, 0.5);
  assert.equal(m.maxDrawdownUsd, 30);
  assert.equal(m.maxDrawdownR, 1);
});

test("MT5 export parser and TREND pattern port", () => {
  const bars = parseMt5Csv("<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2026.01.05\t01:00:00\t10\t12\t9\t11\t5\t0\t30\n", M5);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].spreadPoints, 30);
  assert.equal(bars[0].closeTime - bars[0].openTime, M5);
  const engulf = [{ open: 10, close: 8, high: 10.5, low: 7.5 }, { open: 8, close: 10.5, high: 11, low: 7.8 }];
  assert.deepEqual(detectEntryPattern(engulf, 1), { side: "BUY", pattern: "ENGULFING", patternExtreme: 7.8 });
});

test("research filters: TREND regime filter and entry spread cap block entries", () => {
  const path = [...lead, [2000, 2000, 1980, 1985], flat(1985)];
  assert.equal(simulate({ ...world(path), config: noCost }).length, 1);
  assert.equal(simulate({ ...world(path), config: { ...noCost, trendRegimes: ["BREAKOUT"] } }).length, 0);
  assert.equal(simulate({ ...world(path, { spreadPoints: 50 }), config: { ...noCost, maxEntrySpreadPrice: 0.4 } }).length, 0);
});
