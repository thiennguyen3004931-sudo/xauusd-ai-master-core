#!/usr/bin/env node
// Feature 2 — self-grading of H4 -> H1 -> M15 scenarios on history (offline, read-only).
//
// Every `--step-h1` closed H1 bars, build the scenarios exactly as the live analyzer would (only bars
// closed at that time), then follow the M15 bars that come after:
//   - not filled within --expiry-h1 hours -> NO_FILL; an M15 close beyond the SL before the fill -> CANCELLED
//   - filled when price touches the entry (mid of the zone), entry worsened by --cost (spread + slippage)
//   - after the fill: SL first -> LOSS, TP1 first -> WIN; both inside one M15 bar -> LOSS (STOP_FIRST);
//     TP1 is never counted on the fill bar itself; still open at expiry -> marked to the M15 close (OPEN_EXPIRED)
// The confidence points are fixed in packages/market-intel/src/scenario.mjs and were committed before
// this evaluation was run on real data.
//
// SAFETY: offline. Reads CSV exports, writes to --out (default .runtime/market-intel/mtf-eval, git-ignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { H1_MS, H4_MS, M15_MS, analyzeTimeframe, lastClosedIndex, scenariosFromAnalyses, MTF_VERSION, CONFIDENCE_POINTS } from "../../packages/market-intel/src/index.mjs";
import { loadMt5Bars } from "../backtest/phase7c-replay-data.mjs";
import { parseArgs } from "./regime-library-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BUCKETS = [[5, 39], [40, 54], [55, 69], [70, 90]];

export function simulateScenario(s, m15, startIndex, { expiryBars = 96, cost = 0.3 } = {}) {
  const buy = s.direction === "BUY";
  const risk = Math.abs(s.entry - s.stopLoss);
  const entryEff = buy ? s.entry + cost : s.entry - cost;
  const rOf = (price) => ((buy ? price - entryEff : entryEff - price) / risk);
  let filledAt = -1;
  const last = Math.min(m15.length - 1, startIndex + expiryBars);
  for (let k = startIndex + 1; k <= last; k += 1) {
    const b = m15[k];
    if (filledAt < 0) {
      const touched = buy ? b.low <= s.entry : b.high >= s.entry;
      if (!touched) {
        if (buy ? b.close < s.stopLoss : b.close > s.stopLoss) return { outcome: "CANCELLED", r: 0, filled: false };
        continue;
      }
      filledAt = k;
      if (buy ? b.low <= s.stopLoss : b.high >= s.stopLoss) return { outcome: "LOSS", r: rOf(s.stopLoss), filled: true, bars: 0 };
      continue;
    }
    const hitSl = buy ? b.low <= s.stopLoss : b.high >= s.stopLoss;
    const hitTp = buy ? b.high >= s.takeProfit1 : b.low <= s.takeProfit1;
    if (hitSl) return { outcome: "LOSS", r: rOf(s.stopLoss), filled: true, bars: k - filledAt };
    if (hitTp) return { outcome: "WIN", r: rOf(s.takeProfit1), filled: true, bars: k - filledAt };
  }
  if (filledAt < 0) return { outcome: "NO_FILL", r: 0, filled: false };
  return { outcome: "OPEN_EXPIRED", r: rOf(m15[last].close), filled: true, bars: last - filledAt };
}

const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

export function summarize(rows) {
  const filled = rows.filter((r) => r.filled);
  const resolved = filled.filter((r) => r.outcome === "WIN" || r.outcome === "LOSS");
  const wins = resolved.filter((r) => r.outcome === "WIN");
  const gain = filled.filter((r) => r.r > 0).reduce((s, r) => s + r.r, 0);
  const loss = -filled.filter((r) => r.r < 0).reduce((s, r) => s + r.r, 0);
  return {
    scenarios: rows.length,
    filled: filled.length,
    fillRate: rows.length ? r2((100 * filled.length) / rows.length) : null,
    tp1BeforeSl: resolved.length ? r2((100 * wins.length) / resolved.length) : null,
    avgConfidence: rows.length ? r2(rows.reduce((s, r) => s + r.confidence, 0) / rows.length) : null,
    avgR: filled.length ? r2(filled.reduce((s, r) => s + r.r, 0) / filled.length) : null,
    pfR: loss > 0 ? r2(gain / loss) : null,
    sumR: r2(filled.reduce((s, r) => s + r.r, 0)),
  };
}

