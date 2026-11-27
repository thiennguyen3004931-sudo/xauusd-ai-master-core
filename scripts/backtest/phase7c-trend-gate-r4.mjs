#!/usr/bin/env node
// Phase 7C research round 4 — regime-library trend gate for TREND x management grid (offline).
// Pre-registered plan: docs/research/phase7c-trend-gate-management-r4-plan.md (rules must not change after a run).
//
// SAFETY: offline only. Reads MT5 CSV exports, writes under --out (default .runtime/, git-ignored).
// No broker, no network, no orders, no runtime state, no BOT_MODE.
//
// usage:
//   node scripts/backtest/phase7c-trend-gate-r4.mjs --m5 M5.csv --m15 M15.csv --h1 H1.csv --h4 H4.csv \
//        [--cache .runtime/backtest/phase7c-replay-cache.json] [--out .runtime/backtest/phase7c-r4.json] [--svg file.svg]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { H1_MS, H4_MS, alignmentOf, analyzeTimeframe, classifyTimeframe, combine, lastClosedIndex } from "../../packages/market-intel/src/index.mjs";
import { BASELINE_CONFIG, metrics, simulate } from "./phase7c-management-sim.mjs";
import { configKey, gridConfigs, inWindow, selectStable } from "./phase7c-management-sweep.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";

export const PLAN = Object.freeze({
  splitAt: Date.UTC(2025, 11, 31), // same cut used when the gate was chosen (proposal C2)
  volume: 0.12,
  minTrainTrades: 20,
  baselineKey: configKey({ breakEvenTriggerPrice: 6, breakEvenOffsetPrice: 0, maxInitialStopPrice: 10, fixedTpPrice: null }),
});

/**
 * Library state (H4 context + H1 state, closed bars only) at each time asked. Same semantics as
 * enrichTradesWithContext: short H1 history -> null (UNKNOWN). Memoised per (H4 index, H1 index).
 */
export function libraryStateLookup({ h4, h1 }) {
  const a4 = analyzeTimeframe(h4);
  const a1 = analyzeTimeframe(h1);
  const memo = new Map();
  return (time) => {
    const i4 = lastClosedIndex(h4, time);
    const i1 = lastClosedIndex(h1, time);
    if (i4 < 0 || i1 < 0) return null;
    const key = `${i4}:${i1}`;
    if (memo.has(key)) return memo.get(key);
    const k1 = classifyTimeframe(a1, i1);
    const state = k1.reasons.includes("INSUFFICIENT_DATA") ? null : combine(classifyTimeframe(a4, i4), k1).state;
    memo.set(key, state);
    return state;
  };
}

/** WITH_TREND_ONLY gate as a simulator TREND entry filter. */
export const withTrendOnly = (stateAt) => (side, time) => alignmentOf(stateAt(time), side) === "WITH_TREND";

export function acceptanceOf(oos, folds) {
  const positiveFolds = folds.filter((f) => (f.test?.netUsd ?? 0) > 0).length;
  const checks = {
    oosTradesAtLeast30: oos.trades >= 30,
    oosProfitFactorAbove1_20: oos.profitFactor > 1.2,
    oosExpectancyPositive: oos.expectancyUsd > 0,
    oosAvgRPositive: oos.avgR > 0,
    walkForwardPositiveFoldsAtLeast4of6: positiveFolds >= 4,
  };
  return { pass: Object.values(checks).every(Boolean), checks, positiveFolds };
}

function groupBy(trades, keyOf) {
  const g = {};
  for (const t of trades) (g[keyOf(t)] ??= []).push(t);
  return Object.fromEntries(Object.entries(g).sort().map(([k, ts]) => [k, metrics(ts)]));
}
const exitReasons = (trades) => trades.reduce((o, t) => ({ ...o, [t.exitReason]: (o[t.exitReason] ?? 0) + 1 }), {});
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const monthly = (trades) => {
  const out = {};
  for (const t of trades) { const m = iso(t.entryTime).slice(0, 7); out[m] = Math.round(((out[m] ?? 0) + t.pnlUsd) * 100) / 100; }
  return out;
};

