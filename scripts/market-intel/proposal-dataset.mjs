#!/usr/bin/env node
// Feature 1 (C2) — build the before/after dataset for proposals (offline, read-only).
//
// Tags every trade of a Phase 7C backtest (current config) with the regime-library state visible at its
// entry time, writes the dataset the API reads, and prints the proposals with their evidence label.
// Candidates are chosen on the first part of the period (default 2/3) and labelled on the rest.
//
// SAFETY: offline only. Reads CSV files, writes under .runtime/market-intel/ (git-ignored).
// No broker, no network, no orders, no runtime state.
//
// Usage:
//   node scripts/market-intel/proposal-dataset.mjs --trades .runtime/market-intel/bt3y/trades.csv \
//        --h1 XAUUSD_H1.csv --h4 XAUUSD_H4.csv [--split 0.667] [--out .runtime/market-intel/proposal-dataset.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { H1_MS, H4_MS, enrichTradesWithContext, journalBreakdown } from "../../packages/market-intel/src/index.mjs";
import { BASELINE_PARAMS, EVIDENCE_RULE, PROPOSALS_VERSION, generateProposals } from "../../packages/market-intel/src/proposals.mjs";
import { loadMt5Bars } from "../backtest/phase7c-replay-data.mjs";
import { parseTradesCsv } from "./regime-library-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}

/** Convert backtest rows into journal-shaped trades. */
export function toDatasetTrades(rows) {
  return rows.map((r, i) => ({
    id: `bt-${i + 1}`,
    openedAt: r.entryMs,
    closedAt: Date.parse(`${String(r.exitTime).replace(" ", "T")}Z`),
    strategy: r.strategy,
    side: r.side,
    productionRegime: r.regime,
    netPnl: r.pnlUsd,
    r: r.r,
  }));
}

/** Split time at a fraction of the trade count (chronological). */
export function splitTime(trades, fraction) {
  const sorted = [...trades].sort((a, b) => a.openedAt - b.openedAt);
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[k]?.openedAt ?? 0;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.trades || !args.h1 || !args.h4) {
    console.log("Usage: --trades <trades.csv> --h1 <file> --h4 <file> [--split 0.667] [--out <file>]");
    return args.help ? 0 : 2;
  }
  const rows = parseTradesCsv(fs.readFileSync(path.resolve(args.trades), "utf8"));
  const h1 = loadMt5Bars(path.resolve(args.h1), H1_MS);
  const h4 = loadMt5Bars(path.resolve(args.h4), H4_MS);
  const trades = enrichTradesWithContext({ trades: toDatasetTrades(rows), h4, h1 });
  const fraction = args.split ? Number(args.split) : 2 / 3;
  const splitAt = splitTime(trades, fraction);
  const proposals = generateProposals({ trades, currentParams: BASELINE_PARAMS, splitAt, now: Date.now() });
  const dataset = {
    schema: "market-intel-proposal-dataset-v1",
    version: PROPOSALS_VERSION,
    generatedAt: Date.now(),
    source: { kind: "PHASE7C_BACKTEST_CURRENT_CONFIG", trades: path.basename(args.trades), h1: path.basename(args.h1), h4: path.basename(args.h4) },
    splitFraction: fraction,
    splitAt,
    evidenceRule: EVIDENCE_RULE,
    trades: trades.map(({ id, openedAt, closedAt, strategy, side, productionRegime, netPnl, r, libraryState, alignment }) => ({ id, openedAt, closedAt, strategy, side, productionRegime, netPnl, r, libraryState, alignment })),
  };
  const outFile = path.resolve(root, args.out ?? ".runtime/market-intel/proposal-dataset.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(dataset)}\n`);

  const b = journalBreakdown(trades);
  console.log(`Dataset: ${trades.length} lệnh, ${new Date(dataset.trades[0].openedAt).toISOString().slice(0, 10)} → ${new Date(dataset.trades.at(-1).openedAt).toISOString().slice(0, 10)}, mốc tách ${new Date(splitAt).toISOString().slice(0, 10)}`);
  console.log(`Toàn bộ: PF ${b.overall.profitFactor} · winrate ${b.overall.winRatePct}% · ròng ${b.overall.netPnl}`);
  for (const g of b.byStrategyAndLibraryState) console.log(`  ${g.key}: ${g.trades} lệnh · PF ${g.profitFactor} · ròng ${g.netPnl}`);
  for (const g of b.byAlignment) console.log(`  ${g.key}: ${g.trades} lệnh · PF ${g.profitFactor} · ròng ${g.netPnl}`);
  console.log(`Đề xuất: ${proposals.length}`);
  for (const p of proposals) {
    console.log(`- ${p.label}: ${p.oldValue} → ${p.newValue} · ${p.evidenceLabel}`);
    console.log(`  ${p.reason}`);
    for (const c of p.evaluation.evidence.checks) console.log(`  [${c.passed ? "x" : " "}] ${c.text}`);
    console.log(`  walk-forward Δròng: ${p.evaluation.walkForward.map((f) => f.netDelta).join(", ")}`);
  }
  console.log(`Đã ghi ${path.relative(root, outFile)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
}
