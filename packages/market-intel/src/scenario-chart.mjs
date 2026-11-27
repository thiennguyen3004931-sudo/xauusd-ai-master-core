import { analyzeTimeframe } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { renderRegimeChartSvg } from "./chart-svg.mjs";

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const DIR = { BUY: "Mua", SELL: "Bán" };
const STATE = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };

const MARK_COLORS = {
  light: { entry: "#1f2328", sl: "#d1242f", tp1: "#1a7f37", tp2: "#116329", buy: "#1a7f37", sell: "#d1242f", level: "#6e7781" },
  dark: { entry: "#e6edf3", sl: "#f85149", tp1: "#3fb950", tp2: "#2ea043", buy: "#3fb950", sell: "#f85149", level: "#8b949e" },
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
/**
 * `compact` (web page): fewer bars, only the latest swing labels / BOS-CHoCH, two H4 levels, and the planned
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
  const out = {};
  const frames = [["h4", h4, "H4", result.h4], ["h1", h1, "H1", result.h1], ["m15", m15, "M15", null]];
  for (const [key, series, label, info] of frames) {
    const i = lastClosedIndex(series, result.asOf);
    const analysis = analyzeTimeframe(series.slice(0, i + 1));
    const levels = key === "h4"
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
