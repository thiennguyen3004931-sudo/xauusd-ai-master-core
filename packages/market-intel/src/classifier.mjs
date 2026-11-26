import { ema, atr, adx } from "./indicators.mjs";
import { detectSwings, detectStructureEvents, structureAt } from "./structure.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { REGIME_LIBRARY_VERSION, REGIME_TEMPLATES, THRESHOLDS as T } from "./templates.mjs";

export const SAFETY = Object.freeze({ readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
const MIN_INDEX = T.emaSlow - 1 + T.slopeLookback;
const round = (v, d = 4) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

/** Precompute causal indicator and structure series for one timeframe. */
export function analyzeTimeframe(bars) {
  const closes = bars.map((b) => b.close);
  const ema50 = ema(closes, T.emaFast);
  const ema200 = ema(closes, T.emaSlow);
  const atr14 = atr(bars, 14);
  const adx14 = adx(bars, 14);
  const swings = detectSwings(bars, T.swingBars, (i) => (atr14[i] ?? 0) * T.equalSwingAtr);
  const events = detectStructureEvents(bars, swings);
  return { bars, ema50, ema200, atr: atr14, adx: adx14, swings, events };
}

function edgeVisits(bars, from, to, top, bottom, zone) {
  const upper = top - (top - bottom) * zone;
  const lower = bottom + (top - bottom) * zone;
  let up = 0, down = 0, inUp = false, inDown = false;
  for (let k = from; k <= to; k += 1) {
    const hitUp = bars[k].high >= upper;
    const hitDown = bars[k].low <= lower;
    if (hitUp && !inUp) up += 1;
    if (hitDown && !inDown) down += 1;
    inUp = hitUp;
    inDown = hitDown;
  }
  return { up, down };
}

/** Features as known at the close of bar i (default: last bar). Returns null when not enough history. */
export function featuresAt(analysis, i = analysis.bars.length - 1) {
  const { bars, ema50, ema200, atr: a, adx: x } = analysis;
  if (i < MIN_INDEX || i >= bars.length) return null;
  const atrNow = a[i];
  if (!atrNow || !x[i] || ema200[i] === null || ema50[i - T.slopeLookback] === null) return null;
  const from = Math.max(0, i - T.rangeLookback + 1);
  let top = -Infinity, bottom = Infinity;
  for (let k = from; k <= i; k += 1) { top = Math.max(top, bars[k].high); bottom = Math.min(bottom, bars[k].low); }
  const visits = edgeVisits(bars, from, i, top, bottom, T.edgeZone);
  const s = structureAt(bars, analysis.swings, i, analysis.events);
  return {
    index: i,
    time: bars[i].closeTime,
    close: bars[i].close,
    ema50: ema50[i],
    ema200: ema200[i],
    atr: atrNow,
    adx: x[i].adx,
    plusDi: x[i].plusDi,
    minusDi: x[i].minusDi,
    distEma50Atr: (bars[i].close - ema50[i]) / atrNow,
    slopeAtr: (ema50[i] - ema50[i - T.slopeLookback]) / atrNow,
    rangeHigh: top,
    rangeLow: bottom,
    rangeWidthAtr: (top - bottom) / atrNow,
    upperVisits: visits.up,
    lowerVisits: visits.down,
    pattern: s.pattern,
    lastEvent: s.lastEvent ? `${s.lastEvent.type}_${s.lastEvent.direction}` : null,
    lastEventDirection: s.lastEvent?.direction ?? null,
  };
}

/** Score one timeframe against every template. */
export function classifyTimeframe(analysis, i = analysis.bars.length - 1) {
  const f = featuresAt(analysis, i);
  if (!f) {
    return { state: "TRANSITION", confidence: 0, scores: {}, criteria: {}, reasons: ["INSUFFICIENT_DATA"], features: null };
  }
  const scores = {};
  const criteria = {};
  for (const template of REGIME_TEMPLATES) {
    let total = 0, passed = 0;
    criteria[template.id] = template.criteria.map((c) => {
      const ok = Boolean(c.test(f));
      total += c.weight;
      if (ok) passed += c.weight;
      return { id: c.id, description: c.description, weight: c.weight, passed: ok, value: round(c.value(f)) };
    });
    scores[template.id] = round(passed / total, 3);
  }
  const ranked = Object.entries(scores).sort((p, q) => q[1] - p[1]);
  const [best, second] = ranked;
  const reasons = [];
  let state = best[0];
  if (best[1] < T.minScore) { state = "TRANSITION"; reasons.push("LOW_SCORE"); }
  else if (best[1] - second[1] < T.minMargin) { state = "TRANSITION"; reasons.push("AMBIGUOUS"); }
  const features = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, round(v)]));
  return { state, confidence: Math.round(best[1] * 100), bestTemplate: best[0], scores, criteria, reasons, features };
}

const opposite = (a, b) => (a === "UPTREND" && b === "DOWNTREND") || (a === "DOWNTREND" && b === "UPTREND");

/** Combine H4 (context) and H1 (state) results. */
export function combine(h4, h1) {
  let alignment = "NEUTRAL";
  if (opposite(h1.state, h4.state)) alignment = "CONFLICT";
  else if (h1.state === h4.state && h1.state !== "TRANSITION") alignment = "ALIGNED";
  const state = alignment === "CONFLICT" ? "TRANSITION" : h1.state;
  const reasons = alignment === "CONFLICT" ? ["H1_H4_CONFLICT"] : h1.reasons;
  return { libraryVersion: REGIME_LIBRARY_VERSION, state, alignment, confidence: state === "TRANSITION" ? 0 : h1.confidence, reasons, h4, h1, safety: SAFETY };
}

/**
 * Classify the market from closed H4 and H1 bars. `asOf` (epoch ms) limits both series to bars
 * closed at that time; without it the last bar of each series is used.
 */
export function classifyMarket({ h4, h1, asOf } = {}) {
  const a4 = analyzeTimeframe(h4);
  const a1 = analyzeTimeframe(h1);
  const i4 = asOf === undefined ? h4.length - 1 : lastClosedIndex(h4, asOf);
  const i1 = asOf === undefined ? h1.length - 1 : lastClosedIndex(h1, asOf);
  return combine(classifyTimeframe(a4, i4), classifyTimeframe(a1, i1));
}
