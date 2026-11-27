import { analyzeTimeframe } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { renderRegimeChartSvg } from "./chart-svg.mjs";

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const DIR = { BUY: "Mua", SELL: "Bán" };
const STATE = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };

const MARK_COLORS = {
  light: { entry: "#1f2328", sl: "#d1242f", tp1: "#1a7f37", tp2: "#116329", buy: "#1a7f37", sell: "#d1242f", level: "#6e7781", support: "#1b7c83", resistance: "#9a6700" },
  dark: { entry: "#e6edf3", sl: "#f85149", tp1: "#3fb950", tp2: "#2ea043", buy: "#3fb950", sell: "#f85149", level: "#8b949e", support: "#39c5cf", resistance: "#e3b341" },
};

function marksFor(s, c) {
  if (!s) return [];
  return [
    { price: s.entry, label: "Entry", color: c.entry },
    { price: s.stopLoss, label: "SL", color: c.sl },
    { price: s.takeProfit1, label: "TP1", color: c.tp1 },
    { price: s.takeProfit2, label: "TP2", color: c.tp2 },
  ];
}

/** Three annotated SVG charts (H4, H1, M15) for a buildScenarios() result. */
const round = (v) => Math.round(v * 100) / 100;
/** Half-width cap of a support / resistance band, as a fraction of price (0.15% ≈ 5 price on gold at 3,500). */
const MAX_BAND = 0.0015;

/**
 * Nearest support / resistance to the M15 close from the H4 and H1 key levels of a buildScenarios() result.
 * Overlapping H4 / H1 levels are merged ("H4+H1"). Resistance ascending (nearest first), support descending.
 */
export function nearestLevels(result, { perSide = 3 } = {}) {
  const close = result.m15?.close;
  if (!Number.isFinite(close)) return { resistance: [], support: [] };
  // A swing cluster can chain into a very wide band; draw at most ±MAX_BAND of the price around its centre.
  const cap = (l) => {
    const half = l.price * MAX_BAND;
    return { ...l, low: Math.max(l.low, l.price - half), high: Math.min(l.high, l.price + half) };
  };
  const all = [
    ...(result.h4?.keyLevels ?? []).map((l) => ({ ...cap(l), tf: "H4" })),
    ...(result.h1?.keyLevels ?? []).map((l) => ({ ...cap(l), tf: "H1" })),
  ].sort((a, b) => a.low - b.low);
  const merged = [];
  for (const l of all) {
    const last = merged.at(-1);
    if (last && l.low <= last.high) {
      const n = last.touches + l.touches;
      last.price = (last.price * last.touches + l.price * l.touches) / n;
      last.low = Math.min(last.low, l.low); last.high = Math.max(last.high, l.high); last.touches = n;
      last.tfs.add(l.tf);
    } else merged.push({ price: l.price, low: l.low, high: l.high, touches: l.touches, tfs: new Set([l.tf]) });
  }
  const out = merged.map((l) => ({
    price: round(l.price), low: round(l.low), high: round(l.high), touches: l.touches,
    tf: l.tfs.has("H4") && l.tfs.has("H1") ? "H4+H1" : [...l.tfs][0],
    kind: l.price >= close ? "RESISTANCE" : "SUPPORT",
  }));
  return {
    resistance: out.filter((l) => l.kind === "RESISTANCE").sort((a, b) => a.price - b.price).slice(0, perSide),
    support: out.filter((l) => l.kind === "SUPPORT").sort((a, b) => b.price - a.price).slice(0, perSide),
  };
}

/**
 * `compact` (web page): fewer bars, only the latest swing labels / BOS-CHoCH, nearest H4 / H1 support and resistance bands, and the planned
 * path drawn on M15 only. Default (scripts, reports) keeps the original full charts.
 */
export function renderScenarioCharts({ h4, h1, m15 }, result, { compact = false, theme = "light", bars = compact ? { h4: 60, h1: 80, m15: 96 } : { h4: 90, h1: 120, m15: 120 } } = {}) {
  const c = MARK_COLORS[theme] ?? MARK_COLORS.light;
  const primary = result.scenarios.find((s) => s.role === "PRIMARY") ?? null;
  const zone = primary ? [{ low: primary.entryZone.low, high: primary.entryZone.high, label: `Vùng vào ${DIR[primary.direction]}`, color: primary.direction === "BUY" ? c.buy : c.sell }] : [];
  const marks = marksFor(primary, c);
  const head = primary
    ? `${DIR[primary.direction]} · R:R ${primary.rr1}/${primary.rr2} · tin cậy ${primary.confidence}% (chưa hiệu chỉnh)`
    : "Không có kịch bản";
  const sr = compact ? nearestLevels(result) : null;
  const srLevels = sr ? [...sr.resistance, ...sr.support] : [];
  const out = {};
  const frames = [["h4", h4, "H4", result.h4], ["h1", h1, "H1", result.h1], ["m15", m15, "M15", null]];
  for (const [key, series, label, info] of frames) {
    const i = lastClosedIndex(series, result.asOf);
    const analysis = analyzeTimeframe(series.slice(0, i + 1));
    // Compact: S/R bands inside the visible price range (plus the trade levels), so the axis is not stretched.
    const view = series.slice(Math.max(0, i - bars[key] + 1), i + 1);
    const prices = [...view.flatMap((b) => [b.low, b.high]), ...marks.map((m) => m.price)];
    const vLo = Math.min(...prices), vHi = Math.max(...prices), slack = (vHi - vLo) * 0.15;
    const levels = compact
      ? srLevels.filter((l) => l.high >= vLo - slack && l.low <= vHi + slack).map((l) => ({
        low: l.low, high: l.high, kind: l.kind === "SUPPORT" ? "support" : "resistance",
        label: `${l.kind === "SUPPORT" ? "Hỗ trợ" : "Kháng cự"} ${l.tf} ${l.price.toFixed(2)} (${l.touches} chạm)`,
        color: l.kind === "SUPPORT" ? c.support : c.resistance, fromIndex: Math.max(0, i - bars[key] + 1),
      }))
      : key === "h4"
      ? result.h4.keyLevels.slice(0, compact ? 2 : 3).map((l) => ({ low: l.low, high: l.high, label: `${l.kind === "SUPPORT" ? "Hỗ trợ" : "Kháng cự"} H4 (${l.touches})`, color: c.level, fromIndex: Math.max(0, i - bars[key] + 1) }))
      : [];
    out[key] = renderRegimeChartSvg({
      analysis, from: i - bars[key] + 1, to: i,
      zones: [...levels, ...zone], marks,
      // The planned path is drawn on the trigger timeframe (M15) and the confirmation timeframe (H1).
      compact, theme,
      projection: primary && (compact ? key === "m15" : key !== "h4") ? { slots: Math.round(bars[key] / 4), direction: primary.direction, entry: primary.entry, stopLoss: primary.stopLoss, takeProfit1: primary.takeProfit1, takeProfit2: primary.takeProfit2 } : null,
      title: `${label} · ${info ? STATE[info.state] ?? info.state : "điểm vào"} · đến ${fmt(result.asOf)} (giờ server)`,
      subtitle: head,
    });
  }
  return out;
}
