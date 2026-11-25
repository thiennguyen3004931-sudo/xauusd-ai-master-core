#!/usr/bin/env node
// Phase 7C — alternative ENTRY signals under anchored 6-fold walk-forward (offline research, no orders).
//
// Earlier research (management sweep, strategy variants) showed that no change to SL / BE / TP /
// trailing / filters fixes the result: the weak part is the entry signal (M15 pattern + SuperTrend).
// This script keeps the Phase 7C order management exactly as it is (SL 6–10 + pullback wait, BE +6 → entry,
// 1/3 at +10, FastMove 10/10, M5 handoff, MA50 / FVG runner exits) and swaps only the TREND-path entry
// signal. Every candidate below was fixed BEFORE looking at its results; the honest number is the
// walk-forward line (pick on train, score on the next unseen block), not any single candidate's row.
//
// All signals are causal: the signal at M15 index k only reads M15 bars 0..k and H1 bars that have
// fully closed by m15[k].closeTime (pinned by phase7c-entry-signals.test.mjs).
//
// usage: node scripts/backtest/phase7c-entry-signals.mjs --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f]
import fs from "node:fs";
import path from "node:path";
import { metrics, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, detectEntryPattern, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";
import { walkForwardVariants } from "./phase7c-strategy-variants.mjs";

const H1_MS = 60 * 60_000;

// ---------------------------------------------------------------- indicators (causal)
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const a = 2 / (period + 1);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) { seed += values[i]; continue; }
    if (i === period - 1) { seed += values[i]; prev = seed / period; } else prev = a * values[i] + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

export function rsi(values, period) {
  const out = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g; loss += l;
      if (i === period) { gain /= period; loss /= period; }
      else continue;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// SuperTrend(period, mult) direction, same recurrence as phase7BSupertrend (risk-engine).
export function supertrendDirection(bars, period = 10, mult = 3) {
  const n = bars.length;
  const dir = new Array(n).fill(null);
  let atr = null;
  let trSum = 0;
  let upper = null;
  let lower = null;
  let prevDir = null;
  for (let i = 0; i < n; i += 1) {
    const b = bars[i];
    const pc = i > 0 ? bars[i - 1].close : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (i < period - 1) { trSum += tr; continue; }
    if (i === period - 1) { trSum += tr; atr = trSum / period; } else atr = (atr * (period - 1) + tr) / period;
    const mid = (b.high + b.low) / 2;
    const bu = mid + mult * atr;
    const bl = mid - mult * atr;
    if (upper === null) { upper = bu; lower = bl; prevDir = b.close >= mid ? "BUY" : "SELL"; dir[i] = prevDir; continue; }
    const nu = bu < upper || pc > upper ? bu : upper;
    const nl = bl > lower || pc < lower ? bl : lower;
    let d = prevDir;
    if (prevDir === "SELL" && b.close > nu) d = "BUY";
    else if (prevDir === "BUY" && b.close < nl) d = "SELL";
    upper = nu; lower = nl; prevDir = d;
    dir[i] = d;
  }
  return dir;
}

// H1 bars aggregated from M15 (bucket = floor(openTime / 1h)). closeTime = last M15 close in the bucket.
export function aggregateH1(m15) {
  const out = [];
  for (const bar of m15) {
    const bucket = Math.floor(bar.openTime / H1_MS) * H1_MS;
    const last = out.at(-1);
    if (last && last.openTime === bucket) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.closeTime = bar.closeTime;
      last.complete = bar.closeTime >= bucket + H1_MS;
    } else {
      out.push({ openTime: bucket, closeTime: bar.closeTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close, complete: bar.closeTime >= bucket + H1_MS });
    }
  }
  return out;
}

// For each M15 index, the index of the latest H1 bar whose hour has fully closed by m15[k].closeTime.
export function lastClosedH1Index(m15, h1) {
  const out = new Int32Array(m15.length).fill(-1);
  let h = -1;
  for (let k = 0; k < m15.length; k += 1) {
    while (h + 1 < h1.length && h1[h + 1].openTime + H1_MS <= m15[k].closeTime) h += 1;
    out[k] = h;
  }
  return out;
}