export function runRound4({ m5, m15, pre, stateAt, plan = PLAN, stress = true }) {
  const gate = withTrendOnly(stateAt);
  const base = { volume: plan.volume };
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const isWin = [start, plan.splitAt];
  const oosWin = [plan.splitAt, end];

  const baseline = simulate({ m15, m5, pre, config: base });
  const gated = new Map();
  for (const config of gridConfigs()) {
    gated.set(configKey(config), { config, trades: simulate({ m15, m5, pre, config: { ...base, ...config, trendEntryFilter: gate } }) });
  }
  const gateDefault = gated.get(plan.baselineKey).trades;

  const pick = selectStable(gated, isWin, plan.minTrainTrades);
  const cand = gated.get(pick.key).trades;

  const span = end - start;
  const blocks = Array.from({ length: 7 }, (_, b) => [start + Math.round(span * b / 7), start + Math.round(span * (b + 1) / 7)]);
  const folds = [];
  for (let f = 1; f <= 6; f += 1) {
    const train = [blocks[0][0], blocks[f - 1][1]];
    const test = blocks[f];
    const p = selectStable(gated, train, Math.max(10, Math.round(plan.minTrainTrades * f / 4)));
    folds.push({
      fold: f, train: train.map(iso), picked: p?.key ?? null,
      test: p ? metrics(inWindow(gated.get(p.key).trades, test)) : null,
      testWindow: test.map(iso),
      baseline: metrics(inWindow(baseline, test)),
      gateDefault: metrics(inWindow(gateDefault, test)),
      candidate: metrics(inWindow(cand, test)),
    });
  }
  const wfTrades = folds.flatMap((f, i) => (f.picked ? inWindow(gated.get(f.picked).trades, blocks[i + 1]) : []));

  const oosCand = inWindow(cand, oosWin);
  // EXPLORATORY (not pre-registered, added after the run showed SIDEWAY losing in both windows):
  // gate ON, default management, TREND only. Reported separately; never used for the acceptance verdict.
  const trendOnly = simulate({ m15, m5, pre, config: { ...base, strategies: ["TREND"], trendEntryFilter: gate } });
  const table = [...gated.values()].map(({ config, trades }) => ({
    key: configKey(config), inSample: metrics(inWindow(trades, isWin)), outOfSample: metrics(inWindow(trades, oosWin)),
  }));

  let costStress = null;
  if (stress) {
    const run = (extra, m5x = m5) => metrics(inWindow(simulate({ m15, m5: m5x, pre, config: { ...base, ...pick.config, trendEntryFilter: gate, ...extra } }), oosWin));
    const wideSpread = m5.map((b) => ({ ...b, spreadPoints: (Number(b.spreadPoints) || 0) * 1.5 }));
    costStress = {
      base: metrics(oosCand),
      slippage0_30: run({ slippagePrice: 0.3 }),
      commission10: run({ commissionPerLotRoundTurn: 10 }),
      spreadX1_5: run({}, wideSpread),
      all: run({ slippagePrice: 0.3, commissionPerLotRoundTurn: 10 }, wideSpread),
    };
  }
  const topRemoved = (ts, n) => metrics([...ts].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(n).sort((a, b) => a.entryTime - b.entryTime));

  return {
    generatedAt: new Date().toISOString(),
    plan: { ...plan, splitAt: iso(plan.splitAt) },
    data: { m5Bars: m5.length, m15Bars: m15.length, from: iso(start), to: iso(end) },
    assumptions: {
      execution: "STOP_FIRST; next M5 open entry; spread per M5 bar; slippage on market/stop fills; commission per lot",
      commissionPerLotRoundTurn: BASELINE_CONFIG.commissionPerLotRoundTurn,
      slippagePrice: BASELINE_CONFIG.slippagePrice,
      volume: plan.volume,
      gate: "TREND only when regime-library state (H1 + H4 conflict check, closed bars) is in the trade direction; SIDEWAY ungated",
    },
    windows: { inSample: isWin.map(iso), outOfSample: oosWin.map(iso) },
    current: { inSample: metrics(inWindow(baseline, isWin)), outOfSample: metrics(inWindow(baseline, oosWin)), full: metrics(baseline) },
    gateDefaultManagement: { inSample: metrics(inWindow(gateDefault, isWin)), outOfSample: metrics(inWindow(gateDefault, oosWin)) },
    candidate: {
      key: pick.key, config: pick.config, inSampleNeighbourMedianPf: Math.round(pick.score * 1000) / 1000,
      inSample: metrics(inWindow(cand, isWin)), outOfSample: metrics(oosCand),
      oosBySide: groupBy(oosCand, (t) => t.side), oosByStrategy: groupBy(oosCand, (t) => t.strategy),
      oosByRegime: groupBy(oosCand, (t) => t.regime ?? "null"), oosMonthly: monthly(oosCand), oosExitReasons: exitReasons(oosCand),
      oosTop3Removed: topRemoved(oosCand, 3), oosTop5Removed: topRemoved(oosCand, 5),
      costStress,
    },
    walkForward: { folds, pooled: metrics(wfTrades), pooledBySide: groupBy(wfTrades, (t) => t.side), pooledByRegime: groupBy(wfTrades, (t) => t.regime ?? "null") },
    exploratoryTrendOnly: {
      note: "post-hoc, not pre-registered: gate ON, default management, SIDEWAY off",
      inSample: metrics(inWindow(trendOnly, isWin)), outOfSample: metrics(inWindow(trendOnly, oosWin)),
      oosBySide: groupBy(inWindow(trendOnly, oosWin), (t) => t.side),
      oosByRegime: groupBy(inWindow(trendOnly, oosWin), (t) => t.regime ?? "null"),
      oosTop5Removed: topRemoved(inWindow(trendOnly, oosWin), 5),
      folds: blocks.slice(1).map((b) => ({ test: b.map(iso), ...metrics(inWindow(trendOnly, b)) })),
    },
    acceptance: acceptanceOf(metrics(oosCand), folds),
    acceptanceFixedCandidate: acceptanceOf(metrics(oosCand), folds.map((f) => ({ test: f.candidate }))),
    table,
    series: {
      oos: {
        current: inWindow(baseline, oosWin).map((t) => [t.exitTime, t.pnlUsd]),
        gateDefault: inWindow(gateDefault, oosWin).map((t) => [t.exitTime, t.pnlUsd]),
        candidate: oosCand.map((t) => [t.exitTime, t.pnlUsd]),
        trendOnlyExploratory: inWindow(trendOnly, oosWin).map((t) => [t.exitTime, t.pnlUsd]),
      },
    },
  };
}

