#!/usr/bin/env node
// Phase 7C round 3 — robustness checks for the walk-forward pick N10 (Donchian 30 + ST H1 + ATR expansion).
// EXPLORATORY: written AFTER seeing the round-3 result. Nothing here may be used to re-tune the signal;
// it only asks "is N10 a stable region or a lucky point?" and "does it survive worse costs?".
//
//   1. Parameter neighbourhood: Donchian 20/30/55 x ATR ratio 1.0/1.1/1.2 x ATR baseline SMA 50/100/200.
//   2. Cost stress: slippage 0.10 → 0.30, commission 7 → 10 USD/lot, spread x1.5.
//   3. Month-by-month and per-fold table of N10.
//   4. Family-wise null: random sets the size of EVERY candidate tried in rounds 1–3 (31), since the
//      Donchian + ST H1 family itself was chosen after seeing data in rounds 1–2.
//
// usage: node scripts/backtest/phase7c-entry-signals-r3-robustness.mjs --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f]
import fs from "node:fs";
import path from "node:path";
import { metrics, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";
import { donchianBreakout } from "./phase7c-entry-signals.mjs";
import { CANDIDATES_R3, buildContextR3, buildSignals, randomSignal, selectionNull } from "./phase7c-entry-signals-r3.mjs";
import { walkForwardVariants } from "./phase7c-strategy-variants.mjs";

const CFG = { strategies: ["TREND"], requireTrendMode: false, requireSupertrendM5: false };

function smaOf(values, period) {
  const out = new Array(values.length).fill(null);
  let s = 0; let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === null) { s = 0; n = 0; continue; }
    s += values[i]; n += 1;
    if (n > period) { s -= values[i - period]; n = period; }
    if (n === period) out[i] = s / period;
  }
  return out;
}

