#!/usr/bin/env node
// Phase 7C — entry-signal research, ROUND 3 (offline research, no orders, no runtime change).
//
// Rounds 1–2 (phase7c-entry-signals.mjs) found no signal that passes the acceptance thresholds; the only
// lead was "Donchian M15 breakout aligned with SuperTrend H1". Round 3 tries NEW feature ideas that were
// not in rounds 1–2: volatility squeeze, tick-volume confirmation, H4 trend, session opening-range
// breakouts (London / NY / Asia range), H1 inside-bar breakout, daily momentum, ATR expansion,
// breakout-retest, and range mean-reversion.
//
// PRE-REGISTRATION: the candidate list below was committed BEFORE the script was run on MT5 data
// (see the git history of this file). Nothing in this list may be tuned after seeing results; any
// later idea goes into a separate, explicitly exploratory list.
//
// Honesty checks on top of the 6-fold anchored walk-forward:
//   1. Selection null: the same walk-forward picker is run on sets of RANDOM-direction signals of the
//      same size and similar trade frequency. If the real pooled result is not clearly above that
//      distribution, a "pass" is indistinguishable from picking the luckiest of N coins.
//   2. The 12-month data were already seen in rounds 1–2, so even a pass here is a hypothesis to lock
//      and forward-test on NEW data (shadow / DEMO), not evidence of profitability.
//
// Order management is untouched (Phase 7C: SL 6–10 + pullback wait, BE +6 → entry, 1/3 at +10,
// FastMove 10/10, M5 handoff, MA50 / FVG runner exits; STOP_FIRST, per-bar spread, slippage 0.10,
// commission 7 USD/lot, 0.03 lot, one position at a time). PAUSE (REVERSAL / UNCERTAIN) stays locked.
//
// usage: node scripts/backtest/phase7c-entry-signals-r3.mjs --m5 <M5.csv> --m15 <M15.csv>
//          [--cache f] [--out f.json] [--svg f.svg] [--nulls 100] [--null-draws 400]
import fs from "node:fs";
import path from "node:path";
import { metrics, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";
import { breakdown, buildContext, donchianBreakout, ema, rsi, supertrendDirection } from "./phase7c-entry-signals.mjs";
import { walkForwardVariants } from "./phase7c-strategy-variants.mjs";

const H1_MS = 60 * 60_000;
const H4_MS = 4 * H1_MS;
const DAY_MS = 24 * H1_MS;

// ---------------------------------------------------------------- helpers (all causal)
const sig = (side, pattern, patternExtreme) => ({ side, pattern, patternExtreme });
export const swingStop = (bars, k, side, n = 3) => {
  let v = side === "BUY" ? Infinity : -Infinity;
  for (let i = Math.max(0, k - n + 1); i <= k; i += 1) v = side === "BUY" ? Math.min(v, bars[i].low) : Math.max(v, bars[i].high);
  return v;
};
const hourOf = (bar) => new Date(bar.openTime).getUTCHours();
const minuteOfDay = (bar) => { const d = new Date(bar.openTime); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayOf = (bar) => Math.floor(bar.openTime / DAY_MS);

function rollingStd(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let s = 0; let s2 = 0;
    for (let j = i - period + 1; j <= i; j += 1) { s += values[j]; s2 += values[j] * values[j]; }
    const m = s / period;
    out[i] = { mean: m, std: Math.sqrt(Math.max(0, s2 / period - m * m)) };
  }
  return out;
}

function atrSeries(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  let atr = null; let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const pc = i > 0 ? bars[i - 1].close : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (i < period - 1) { sum += tr; continue; }
    if (i === period - 1) { sum += tr; atr = sum / period; } else atr = (atr * (period - 1) + tr) / period;
    out[i] = atr;
  }
  return out;
}