export function group(rows, keyFn) {
  const g = {};
  for (const r of rows) (g[keyFn(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, summarize(v)]));
}

export const bucketOf = (c) => {
  const b = BUCKETS.find(([lo, hi]) => c >= lo && c <= hi);
  return b ? `${b[0]}-${b[1]}` : "?";
};

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.m15 || !args.h1 || !args.h4) {
    console.log("Usage: --m15 <file> --h1 <file> --h4 <file> [--step-h1 4] [--expiry-h1 24] [--cost 0.3] [--split YYYY-MM-DD] [--out dir]");
    return 2;
  }
  const step = Number(args["step-h1"] ?? 4);
  const expiryBars = Number(args["expiry-h1"] ?? 24) * 4;
  const cost = Number(args.cost ?? 0.3);
  const split = args.split ? Date.parse(`${args.split}T00:00Z`) : null;
  const outDir = path.resolve(root, args.out ?? ".runtime/market-intel/mtf-eval");
  fs.mkdirSync(outDir, { recursive: true });
  const m15 = loadMt5Bars(path.resolve(args.m15), M15_MS);
  const h1 = loadMt5Bars(path.resolve(args.h1), H1_MS);
  const h4 = loadMt5Bars(path.resolve(args.h4), H4_MS);
  const a15 = analyzeTimeframe(m15), a1 = analyzeTimeframe(h1), a4 = analyzeTimeframe(h4);
  const rows = [];
  for (let i1 = 0; i1 < h1.length; i1 += step) {
    const t = h1[i1].closeTime;
    const i15 = lastClosedIndex(m15, t), i4 = lastClosedIndex(h4, t);
    if (i15 < 300 || i4 < 220 || i1 < 220) continue;
    if (i15 + expiryBars >= m15.length) break;
    const res = scenariosFromAnalyses({ a4, a1, a15, i4, i1, i15 });
    for (const s of res.scenarios) {
      const sim = simulateScenario(s, m15, i15, { expiryBars, cost });
      rows.push({
        time: t, role: s.role, direction: s.direction, confidence: s.confidence, h4: res.h4.state, h1: res.h1.state,
        m15Status: s.m15.status, rr1: s.rr1, stopDistance: s.botStopRule.stopDistance, withinBotRule: s.botStopRule.withinRule,
        period: split === null ? "all" : t < split ? "A_truoc_split" : "B_sau_split", ...sim,
      });
    }
  }
  const primary = rows.filter((r) => r.role === "PRIMARY");
  const summary = {
    version: MTF_VERSION,
    confidencePoints: CONFIDENCE_POINTS,
    settings: { step, expiryH1: expiryBars / 4, cost, split: args.split ?? null },
    data: { m15: m15.length, h1: h1.length, h4: h4.length, from: new Date(m15[0].openTime).toISOString(), to: new Date(m15.at(-1).closeTime).toISOString() },
    primary: summarize(primary),
    alternate: summarize(rows.filter((r) => r.role === "ALTERNATE")),
    primaryByBucket: group(primary, (r) => bucketOf(r.confidence)),
    primaryByPeriod: group(primary, (r) => r.period),
    primaryByPeriodBucket: group(primary, (r) => `${r.period}|${bucketOf(r.confidence)}`),
    primaryByDirection: group(primary, (r) => r.direction),
    primaryByM15: group(primary, (r) => r.m15Status),
    primaryByH4: group(primary, (r) => r.h4),
    primaryByBotRule: group(primary, (r) => (r.withinBotRule ? "SL_6_10" : r.stopDistance > 10 ? "SL_GT_10" : "SL_LT_6")),
    alternateByBucket: group(rows.filter((r) => r.role === "ALTERNATE"), (r) => bucketOf(r.confidence)),
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, "scenarios.csv"), ["time,role,direction,confidence,h4,h1,m15Status,rr1,stopDistance,outcome,r", ...rows.map((r) => [new Date(r.time).toISOString(), r.role, r.direction, r.confidence, r.h4, r.h1, r.m15Status, r.rr1, r.stopDistance, r.outcome, r2(r.r)].join(","))].join("\n"));
  console.log(JSON.stringify({ primary: summary.primary, byBucket: summary.primaryByBucket, out: outDir }, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
