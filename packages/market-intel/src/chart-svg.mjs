// Annotated candlestick chart as a standalone SVG string (no dependencies, no scripts).
// Draws candles, EMA50 / EMA200, swing labels (HH/HL/LH/LL/EH/EL), BOS / CHoCH levels,
// optional trend line through the last two swings and optional zones.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const THEMES = {
  light: {
    up: "#26a69a", down: "#ef5350", ema50: "#2962ff", ema200: "#ff9800", text: "#1f2328", quiet: "#6e7781",
    grid: "#eaeef2", bos: "#6f42c1", choch: "#d63384", zone: "#2962ff", trend: "#1f2328", bg: "#ffffff", panel: "#f6f8fa",
  },
  dark: {
    up: "#26a69a", down: "#ef5350", ema50: "#5b9bff", ema200: "#ffb74d", text: "#e6edf3", quiet: "#8b949e",
    grid: "#222b36", bos: "#b392f0", choch: "#f778ba", zone: "#5b9bff", trend: "#c9d1d9", bg: "#11161d", panel: "#18202a",
  },
};
/** Compact mode: only the latest swing labels and structure events, so the chart stays readable. */
const COMPACT = { swings: 6, events: 2 };

/**
 * @param analysis result of analyzeTimeframe()
 * @param from first bar index shown, to last bar index shown (state "as of" `to`: only swings / events known then)
 * @param zones [{ low, high, label, color?, fromIndex?, toIndex? }] (bar indices; default: whole window)
 * @param marks [{ price, label, color? }] horizontal levels (e.g. entry / SL / TP)
 * @param projection optional { slots, direction, entry, stopLoss, takeProfit1, takeProfit2 }: empty space after
 *   the last closed bar with the planned path (price -> entry -> TP1 -> TP2, and entry -> SL). Illustrative only.
 */