function sma(values, period) {
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

// Generic bucket aggregation from M15 (H4 or D1, broker time). complete = bucket fully closed.
export function aggregate(m15, bucketMs) {
  const out = [];
  for (const bar of m15) {
    const bucket = Math.floor(bar.openTime / bucketMs) * bucketMs;
    const last = out.at(-1);
    if (last && last.openTime === bucket) {
      last.high = Math.max(last.high, bar.high); last.low = Math.min(last.low, bar.low);
      last.close = bar.close; last.closeTime = bar.closeTime;
    } else out.push({ openTime: bucket, closeTime: bar.closeTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  }
  return out;
}

// Index of the latest bucket bar that has fully closed by m15[k].closeTime.
export function lastClosedIndex(m15, agg, bucketMs) {
  const out = new Int32Array(m15.length).fill(-1);
  let h = -1;
  for (let k = 0; k < m15.length; k += 1) {
    while (h + 1 < agg.length && agg[h + 1].openTime + bucketMs <= m15[k].closeTime) h += 1;
    out[k] = h;
  }
  return out;
}

export function buildContextR3(m15, pre = null) {
  const base = buildContext(m15, pre);
  const closes = m15.map((b) => b.close);
  const bb = rollingStd(closes, 20);
  const bbWidth = bb.map((x) => (x && x.mean > 0 ? (4 * x.std) / x.mean : null));
  const atr14 = atrSeries(m15, 14);
  const h4 = aggregate(m15, H4_MS);
  const d1 = aggregate(m15, DAY_MS);
  return {
    ...base,
    regimes: pre?.regimes ?? null,
    bb,
    bbWidth,
    rsi14: rsi(closes, 14),
    atr14,
    atr14Sma100: sma(atr14, 100),
    tickVolSma20: sma(m15.map((b) => b.tickVolume ?? 0), 20),
    h4,
    h4Idx: lastClosedIndex(m15, h4, H4_MS),
    h4Ema50: ema(h4.map((b) => b.close), 50),
    d1,
    d1Idx: lastClosedIndex(m15, d1, DAY_MS),
  };
}

const h1StSide = (ctx, k) => { const h = ctx.h1Idx[k]; return h >= 0 ? ctx.h1St[h] : null; };
const h4EmaSide = (ctx, k) => {
  const h = ctx.h4Idx[k];
  if (h < 0 || ctx.h4Ema50[h] === null) return null;
  return ctx.h4[h].close > ctx.h4Ema50[h] ? "BUY" : ctx.h4[h].close < ctx.h4Ema50[h] ? "SELL" : null;
};
const withFilter = (base, keep) => (ctx, k) => { const s = base(ctx, k); return s && keep(ctx, k, s) ? s : null; };
const alignH1 = (base) => withFilter(base, (c, k, s) => h1StSide(c, k) === s.side);

// ---------------------------------------------------------------- new signal builders
// Bollinger squeeze breakout: band width at k-1 in the lowest 20% of the previous 120 widths, then a
// close outside the band at k (first close outside).
export function squeezeBreakout(ctx, k) {
  if (k < 200) return null;
  const w = ctx.bbWidth[k - 1];
  if (w === null) return null;
  let below = 0; let n = 0;
  for (let i = k - 120; i < k - 1; i += 1) { if (ctx.bbWidth[i] === null) continue; n += 1; if (ctx.bbWidth[i] < w) below += 1; }
  if (!n || below / n > 0.2) return null;
  const b = ctx.m15[k]; const prev = ctx.m15[k - 1]; const band = ctx.bb[k]; const pband = ctx.bb[k - 1];
  const up = band.mean + 2 * band.std; const dn = band.mean - 2 * band.std;
  if (b.close > up && prev.close <= pband.mean + 2 * pband.std) return sig("BUY", "SQUEEZE_BREAKOUT", swingStop(ctx.m15, k, "BUY"));
  if (b.close < dn && prev.close >= pband.mean - 2 * pband.std) return sig("SELL", "SQUEEZE_BREAKOUT", swingStop(ctx.m15, k, "SELL"));
  return null;
}

// Opening-range breakout. Range = M15 bars with broker minute-of-day in [rangeFrom, rangeTo); trade the
// first M15 close beyond the range inside [tradeFrom, tradeTo), at most one signal per broker day.
export function openingRangeBreakout({ rangeFrom, rangeTo, tradeFrom, tradeTo }) {
  return (ctx, k) => {
    if (k < 200) return null;
    const bars = ctx.m15; const b = bars[k]; const mod = minuteOfDay(b);
    if (mod < tradeFrom || mod >= tradeTo) return null;
    const day = dayOf(b);
    let hi = -Infinity; let lo = Infinity; let count = 0;
    let i = k - 1;
    for (; i >= 0 && dayOf(bars[i]) === day; i -= 1) {
      const m = minuteOfDay(bars[i]);
      if (m >= rangeFrom && m < rangeTo) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); count += 1; }
    }
    if (count < Math.max(1, Math.floor((rangeTo - rangeFrom) / 15) - 1)) return null;
    // first breakout of the day only: no earlier close beyond the range in the trade window
    for (let j = k - 1; j >= 0 && dayOf(bars[j]) === day; j -= 1) {
      const m = minuteOfDay(bars[j]);
      if (m < tradeFrom) break;
      if (bars[j].close > hi || bars[j].close < lo) return null;
    }
    if (b.close > hi) return sig("BUY", "OPENING_RANGE_BREAKOUT", swingStop(bars, k, "BUY"));
    if (b.close < lo) return sig("SELL", "OPENING_RANGE_BREAKOUT", swingStop(bars, k, "SELL"));
    return null;
  };
}

// H1 inside-bar breakout: the last closed H1 is inside the H1 before it; M15 closes beyond it (first cross).
export function h1InsideBreak(ctx, k) {
  if (k < 200) return null;
  const h = ctx.h1Idx[k];
  if (h < 1) return null;
  const inside = ctx.h1[h]; const mother = ctx.h1[h - 1];
  if (!(inside.high <= mother.high && inside.low >= mother.low)) return null;
  const b = ctx.m15[k]; const prev = ctx.m15[k - 1];
  if (b.close > inside.high && prev.close <= inside.high) return sig("BUY", "H1_INSIDE_BREAK", swingStop(ctx.m15, k, "BUY"));
  if (b.close < inside.low && prev.close >= inside.low) return sig("SELL", "H1_INSIDE_BREAK", swingStop(ctx.m15, k, "SELL"));
  return null;
}

// Breakout + retest: a Donchian-20 breakout aligned with H1 SuperTrend at bar b; within the next 8 M15
// bars price comes back to the breakout level (±0.5) and a bar closes back on the breakout side in the
// breakout direction. Entry on that retest bar; at most one retest entry per breakout.
export function breakoutRetest(ctx, k) {
  if (k < 210) return null;
  const bars = ctx.m15; const b = bars[k];
  for (let back = 1; back <= 8; back += 1) {
    const s = k - back;
    const brk = donchianBreakout(ctx, s, 20);
    if (!brk || h1StSide(ctx, s) !== brk.side) continue;
    let level = brk.side === "BUY" ? -Infinity : Infinity;
    for (let i = s - 20; i < s; i += 1) level = brk.side === "BUY" ? Math.max(level, bars[i].high) : Math.min(level, bars[i].low);
    let alreadyRetested = false;
    for (let i = s + 1; i < k; i += 1) {
      const t = bars[i];
      if (brk.side === "BUY" ? t.low <= level + 0.5 && t.close > level && t.close > t.open : t.high >= level - 0.5 && t.close < level && t.close < t.open) { alreadyRetested = true; break; }
    }
    if (alreadyRetested) return null;
    if (brk.side === "BUY" && b.low <= level + 0.5 && b.close > level && b.close > b.open) return sig("BUY", "BREAKOUT_RETEST", swingStop(bars, k, "BUY"));
    if (brk.side === "SELL" && b.high >= level - 0.5 && b.close < level && b.close < b.open) return sig("SELL", "BREAKOUT_RETEST", swingStop(bars, k, "SELL"));
    return null;
  }
  return null;
}

// Range mean reversion: production regime is RANGING; previous close was outside BB(20,2) with RSI14
// beyond 30/70, current bar closes back inside the band in the reverting direction.
export function rangeMeanReversion(ctx, k) {
  if (k < 200 || !ctx.regimes) return null;
  if (ctx.regimes[k]?.regime !== "RANGING") return null;
  const b = ctx.m15[k]; const p = ctx.m15[k - 1]; const band = ctx.bb[k]; const pb = ctx.bb[k - 1]; const r = ctx.rsi14[k - 1];
  if (!band || !pb || r === null) return null;
  if (p.close < pb.mean - 2 * pb.std && r < 30 && b.close > band.mean - 2 * band.std && b.close > b.open) return sig("BUY", "RANGE_MR", swingStop(ctx.m15, k, "BUY"));
  if (p.close > pb.mean + 2 * pb.std && r > 70 && b.close < band.mean + 2 * band.std && b.close < b.open) return sig("SELL", "RANGE_MR", swingStop(ctx.m15, k, "SELL"));
  return null;
}

const donch = (lb) => (ctx, k) => donchianBreakout(ctx, k, lb);
const prevDaySide = (ctx, k) => {
  const d = ctx.d1Idx[k];
  if (d < 0) return null;
  const bar = ctx.d1[d];
  return bar.close > bar.open ? "BUY" : bar.close < bar.open ? "SELL" : null;
};

// Broker server time is GMT+2 (winter) / GMT+3 (summer), so London 08:00 local ≈ 10:00 broker all year
// and New York 08:30 ET ≈ 15:30 broker for most of the year (DST mismatch weeks not corrected).
const LONDON_ORB = { rangeFrom: 10 * 60, rangeTo: 11 * 60, tradeFrom: 11 * 60, tradeTo: 15 * 60 };
const NY_ORB = { rangeFrom: 15 * 60 + 30, rangeTo: 16 * 60 + 30, tradeFrom: 16 * 60 + 30, tradeTo: 20 * 60 };
const ASIA_RANGE = { rangeFrom: 1 * 60, rangeTo: 10 * 60, tradeFrom: 10 * 60, tradeTo: 18 * 60 };

// TREND path only; PAUSE stays locked. ST M15 gate kept unless stated; M5 gate off (as rounds 1–2).
const CFG = { strategies: ["TREND"], requireTrendMode: false, requireSupertrendM5: false };
const CFG_NO_ST = { ...CFG, requireSupertrendM15: false };

// ---------------------------------------------------------------- PRE-REGISTERED round-3 list
export const CANDIDATES_R3 = Object.freeze([
  { id: "N1_SQUEEZE_H1ST", label: "Bollinger squeeze (độ rộng thấp nhất 20%/120 nến) rồi đóng ngoài band + ST H1", signal: alignH1(squeezeBreakout), config: CFG },
  { id: "N2_DONCH30_H1ST_VOL", label: "Phá Donchian 30 + ST H1 + tick volume ≥ 1,5× TB 20 nến", signal: withFilter(alignH1(donch(30)), (c, k) => c.tickVolSma20[k - 1] !== null && (c.m15[k].tickVolume ?? 0) >= 1.5 * c.tickVolSma20[k - 1]), config: CFG },
  { id: "N3_DONCH30_H1ST_H4", label: "Phá Donchian 30 + ST H1 + giá H4 cùng phía EMA50 H4", signal: withFilter(alignH1(donch(30)), (c, k, s) => h4EmaSide(c, k) === s.side), config: CFG },
  { id: "N4_LONDON_ORB", label: "Phá biên giờ đầu London (10:00–10:59 broker), vào 11:00–14:59, 1 lệnh/ngày", signal: openingRangeBreakout(LONDON_ORB), config: CFG },
  { id: "N5_LONDON_ORB_H1ST", label: "Như N4 + ST H1 cùng hướng", signal: alignH1(openingRangeBreakout(LONDON_ORB)), config: CFG },
  { id: "N6_NY_ORB_H1ST", label: "Phá biên giờ đầu New York (15:30–16:29 broker), vào 16:30–19:59, + ST H1", signal: alignH1(openingRangeBreakout(NY_ORB)), config: CFG },
  { id: "N7_ASIA_RANGE_H1ST", label: "Phá biên phiên Á (01:00–09:59 broker), vào 10:00–17:59, + ST H1", signal: alignH1(openingRangeBreakout(ASIA_RANGE)), config: CFG },
  { id: "N8_H1_INSIDE_H1ST", label: "Nến H1 inside bar, M15 đóng vượt biên + ST H1", signal: alignH1(h1InsideBreak), config: CFG },
  { id: "N9_D1MOM_DONCH20", label: "Phá Donchian 20 cùng hướng nến ngày hôm trước (không ST H1)", signal: withFilter(donch(20), (c, k, s) => prevDaySide(c, k) === s.side), config: CFG },
  { id: "N10_DONCH30_H1ST_ATRX", label: "Phá Donchian 30 + ST H1 + ATR14 > SMA100(ATR14) (biến động đang mở rộng)", signal: withFilter(alignH1(donch(30)), (c, k) => c.atr14Sma100[k] !== null && c.atr14[k] > c.atr14Sma100[k]), config: CFG },
  { id: "N11_BREAKOUT_RETEST", label: "Phá Donchian 20 + ST H1, chờ hồi về test lại mức phá trong 8 nến", signal: breakoutRetest, config: CFG },
  { id: "N12_RANGE_MR", label: "Đảo chiều trong RANGING: đóng lại vào trong BB(20,2) sau RSI14 quá mua/bán", signal: rangeMeanReversion, config: CFG_NO_ST },
]);

// Random-direction control at a given bar rate (deterministic per seed); same swing SL and management.
export function randomSignal(seed, rate) {
  return (ctx, k) => {
    if (k < 200) return null;
    let x = (Math.imul(k + 1, 2654435761) ^ Math.imul(seed + 1, 40503)) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
    const u = x / 4294967296;
    if (u >= rate) return null;
    const side = u < rate / 2 ? "BUY" : "SELL";
    return sig(side, "RANDOM", swingStop(ctx.m15, k, side));
  };
}

export const buildSignals = (ctx, fn) => ctx.m15.map((_, k) => fn(ctx, k));

// Deterministic PRNG for the null resampling.
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Selection null: draw `setSize` random candidates (without replacement) from the pool, run the same
// walk-forward picker, record pooled PF / net / positive folds.
export function selectionNull(randomPool, setSize, start, end, draws = 400, seed = 11) {
  const rnd = mulberry32(seed);
  const ids = [...randomPool.keys()];
  const out = [];
  for (let d = 0; d < draws; d += 1) {
    const pick = [...ids];
    for (let i = pick.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
    const set = new Map(pick.slice(0, setSize).map((id) => [id, randomPool.get(id)]));
    const wf = walkForwardVariants(set, start, end);
    out.push({ pf: wf.pooled.profitFactor, net: wf.pooled.netUsd, trades: wf.pooled.trades, positiveFolds: wf.positiveFolds, passes: Object.values(wf.acceptance).every(Boolean) });
  }
  return out;
}

const inWindowOf = (trades, [from, to]) => trades.filter((t) => t.entryTime >= from && t.entryTime < to);
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.m5 || !args.m15) { console.error("usage: --m5 <M5.csv> --m15 <M15.csv> [--cache f] [--out f] [--svg f] [--nulls n] [--null-draws n]"); process.exit(2); }
  const m5 = loadMt5Bars(args.m5, M5_MS);
  const m15 = loadMt5Bars(args.m15, M15_MS);
  const cacheFile = args.cache ?? ".runtime/backtest/phase7c-replay-cache.json";
  let pre = loadCache(cacheFile, m15, m5);
  if (!pre) { pre = await precomputeReplay({ m15, m5 }); saveCache(cacheFile, pre); }
  const ctx = buildContextR3(m15, pre);
  const start = m5[0].openTime;
  const end = m5.at(-1).closeTime;
  const run = (signalFn, config) => simulate({ m15, m5, pre: { ...pre, trendSignals: buildSignals(ctx, signalFn) }, config });

  const tradesById = new Map(CANDIDATES_R3.map((c) => [c.id, run(c.signal, c.config)]));
  const wf = walkForwardVariants(tradesById, start, end);
  const rows = CANDIDATES_R3.map((c) => {
    const t = tradesById.get(c.id);
    const folds = wf.rows.map((r) => r.perVariant[c.id]);
    return { id: c.id, label: c.label, full: metrics(t), breakdown: breakdown(t), folds, positiveFolds: folds.filter((m) => m.netUsd > 0).length };
  });

  // Random pool at a trade frequency close to the candidates' median.
  const medianTrades = quantile(rows.map((r) => r.full.trades), 0.5);
  const nNulls = Number(args.nulls ?? 100);
  const rate = Math.min(0.2, Math.max(0.002, medianTrades / m15.length * 2.2));
  const randomPool = new Map();
  for (let s = 0; s < nNulls; s += 1) randomPool.set(`RND_${s}`, run(randomSignal(s, rate), CFG_NO_ST));
  const randomSingles = [...randomPool.values()].map((t) => metrics(t));
  const nullDist = selectionNull(randomPool, CANDIDATES_R3.length, start, end, Number(args["null-draws"] ?? 400));
  const pValuePf = nullDist.filter((d) => d.pf >= wf.pooled.profitFactor).length / nullDist.length;
  const nullPassRate = nullDist.filter((d) => d.passes).length / nullDist.length;

  const mid = start + Math.round((end - start) / 2);
  const fin = (pf) => (Number.isFinite(pf) ? pf : 5);
  const split = CANDIDATES_R3.map((c) => { const t = tradesById.get(c.id); return { id: c.id, is: metrics(t.filter((x) => x.entryTime < mid)), oos: metrics(t.filter((x) => x.entryTime >= mid)) }; });
  const splitPick = split.filter((r) => r.is.trades >= 20).sort((a, b) => fin(b.is.profitFactor) - fin(a.is.profitFactor))[0] ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    data: { m5Bars: m5.length, m15Bars: m15.length, from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    rows,
    walkForward: wf,
    walkForwardPooledBreakdown: breakdown(wf.rows.flatMap((r) => (r.picked ? inWindowOf(tradesById.get(r.picked), r.test) : []))),
    split: { mid: new Date(mid).toISOString(), rows: split, pick: splitPick },
    nullModel: {
      randomRate: rate, randomCandidates: nNulls, draws: nullDist.length, setSize: CANDIDATES_R3.length,
      singleRandomPf: { p05: quantile(randomSingles.map((m) => m.profitFactor), 0.05), p50: quantile(randomSingles.map((m) => m.profitFactor), 0.5), p95: quantile(randomSingles.map((m) => m.profitFactor), 0.95) },
      singleRandomTradesMedian: quantile(randomSingles.map((m) => m.trades), 0.5),
      wfPooledPf: { p05: quantile(nullDist.map((d) => d.pf), 0.05), p50: quantile(nullDist.map((d) => d.pf), 0.5), p95: quantile(nullDist.map((d) => d.pf), 0.95) },
      wfPositiveFolds: { p50: quantile(nullDist.map((d) => d.positiveFolds), 0.5), p95: quantile(nullDist.map((d) => d.positiveFolds), 0.95) },
      pValuePooledPf: pValuePf,
      nullPassRate,
    },
  };
  const out = args.out ?? ".runtime/backtest/phase7c-entry-signals-r3.json";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
  console.log("| Tín hiệu | 12 tháng: lệnh / PF / USD / avg R / Max DD USD (R) | F1 | F2 | F3 | F4 | F5 | F6 | Fold dương |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const f = r.full;
    console.log(`| ${r.id} — ${r.label} | ${f.trades} / ${pf(f.profitFactor)} / ${f.netUsd.toFixed(0)} / ${f.avgR.toFixed(3)} / ${f.maxDrawdownUsd.toFixed(0)} (${f.maxDrawdownR.toFixed(1)}) | ${r.folds.map((m) => `${m.netUsd.toFixed(0)} (${pf(m.profitFactor)})`).join(" | ")} | ${r.positiveFolds}/6 |`);
  }
  console.log("\nWalk-forward:");
  for (const r of wf.rows) console.log(`- Fold ${r.fold} (${new Date(r.test[0]).toISOString().slice(0, 10)} → ${new Date(r.test[1]).toISOString().slice(0, 10)}): chọn ${r.picked} (train PF ${pf(r.trainPf)}) → ${r.test_.trades} lệnh, PF ${pf(r.test_.profitFactor)}, ${r.test_.netUsd.toFixed(0)} USD`);
  console.log(`Gộp: ${JSON.stringify(wf.pooled)} | fold dương ${wf.positiveFolds}/6 | ngưỡng: ${JSON.stringify(wf.acceptance)}`);
  console.log(`Gộp theo BUY/SELL, regime: ${JSON.stringify(report.walkForwardPooledBreakdown)}`);
  if (splitPick) console.log(`Chia 50/50: chọn ${splitPick.id} (IS PF ${pf(splitPick.is.profitFactor)}) → OOS ${JSON.stringify(splitPick.oos)}`);
  console.log(`\nNull (ngẫu nhiên): ${JSON.stringify(report.nullModel)}`);

  if (args.svg) {
    const firstTest = wf.rows[0].test[0];
    const { equitySvg } = await import("./phase7c-entry-signals.mjs");
    const median = [...randomPool.entries()].map(([id, t]) => ({ id, net: metrics(inWindowOf(t, [firstTest, end])).netUsd })).sort((a, b) => a.net - b.net)[Math.floor(nNulls / 2)];
    fs.writeFileSync(args.svg, equitySvg([
      { name: "WF vòng 3 (gộp test)", trades: wf.rows.flatMap((r) => (r.picked ? inWindowOf(tradesById.get(r.picked), r.test) : [])) },
      { name: "Ngẫu nhiên (trung vị)", trades: inWindowOf(randomPool.get(median.id), [firstTest, end]) },
    ], { from: firstTest, to: end, folds: wf.rows.map((r) => r.test[0]) }));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
