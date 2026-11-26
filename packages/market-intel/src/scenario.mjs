// Feature 2 — top-down H4 -> H1 -> M15 analysis and 1-2 trade scenarios (advisory only).
//
// The confidence is a rule score with fixed, documented points (CONFIDENCE_POINTS). It is NOT a
// calibrated probability; scripts/market-intel/mtf-scenario-eval.mjs measures how often scenarios of
// each score actually reached TP1 before SL.
import { analyzeTimeframe, classifyTimeframe, SAFETY } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { keyLevels, orderBlocks } from "./zones.mjs";
import { m15Trigger } from "./triggers.mjs";

export const MTF_VERSION = "mtf-scenario-v1";
export const MTF_FLAG = "ZIQ_MARKET_INTEL_MTF_ENABLED";
export const isMtfEnabled = (env = process.env) => String(env?.[MTF_FLAG] ?? "").trim().toLowerCase() === "true";

/** Bot rule used to flag scenarios: initial SL 6-10 price (PHASE7C-FINAL-RUNTIME-BASELINE.md). */
export const BOT_STOP_RULE = Object.freeze({ min: 6, max: 10 });

export const CONFIDENCE_POINTS = Object.freeze({
  base: 30,
  h4WithTrend: 20, h4RangeEdge: 10, h4None: 0, h4Against: -15,
  h1Agree: 15, h1Neutral: 5, h1Disagree: -10,
  discount: 10, premiumPenalty: -5,
  zoneConfluence: 10, zoneSingle: 5,
  m15Triggered: 15, m15Touched: 5,
  rrGood: 5, rrPoor: -10,
  min: 5, max: 90,
});
const P = CONFIDENCE_POINTS;

const STOP_BUFFER_ATR = 0.25;
const MAX_ZONE_ATR = 1.5;
const MAX_ZONE_DISTANCE_ATR = 4;
const round = (v) => Math.round(v * 100) / 100;
const trendDir = (state) => (state === "UPTREND" ? "BUY" : state === "DOWNTREND" ? "SELL" : null);
const opposite = (d) => (d === "BUY" ? "SELL" : "BUY");

function lastSwingRange(analysis, i) {
  const vis = analysis.swings.filter((s) => s.confirmIndex <= i);
  const hi = vis.filter((s) => s.type === "HIGH").at(-1);
  const lo = vis.filter((s) => s.type === "LOW").at(-1);
  if (!hi || !lo || hi.price <= lo.price) return null;
  return { high: hi.price, low: lo.price, highIndex: hi.index, lowIndex: lo.index };
}

function overlaps(a, b) {
  return a.low <= b.high && b.low <= a.high;
}

/** Candidate entry zones for `dir` at or beyond the current price, nearest first. */
function candidateZones(dir, ctx) {
  const { a1, i1, h1Levels, h1Obs, h4Levels, h4Obs, close, atr1 } = ctx;
  const buy = dir === "BUY";
  const wanted = buy ? "BULLISH" : "BEARISH";
  const levelKind = buy ? "SUPPORT" : "RESISTANCE";
  const zones = [];
  for (const ob of [...h1Obs.map((o) => ({ ...o, tf: "H1" })), ...h4Obs.map((o) => ({ ...o, tf: "H4" }))]) {
    if (ob.direction === wanted) zones.push({ low: ob.low, high: ob.high, sources: [`OB ${ob.tf}`] });
  }
  for (const l of [...h1Levels.map((x) => ({ ...x, tf: "H1" })), ...h4Levels.map((x) => ({ ...x, tf: "H4" }))]) {
    if (l.kind === levelKind && l.touches >= 2) zones.push({ low: l.low, high: l.high, sources: [`${buy ? "Hỗ trợ" : "Kháng cự"} ${l.tf} (${l.touches} chạm)`] });
  }
  const ema = a1.ema50[i1];
  if (ema !== null) zones.push({ low: ema - 0.3 * atr1, high: ema + 0.3 * atr1, sources: ["EMA50 H1"] });
  // Keep zones on the correct side of price (or containing it) and not too far.
  const usable = zones.filter((z) => (buy ? z.low <= close + 0.1 * atr1 : z.high >= close - 0.1 * atr1))
    .filter((z) => (buy ? close - z.high : z.low - close) <= MAX_ZONE_DISTANCE_ATR * atr1);
  // Merge overlapping zones (confluence) and trim width.
  usable.sort((p, q) => p.low - q.low);
  const merged = [];
  for (const z of usable) {
    const last = merged.at(-1);
    if (last && overlaps(last, z)) {
      last.low = Math.min(last.low, z.low);
      last.high = Math.max(last.high, z.high);
      last.sources = [...new Set([...last.sources, ...z.sources])];
    } else merged.push({ ...z, sources: [...z.sources] });
  }
  for (const z of merged) {
    if (z.high - z.low > MAX_ZONE_ATR * atr1) {
      if (buy) z.low = z.high - MAX_ZONE_ATR * atr1; else z.high = z.low + MAX_ZONE_ATR * atr1;
    }
    if (buy && z.high > close) z.high = Math.max(close, z.low + 0.1 * atr1);
    if (!buy && z.low < close) z.low = Math.min(close, z.high - 0.1 * atr1);
  }
  return merged.filter((z) => z.high > z.low).sort((p, q) => (buy ? q.high - p.high : p.low - q.low));
}

