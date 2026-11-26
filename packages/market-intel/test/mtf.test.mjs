import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTimeframe, resample, H1_MS, H4_MS, M15_MS,
  keyLevels, orderBlocks, m15Trigger, buildScenarios, isMtfEnabled, renderScenarioCharts, MTF_VERSION,
} from "../src/index.mjs";
import { barsFromPath } from "./helpers.mjs";

// One consistent price path on M15; H1 / H4 are built from it.
const upM15 = (i) => 2000 + 0.06 * i + 15 * Math.sin((2 * Math.PI * i) / 384) + 4 * Math.sin((2 * Math.PI * i) / 40);
const downM15 = (i) => 3000 - 0.06 * i + 15 * Math.sin((2 * Math.PI * i) / 384) + 4 * Math.sin((2 * Math.PI * i) / 40);
function frames(path, n = 4200) {
  const m15 = barsFromPath(n, path, { periodMs: M15_MS, start: Date.UTC(2026, 0, 5), wick: 0.3 });
  return { m15, h1: resample(m15, H1_MS), h4: resample(m15, H4_MS) };
}

test("flag: MTF analysis is OFF unless explicitly enabled", () => {
  assert.equal(isMtfEnabled({}), false);
  assert.equal(isMtfEnabled({ ZIQ_MARKET_INTEL_MTF_ENABLED: "1" }), false);
  assert.equal(isMtfEnabled({ ZIQ_MARKET_INTEL_MTF_ENABLED: "true" }), true);
});

test("keyLevels: repeated swing highs at one price cluster into one resistance with touches", () => {
  // Flat oscillation with identical tops at ~2310 and bottoms at ~2290.
  const bars = barsFromPath(300, (i) => 2300 + 10 * Math.sin((2 * Math.PI * i) / 16), { wick: 0.2 });
  const a = analyzeTimeframe(bars);
  const levels = keyLevels(a, 299);
  const res = levels.find((l) => l.kind === "RESISTANCE");
  const sup = levels.find((l) => l.kind === "SUPPORT");
  assert.ok(res && Math.abs(res.price - 2310.2) < 1, JSON.stringify(res));
  assert.ok(res.touches >= 3);
  assert.ok(sup && Math.abs(sup.price - 2289.8) < 1);
});

test("orderBlocks: last bearish candle before a bullish BOS becomes a bullish OB until a close below it", () => {
  // Fall, one bearish candle, strong rally through the prior swing high.
  const closes = [];
  for (let i = 0; i < 40; i += 1) closes.push(2000 + 5 * Math.sin(i / 2));
  for (let i = 0; i < 6; i += 1) closes.push(closes.at(-1) - 2);
  for (let i = 0; i < 12; i += 1) closes.push(closes.at(-1) + 4);
  const bars = closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { openTime: i * H1_MS, closeTime: (i + 1) * H1_MS, open: o, close: c, high: Math.max(o, c) + 0.3, low: Math.min(o, c) - 0.3 };
  });
  const a = analyzeTimeframe(bars);
  const obs = orderBlocks(a, bars.length - 1);
  const bull = obs.find((o) => o.direction === "BULLISH");
  assert.ok(bull, JSON.stringify(obs));
  assert.ok(bars[bull.index].close < bars[bull.index].open);
  assert.equal(bull.low, bars[bull.index].low);
  // Append closes below the OB: it is mitigated and dropped.
  const later = [...bars];
  for (let k = 0; k < 30; k += 1) {
    const o = later.at(-1).close;
    const c = o - 3;
    later.push({ openTime: later.length * H1_MS, closeTime: (later.length + 1) * H1_MS, open: o, close: c, high: o + 0.3, low: c - 0.3 });
  }
  const after = orderBlocks(analyzeTimeframe(later), later.length - 1);
  assert.ok(!after.some((o) => o.index === bull.index && o.direction === "BULLISH"));
});

test("m15Trigger: touch of a demand zone then a bullish engulfing -> TRIGGERED", () => {
  const p = [2010, 2008, 2006, 2004, 2002, 2001, 2000.5, 2003.5, 2004];
  const bars = p.map((c, i) => {
    const o = i === 0 ? c : p[i - 1];
    return { openTime: i * M15_MS, closeTime: (i + 1) * M15_MS, open: o, close: c, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2 };
  });
  const a = analyzeTimeframe(bars);
  const t = m15Trigger(a, bars.length - 1, { low: 1999, high: 2002 }, "BUY");
  assert.equal(t.status, "TRIGGERED");
  assert.ok(t.triggers.some((x) => x.type === "ENGULFING"));
  const far = m15Trigger(a, bars.length - 1, { low: 1980, high: 1985 }, "BUY");
  assert.equal(far.status, "WAITING");
});

