import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTimeframe, combinedAt, classifySeries, parseTradesCsv, tradeStats, main } from "./regime-library-report.mjs";
import { analyzeTimeframe, H1_MS, H4_MS, M15_MS } from "../../packages/market-intel/src/index.mjs";

function syntheticM15(count) {
  const start = Date.UTC(2026, 0, 5);
  const rows = [];
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const p = (k) => 2000 + 0.2 * k + 8 * Math.sin((2 * Math.PI * k) / 96);
    const open = p(i - 1), close = p(i);
    const t = start + i * M15_MS;
    const b = { openTime: t, closeTime: t + M15_MS, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close };
    bars.push(b);
    const d = new Date(t).toISOString();
    rows.push([d.slice(0, 10).replaceAll("-", "."), d.slice(11, 19), open.toFixed(2), b.high.toFixed(2), b.low.toFixed(2), close.toFixed(2), 100, 0, 20].join("\t"));
  }
  return { bars, csv: ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>", ...rows].join("\n") };
}

test("buildTimeframe drops stub buckets with fewer than half their M15 bars", () => {
  const { bars } = syntheticM15(4 * 10 + 1); // last H1 bucket has 1 bar
  const h1 = buildTimeframe(bars, H1_MS);
  assert.equal(h1.length, 10);
});

test("combinedAt only uses H1/H4 bars closed at asOf (no look-ahead)", () => {
  const { bars } = syntheticM15(16 * 400);
  const h1 = buildTimeframe(bars, H1_MS);
  const h4 = buildTimeframe(bars, H4_MS);
  const s1 = classifySeries(analyzeTimeframe(h1));
  const s4 = classifySeries(analyzeTimeframe(h4));
  const asOf = h1[300].closeTime + 30 * 60_000; // mid-way through the next H1 bar
  const c = combinedAt(h1, h4, s1, s4, asOf);
  assert.equal(c.h1Index, 300);
  assert.ok(h4[c.h4Index].closeTime <= asOf);
  assert.ok(c.h4Index + 1 >= h4.length || h4[c.h4Index + 1].closeTime > asOf);
});

test("trades CSV parsing and stats", () => {
  const list = parseTradesCsv("strategy,side,regime,entryTime,pnlUsd,r\nTREND,BUY,BREAKOUT,2026-01-05 10:00,30,1\nTREND,SELL,BREAKOUT,2026-01-05 11:00,-10,-1\n");
  assert.equal(list[0].entryMs, Date.UTC(2026, 0, 5, 10));
  const s = tradeStats(list);
  assert.deepEqual(s, { n: 2, winRate: 50, pf: 3, netUsd: 20, avgR: 0 });
});

test("main writes summary.json and sample charts from a CSV, offline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-report-"));
  const { csv } = syntheticM15(16 * 400);
  writeFileSync(join(dir, "m15.csv"), csv);
  const code = await main(["--m15", join(dir, "m15.csv"), "--skip-production", "--out", join(dir, "out"), "--charts-dir", join(dir, "charts")]);
  assert.equal(code, 0);
  const summary = JSON.parse(readFileSync(join(dir, "out", "summary.json"), "utf8"));
  assert.equal(summary.libraryVersion, "regime-library-v1");
  assert.equal(summary.agreement, null);
  assert.ok(summary.classifiedH1 > 0);
  assert.ok(readdirSync(join(dir, "charts")).every((f) => f.endsWith(".svg")));
});