function targets(dir, entry, risk, ctx) {
  const { a1, i1, h1Levels, h4Levels } = ctx;
  const buy = dir === "BUY";
  const beyond = (p) => (buy ? p > entry : p < entry);
  const sorter = (p, q) => (buy ? p - q : q - p);
  const swingTargets = a1.swings.filter((s) => s.confirmIndex <= i1 && s.type === (buy ? "HIGH" : "LOW")).map((s) => s.price);
  const levelTargets = [...h1Levels, ...h4Levels].filter((l) => l.kind === (buy ? "RESISTANCE" : "SUPPORT")).map((l) => l.price);
  const all = [...new Set([...swingTargets, ...levelTargets])].filter(beyond).sort(sorter);
  const minTp1 = buy ? entry + risk : entry - risk;
  let tp1 = all.find((p) => (buy ? p >= minTp1 : p <= minTp1));
  let tp1Source = "Thanh khoản / swing H1";
  if (tp1 === undefined) { tp1 = buy ? entry + 1.5 * risk : entry - 1.5 * risk; tp1Source = "1,5R (không có đỉnh/đáy phù hợp)"; }
  const h4 = h4Levels.filter((l) => l.kind === (buy ? "RESISTANCE" : "SUPPORT")).map((l) => l.price).filter((p) => (buy ? p > tp1 : p < tp1)).sort(sorter);
  let tp2 = h4[0];
  let tp2Source = "Vùng H4";
  if (tp2 === undefined) { tp2 = buy ? Math.max(tp1, entry + 3 * risk) : Math.min(tp1, entry - 3 * risk); tp2Source = "3R (không có vùng H4 phù hợp)"; }
  return { tp1, tp2, tp1Source, tp2Source };
}

