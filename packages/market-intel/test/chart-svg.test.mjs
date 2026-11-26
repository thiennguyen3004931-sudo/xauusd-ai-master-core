import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRegimeChartSvg, analyzeTimeframe } from "../src/index.mjs";
import { barsFromPath, upPath } from "./helpers.mjs";

test("chart: one candle per bar, swing labels, EMA lines, escaped title", () => {
  const bars = barsFromPath(300, upPath());
  const analysis = analyzeTimeframe(bars);
  const svg = renderRegimeChartSvg({ analysis, from: 200, to: 299, title: "H1 <Uptrend> & test" });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/class="candle"/g) ?? []).length, 100);
  assert.match(svg, /HH|HL/);
  assert.match(svg, /class="ema50"/);
  assert.match(svg, /class="ema200"/);
  assert.ok(svg.includes("H1 &lt;Uptrend&gt; &amp; test"));
  assert.ok(!svg.includes("<script"));
});

test("chart: optional projection draws the planned path after the last bar, off by default", () => {
  const bars = barsFromPath(300, upPath());
  const analysis = analyzeTimeframe(bars);
  const plain = renderRegimeChartSvg({ analysis, from: 200, to: 299 });
  assert.ok(!plain.includes('class="projection"'));
  const last = bars[299].close;
  const svg = renderRegimeChartSvg({ analysis, from: 200, to: 299, projection: { slots: 24, direction: "BUY", entry: last - 5, stopLoss: last - 12, takeProfit1: last + 6, takeProfit2: last + 14 } });
  assert.equal((svg.match(/class="candle"/g) ?? []).length, 100);
  assert.match(svg, /class="projection"/);
  assert.match(svg, /class="projection-target"/);
  assert.match(svg, /class="projection-stop"/);
  assert.match(svg, /Dự kiến \(minh hoạ, không phải dự báo\)/);
  for (const label of ["Entry", "TP1", "TP2", "SL"]) assert.ok(svg.includes(`>${label}</text>`), label);
});

test("scenario charts: M15 chart carries the projection of the primary scenario", async () => {
  const { renderScenarioCharts } = await import("../src/scenario-chart.mjs");
  const bars = barsFromPath(300, upPath());
  const s = { role: "PRIMARY", direction: "BUY", entry: 2100, stopLoss: 2090, takeProfit1: 2115, takeProfit2: 2130, rr1: 1.5, rr2: 3, confidence: 50, entryZone: { low: 2098, high: 2102 } };
  const result = { asOf: bars[299].closeTime, scenarios: [s], h4: { state: "UPTREND", keyLevels: [] }, h1: { state: "UPTREND" } };
  const charts = renderScenarioCharts({ h4: bars, h1: bars, m15: bars }, result);
  assert.match(charts.m15, /class="projection"/);
  assert.ok(!charts.h4.includes('class="projection"'));
});