export function renderRegimeChartSvg({ analysis, from, to, title = "", subtitle = "", zones = [], marks = [], trendline = true, projection = null, width = 960, height = 460, theme = "light", compact = false }) {
  const { bars, ema50, ema200 } = analysis;
  const COLORS = THEMES[theme] ?? THEMES.light;
  const lo = Math.max(0, from);
  const hi = Math.min(bars.length - 1, to);
  const view = bars.slice(lo, hi + 1);
  const padL = 16, padR = marks.length ? 128 : 72, padT = 56, padB = 36;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  let pMin = Math.min(...view.map((b) => b.low)), pMax = Math.max(...view.map((b) => b.high));
  for (const z of zones) { pMin = Math.min(pMin, z.low); pMax = Math.max(pMax, z.high); }
  for (const m of marks) { pMin = Math.min(pMin, m.price); pMax = Math.max(pMax, m.price); }
  for (let i = lo; i <= hi; i += 1) {
    for (const v of [ema50[i], ema200[i]]) if (v !== null && v !== undefined) { pMin = Math.min(pMin, v); pMax = Math.max(pMax, v); }
  }
  const pad = (pMax - pMin) * 0.06 || 1;
  pMin -= pad; pMax += pad;
  const slots = projection ? Math.max(4, Math.round(projection.slots ?? 24)) : 0;
  const step = plotW / (view.length + slots);
  const X = (i) => padL + (i - lo + 0.5) * step;
  const Y = (p) => padT + ((pMax - p) / (pMax - pMin)) * plotH;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11">`);
  out.push(`<rect class="background" width="${width}" height="${height}" fill="${COLORS.bg}"/>`);
  out.push(`<text x="${padL}" y="22" font-size="15" font-weight="600" fill="${COLORS.text}">${esc(title)}</text>`);
  if (subtitle) out.push(`<text x="${padL}" y="40" fill="${COLORS.quiet}">${esc(subtitle)}</text>`);

  // price grid
  const ticks = 6;
  const markYs = marks.map((m) => Y(m.price));
  for (let k = 0; k <= ticks; k += 1) {
    const p = pMin + ((pMax - pMin) * k) / ticks;
    out.push(`<line x1="${padL}" x2="${padL + plotW}" y1="${Y(p).toFixed(1)}" y2="${Y(p).toFixed(1)}" stroke="${COLORS.grid}"/>`);
    // Compact: skip a price label that would sit under an Entry / SL / TP tag.
    if (compact && markYs.some((y) => Math.abs(y - Y(p)) < 12)) continue;
    out.push(`<text x="${padL + plotW + 6}" y="${(Y(p) + 4).toFixed(1)}" fill="${COLORS.quiet}">${p.toFixed(2)}</text>`);
  }
  out.push(`<text x="${padL}" y="${height - 12}" fill="${COLORS.quiet}">${esc(fmtTime(view[0].openTime))}</text>`);
  out.push(`<text x="${X(hi) + step / 2}" y="${height - 12}" text-anchor="end" fill="${COLORS.quiet}">${esc(fmtTime(view.at(-1).closeTime))}</text>`);
  if (slots) {
    const px = X(hi) + step / 2;
    out.push(`<rect class="projection-area" x="${px.toFixed(1)}" y="${padT}" width="${(padL + plotW - px).toFixed(1)}" height="${plotH}" fill="${COLORS.panel}"/>`);
    out.push(`<text x="${(px + 6).toFixed(1)}" y="${padT + plotH - 6}" fill="${COLORS.quiet}">Dự kiến (minh hoạ, không phải dự báo)</text>`);
  }

  for (const z of zones) {
    const zx1 = X(Math.max(lo, z.fromIndex ?? lo)) - step / 2;
    const zx2 = X(Math.min(hi + slots, z.toIndex ?? hi + slots)) + step / 2;
    out.push(`<rect class="zone${z.kind ? ` level-${z.kind}` : ""}" x="${zx1.toFixed(1)}" y="${Y(z.high).toFixed(1)}" width="${(zx2 - zx1).toFixed(1)}" height="${Math.max(1, Y(z.low) - Y(z.high)).toFixed(1)}" fill="${z.color ?? COLORS.zone}" fill-opacity="0.08" stroke="${z.color ?? COLORS.zone}" stroke-opacity="0.4" stroke-dasharray="4 3"/>`);
    if (z.label) out.push(`<text x="${(zx1 + 4).toFixed(1)}" y="${(Y(z.high) + 12).toFixed(1)}" fill="${z.color ?? COLORS.zone}">${esc(z.label)}</text>`);
  }

  // candles
  const bodyW = Math.max(1, step * 0.6);
  for (let i = lo; i <= hi; i += 1) {
    const b = bars[i];
    const c = b.close >= b.open ? COLORS.up : COLORS.down;
    const yTop = Y(Math.max(b.open, b.close)), yBot = Y(Math.min(b.open, b.close));
    out.push(`<g class="candle"><line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${Y(b.high).toFixed(1)}" y2="${Y(b.low).toFixed(1)}" stroke="${c}"/><rect x="${(X(i) - bodyW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${Math.max(0.8, yBot - yTop).toFixed(1)}" fill="${c}"/></g>`);
  }

  // EMAs
  for (const [name, series, color] of [["ema50", ema50, COLORS.ema50], ["ema200", ema200, COLORS.ema200]]) {
    const pts = [];
    for (let i = lo; i <= hi; i += 1) if (series[i] !== null) pts.push(`${X(i).toFixed(1)},${Y(series[i]).toFixed(1)}`);
    if (pts.length > 1) out.push(`<polyline class="${name}" points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.4"/>`);
  }

  // swings known as of `hi`
  let swings = analysis.swings.filter((s) => s.index >= lo && s.confirmIndex <= hi && s.label !== "H" && s.label !== "L");
  if (compact) swings = swings.slice(-COMPACT.swings);
  for (const s of swings) {
    const above = s.type === "HIGH";
    const y = above ? Y(s.price) - 6 : Y(s.price) + 14;
    const color = s.label === "HH" || s.label === "HL" ? COLORS.up : s.label === "LH" || s.label === "LL" ? COLORS.down : COLORS.quiet;
    out.push(`<text class="swing" x="${X(s.index).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-weight="600" fill="${color}">${s.label}</text>`);
  }

  // BOS / CHoCH levels
  let events = analysis.events.filter((ev) => ev.index >= lo && ev.index <= hi);
  if (compact) events = events.slice(-COMPACT.events);
  for (const e of events) {
    const color = e.type === "BOS" ? COLORS.bos : COLORS.choch;
    const x1 = X(Math.max(lo, e.swingIndex)), x2 = X(e.index);
    out.push(`<line class="event" x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${Y(e.level).toFixed(1)}" y2="${Y(e.level).toFixed(1)}" stroke="${color}" stroke-dasharray="5 3"/>`);
    out.push(`<text x="${((x1 + x2) / 2).toFixed(1)}" y="${(Y(e.level) + (e.direction === "UP" ? -4 : 12)).toFixed(1)}" text-anchor="middle" fill="${color}">${e.type === "BOS" ? "BOS" : "CHoCH"}</text>`);
  }

  // trend line, only when the structure known as of `hi` is a clean trend:
  // HH + HL -> through the last two lows; LH + LL -> through the last two highs.
  if (trendline) {
    const known = analysis.swings.filter((s) => s.confirmIndex <= hi);
    const lows = known.filter((s) => s.type === "LOW").slice(-2);
    const highs = known.filter((s) => s.type === "HIGH").slice(-2);
    let pair = null;
    if (lows.length === 2 && highs.length === 2 && highs[1].label === "HH" && lows[1].label === "HL") pair = lows;
    else if (lows.length === 2 && highs.length === 2 && highs[1].label === "LH" && lows[1].label === "LL") pair = highs;
    if (pair && pair[0].index < lo) pair = null;
    if (pair) {
      const slope = (pair[1].price - pair[0].price) / (pair[1].index - pair[0].index);
      const yEnd = pair[0].price + slope * (hi - pair[0].index);
      out.push(`<line class="trendline" x1="${X(pair[0].index).toFixed(1)}" y1="${Y(pair[0].price).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(yEnd).toFixed(1)}" stroke="${COLORS.trend}" stroke-width="1.2"/>`);
    }
  }

  // Level marks: line across the plot, label in the right margin (de-overlapped, on a white tag).
  const tags = marks.map((m) => ({ ...m, y: Y(m.price) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < tags.length; k += 1) if (tags[k].y - tags[k - 1].y < 14) tags[k].y = tags[k - 1].y + 14;
  for (const m of tags) {
    const color = m.color ?? COLORS.text;
    out.push(`<line class="mark" x1="${padL}" x2="${padL + plotW}" y1="${Y(m.price).toFixed(1)}" y2="${Y(m.price).toFixed(1)}" stroke="${color}" stroke-width="1.2"/>`);
    out.push(`<rect x="${padL + plotW + 2}" y="${(m.y - 7).toFixed(1)}" width="${padR - 6}" height="14" fill="${COLORS.bg}"/>`);
    out.push(`<text x="${padL + plotW + 6}" y="${(m.y + 4).toFixed(1)}" font-weight="600" fill="${color}">${esc(m.label)} ${m.price.toFixed(2)}</text>`);
  }

  if (slots) {
    const pr = projection;
    const last = bars[hi].close;
    const at = (f) => X(hi) + f * slots * step;
    const pt = (f, p) => `${at(f).toFixed(1)},${Y(p).toFixed(1)}`;
    const win = pr.direction === "SELL" ? COLORS.down : COLORS.up;
    out.push(`<g class="projection">`);
    out.push(`<polyline class="projection-target" points="${pt(0, last)} ${pt(0.3, pr.entry)} ${pt(0.7, pr.takeProfit1)} ${pt(0.95, pr.takeProfit2)}" fill="none" stroke="${win}" stroke-width="2" stroke-dasharray="6 4"/>`);
    out.push(`<polyline class="projection-stop" points="${pt(0.3, pr.entry)} ${pt(0.6, pr.stopLoss)}" fill="none" stroke="#d1242f" stroke-width="2" stroke-dasharray="3 3"/>`);
    for (const [f, p, label, color] of [[0.3, pr.entry, "Entry", COLORS.text], [0.7, pr.takeProfit1, "TP1", theme === "dark" ? "#3fb950" : "#1a7f37"], [0.95, pr.takeProfit2, "TP2", theme === "dark" ? "#2ea043" : "#116329"], [0.6, pr.stopLoss, "SL", theme === "dark" ? "#f85149" : "#d1242f"]]) {
      out.push(`<circle cx="${at(f).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="3.5" fill="${color}"/>`);
      const ly = Y(p) - 7 < padT + 4 ? Y(p) + 16 : Y(p) - 7;
      out.push(`<text x="${at(f).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-weight="600" fill="${color}">${label}</text>`);
    }
    out.push(`</g>`);
  }

  // legend (bottom centre, between the two dates)
  const lx = padL + plotW / 2 - 120;
  const ly = height - 16;
  out.push(`<g class="legend" transform="translate(0 ${ly - 34})"><line x1="${lx}" x2="${lx + 18}" y1="34" y2="34" stroke="${COLORS.ema50}" stroke-width="2"/><text x="${lx + 22}" y="38" fill="${COLORS.text}">EMA50</text><line x1="${lx + 70}" x2="${lx + 88}" y1="34" y2="34" stroke="${COLORS.ema200}" stroke-width="2"/><text x="${lx + 92}" y="38" fill="${COLORS.text}">EMA200</text><line x1="${lx + 145}" x2="${lx + 163}" y1="34" y2="34" stroke="${COLORS.bos}" stroke-dasharray="5 3"/><text x="${lx + 167}" y="38" fill="${COLORS.text}">BOS</text><line x1="${lx + 195}" x2="${lx + 213}" y1="34" y2="34" stroke="${COLORS.choch}" stroke-dasharray="5 3"/><text x="${lx + 217}" y="38" fill="${COLORS.text}">CHoCH</text></g>`);
  out.push(`</svg>`);
  return out.join("\n");
}