function buildDirectional(dir, role, ctx) {
  const { a1, i1, a15, i15, h4State, h1State, bias, close, atr1 } = ctx;
  const buy = dir === "BUY";
  const zone = candidateZones(dir, ctx)[0];
  if (!zone) return null;
  const entry = (zone.low + zone.high) / 2;
  const range = lastSwingRange(a1, i1);
  let stop = buy ? zone.low - STOP_BUFFER_ATR * atr1 : zone.high + STOP_BUFFER_ATR * atr1;
  if (range) {
    const structure = buy ? range.low : range.high;
    const near = buy ? structure < zone.low && zone.low - structure <= 0.5 * atr1 : structure > zone.high && structure - zone.high <= 0.5 * atr1;
    if (near) stop = buy ? Math.min(stop, structure - STOP_BUFFER_ATR * atr1) : Math.max(stop, structure + STOP_BUFFER_ATR * atr1);
  }
  const risk = Math.abs(entry - stop);
  const { tp1, tp2, tp1Source, tp2Source } = targets(dir, entry, risk, ctx);
  const rr1 = Math.abs(tp1 - entry) / risk;
  const rr2 = Math.abs(tp2 - entry) / risk;

  const breakdown = [{ factor: "Điểm nền", points: P.base }];
  if (bias === dir) breakdown.push({ factor: `H4 ${h4State.state} cùng hướng`, points: P.h4WithTrend });
  else if (bias === "RANGE") breakdown.push({ factor: "H4 sideway, vào ở biên", points: P.h4RangeEdge });
  else if (bias === "NONE") breakdown.push({ factor: "H4 chưa rõ xu hướng", points: P.h4None });
  else breakdown.push({ factor: "Ngược xu hướng H4", points: P.h4Against });
  const h1Dir = trendDir(h1State.state);
  if (h1Dir === dir) breakdown.push({ factor: "H1 đồng thuận", points: P.h1Agree });
  else if (h1Dir === null) breakdown.push({ factor: `H1 ${h1State.state}`, points: P.h1Neutral });
  else breakdown.push({ factor: "H1 ngược hướng", points: P.h1Disagree });
  let position = null;
  if (range) {
    position = (close - range.low) / (range.high - range.low);
    const discount = buy ? position <= 0.5 : position >= 0.5;
    breakdown.push(discount ? { factor: buy ? "Giá ở vùng discount (nửa dưới nhịp H1)" : "Giá ở vùng premium (nửa trên nhịp H1)", points: P.discount }
                            : { factor: buy ? "Giá đang ở vùng premium" : "Giá đang ở vùng discount", points: P.premiumPenalty });
  }
  breakdown.push(zone.sources.length >= 2 ? { factor: `Vùng hội tụ: ${zone.sources.join(" + ")}`, points: P.zoneConfluence }
                                          : { factor: `Vùng: ${zone.sources[0]}`, points: P.zoneSingle });
  const trigger = m15Trigger(a15, i15, zone, dir);
  if (trigger.status === "TRIGGERED") breakdown.push({ factor: `M15 đã có tín hiệu: ${[...new Set(trigger.triggers.map((t) => t.type))].join(", ")}`, points: P.m15Triggered });
  else if (trigger.status === "TOUCHED_NO_TRIGGER") breakdown.push({ factor: "M15 đã chạm vùng, chưa có tín hiệu", points: P.m15Touched });
  else breakdown.push({ factor: "M15 chưa chạm vùng", points: 0 });
  if (rr1 >= 1.5) breakdown.push({ factor: `R:R TP1 ${round(rr1)} ≥ 1,5`, points: P.rrGood });
  else if (rr1 < 1) breakdown.push({ factor: `R:R TP1 ${round(rr1)} < 1`, points: P.rrPoor });
  const raw = breakdown.reduce((s, f) => s + f.points, 0);
  const confidence = Math.max(P.min, Math.min(P.max, raw));

  const stopDistance = Math.abs(entry - stop);
  return {
    role,
    direction: dir,
    entryZone: { low: round(zone.low), high: round(zone.high), sources: zone.sources },
    entry: round(entry),
    stopLoss: round(stop),
    takeProfit1: round(tp1),
    takeProfit2: round(tp2),
    targetsSource: { tp1: tp1Source, tp2: tp2Source },
    rr1: round(Math.abs(round(tp1) - round(entry)) / Math.abs(round(entry) - round(stop))),
    rr2: round(Math.abs(round(tp2) - round(entry)) / Math.abs(round(entry) - round(stop))),
    invalidation: {
      price: round(stop),
      text: buy ? `Mất hiệu lực nếu nến H1 đóng cửa dưới ${round(stop)}, hoặc H4 xuất hiện CHoCH giảm.`
                : `Mất hiệu lực nếu nến H1 đóng cửa trên ${round(stop)}, hoặc H4 xuất hiện CHoCH tăng.`,
    },
    m15: { status: trigger.status, triggers: trigger.triggers },
    confidence,
    confidenceBreakdown: breakdown,
    confidenceNote: "Điểm theo luật cố định, chưa hiệu chỉnh thành xác suất.",
    botStopRule: {
      stopDistance: round(stopDistance),
      withinRule: stopDistance >= BOT_STOP_RULE.min && stopDistance <= BOT_STOP_RULE.max,
      note: stopDistance > BOT_STOP_RULE.max ? "SL rộng hơn 10 giá: bot TREND sẽ chờ hồi, SIDEWAY sẽ bỏ lệnh."
          : stopDistance < BOT_STOP_RULE.min ? "SL hẹp hơn 6 giá: bot sẽ nới SL lên tối thiểu 6." : "Nằm trong luật SL 6–10 của bot.",
    },
    pricePositionInH1Leg: position === null ? null : round(position),
  };
}