export function buildContext(m15, pre = null) {
  const closes = m15.map((b) => b.close);
  const h1 = aggregateH1(m15);
  const h1Closes = h1.map((b) => b.close);
  return {
    m15,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi2: rsi(closes, 2),
    m15St: pre?.m15St ?? supertrendDirection(m15, 10, 3),
    h1,
    h1Idx: lastClosedH1Index(m15, h1),
    h1St: supertrendDirection(h1, 10, 3),
    h1Ema50: ema(h1Closes, 50),
  };
}

// ---------------------------------------------------------------- signal builders
const swingStop = (bars, k, side, n = 3) => {
  let v = side === "BUY" ? Infinity : -Infinity;
  for (let i = Math.max(0, k - n + 1); i <= k; i += 1) v = side === "BUY" ? Math.min(v, bars[i].low) : Math.max(v, bars[i].high);
  return v;
};
const sig = (side, pattern, patternExtreme) => ({ side, pattern, patternExtreme });

function h1StSide(ctx, k) {
  const h = ctx.h1Idx[k];
  return h >= 0 ? ctx.h1St[h] : null;
}
function h1EmaSide(ctx, k) {
  const h = ctx.h1Idx[k];
  if (h < 0 || ctx.h1Ema50[h] === null) return null;
  return ctx.h1[h].close > ctx.h1Ema50[h] ? "BUY" : ctx.h1[h].close < ctx.h1Ema50[h] ? "SELL" : null;
}

export function currentPattern(ctx, k) {
  if (k < 200) return null;
  return detectEntryPattern(ctx.m15, k);
}

export function donchianBreakout(ctx, k, lookback = 20) {
  if (k < Math.max(lookback, 200)) return null;
  const bars = ctx.m15;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = k - lookback; i < k; i += 1) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); }
  const prevClose = bars[k - 1].close;
  if (bars[k].close > hi && prevClose <= hi) return sig("BUY", "DONCHIAN_BREAKOUT", swingStop(bars, k, "BUY"));
  if (bars[k].close < lo && prevClose >= lo) return sig("SELL", "DONCHIAN_BREAKOUT", swingStop(bars, k, "SELL"));
  return null;
}

export function emaPullback(ctx, k) {
  if (k < 200) return null;
  const b = ctx.m15[k];
  const e20 = ctx.ema20[k];
  const e50 = ctx.ema50[k];
  if (e20 === null || e50 === null) return null;
  if (e20 > e50 && b.close > e50 && b.low <= e20 && b.close > e20 && b.close > b.open) return sig("BUY", "EMA20_PULLBACK", swingStop(ctx.m15, k, "BUY"));
  if (e20 < e50 && b.close < e50 && b.high >= e20 && b.close < e20 && b.close < b.open) return sig("SELL", "EMA20_PULLBACK", swingStop(ctx.m15, k, "SELL"));
  return null;
}

export function rsi2MeanReversion(ctx, k) {
  if (k < 200) return null;
  const trend = h1EmaSide(ctx, k);
  const r = ctx.rsi2[k - 1];
  const b = ctx.m15[k];
  if (r === null || !trend) return null;
  if (trend === "BUY" && r < 10 && b.close > b.open) return sig("BUY", "RSI2_MR", swingStop(ctx.m15, k, "BUY"));
  if (trend === "SELL" && r > 90 && b.close < b.open) return sig("SELL", "RSI2_MR", swingStop(ctx.m15, k, "SELL"));
  return null;
}

const withFilter = (base, keep) => (ctx, k) => {
  const s = base(ctx, k);
  return s && keep(ctx, k, s) ? s : null;
};
const fade = (base) => (ctx, k) => {
  const s = base(ctx, k);
  if (!s) return null;
  const side = s.side === "BUY" ? "SELL" : "BUY";
  return sig(side, `FADE_${s.pattern}`, swingStop(ctx.m15, k, side));
};
const brokerHour = (ctx, k) => new Date(ctx.m15[k].openTime).getUTCHours();

