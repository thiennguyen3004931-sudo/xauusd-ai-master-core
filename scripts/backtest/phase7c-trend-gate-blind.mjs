#!/usr/bin/env node
// Phase 7C — one-shot blind test of the locked hypothesis "library trend gate + TREND only" (offline).
// Locked plan: docs/research/phase7c-trend-gate-blind-test-plan.md. Run once; do not tune on the result.
//
// SAFETY: offline only. Reads MT5 CSV exports, writes under --out (default .runtime/, git-ignored).
// No broker, no network, no orders, no runtime state, no BOT_MODE.
//
// usage:
//   node scripts/backtest/phase7c-trend-gate-blind.mjs --m5 M5.csv --m15 M15.csv --h1 H1.csv --h4 H4.csv \
//        [--start 2021-11-11] [--cache .runtime/backtest/blind-cache.json] [--out .runtime/backtest/blind.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { H1_MS, H4_MS } from "../../packages/market-intel/src/index.mjs";
import { metrics, simulate } from "./phase7c-management-sim.mjs";
import { inWindow } from "./phase7c-management-sweep.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";
import { libraryStateLookup, withTrendOnly } from "./phase7c-trend-gate-r4.mjs";

export const LOCKED = Object.freeze({
  // first date with real M5/M15 history in the 2020-2023 export (earlier rows are H1 bars with zero spread)
  intradayStart: Date.UTC(2021, 10, 11),
  volume: 0.12,
  strategies: Object.freeze(["TREND"]),
  blocks: 6,
  thresholds: Object.freeze({ minTrades: 30, profitFactorAbove: 1.2, minPositiveBlocks: 4 }),
});

export function verdict(all, blockMetrics, t = LOCKED.thresholds) {
  const positiveBlocks = blockMetrics.filter((m) => m.netUsd > 0).length;
  const checks = {
    tradesAtLeast30: all.trades >= t.minTrades,
    profitFactorAbove1_20: all.profitFactor > t.profitFactorAbove,
    expectancyPositive: all.expectancyUsd > 0,
    avgRPositive: all.avgR > 0,
    positiveBlocksAtLeast4of6: positiveBlocks >= t.minPositiveBlocks,
  };
  return { pass: Object.values(checks).every(Boolean), checks, positiveBlocks };
}

export const equalBlocks = (start, end, n) =>
  Array.from({ length: n }, (_, b) => [start + Math.round(((end - start) * b) / n), start + Math.round(((end - start) * (b + 1)) / n)]);

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const groupBy = (trades, keyOf) => {
  const g = {};
  for (const t of trades) (g[keyOf(t)] ??= []).push(t);
  return Object.fromEntries(Object.entries(g).sort().map(([k, ts]) => [k, metrics(ts)]));
};

export function runBlind({ m5, m15, pre, stateAt, locked = LOCKED, stress = true }) {
  const gate = withTrendOnly(stateAt);
  const config = { volume: locked.volume, strategies: [...locked.strategies], trendEntryFilter: gate };
  const trades = simulate({ m15, m5, pre, config });
  const current = simulate({ m15, m5, pre, config: { volume: locked.volume } });
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const blocks = equalBlocks(start, end, locked.blocks);
  const blockMetrics = blocks.map((b) => metrics(inWindow(trades, b)));
  const all = metrics(trades);
  const half = [[start, blocks[2][1]], [blocks[3][0], end]];
  const topRemoved = metrics([...trades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(5).sort((a, b) => a.entryTime - b.entryTime));
  let costStress = null;
  if (stress) {
    const run = (extra, m5x = m5) => metrics(simulate({ m15, m5: m5x, pre, config: { ...config, ...extra } }));
    const wide = m5.map((b) => ({ ...b, spreadPoints: (Number(b.spreadPoints) || 0) * 1.5 }));
    costStress = {
      slippage0_30: run({ slippagePrice: 0.3 }),
      commission10: run({ commissionPerLotRoundTurn: 10 }),
      spreadX1_5: run({}, wide),
      all: run({ slippagePrice: 0.3, commissionPerLotRoundTurn: 10 }, wide),
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    data: { m5Bars: m5.length, m15Bars: m15.length, from: iso(start), to: iso(end) },
    locked: { ...locked, intradayStart: iso(locked.intradayStart) },
    hypothesis: { all, verdict: verdict(all, blockMetrics), blocks: blocks.map((b, i) => ({ test: b.map(iso), ...blockMetrics[i] })) },
    reference: {
      current: { all: metrics(current), blocks: blocks.map((b) => metrics(inWindow(current, b))) },
      bySide: groupBy(trades, (t) => t.side),
      byRegime: groupBy(trades, (t) => t.regime ?? "null"),
      halves: half.map((h) => ({ window: h.map(iso), ...metrics(inWindow(trades, h)) })),
      top5Removed: topRemoved,
      exitReasons: trades.reduce((o, t) => ({ ...o, [t.exitReason]: (o[t.exitReason] ?? 0) + 1 }), {}),
      costStress,
    },
  };
}

const trimFrom = (bars, ms) => bars.filter((b) => b.openTime >= ms);

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.m5 || !args.m15 || !args.h1 || !args.h4) {
    console.error("usage: --m5 <M5.csv> --m15 <M15.csv> --h1 <H1.csv> --h4 <H4.csv> [--cache file] [--out file]");
    process.exit(2);
  }
  const startMs = LOCKED.intradayStart;
  const m5 = trimFrom(loadMt5Bars(args.m5, M5_MS), startMs);
  const m15 = trimFrom(loadMt5Bars(args.m15, M15_MS), startMs);
  const h1 = loadMt5Bars(args.h1, H1_MS);
  const h4 = loadMt5Bars(args.h4, H4_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/blind-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) {
    pre = await precomputeReplay({ m15, m5, onProgress: (i, n) => (i % 10000 === 0 ? console.error(`  ${i}/${n}`) : null) });
    saveCache(cacheFile, pre);
  }
  const report = runBlind({ m5, m15, pre, stateAt: libraryStateLookup({ h4, h1 }) });
  const out = args.out ?? ".runtime/backtest/blind.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ data: report.data, all: report.hypothesis.all, verdict: report.hypothesis.verdict }, null, 2));
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) await main();