/** Analyse precomputed timeframes at given indices (used by the evaluator for speed). */
export function scenariosFromAnalyses({ a4, a1, a15, i4, i1, i15 }) {
  const h4State = classifyTimeframe(a4, i4);
  const h1State = classifyTimeframe(a1, i1);
  const close = a15.bars[i15].close;
  const atr1 = a1.atr[i1];
  const h4Dir = trendDir(h4State.state);
  const bias = h4Dir ?? (h4State.state === "SIDEWAY" ? "RANGE" : "NONE");
  const ctx = {
    a1, i1, a15, i15, h4State, h1State, bias, close, atr1,
    h1Levels: keyLevels(a1, i1), h1Obs: orderBlocks(a1, i1),
    h4Levels: keyLevels(a4, i4), h4Obs: orderBlocks(a4, i4),
  };
  const notes = [];
  let primaryDir = h4Dir;
  if (!primaryDir && bias === "RANGE") {
    const range = lastSwingRange(a1, i1);
    primaryDir = range && (close - range.low) / (range.high - range.low) > 0.5 ? "SELL" : "BUY";
    notes.push("H4 đi ngang: kịch bản chính là vào ở biên gần nhất.");
  }
  if (!primaryDir) primaryDir = trendDir(h1State.state);
  if (!primaryDir) notes.push("H4 và H1 đều chưa rõ hướng: không đưa ra kịch bản.");
  const h1Dir = trendDir(h1State.state);
  const phase = !h1Dir ? "KHONG_RO" : (() => {
    const range = lastSwingRange(a1, i1);
    if (!range) return "KHONG_RO";
    return h1Dir === "BUY" ? (close > range.high ? "PHA_DAY" : "PHA_HOI") : (close < range.low ? "PHA_DAY" : "PHA_HOI");
  })();
  const scenarios = [];
  if (primaryDir && atr1) {
    const primary = buildDirectional(primaryDir, "PRIMARY", ctx);
    if (primary) scenarios.push(primary);
    else notes.push("Không tìm được vùng vào lệnh phù hợp cho hướng chính.");
    const alternate = buildDirectional(opposite(primaryDir), "ALTERNATE", ctx);
    if (alternate) scenarios.push(alternate);
    if (!primary && alternate) alternate.role = "PRIMARY";
  }
  return {
    version: MTF_VERSION,
    asOf: a15.bars[i15].closeTime,
    safety: SAFETY,
    h4: { state: h4State.state, confidence: h4State.confidence, bias, keyLevels: ctx.h4Levels, orderBlocks: ctx.h4Obs, index: i4 },
    h1: { state: h1State.state, confidence: h1State.confidence, agreement: !h1Dir ? "NEUTRAL" : h1Dir === h4Dir ? "AGREE" : h4Dir ? "DISAGREE" : "NEUTRAL", phase, keyLevels: ctx.h1Levels, orderBlocks: ctx.h1Obs, index: i1 },
    m15: { close, index: i15 },
    scenarios: scenarios.sort((p, q) => (p.role === "PRIMARY" ? -1 : 1) - (q.role === "PRIMARY" ? -1 : 1)),
    notes,
  };
}

/** Top-down analysis from closed H4, H1 and M15 bars, as of `asOf` (default: last M15 close). */
export function buildScenarios({ h4, h1, m15, asOf } = {}) {
  const t = asOf ?? m15.at(-1).closeTime;
  const i15 = lastClosedIndex(m15, t);
  const i1 = lastClosedIndex(h1, t);
  const i4 = lastClosedIndex(h4, t);
  const cut = (bars, i) => bars.slice(0, i + 1);
  const a15 = analyzeTimeframe(cut(m15, i15));
  const a1 = analyzeTimeframe(cut(h1, i1));
  const a4 = analyzeTimeframe(cut(h4, i4));
  return scenariosFromAnalyses({ a4, a1, a15, i4, i1, i15 });
}
