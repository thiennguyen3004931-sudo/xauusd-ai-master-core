#!/usr/bin/env node
// Phase 7C T3 + T4 — management parameter sweep, out-of-sample and 6-fold walk-forward (offline).
//
// usage:
//   node scripts/backtest/phase7c-management-sweep.mjs --m5 <M5.csv> --m15 <M15.csv> \
//        [--cache .runtime/backtest/phase7c-replay-cache.json] [--out .runtime/backtest/phase7c-sweep.json]
//
// Inputs are MT5 "Export bars" CSV files. Raw broker data and outputs stay out of git (.runtime/).
// Grid (work order T3): BE trigger 6/8/10 x BE offset 0/1/2 x SL cap 10/12/15 x fixed TP off/20/30/40.
// Selection never looks at the test window: a config is chosen on the training window by the median
// profit factor of itself and its grid neighbours (stable region, not a single optimum).
import fs from "node:fs";
import path from "node:path";
import { BASELINE_CONFIG, metrics, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";

export const GRID = Object.freeze({
  breakEvenTriggerPrice: [6, 8, 10],
  breakEvenOffsetPrice: [0, 1, 2],
  maxInitialStopPrice: [10, 12, 15],
  fixedTpPrice: [null, 20, 30, 40],
});
const DIMS = Object.keys(GRID);
export const MIN_TRAIN_TRADES = 20;

export function gridConfigs() {
  const out = [];
  const rec = (i, acc) => {
    if (i === DIMS.length) { out.push({ ...acc }); return; }
    for (const v of GRID[DIMS[i]]) rec(i + 1, { ...acc, [DIMS[i]]: v });
  };
  rec(0, {});
  return out;
}

export const configKey = (c) =>
  `BE${c.breakEvenTriggerPrice}/OFF${c.breakEvenOffsetPrice}/SL${c.maxInitialStopPrice}/TP${c.fixedTpPrice ?? "off"}`;

function neighbours(config) {
  const out = [config];
  for (const d of DIMS) {
    const values = GRID[d];
    const i = values.indexOf(config[d]);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < values.length) out.push({ ...config, [d]: values[j] });
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const finitePf = (pf) => (Number.isFinite(pf) ? pf : 5);

export function selectStable(resultsByKey, window, minTrades = MIN_TRAIN_TRADES) {
  let best = null;
  for (const [key, { config, trades }] of resultsByKey) {
    const own = metrics(inWindow(trades, window));
    if (own.trades < minTrades) continue;
    const pfs = neighbours(config).map((n) => finitePf(metrics(inWindow(resultsByKey.get(configKey(n)).trades, window)).profitFactor));
    const score = median(pfs);
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && own.expectancyUsd > best.own.expectancyUsd)) {
      best = { key, config, score, own };
    }
  }
  return best;
}

export const inWindow = (trades, [from, to]) => trades.filter((t) => t.entryTime >= from && t.entryTime < to);

function breakdown(trades) {
  const groups = {};
  for (const t of trades) {
    for (const g of [`side:${t.side}`, `strategy:${t.strategy}`, `regime:${t.regime}`, `strategy+side:${t.strategy}/${t.side}`]) {
      (groups[g] ??= []).push(t);
    }
  }
  return Object.fromEntries(Object.entries(groups).sort().map(([g, ts]) => [g, metrics(ts)]));
}

function exitReasons(trades) {
  const out = {};
  for (const t of trades) out[t.exitReason] = (out[t.exitReason] ?? 0) + 1;
  return out;
}

