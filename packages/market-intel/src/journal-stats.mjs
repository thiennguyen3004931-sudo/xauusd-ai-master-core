// Feature 1 (C1): descriptive trade statistics by market type. Deterministic, no LLM, read-only.
// It describes realized trades; it never changes a strategy, a risk setting or an order.
import { analyzeTimeframe, classifyTimeframe, combine } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { REGIME_LIBRARY_VERSION } from "./templates.mjs";

export const JOURNAL_FLAG = "ZIQ_MARKET_INTEL_JOURNAL_ENABLED";
/** Below this many trades a group is labelled "not enough sample" and never drives a proposal. */
export const JOURNAL_MIN_SAMPLE = 30;

export function isJournalEnabled(env = process.env) {
  return String(env?.[JOURNAL_FLAG] ?? "").trim().toLowerCase() === "true";
}

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const pct1 = (x) => Math.round(x * 1000) / 10;

export function performanceStats(trades) {
  const pnl = trades.map((x) => Number(x.netPnl) || 0);
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v < 0);
  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = -losses.reduce((s, v) => s + v, 0);
  let streak = 0;
  let maxStreak = 0;
  for (const v of pnl) {
    streak = v < 0 ? streak + 1 : 0;
    if (streak > maxStreak) maxStreak = streak;
  }
  const n = pnl.length;
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? -grossLoss / losses.length : null;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    breakeven: n - wins.length - losses.length,
    winRatePct: n ? pct1(wins.length / n) : null,
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    profitFactor: grossLoss > 0 ? r2(grossProfit / grossLoss) : null,
    profitFactorInfinite: grossLoss === 0 && grossProfit > 0,
    netPnl: r2(pnl.reduce((s, v) => s + v, 0)),
    expectancy: n ? r2(pnl.reduce((s, v) => s + v, 0) / n) : null,
    avgWin: avgWin === null ? null : r2(avgWin),
    avgLoss: avgLoss === null ? null : r2(avgLoss),
    /** Realized reward:risk = average win / |average loss|. */
    payoffRatio: avgWin !== null && avgLoss ? r2(avgWin / -avgLoss) : null,
    maxConsecutiveLosses: maxStreak,
    enoughSample: n >= JOURNAL_MIN_SAMPLE,
  };
}

export function groupStats(trades, keyOf) {
  const groups = new Map();
  for (const x of trades) {
    const key = String(keyOf(x) ?? "UNKNOWN");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, ...performanceStats(list) }))
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
}

export function alignmentOf(state, side) {
  if (state === "UPTREND") return side === "BUY" ? "WITH_TREND" : "AGAINST_TREND";
  if (state === "DOWNTREND") return side === "SELL" ? "WITH_TREND" : "AGAINST_TREND";
  if (state === "SIDEWAY") return "SIDEWAY";
  if (state === "TRANSITION") return "TRANSITION";
  return "UNKNOWN";
}

export function journalBreakdown(trades) {
  return {
    overall: performanceStats(trades),
    byLibraryState: groupStats(trades, (x) => x.libraryState),
    byProductionRegime: groupStats(trades, (x) => x.productionRegime),
    byStrategy: groupStats(trades, (x) => x.strategy),
    bySide: groupStats(trades, (x) => x.side),
    byAlignment: groupStats(trades, (x) => x.alignment),
    byStrategyAndLibraryState: groupStats(trades, (x) => `${x.strategy ?? "UNKNOWN"}|${x.libraryState ?? "UNKNOWN"}`),
  };
}

/**
 * Attach the template-library state that was visible when each trade opened. Causal: only bars
 * closed at or before openedAt are used. Trades before the loaded history get state null.
 */
export function enrichTradesWithContext({ trades, h4, h1 }) {
  const a4 = h4?.length ? analyzeTimeframe(h4) : null;
  const a1 = h1?.length ? analyzeTimeframe(h1) : null;
  return trades.map((trade) => {
    const base = { ...trade, libraryState: null, libraryH4: null, libraryH1: null, libraryScore: null, libraryAsOfH1: null, libraryVersion: REGIME_LIBRARY_VERSION };
    if (!a4 || !a1 || !Number.isFinite(trade.openedAt)) return { ...base, alignment: "UNKNOWN" };
    const i4 = lastClosedIndex(h4, trade.openedAt);
    const i1 = lastClosedIndex(h1, trade.openedAt);
    if (i4 < 0 || i1 < 0) return { ...base, alignment: "UNKNOWN" };
    const k4 = classifyTimeframe(a4, i4);
    const k1 = classifyTimeframe(a1, i1);
    // Same semantics as classifyMarket: a short H4 history is neutral context, a short H1 history is unknown.
    if (k1.reasons.includes("INSUFFICIENT_DATA")) return { ...base, alignment: "UNKNOWN" };
    const c = combine(k4, k1);
    return {
      ...base,
      libraryState: c.state,
      libraryH4: c.h4?.state ?? null,
      libraryH1: c.h1?.state ?? null,
      libraryScore: c.h1?.confidence ?? null,
      libraryAsOfH1: h1[i1].closeTime,
      alignment: alignmentOf(c.state, trade.side),
    };
  });
}