/** Cumulative OOS P/L lines (USD). */
export function renderEquitySvg(series, { width = 760, height = 320 } = {}) {
  const lines = [
    ["current", "Hiện tại", "#8a8f98", ""],
    ["gateDefault", "Cổng, QL mặc định", "#257de0", ""],
    ["candidate", "Cổng + cấu hình chọn", "#f47230", ""],
    ["trendOnlyExploratory", "Cổng, chỉ TREND (khám phá)", "#00b894", " stroke-dasharray=\"6 4\""],
  ];
  const cum = Object.fromEntries(lines.map(([k]) => {
    let s = 0;
    return [k, (series[k] ?? []).map(([t, p]) => [t, (s += p)])];
  }));
  const all = Object.values(cum).flat();
  if (!all.length) return "<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
  const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
  const y0 = Math.min(0, ...all.map((p) => p[1])), y1 = Math.max(0, ...all.map((p) => p[1]));
  const L = 64, R = 16, T = 48, B = 32;
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (width - L - R);
  const y = (v) => T + (1 - (v - y0) / Math.max(1, y1 - y0)) * (height - T - B);
  const ticks = 5;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => y0 + (i * (y1 - y0)) / ticks).map((v) =>
    `<line x1="${L}" x2="${width - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(v)}</text>`).join("");
  const paths = lines.map(([k, , c, dash]) => {
    const pts = cum[k];
    if (!pts.length) return "";
    const d = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"${dash}/>`;
  }).join("");
  const legend = lines.map(([k, label, c], i) => {
    const last = cum[k].at(-1)?.[1] ?? 0;
    const lx = L + (i % 2) * 340, ly = 12 + Math.floor(i / 2) * 16;
    return `<rect x="${lx}" y="${ly - 4}" width="14" height="3" rx="1" fill="${c}"/><text x="${lx + 20}" y="${ly}" font-size="11" fill="#191919">${label}: ${Math.round(last)} USD</text>`;
  }).join("");
  const xl = [[t0, "start"], [(t0 + t1) / 2, "middle"], [t1, "end"]].map(([t, a]) => `<text x="${x(t).toFixed(1)}" y="${height - 10}" text-anchor="${a}" font-size="11" fill="#6b7280">${iso(t)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui,sans-serif"><rect width="100%" height="100%" fill="#fff"/>${grid}<line x1="${L}" x2="${width - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#9ca3af"/>${paths}${legend}${xl}</svg>\n`;
}

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.m5 || !args.m15 || !args.h1 || !args.h4) {
    console.error("usage: --m5 <M5.csv> --m15 <M15.csv> --h1 <H1.csv> --h4 <H4.csv> [--cache file] [--out file] [--svg file]");
    process.exit(2);
  }
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const h1 = loadMt5Bars(args.h1, H1_MS);
  const h4 = loadMt5Bars(args.h4, H4_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) {
    pre = await precomputeReplay({ m15, m5, onProgress: (i, n) => console.error(`  ${i}/${n}`) });
    saveCache(cacheFile, pre);
  }
  const report = runRound4({ m5, m15, pre, stateAt: libraryStateLookup({ h4, h1 }) });
  const out = args.out ?? ".runtime/backtest/phase7c-r4.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (args.svg) fs.writeFileSync(args.svg, renderEquitySvg(report.series.oos));
  const { series, table, ...summary } = report;
  console.log(JSON.stringify({ current: summary.current.outOfSample, gateDefault: summary.gateDefaultManagement.outOfSample, candidate: summary.candidate.key, oos: summary.candidate.outOfSample, wf: summary.walkForward.pooled, acceptance: summary.acceptance }, null, 2));
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) await main();