// Deterministic pseudo-random control: same SL/management, random side at ~the current pattern's frequency.
export function randomControl(seed = 7, rate = 0.06) {
  return (ctx, k) => {
    if (k < 200) return null;
    let x = (Math.imul(k + 1, 2654435761) ^ seed) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
    const u = x / 4294967296;
    if (u >= rate) return null;
    const side = u < rate / 2 ? "BUY" : "SELL";
    return sig(side, "RANDOM", swingStop(ctx.m15, k, side));
  };
}

// Production gates for the TREND path: regime TREND + SuperTrend M15 + M5 aligned (config {} keeps them).
const PROD_GATES = {};
const TREND_ONLY = { strategies: ["TREND"] };
const NO_REGIME = { strategies: ["TREND"], requireTrendMode: false };

// Fixed list, decided before running. eligible=false rows are references / controls only.
export const CANDIDATES = Object.freeze([
  { id: "E0_CURRENT_FULL", label: "Hiện tại: pattern M15 + SuperTrend, TREND + SIDEWAY", signal: currentPattern, config: PROD_GATES, eligible: true },
  { id: "E1_CURRENT_TREND", label: "Hiện tại, chỉ TREND", signal: currentPattern, config: TREND_ONLY, eligible: true },
  { id: "E2_PAT_H1_ST", label: "Pattern hiện tại + SuperTrend H1 cùng hướng", signal: withFilter(currentPattern, (c, k, s) => h1StSide(c, k) === s.side), config: TREND_ONLY, eligible: true },
  { id: "E3_PAT_H1_EMA50", label: "Pattern hiện tại + giá H1 cùng phía EMA50 H1", signal: withFilter(currentPattern, (c, k, s) => h1EmaSide(c, k) === s.side), config: TREND_ONLY, eligible: true },
  { id: "E4_PAT_SESSION", label: "Pattern hiện tại, chỉ 10:00–19:59 giờ broker", signal: withFilter(currentPattern, (c, k) => { const h = brokerHour(c, k); return h >= 10 && h < 20; }), config: TREND_ONLY, eligible: true },
  { id: "E5_PAT_FADE", label: "Đảo chiều pattern hiện tại (mọi regime trừ PAUSE, không SuperTrend)", signal: fade(currentPattern), config: { ...NO_REGIME, requireSupertrendM15: false, requireSupertrendM5: false }, eligible: true },
  { id: "E6_DONCH20_REGIME", label: "Phá đỉnh/đáy 20 nến M15 + ST M15, có cổng regime", signal: donchianBreakout, config: { ...TREND_ONLY, requireSupertrendM5: false }, eligible: true },
  { id: "E7_DONCH20_ANY", label: "Phá đỉnh/đáy 20 nến M15 + ST M15, mọi regime trừ PAUSE", signal: donchianBreakout, config: { ...NO_REGIME, requireSupertrendM5: false }, eligible: true },
  { id: "E8_DONCH20_H1ST", label: "Phá 20 nến M15 + ST M15 + ST H1, mọi regime trừ PAUSE", signal: withFilter(donchianBreakout, (c, k, s) => h1StSide(c, k) === s.side), config: { ...NO_REGIME, requireSupertrendM5: false }, eligible: true },
  { id: "E9_EMA_PULLBACK", label: "Hồi về EMA20 trong xu hướng EMA20>EMA50, mọi regime trừ PAUSE", signal: emaPullback, config: { ...NO_REGIME, requireSupertrendM15: false, requireSupertrendM5: false }, eligible: true },
  { id: "E10_EMA_PULLBACK_H1ST", label: "Hồi EMA20 + ST H1 cùng hướng, mọi regime trừ PAUSE", signal: withFilter(emaPullback, (c, k, s) => h1StSide(c, k) === s.side), config: { ...NO_REGIME, requireSupertrendM15: false, requireSupertrendM5: false }, eligible: true },
  { id: "E11_RSI2_MR_H1", label: "RSI(2) quá bán/quá mua theo xu hướng EMA50 H1, mọi regime trừ PAUSE", signal: rsi2MeanReversion, config: { ...NO_REGIME, requireSupertrendM15: false, requireSupertrendM5: false }, eligible: true },
  { id: "X_RANDOM", label: "Đối chứng: hướng ngẫu nhiên, cùng SL và quản lý lệnh", signal: randomControl(), config: { ...NO_REGIME, requireSupertrendM15: false, requireSupertrendM5: false }, eligible: false },
]);