export function runSweep({ m15, m5, pre, cost = {} }) {
  const results = new Map();
  for (const config of gridConfigs()) {
    const trades = simulate({ m15, m5, pre, config: { ...config, ...cost } });
    results.set(configKey(config), { config, trades });
  }
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const span = end - start;
  const isWindow = [start, start + Math.round(span * 2 / 3)];
  const oosWindow = [isWindow[1], end];
  const baselineKey = configKey({ breakEvenTriggerPrice: 6, breakEvenOffsetPrice: 0, maxInitialStopPrice: 10, fixedTpPrice: null });
  const baseline = results.get(baselineKey);

  const table = [...results.values()].map(({ config, trades }) => ({
    key: configKey(config),
    config,
    full: metrics(trades),
    inSample: metrics(inWindow(trades, isWindow)),
    outOfSample: metrics(inWindow(trades, oosWindow)),
  }));

  const selected = selectStable(results, isWindow);
  const candidate = selected ? results.get(selected.key) : null;

  // 6-fold anchored walk-forward: 7 equal blocks, fold f trains on blocks [0, f) and tests on block f.
  const blocks = Array.from({ length: 7 }, (_, b) => [start + Math.round(span * b / 7), start + Math.round(span * (b + 1) / 7)]);
  const folds = [];
  for (let f = 1; f <= 6; f += 1) {
    const train = [blocks[0][0], blocks[f - 1][1]];
    const testWin = blocks[f];
    const pick = selectStable(results, train, Math.max(10, Math.round(MIN_TRAIN_TRADES * f / 4)));
    folds.push({
      fold: f,
      train: train.map(iso),
      test: testWin.map(iso),
      selectedOnTrain: pick?.key ?? null,
      trainScore: pick ? Math.round(pick.score * 1000) / 1000 : null,
      walkForwardTest: pick ? metrics(inWindow(results.get(pick.key).trades, testWin)) : null,
      baselineTest: metrics(inWindow(baseline.trades, testWin)),
      candidateTest: candidate ? metrics(inWindow(candidate.trades, testWin)) : null,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    data: { m5Bars: m5.length, m15Bars: m15.length, from: iso(start), to: iso(end) },
    assumptions: {
      execution: "STOP_FIRST; entries at next M5 open; stops filled with slippage; TP at price",
      spread: "per-bar MT5 <SPREAD> x point",
      commissionPerLotRoundTurn: cost.commissionPerLotRoundTurn ?? BASELINE_CONFIG.commissionPerLotRoundTurn,
      slippagePrice: cost.slippagePrice ?? BASELINE_CONFIG.slippagePrice,
      volume: BASELINE_CONFIG.volume,
      notModelled: ["daily recovery / RECOVERY_TP", "REVERSAL entries", "spread/freshness gates", "broker stop level gap"],
    },
    windows: { inSample: isWindow.map(iso), outOfSample: oosWindow.map(iso) },
    baseline: {
      key: baselineKey,
      full: metrics(baseline.trades),
      inSample: metrics(inWindow(baseline.trades, isWindow)),
      outOfSample: metrics(inWindow(baseline.trades, oosWindow)),
      outOfSampleBreakdown: breakdown(inWindow(baseline.trades, oosWindow)),
      exitReasons: exitReasons(baseline.trades),
    },
    candidate: selected ? {
      key: selected.key,
      config: selected.config,
      inSampleNeighbourMedianPf: Math.round(selected.score * 1000) / 1000,
      inSample: metrics(inWindow(candidate.trades, isWindow)),
      outOfSample: metrics(inWindow(candidate.trades, oosWindow)),
      outOfSampleBreakdown: breakdown(inWindow(candidate.trades, oosWindow)),
      exitReasons: exitReasons(candidate.trades),
    } : null,
    walkForward: folds,
    table,
  };
}

export function acceptance(report) {
  const c = report.candidate;
  if (!c) return { pass: false, reasons: ["no candidate met the minimum training trades"] };
  const oos = c.outOfSample;
  const positiveFolds = report.walkForward.filter((f) => (f.candidateTest?.netUsd ?? 0) > 0).length;
  const checks = {
    oosTradesAtLeast30: oos.trades >= 30,
    oosProfitFactorAbove1_20: oos.profitFactor > 1.2,
    oosExpectancyPositive: oos.expectancyUsd > 0,
    oosAvgRPositive: oos.avgR > 0,
    walkForwardPositiveFoldsAtLeast4of6: positiveFolds >= 4,
  };
  return { pass: Object.values(checks).every(Boolean), checks, positiveFolds };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.m5 || !args.m15) {
    console.error("usage: --m5 <M5.csv> --m15 <M15.csv> [--cache file] [--out file] [--commission 7] [--slippage 0.1]");
    process.exit(2);
  }
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) {
    console.error(`PRECOMPUTE regime on ${m15.length} M15 bars ...`);
    pre = await precomputeReplay({ m15, m5, onProgress: (i, n) => console.error(`  ${i}/${n}`) });
    saveCache(cacheFile, pre);
  }
  const cost = {};
  if (args.commission !== undefined) cost.commissionPerLotRoundTurn = Number(args.commission);
  if (args.slippage !== undefined) cost.slippagePrice = Number(args.slippage);
  const report = runSweep({ m15, m5, pre, cost });
  report.acceptance = acceptance(report);
  const out = args.out ?? ".runtime/backtest/phase7c-sweep.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ baseline: report.baseline.outOfSample, candidate: report.candidate?.key, candidateOos: report.candidate?.outOfSample, acceptance: report.acceptance }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
