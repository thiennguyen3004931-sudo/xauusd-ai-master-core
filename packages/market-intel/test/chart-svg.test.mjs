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