test("m15Trigger: a wick below recent lows that closes back above is a liquidity sweep", () => {
  const rows = [];
  for (let i = 0; i < 12; i += 1) rows.push({ o: 2005, c: 2004 + (i % 2), l: 2003, h: 2006.5 });
  rows.push({ o: 2004, c: 2004.5, l: 2001.5, h: 2005 }); // sweeps 2003 lows, closes back above
  const bars = rows.map((r, i) => ({ openTime: i * M15_MS, closeTime: (i + 1) * M15_MS, open: r.o, close: r.c, high: r.h, low: r.l }));
  const t = m15Trigger(analyzeTimeframe(bars), bars.length - 1, { low: 2001, high: 2003.5 }, "BUY");
  assert.ok(t.triggers.some((x) => x.type === "LIQUIDITY_SWEEP"), JSON.stringify(t));
});

function checkScenario(s, dir) {
  assert.equal(s.direction, dir);
  const sign = dir === "BUY" ? 1 : -1;
  assert.ok(sign * (s.entry - s.stopLoss) > 0, "SL on the wrong side");
  assert.ok(sign * (s.takeProfit1 - s.entry) > 0, "TP1 on the wrong side");
  assert.ok(sign * (s.takeProfit2 - s.takeProfit1) >= 0, "TP2 before TP1");
  assert.ok(s.entryZone.low < s.entryZone.high);
  const risk = Math.abs(s.entry - s.stopLoss);
  assert.ok(Math.abs(s.rr1 - Math.abs(s.takeProfit1 - s.entry) / risk) < 0.01);
  assert.ok(Math.abs(s.rr2 - Math.abs(s.takeProfit2 - s.entry) / risk) < 0.01);
  assert.ok(s.invalidation.price && s.invalidation.text.length > 0);
  assert.ok(s.confidence >= 5 && s.confidence <= 90);
  const raw = s.confidenceBreakdown.reduce((sum, f) => sum + f.points, 0);
  assert.equal(s.confidence, Math.max(5, Math.min(90, raw)));
  assert.equal(typeof s.botStopRule.withinRule, "boolean");
}

test("buildScenarios: uptrend on H4 and H1 -> primary BUY with consistent levels and an alternate", () => {
  const { m15, h1, h4 } = frames(upM15);
  const r = buildScenarios({ h4, h1, m15 });
  assert.equal(r.version, MTF_VERSION);
  assert.equal(r.h4.bias, "BUY");
  assert.ok(r.scenarios.length >= 1 && r.scenarios.length <= 2);
  checkScenario(r.scenarios[0], "BUY");
  assert.equal(r.scenarios[0].role, "PRIMARY");
  if (r.scenarios[1]) assert.equal(r.scenarios[1].role, "ALTERNATE");
  assert.deepEqual(r.safety, { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
});

test("buildScenarios: downtrend -> primary SELL", () => {
  const { m15, h1, h4 } = frames(downM15);
  const r = buildScenarios({ h4, h1, m15 });
  assert.equal(r.h4.bias, "SELL");
  checkScenario(r.scenarios[0], "SELL");
});

test("buildScenarios: result at asOf ignores bars that close later (no look-ahead)", () => {
  const { m15, h1, h4 } = frames(upM15, 4600);
  const asOf = m15[4199].closeTime;
  const cut = (bars) => bars.filter((b) => b.closeTime <= asOf);
  const full = buildScenarios({ h4, h1, m15, asOf });
  const trimmed = buildScenarios({ h4: cut(h4), h1: cut(h1), m15: cut(m15) });
  assert.deepEqual(full.scenarios, trimmed.scenarios);
});

test("renderScenarioCharts: three charts with entry, SL and TP marks", () => {
  const { m15, h1, h4 } = frames(upM15);
  const r = buildScenarios({ h4, h1, m15 });
  const charts = renderScenarioCharts({ h4, h1, m15 }, r);
  assert.deepEqual(Object.keys(charts), ["h4", "h1", "m15"]);
  for (const svg of Object.values(charts)) {
    assert.match(svg, /^<svg /);
    assert.match(svg, /SL /);
    assert.match(svg, /TP1 /);
    assert.match(svg, /Entry /);
  }
});
