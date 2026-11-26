import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateScenario, summarize, bucketOf } from "./mtf-scenario-eval.mjs";

const bar = (o, h, l, c) => ({ open: o, high: h, low: l, close: c });
const buy = { direction: "BUY", entry: 2000, stopLoss: 1992, takeProfit1: 2016 };

test("no touch of the entry within expiry -> NO_FILL", () => {
  const m15 = [bar(2005, 2006, 2004, 2005), bar(2005, 2007, 2003, 2006), bar(2006, 2008, 2004, 2007)];
  assert.equal(simulateScenario(buy, m15, 0, { expiryBars: 5 }).outcome, "NO_FILL");
});

test("a close beyond the SL before the fill cancels the scenario", () => {
  const m15 = [bar(2005, 2006, 2004, 2005), bar(1995, 1996, 1990, 1991)];
  // low 1990 also touches entry 2000 -> filled and stopped on the same bar: STOP_FIRST
  assert.equal(simulateScenario(buy, m15, 0).outcome, "LOSS");
  const sell = { direction: "SELL", entry: 2010, stopLoss: 2018, takeProfit1: 1994 };
  const m15b = [bar(2000, 2001, 1999, 2000), bar(2000, 2005, 1999, 2004)];
  assert.equal(simulateScenario(sell, [...m15b, bar(2004, 2009, 2003, 2008)], 0).outcome, "NO_FILL");
});

test("fill then TP1 -> WIN with R net of costs; TP1 on the fill bar is ignored", () => {
  const m15 = [bar(2005, 2006, 2004, 2005), bar(2004, 2020, 1999, 2010), bar(2010, 2017, 2009, 2016)];
  const r = simulateScenario(buy, m15, 0, { cost: 0.4 });
  assert.equal(r.outcome, "WIN");
  assert.equal(r.bars, 1);
  assert.ok(Math.abs(r.r - (2016 - 2000.4) / 8) < 1e-9);
});

test("SL and TP1 inside one bar after the fill -> LOSS (STOP_FIRST)", () => {
  const m15 = [bar(2005, 2006, 2004, 2005), bar(2004, 2005, 1999, 2003), bar(2003, 2020, 1990, 2000)];
  assert.equal(simulateScenario(buy, m15, 0).outcome, "LOSS");
});

test("still open at expiry -> OPEN_EXPIRED marked to the close", () => {
  const m15 = [bar(2005, 2006, 2004, 2005), bar(2004, 2005, 1999, 2003), bar(2003, 2006, 2001, 2004)];
  const r = simulateScenario(buy, m15, 0, { expiryBars: 2, cost: 0 });
  assert.equal(r.outcome, "OPEN_EXPIRED");
  assert.equal(r.r, 0.5);
});

test("summary metrics and buckets", () => {
  const s = summarize([
    { filled: true, outcome: "WIN", r: 2, confidence: 60 },
    { filled: true, outcome: "LOSS", r: -1, confidence: 40 },
    { filled: false, outcome: "NO_FILL", r: 0, confidence: 50 },
  ]);
  assert.equal(s.fillRate, 66.67);
  assert.equal(s.tp1BeforeSl, 50);
  assert.equal(s.pfR, 2);
  assert.equal(bucketOf(72), "70-90");
  assert.equal(bucketOf(5), "5-39");
});

test("analysis markdown lists both scenarios with levels, invalidation and the score breakdown", async () => {
  const { renderMarkdown } = await import("./mtf-scenario.mjs");
  const s = (role, direction) => ({
    role, direction, confidence: 60, entryZone: { low: 1, high: 2, sources: ["OB H1"] }, entry: 1.5, stopLoss: 0.5,
    takeProfit1: 3, takeProfit2: 4, rr1: 1.5, rr2: 2.5, targetsSource: { tp1: "swing", tp2: "H4" },
    invalidation: { price: 0.5, text: "H1 đóng dưới 0.5" }, m15: { status: "WAITING", triggers: [] },
    confidenceBreakdown: [{ factor: "Điểm nền", points: 30 }], botStopRule: { stopDistance: 1, note: "x" },
  });
  const md = renderMarkdown({
    asOf: Date.UTC(2026, 0, 5), notes: [], m15: { close: 1.6 },
    h4: { state: "UPTREND", confidence: 80, bias: "BUY", keyLevels: [], orderBlocks: [] },
    h1: { state: "UPTREND", confidence: 70, agreement: "AGREE", phase: "PHA_HOI" },
    scenarios: [s("PRIMARY", "BUY"), s("ALTERNATE", "SELL")],
  });
  assert.match(md, /Kịch bản chính: MUA/);
  assert.match(md, /Kịch bản thay thế: BÁN/);
  assert.match(md, /Mất hiệu lực \| H1 đóng dưới 0.5/);
  assert.match(md, /\+30: Điểm nền/);
});
