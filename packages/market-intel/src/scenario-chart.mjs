import { analyzeTimeframe } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";
import { renderRegimeChartSvg } from "./chart-svg.mjs";

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const DIR = { BUY: "Mua", SELL: "Bán" };
const STATE = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };

function marksFor(s) {
  if (!s) return [];
  return [
    { price: s.entry, label: "Entry", color: "#1f2328" },
    { price: s.stopLoss, label: "SL", color: "#d1242f" },
    { price: s.takeProfit1, label: "TP1", color: "#1a7f37" },
    { price: s.takeProfit2, label: "TP2", color: "#116329" },
  ];
}

/** Three annotated SVG charts (H4, H1, M15) for a buildScenarios() result. */
export function renderScenarioCharts({ h4, h1, m15 }, result, { bars = { h4: 90, h1: 120, m15: 120 } } = {}) {
  const primary = result.scenarios.find((s) => s.role === "PRIMARY") ?? null;
  const zone = primary ? [{ low: primary.entryZone.low, high: primary.entryZone.high, label: `Vùng vào ${DIR[primary.direction]}`, color: primary.direction === "BUY" ? "#1a7f37" : "#d1242f" }] : [];
  const marks = marksFor(primary);
  const head = primary
    ? `${DIR[primary.direction]} · R:R ${primary.rr1}/${primary.rr2} · tin cậy ${primary.confidence}% (chưa hiệu chỉnh)`
    : "Không có kịch bản";
  const out = {};
  const frames = [["h4", h4, "H4", result.h4], ["h1", h1, "H1", result.h1], ["m15", m15, "M15", null]];
  for (const [key, series, label, info] of frames) {
    const i = lastClosedIndex(series, result.asOf);
    const analysis = analyzeTimeframe(series.slice(0, i + 1));
    const levels = key === "h4"
      ? result.h4.keyLevels.slice(0, 3).map((l) => ({ low: l.low, high: l.high, label: `${l.kind === "SUPPORT" ? "Hỗ trợ" : "Kháng cự"} H4 (${l.touches})`, color: "#6e7781", fromIndex: Math.max(0, i - bars[key] + 1) }))
      : [];
    out[key] = renderRegimeChartSvg({
      analysis, from: i - bars[key] + 1, to: i,
      zones: [...levels, ...zone], marks,
      title: `${label} · ${info ? STATE[info.state] ?? info.state : "điểm vào"} · đến ${fmt(result.asOf)} (giờ server)`,
      subtitle: head,
    });
  }
  return out;
}