export function donchAtrSignal(lookback, ratio, baseline) {
  let cacheCtx = null; let base = null;
  return (ctx, k) => {
    if (cacheCtx !== ctx) { cacheCtx = ctx; base = smaOf(ctx.atr14, baseline); }
    const s = donchianBreakout(ctx, k, lookback);
    if (!s) return null;
    const h = ctx.h1Idx[k];
    if (h < 0 || ctx.h1St[h] !== s.side) return null;
    return base[k] !== null && ctx.atr14[k] > ratio * base[k] ? s : null;
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) { pre = await precomputeReplay({ m15, m5 }); saveCache(cacheFile, pre); }
  const ctx = buildContextR3(m15, pre);
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const span = end - start;
  const foldStarts = Array.from({ length: 7 }, (_, b) => start + Math.round(span * b / 7));
  const run = (fn, config = CFG, m5bars = m5) => simulate({ m15, m5: m5bars, pre: { ...pre, trendSignals: buildSignals(ctx, fn) }, config });
  const foldNets = (trades) => [1, 2, 3, 4, 5, 6].map((f) => metrics(trades.filter((t) => t.entryTime >= foldStarts[f] && t.entryTime < (foldStarts[f + 1] ?? Infinity))));

  // 1. neighbourhood
  const grid = [];
  for (const lb of [20, 30, 55]) for (const ratio of [1.0, 1.1, 1.2]) for (const baseline of [50, 100, 200]) {
    const t = run(donchAtrSignal(lb, ratio, baseline));
    const folds = foldNets(t);
    grid.push({ lookback: lb, ratio, baseline, full: metrics(t), positiveFolds: folds.filter((m) => m.netUsd > 0).length, oosFoldsPooled: metrics(t.filter((x) => x.entryTime >= foldStarts[1])) });
  }

  // 2. cost stress on N10 itself
  const n10 = CANDIDATES_R3.find((c) => c.id === "N10_DONCH30_H1ST_ATRX");
  const m5Wide = m5.map((b) => ({ ...b, spreadPoints: b.spreadPoints * 1.5 }));
  const stress = [
    { id: "base", trades: run(n10.signal) },
    { id: "slippage 0.30", trades: run(n10.signal, { ...CFG, slippagePrice: 0.3 }) },
    { id: "commission 10/lot", trades: run(n10.signal, { ...CFG, commissionPerLotRoundTurn: 10 }) },
    { id: "spread x1.5", trades: run(n10.signal, CFG, m5Wide) },
    { id: "all three", trades: run(n10.signal, { ...CFG, slippagePrice: 0.3, commissionPerLotRoundTurn: 10 }, m5Wide) },
    { id: "no ST M15 gate", trades: run(n10.signal, { ...CFG, requireSupertrendM15: false }) },
  ].map((s) => ({ id: s.id, full: metrics(s.trades), testBlocks: metrics(s.trades.filter((x) => x.entryTime >= foldStarts[1])), folds: foldNets(s.trades).map((m) => m.netUsd) }));

  // 3. monthly
  const base = run(n10.signal);
  const months = {};
  for (const t of base) { const m = new Date(t.entryTime).toISOString().slice(0, 7); (months[m] ??= []).push(t); }
  const monthly = Object.entries(months).sort().map(([m, ts]) => ({ month: m, ...metrics(ts) }));
  const exitReasons = Object.fromEntries([...new Set(base.map((t) => t.exitReason))].map((r) => [r, base.filter((t) => t.exitReason === r).length]));

  // 4. family-wise null (set size 31 = rounds 1–3 candidates), random at N10's trade frequency
  const target = base.length;
  let lo = 0.001; let hi = 0.2;
  for (let it = 0; it < 14; it += 1) {
    const mid = Math.sqrt(lo * hi);
    const ns = [0, 1, 2, 3, 4].map((s) => run(randomSignal(1000 + s, mid), { ...CFG, requireSupertrendM15: false }).length).sort((a, b) => a - b);
    if (ns[2] < target) lo = mid; else hi = mid;
  }
  const rate = Math.sqrt(lo * hi);
  const pool = new Map();
  for (let s = 0; s < 150; s += 1) pool.set(`RND_${s}`, run(randomSignal(s, rate), { ...CFG, requireSupertrendM15: false }));
  const wfReal = walkForwardVariants(new Map(CANDIDATES_R3.map((c) => [c.id, run(c.signal, c.config)])), start, end);
  const dist = selectionNull(pool, 31, start, end, 400, 23);
  const familyNull = {
    setSize: 31, randomRate: rate, draws: dist.length,
    wfPooledPfP95: dist.map((d) => d.pf).sort((a, b) => a - b)[Math.floor(0.95 * dist.length)],
    wfPooledNetP95: dist.map((d) => d.net).sort((a, b) => a - b)[Math.floor(0.95 * dist.length)],
    pValuePooledPf: dist.filter((d) => d.pf >= wfReal.pooled.profitFactor).length / dist.length,
    pValuePooledNet: dist.filter((d) => d.net >= wfReal.pooled.netUsd).length / dist.length,
    nullPassRate: dist.filter((d) => d.passes).length / dist.length,
  };

  const report = { generatedAt: new Date().toISOString(), grid, stress, monthly, exitReasons, familyNull };
  const out = args.out ?? ".runtime/backtest/phase7c-entry-signals-r3-robustness.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
  console.log("| Donchian | ATR ratio | ATR SMA | 12 tháng lệnh / PF / USD | 6 block test: lệnh / PF / USD | Fold dương |");
  for (const g of grid) console.log(`| ${g.lookback} | ${g.ratio} | ${g.baseline} | ${g.full.trades} / ${pf(g.full.profitFactor)} / ${g.full.netUsd.toFixed(0)} | ${g.oosFoldsPooled.trades} / ${pf(g.oosFoldsPooled.profitFactor)} / ${g.oosFoldsPooled.netUsd.toFixed(0)} | ${g.positiveFolds}/6 |`);
  for (const s of stress) console.log(`stress ${s.id}: full ${s.full.trades}/${pf(s.full.profitFactor)}/${s.full.netUsd} avgR ${s.full.avgR} | test blocks ${s.testBlocks.trades}/${pf(s.testBlocks.profitFactor)}/${s.testBlocks.netUsd} | folds ${s.folds.map((x) => x.toFixed(0)).join(",")}`);
  for (const m of monthly) console.log(`${m.month}: ${m.trades} lệnh, PF ${pf(m.profitFactor)}, ${m.netUsd} USD`);
  console.log("exit reasons", JSON.stringify(exitReasons));
  console.log("family null", JSON.stringify(familyNull));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
