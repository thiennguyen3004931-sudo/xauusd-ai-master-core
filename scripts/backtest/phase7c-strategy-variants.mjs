#!/usr/bin/env node
// Phase 7C — strategy-level variants under anchored 6-fold walk-forward (offline research, no orders).
//
// The T3/T4 management grid found nothing that passes. The T4 breakdown pointed at SIDEWAY and at
// TREND outside BREAKOUT. Those observations came from data that was already seen, so this script
// judges each idea ONLY by walk-forward: in every fold the variant is picked on the training blocks
// and scored on the next, unseen block. The concatenated fold tests are the honest out-of-sample.
//
// usage: node scripts/backtest/phase7c-strategy-variants.mjs --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f]
import fs from "node:fs";
import path from "node:path";
import { metrics, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";

export const VARIANTS = Object.freeze([
  { id: "V0_BASELINE", label: "Hiện tại: TREND + SIDEWAY", config: {} },
  { id: "V1_TREND_ONLY", label: "Tắt SIDEWAY", config: { strategies: ["TREND"] } },
  { id: "V2_TREND_BREAKOUT_ONLY", label: "Chỉ TREND khi BREAKOUT", config: { strategies: ["TREND"], trendRegimes: ["BREAKOUT"] } },
  { id: "V3_SIDEWAY_CONF_75", label: "SIDEWAY cần độ tin cậy ≥75", config: { sidewayMinConfidence: 75 } },
  { id: "V4_TREND_ONLY_SPREAD_050", label: "Tắt SIDEWAY + spread vào lệnh ≤0,50", config: { strategies: ["TREND"], maxEntrySpreadPrice: 0.5 } },
  { id: "V5_BREAKOUT_SPREAD_050", label: "Chỉ TREND BREAKOUT + spread ≤0,50", config: { strategies: ["TREND"], trendRegimes: ["BREAKOUT"], maxEntrySpreadPrice: 0.5 } },
]);

const finitePf = (pf) => (Number.isFinite(pf) ? pf : 5);
const inWindow = (trades, [from, to]) => trades.filter((t) => t.entryTime >= from && t.entryTime < to);

export function walkForwardVariants(tradesById, start, end, { folds = 6, minTrainTrades = 20 } = {}) {
  const span = end - start;
  const blocks = Array.from({ length: folds + 1 }, (_, b) => [start + Math.round(span * b / (folds + 1)), start + Math.round(span * (b + 1) / (folds + 1))]);
  const rows = [];
  const pooled = [];
  for (let f = 1; f <= folds; f += 1) {
    const train = [blocks[0][0], blocks[f - 1][1]];
    const testWin = blocks[f];
    let pick = null;
    for (const [id, trades] of tradesById) {
      const m = metrics(inWindow(trades, train));
      if (m.trades < minTrainTrades) continue;
      if (!pick || finitePf(m.profitFactor) > finitePf(pick.train.profitFactor) + 1e-9) pick = { id, train: m };
    }
    const testTrades = pick ? inWindow(tradesById.get(pick.id), testWin) : [];
    pooled.push(...testTrades);
    rows.push({
      fold: f,
      test: testWin,
      picked: pick?.id ?? null,
      trainPf: pick?.train.profitFactor ?? null,
      test_: metrics(testTrades),
      perVariant: Object.fromEntries([...tradesById].map(([id, trades]) => [id, metrics(inWindow(trades, testWin))])),
    });
  }
  const positiveFolds = rows.filter((r) => r.test_.netUsd > 0).length;
  const pooledMetrics = metrics(pooled);
  return {
    rows,
    pooled: pooledMetrics,
    positiveFolds,
    acceptance: {
      tradesAtLeast30: pooledMetrics.trades >= 30,
      profitFactorAbove1_20: pooledMetrics.profitFactor > 1.2,
      expectancyPositive: pooledMetrics.expectancyUsd > 0,
      avgRPositive: pooledMetrics.avgR > 0,
      positiveFoldsAtLeast4of6: positiveFolds >= 4,
    },
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.m5 || !args.m15) { console.error("usage: --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f]"); process.exit(2); }
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) { pre = await precomputeReplay({ m15, m5 }); saveCache(cacheFile, pre); }
  const tradesById = new Map(VARIANTS.map((v) => [v.id, simulate({ m15, m5, pre, config: v.config })]));
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const wf = walkForwardVariants(tradesById, start, end);
  const report = {
    generatedAt: new Date().toISOString(),
    variants: VARIANTS.map((v) => ({ ...v, full: metrics(tradesById.get(v.id)) })),
    walkForward: wf,
  };
  const out = args.out ?? ".runtime/backtest/phase7c-strategy-variants.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
  console.log("| Biến thể | 12 tháng: lệnh / PF / USD / Max DD USD | " + [1, 2, 3, 4, 5, 6].map((f) => `Fold ${f} USD`).join(" | ") + " | Fold dương |");
  console.log("|---|---|" + "---|".repeat(7));
  for (const v of report.variants) {
    const folds = wf.rows.map((r) => r.perVariant[v.id]);
    console.log(`| ${v.id} — ${v.label} | ${v.full.trades} / ${pf(v.full.profitFactor)} / ${v.full.netUsd.toFixed(0)} / ${v.full.maxDrawdownUsd.toFixed(0)} | ${folds.map((m) => `${m.netUsd.toFixed(0)} (PF ${pf(m.profitFactor)})`).join(" | ")} | ${folds.filter((m) => m.netUsd > 0).length}/6 |`);
  }
  console.log("\nWalk-forward chọn biến thể trên train, chấm trên block kế tiếp:");
  for (const r of wf.rows) console.log(`- Fold ${r.fold}: chọn ${r.picked} (train PF ${pf(r.trainPf)}) → test ${r.test_.trades} lệnh, PF ${pf(r.test_.profitFactor)}, ${r.test_.netUsd.toFixed(0)} USD`);
  console.log(`\nGộp các fold test: ${JSON.stringify(wf.pooled)} | fold dương ${wf.positiveFolds}/6 | ngưỡng: ${JSON.stringify(wf.acceptance)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
