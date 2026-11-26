#!/usr/bin/env node
// Feature 3 — regime template library report (offline, read-only).
//
// Classifies every closed H1 bar of a historical MT5 export with the template library, compares it
// with the production regime classifier (shadow agreement), describes what happened after each state,
// attributes backtest trades to the library state at entry, and renders annotated sample charts.
//
// SAFETY: offline only. Reads CSV exports, writes to --out (default .runtime/market-intel/, git-ignored)
// and, when asked, sample SVG charts to --charts-dir. No broker, no network, no orders, no runtime state.
//
// Usage:
//   node scripts/market-intel/regime-library-report.mjs --m15 XAUUSD_M15.csv
//        [--h1 XAUUSD_H1.csv] [--h4 XAUUSD_H4.csv]          (default: built from M15)
//        [--production-cache .runtime/backtest/phase7c-replay-cache.json | --skip-production]
//        [--trades .runtime/backtest/<run>/trades.csv]
//        [--charts-dir docs/market-intel/charts] [--out .runtime/market-intel/regime-library]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  H1_MS, H4_MS, M15_MS, REGIME_LIBRARY_VERSION, REGIME_TEMPLATES, THRESHOLDS, agreementMatrix, analyzeTimeframe,
  classifyTimeframe, combine, lastClosedIndex, renderRegimeChartSvg, resample,
} from "../../packages/market-intel/src/index.mjs";
import { loadMt5Bars, precomputeReplay } from "../backtest/phase7c-replay-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATES = ["UPTREND", "DOWNTREND", "SIDEWAY", "TRANSITION"];
const LABEL = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };
const FORWARD_H1 = 24;

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Tham số không hợp lệ: ${a}`);
    if (a === "--skip-production" || a === "--help") { args[a.slice(2)] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`Thiếu giá trị cho ${a}`);
    args[a.slice(2)] = v;
    i += 1;
  }
  return args;
}

/** Keep only buckets that carry at least half their source bars (drops holiday stubs). */
export function buildTimeframe(m15, periodMs) {
  return resample(m15, periodMs).filter((b) => b.sourceBars >= (periodMs / M15_MS) / 2);
}

/** Library state per bar of a timeframe (index-aligned). */
export function classifySeries(analysis) {
  return analysis.bars.map((_, i) => classifyTimeframe(analysis, i));
}

/** Combined state as of `asOf` (H4 context + H1 state), using only bars closed by then. */
export function combinedAt(h1, h4, h1States, h4States, asOf) {
  const i1 = lastClosedIndex(h1, asOf);
  const i4 = lastClosedIndex(h4, asOf);
  if (i1 < 0 || i4 < 0) return null;
  return { ...combine(h4States[i4], h1States[i1]), h1Index: i1, h4Index: i4 };
}

const pct = (x) => (x === null || Number.isNaN(x) ? null : Math.round(x * 1000) / 10);
const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

export function forwardStats(h1, analysis, combined) {
  const out = Object.fromEntries(STATES.map((s) => [s, { n: 0, sumAtr: 0, up: 0 }]));
  for (let i = 0; i + FORWARD_H1 < h1.length; i += 1) {
    const c = combined[i];
    const a = analysis.atr[i];
    if (!c || !a) continue;
    const move = (h1[i + FORWARD_H1].close - h1[i].close) / a;
    const s = out[c.state];
    s.n += 1; s.sumAtr += move; if (move > 0) s.up += 1;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, meanMoveAtr: v.n ? r2(v.sumAtr / v.n) : null, upShare: v.n ? pct(v.up / v.n) : null }]));
}

export function runLengths(combined) {
  const runs = Object.fromEntries(STATES.map((s) => [s, []]));
  let cur = null, len = 0;
  for (const c of combined) {
    const s = c?.state ?? null;
    if (s === cur) { len += 1; continue; }
    if (cur) runs[cur].push(len);
    cur = s; len = 1;
  }
  if (cur) runs[cur].push(len);
  return Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { runs: v.length, medianH1Bars: v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null }]));
}

export function parseTradesCsv(text) {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((line) => {
    const v = line.split(",");
    const o = Object.fromEntries(cols.map((c, k) => [c, v[k]]));
    return { ...o, entryMs: Date.parse(`${o.entryTime.replace(" ", "T")}Z`), pnlUsd: Number(o.pnlUsd), r: Number(o.r) };
  });
}

export function tradeStats(trades) {
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const gp = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const gl = -trades.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0);
  const net = trades.reduce((s, t) => s + t.pnlUsd, 0);
  return {
    n: trades.length,
    winRate: trades.length ? pct(wins.length / trades.length) : null,
    pf: gl > 0 ? r2(gp / gl) : gp > 0 ? "∞" : null,
    netUsd: r2(net),
    avgR: trades.length ? r2(trades.reduce((s, t) => s + t.r, 0) / trades.length) : null,
  };
}

function pickSamples(h1States, combined, state, count = 2, minGap = 240) {
  const candidates = [];
  combined.forEach((c, i) => {
    if (!c || c.state !== state) return;
    if (state !== "SIDEWAY" && c.alignment !== "ALIGNED") return;
    candidates.push({ i, score: h1States[i].scores[state] ?? 0, conf: h1States[i].confidence });
  });
  candidates.sort((a, b) => b.score - a.score || b.conf - a.conf || b.i - a.i);
  const picked = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p.i - c.i) >= minGap)) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked.sort((a, b) => a.i - b.i);
}

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function renderSample(state, k, sample, ctx) {
  const { h1, h4, a1, a4, h1States, combined } = ctx;
  const i = sample.i;
  const c = combined[i];
  const r = h1States[i];
  const passed = r.criteria[state].filter((x) => x.passed).map((x) => x.id);
  const zones = state === "SIDEWAY" ? [{ low: r.features.rangeLow, high: r.features.rangeHigh, label: `Biên ${THRESHOLDS.rangeLookback} nến H1`, fromIndex: i - THRESHOLDS.rangeLookback + 1, toIndex: i }] : [];
  const h1Svg = renderRegimeChartSvg({
    analysis: a1, from: i - 119, to: i, zones,
    title: `${LABEL[state]} · H1 · mẫu ${k} · đến ${fmt(h1[i].closeTime)} (giờ server)`,
    subtitle: `Điểm khớp ${Math.round(r.scores[state] * 100)}% (đạt ${passed.length}/${r.criteria[state].length} tiêu chí) · H4: ${LABEL[c.h4.state] ?? c.h4.state} · ADX ${r.features.adx.toFixed(1)} · biên ${r.features.rangeWidthAtr.toFixed(1)} ATR`,
  });
  const i4 = c.h4Index;
  const h4Svg = renderRegimeChartSvg({
    analysis: a4, from: i4 - 89, to: i4, zones: [],
    title: `${LABEL[state]} · H4 bối cảnh · mẫu ${k} · đến ${fmt(h4[i4].closeTime)} (giờ server)`,
    subtitle: `Trạng thái H4: ${LABEL[c.h4.state] ?? c.h4.state} (${c.h4.confidence}%) · ${c.alignment}`,
  });
  return { h1Svg, h4Svg, at: fmt(h1[i].closeTime), score: r.scores[state], passed };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.m15) {
    console.log("Usage: --m15 <file> [--h1 <file>] [--h4 <file>] [--production-cache <file> | --skip-production] [--trades <file>] [--charts-dir <dir>] [--out <dir>]");
    return args.help ? 0 : 2;
  }
  const outDir = path.resolve(root, args.out ?? ".runtime/market-intel/regime-library");
  fs.mkdirSync(outDir, { recursive: true });
  const m15 = loadMt5Bars(path.resolve(args.m15), M15_MS);
  const h1 = args.h1 ? loadMt5Bars(path.resolve(args.h1), H1_MS) : buildTimeframe(m15, H1_MS);
  const h4 = args.h4 ? loadMt5Bars(path.resolve(args.h4), H4_MS) : buildTimeframe(m15, H4_MS);
  const a1 = analyzeTimeframe(h1);
  const a4 = analyzeTimeframe(h4);
  const h1States = classifySeries(a1);
  const h4States = classifySeries(a4);
  const combined = h1.map((b) => combinedAt(h1, h4, h1States, h4States, b.closeTime));

  const distribution = Object.fromEntries(STATES.map((s) => [s, 0]));
  const alignment = {};
  let classified = 0;
  for (const c of combined) {
    if (!c || c.reasons.includes("INSUFFICIENT_DATA")) continue;
    classified += 1;
    distribution[c.state] += 1;
    alignment[c.alignment] = (alignment[c.alignment] ?? 0) + 1;
  }

  // Shadow agreement with the production M15 regime classifier.
  let agreement = null;
  if (!args["skip-production"]) {
    let regimes;
    if (args["production-cache"]) {
      const cache = JSON.parse(fs.readFileSync(path.resolve(args["production-cache"]), "utf8"));
      if (cache.m15Count !== m15.length || cache.firstM15 !== m15[0].openTime) throw new Error("production cache does not match --m15");
      regimes = cache.regimes;
    } else {
      regimes = (await precomputeReplay({ m15, m5: [] })).regimes;
    }
    const rows = [];
    for (let i = 0; i < m15.length; i += 1) {
      if (!regimes[i]) continue;
      const c = combinedAt(h1, h4, h1States, h4States, m15[i].closeTime);
      if (!c || c.reasons.includes("INSUFFICIENT_DATA")) continue;
      rows.push({ library: c.state, production: regimes[i].regime });
    }
    agreement = agreementMatrix(rows);
  }

  // Backtest trades attributed to the library state known at entry.
  let trades = null;
  if (args.trades) {
    const list = parseTradesCsv(fs.readFileSync(path.resolve(args.trades), "utf8"));
    const groups = {};
    for (const t of list) {
      const c = combinedAt(h1, h4, h1States, h4States, t.entryMs);
      const state = c?.state ?? "NONE";
      for (const key of [`${state}`, `${state}|${t.strategy}`, `${state}|${t.strategy}|${t.side}`, `${state}|side-vs-state|${sideFits(state, t.side)}`]) {
        (groups[key] ??= []).push(t);
      }
    }
    trades = { total: tradeStats(list), groups: Object.fromEntries(Object.entries(groups).sort().map(([k, v]) => [k, tradeStats(v)])) };
  }

  const samples = {};
  if (args["charts-dir"]) {
    const dir = path.resolve(root, args["charts-dir"]);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = { h1, h4, a1, a4, h1States, combined };
    for (const state of ["UPTREND", "DOWNTREND", "SIDEWAY"]) {
      samples[state] = pickSamples(h1States, combined, state).map((s, k) => {
        const r = renderSample(state, k + 1, s, ctx);
        const base = `${state.toLowerCase()}-${k + 1}`;
        fs.writeFileSync(path.join(dir, `${base}-h1.svg`), r.h1Svg);
        fs.writeFileSync(path.join(dir, `${base}-h4.svg`), r.h4Svg);
        return { files: [`${base}-h1.svg`, `${base}-h4.svg`], at: r.at, score: r.score, passed: r.passed };
      });
    }
  }

  const summary = {
    libraryVersion: REGIME_LIBRARY_VERSION,
    thresholds: THRESHOLDS,
    templates: REGIME_TEMPLATES.map((t) => ({ id: t.id, criteria: t.criteria.map((c) => ({ id: c.id, weight: c.weight, description: c.description })) })),
    data: { m15: m15.length, h1: h1.length, h4: h4.length, from: fmt(m15[0].openTime), to: fmt(m15.at(-1).closeTime), h1Source: args.h1 ? "file" : "M15", h4Source: args.h4 ? "file" : "M15" },
    classifiedH1: classified,
    distribution: Object.fromEntries(Object.entries(distribution).map(([k, v]) => [k, { n: v, share: pct(v / classified) }])),
    alignment,
    runLengths: runLengths(combined),
    forward24h: forwardStats(h1, a1, combined),
    agreement,
    trades,
    samples,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ distribution: summary.distribution, agreementRate: agreement?.agreementRate ?? null, out: outDir }, null, 2));
  return 0;
}

function sideFits(state, side) {
  if (state === "UPTREND") return side === "BUY" ? "with" : "against";
  if (state === "DOWNTREND") return side === "SELL" ? "with" : "against";
  return "n/a";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
}