// Round 2 — added AFTER seeing round 1 (E8 was the only family with early positive folds), so it is
// exploratory: Donchian lookback 10/30/55 x H1 SuperTrend on/off. Walk-forward still picks per fold on
// train only, but the family itself was chosen with knowledge of the whole sample.
const donchianLb = (lb) => (ctx, k) => donchianBreakout(ctx, k, lb);
const DONCH_CFG = { ...NO_REGIME, requireSupertrendM5: false };
export const CANDIDATES_ROUND2 = Object.freeze([10, 20, 30, 55].flatMap((lb) => [
  { id: `R2_DONCH${lb}`, label: `Phá ${lb} nến M15 + ST M15, mọi regime trừ PAUSE`, signal: donchianLb(lb), config: DONCH_CFG, eligible: true },
  { id: `R2_DONCH${lb}_H1ST`, label: `Phá ${lb} nến M15 + ST M15 + ST H1, mọi regime trừ PAUSE`, signal: withFilter(donchianLb(lb), (c, k, s) => h1StSide(c, k) === s.side), config: DONCH_CFG, eligible: true },
]));

export function buildSignals(ctx, signalFn) {
  return ctx.m15.map((_, k) => signalFn(ctx, k));
}

export function breakdown(trades) {
  const by = (key) => Object.fromEntries([...new Set(trades.map((t) => t[key] ?? "NONE"))].sort().map((v) => [v, metrics(trades.filter((t) => (t[key] ?? "NONE") === v))]));
  return { side: by("side"), regime: by("regime") };
}

