// Per-timeframe summary for the Control Center: open / high / low / close of the last CLOSED bar and the
// regime-library trend of that timeframe. Read-only, advisory only.
import { analyzeTimeframe, classifyTimeframe } from "./classifier.mjs";
import { lastClosedIndex } from "./candles.mjs";

const round = (v) => Math.round(v * 100) / 100;

function summarize(bars, asOf) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const i = lastClosedIndex(bars, asOf);
  if (i < 0) return null;
  const closed = bars.slice(0, i + 1);
  const b = closed[i];
  const cls = classifyTimeframe(analyzeTimeframe(closed), i);
  const change = round(round(b.close) - round(b.open));
  return {
    openTime: b.openTime, closeTime: b.closeTime,
    open: round(b.open), high: round(b.high), low: round(b.low), close: round(b.close),
    change, changePct: b.open ? round(((b.close - b.open) / b.open) * 100) : 0,
    candle: change > 0 ? "UP" : change < 0 ? "DOWN" : "FLAT",
    state: cls.state, confidence: cls.confidence,
  };
}

/** { h4, h1, m15 } summaries as of `asOf` (default: last M15 / H1 close). A bar still forming at `asOf` is skipped. */
export function frameSummaries({ h4 = [], h1 = [], m15 = [] } = {}, asOf) {
  const t = asOf ?? (m15.at(-1) ?? h1.at(-1) ?? h4.at(-1))?.closeTime ?? Date.now();
  return { h4: summarize(h4, t), h1: summarize(h1, t), m15: summarize(m15, t) };
}