// Static SVG (report is Markdown, so no hover): cumulative USD of walk-forward test trades, 0.03 lot.
export function equitySvg(series, { from, to, folds = [] }) {
  const W = 900, H = 420, L = 64, R = 230, T = 36, B = 44;
  const colors = ["#257de0", "#f47230", "#00b894", "#f2a600"];
  const curves = series.map((s) => {
    let eq = 0;
    const pts = [[from, 0]];
    for (const t of [...s.trades].sort((a, b) => a.exitTime - b.exitTime)) { eq += t.pnlUsd; pts.push([t.exitTime, eq]); }
    return { ...s, pts, last: eq };
  });
  const ys = curves.flatMap((c) => c.pts.map((p) => p[1]));
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const step = 500;
  const lo = Math.floor(yMin / step) * step, hi = Math.ceil(yMax / step) * step;
  const x = (t) => L + ((t - from) / (to - from)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${L}" y="20" font-size="14" font-weight="600" fill="#1f1f1f">Lãi/lỗ cộng dồn trên các block test walk-forward (USD, 0,03 lot)</text>`];
  for (let v = lo; v <= hi; v += step) out.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? "#9c9c9c" : "#e6e6e6"}" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="#6b6b6b">${v}</text>`);
  folds.forEach((f, i) => out.push(`<line x1="${x(f)}" x2="${x(f)}" y1="${T}" y2="${H - B}" stroke="#e6e6e6" stroke-dasharray="3 3"/><text x="${x(f) + 4}" y="${H - B + 16}" fill="#6b6b6b">F${i + 1} ${new Date(f).toISOString().slice(5, 10)}</text>`));
  const labels = [];
  curves.forEach((c, i) => {
    out.push(`<polyline fill="none" stroke="${colors[i]}" stroke-width="2" stroke-linejoin="round" points="${c.pts.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`);
    labels.push({ y: y(c.last), text: `${c.name}: ${c.last >= 0 ? "+" : ""}${c.last.toFixed(0)}`, color: colors[i] });
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i += 1) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
  for (const l of labels) out.push(`<circle cx="${W - R + 10}" cy="${l.y - 4}" r="4" fill="${l.color}"/><text x="${W - R + 18}" y="${l.y}" fill="#1f1f1f">${l.text}</text>`);
  out.push("</svg>");
  return out.join("\n");
}

const inWindowOf = (trades, [from, to]) => trades.filter((t) => t.entryTime >= from && t.entryTime < to);

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.m5 || !args.m15) { console.error("usage: --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f]"); process.exit(2); }
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) { pre = await precomputeReplay({ m15, m5 }); saveCache(cacheFile, pre); }
  const ctx = buildContext(m15, pre);

  const tradesById = new Map();
  for (const c of CANDIDATES) {
    const trendSignals = c.id === "E0_CURRENT_FULL" || c.id === "E1_CURRENT_TREND" ? pre.trendSignals : buildSignals(ctx, c.signal);
    tradesById.set(c.id, simulate({ m15, m5, pre: { ...pre, trendSignals }, config: c.config }));
  }
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const eligible = new Map([...tradesById].filter(([id]) => CANDIDATES.find((c) => c.id === id).eligible));
  const wf = walkForwardVariants(eligible, start, end);
  const wfAll = walkForwardVariants(tradesById, start, end); // per-candidate fold table incl. control

  // Simple split: first 50% in-sample / last 50% out-of-sample, pick best IS PF among eligible.
  const mid = start + Math.round((end - start) / 2);
  const isRows = [...eligible].map(([id, t]) => ({ id, is: metrics(t.filter((x) => x.entryTime < mid)), oos: metrics(t.filter((x) => x.entryTime >= mid)) }));
  const fin = (pf) => (Number.isFinite(pf) ? pf : 5);
  const splitPick = isRows.filter((r) => r.is.trades >= 20).sort((a, b) => fin(b.is.profitFactor) - fin(a.is.profitFactor))[0];

  const r2 = new Map(CANDIDATES_ROUND2.map((c) => [c.id, simulate({ m15, m5, pre: { ...pre, trendSignals: buildSignals(ctx, c.signal) }, config: c.config })]));
  const wf2 = walkForwardVariants(r2, start, end);
  const r2Rows = CANDIDATES_ROUND2.map((c) => ({ id: c.id, label: c.label, full: metrics(r2.get(c.id)), breakdown: breakdown(r2.get(c.id)), folds: wf2.rows.map((r) => r.perVariant[c.id]) }));

  const report = {
    generatedAt: new Date().toISOString(),
    data: { m5Bars: m5.length, m15Bars: m15.length, from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    candidates: CANDIDATES.map((c) => ({ id: c.id, label: c.label, eligible: c.eligible, config: c.config, full: metrics(tradesById.get(c.id)), breakdown: breakdown(tradesById.get(c.id)) })),
    walkForward: wf,
    perCandidateFolds: wfAll.rows.map((r) => ({ fold: r.fold, test: r.test, perVariant: r.perVariant })),
    split: { mid: new Date(mid).toISOString(), rows: isRows, pick: splitPick ?? null },
    walkForwardPooledBreakdown: breakdown(wf.rows.flatMap((r) => inWindowOf(tradesById.get(r.picked) ?? [], r.test))),
    round2: { rows: r2Rows, walkForward: wf2 },
  };
  const out = args.out ?? ".runtime/backtest/phase7c-entry-signals.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  if (args.svg) {
    const firstTest = wf.rows[0].test[0];
    const pickTrades = (w) => w.rows.flatMap((r) => (r.picked ? inWindowOf((tradesById.get(r.picked) ?? r2.get(r.picked)), r.test) : []));
    fs.writeFileSync(args.svg, equitySvg([
      { name: "Hiện tại (E0)", trades: tradesById.get("E0_CURRENT_FULL").filter((t) => t.entryTime >= firstTest) },
      { name: "Đối chứng ngẫu nhiên", trades: tradesById.get("X_RANDOM").filter((t) => t.entryTime >= firstTest) },
      { name: "WF vòng 1", trades: pickTrades(wf) },
      { name: "WF vòng 2 (khám phá)", trades: pickTrades(wf2) },
    ], { from: firstTest, to: end, folds: wf.rows.map((r) => r.test[0]) }));
  }

  const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
  console.log("| Tín hiệu | 12 tháng: lệnh / PF / USD / avg R / Max DD USD (R) | " + [1, 2, 3, 4, 5, 6].map((f) => `F${f} USD`).join(" | ") + " | Fold dương |");
  console.log("|---|---|" + "---|".repeat(7));
  for (const c of report.candidates) {
    const folds = wfAll.rows.map((r) => r.perVariant[c.id]);
    const f = c.full;
    console.log(`| ${c.id}${c.eligible ? "" : " (đối chứng)"} — ${c.label} | ${f.trades} / ${pf(f.profitFactor)} / ${f.netUsd.toFixed(0)} / ${f.avgR.toFixed(3)} / ${f.maxDrawdownUsd.toFixed(0)} (${f.maxDrawdownR.toFixed(1)}) | ${folds.map((m) => `${m.netUsd.toFixed(0)} (${pf(m.profitFactor)})`).join(" | ")} | ${folds.filter((m) => m.netUsd > 0).length}/6 |`);
  }
  console.log("\nWalk-forward (chọn trên train, chấm block kế tiếp):");
  for (const r of wf.rows) console.log(`- Fold ${r.fold} (${new Date(r.test[0]).toISOString().slice(0, 10)} → ${new Date(r.test[1]).toISOString().slice(0, 10)}): chọn ${r.picked} (train PF ${pf(r.trainPf)}) → ${r.test_.trades} lệnh, PF ${pf(r.test_.profitFactor)}, ${r.test_.netUsd.toFixed(0)} USD`);
  console.log(`\nGộp: ${JSON.stringify(wf.pooled)} | fold dương ${wf.positiveFolds}/6 | ngưỡng: ${JSON.stringify(wf.acceptance)}`);
  console.log("\nVòng 2 (khám phá, sau khi đã thấy vòng 1):");
  for (const r of r2Rows) console.log(`| ${r.id} | ${r.full.trades} / ${pf(r.full.profitFactor)} / ${r.full.netUsd.toFixed(0)} / ${r.full.avgR.toFixed(3)} / ${r.full.maxDrawdownUsd.toFixed(0)} (${r.full.maxDrawdownR.toFixed(1)}) | ${r.folds.map((m) => `${m.netUsd.toFixed(0)} (${pf(m.profitFactor)})`).join(" | ")} | ${r.folds.filter((m) => m.netUsd > 0).length}/6 |`);
  for (const r of wf2.rows) console.log(`- Fold ${r.fold}: chọn ${r.picked} (train PF ${pf(r.trainPf)}) → ${r.test_.trades} lệnh, PF ${pf(r.test_.profitFactor)}, ${r.test_.netUsd.toFixed(0)} USD`);
  console.log(`Gộp vòng 2: ${JSON.stringify(wf2.pooled)} | fold dương ${wf2.positiveFolds}/6 | ngưỡng: ${JSON.stringify(wf2.acceptance)}`);
  console.log(`\nGộp vòng 1 theo BUY/SELL và regime: ${JSON.stringify(report.walkForwardPooledBreakdown)}`);
  if (splitPick) console.log(`\nChia 50/50 (mốc ${report.split.mid.slice(0, 10)}): chọn ${splitPick.id} theo IS PF ${pf(splitPick.is.profitFactor)} → OOS ${JSON.stringify(splitPick.oos)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
