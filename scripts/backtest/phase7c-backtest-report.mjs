// Phase 7C backtest mode — report building and rendering (pure functions, no I/O, no MT5, no orders).
//
// Input: trades from simulate() in phase7c-management-sim.mjs. Output: a JSON-able report with the
// metrics the operator asked for (PF, expectancy, drawdown USD/R, win rate, trade count, BUY/SELL split),
// plus renderers for Markdown, HTML (self-contained, inline SVG equity curve) and CSV.
import { metrics } from "./phase7c-management-sim.mjs";

export const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);

export function groupMetrics(trades, keyOf) {
  const groups = new Map();
  for (const t of trades) {
    const key = keyOf(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, ts]) => [k, metrics(ts)]));
}

export function exitReasonCounts(trades) {
  const out = {};
  for (const t of trades) out[t.exitReason] = (out[t.exitReason] ?? 0) + 1;
  return out;
}

export function equityCurve(trades) {
  let equity = 0;
  let cumR = 0;
  let peak = 0;
  return trades.map((t) => {
    equity += t.pnlUsd;
    cumR += t.r;
    peak = Math.max(peak, equity);
    return { time: t.exitTime, equityUsd: round(equity), cumR: round(cumR, 3), drawdownUsd: round(peak - equity) };
  });
}

/**
 * @param {object} args
 * @param {object[]} args.trades       trades of the tested config
 * @param {object}   args.config       effective simulator config of the tested config
 * @param {object[]} [args.baselineTrades] trades of the frozen Phase 7C baseline on the same data (comparison)
 * @param {object}   args.data         { m5Bars, m15Bars, from, to } (ms)
 * @param {object}   [args.window]     { from, to } (ms) — entry-time filter that was applied
 */
export function buildBacktestReport({ trades, config, baselineTrades = null, data, window = null }) {
  const summary = metrics(trades);
  return {
    kind: "phase7c-backtest",
    generatedAt: new Date().toISOString(),
    safety: "OFFLINE_REPLAY_ONLY — không kết nối MT5, không gửi/sửa/đóng lệnh, không đọc/ghi runtime",
    data: {
      m5Bars: data.m5Bars,
      m15Bars: data.m15Bars,
      from: iso(data.from),
      to: iso(data.to),
      window: window ? { from: Number.isFinite(window.from) ? iso(window.from) : null, to: Number.isFinite(window.to) ? iso(window.to) : null } : null,
    },
    config: {
      breakEvenEnabled: config.breakEvenEnabled,
      breakEvenTriggerPrice: config.breakEvenTriggerPrice,
      breakEvenOffsetPrice: config.breakEvenOffsetPrice,
      minInitialStopPrice: config.minInitialStopPrice,
      maxInitialStopPrice: config.maxInitialStopPrice,
      fixedTpPrice: config.fixedTpPrice,
      partialEnabled: config.partialEnabled,
      partialTriggerPrice: config.partialTriggerPrice,
      partialFraction: config.partialFraction,
      fastMoveEnabled: config.fastMoveEnabled,
      fastMoveActivationPrice: config.fastMoveActivationPrice,
      fastMoveGivebackPrice: config.fastMoveGivebackPrice,
      m5TrailEnabled: config.m5TrailEnabled,
      runnerExitsEnabled: config.runnerExitsEnabled,
      volume: config.volume,
      strategies: config.strategies,
    },
    costs: {
      execution: "STOP_FIRST; vào lệnh ở giá mở nến M5 kế tiếp; SL khớp có trượt giá; TP khớp đúng giá",
      spread: config.minSpreadPoints > 0
        ? `spread theo từng nến MT5, tối thiểu ${config.minSpreadPoints} point`
        : "spread theo từng nến MT5 (<SPREAD> × point)",
      commissionPerLotRoundTurn: config.commissionPerLotRoundTurn,
      slippagePrice: config.slippagePrice,
    },
    notModelled: [
      "daily recovery / RECOVERY_TP",
      "lệnh REVERSAL (bị khoá khi LIVE AUTO)",
      "cổng spread / độ tươi dữ liệu của runtime",
      "stop/freeze level của broker",
      "SIDEWAY lot theo rủi ro 1% (backtest dùng lot cố định)",
    ],
    summary,
    bySide: groupMetrics(trades, (t) => t.side),
    byStrategy: groupMetrics(trades, (t) => t.strategy),
    byStrategySide: groupMetrics(trades, (t) => `${t.strategy}/${t.side}`),
    byRegime: groupMetrics(trades, (t) => t.regime ?? "UNKNOWN"),
    byMonth: groupMetrics(trades, (t) => monthOf(t.entryTime)),
    exitReasons: exitReasonCounts(trades),
    baseline: baselineTrades ? { summary: metrics(baselineTrades), bySide: groupMetrics(baselineTrades, (t) => t.side) } : null,
    equity: equityCurve(trades),
    verdict: verdict(summary),
  };
}

// Plain-language reading of the numbers. Never claims profitability: a backtest is evidence, not proof.
export function verdict(m) {
  const notes = [];
  if (m.trades < 30) notes.push(`Chỉ ${m.trades} lệnh (< 30): quá ít để kết luận.`);
  if (m.profitFactor <= 1) notes.push(`PF ${fmtPf(m.profitFactor)} ≤ 1: cấu hình này lỗ trên dữ liệu đã chạy.`);
  else if (m.profitFactor <= 1.2) notes.push(`PF ${fmtPf(m.profitFactor)} trong khoảng 1–1,2: lợi thế quá mỏng, chưa đạt ngưỡng 1,20.`);
  else notes.push(`PF ${fmtPf(m.profitFactor)} > 1,20 trên dữ liệu này. Vẫn phải kiểm ngoài mẫu (sweep T3/T4) và DEMO ≥ 30 lệnh trước khi tin.`);
  if (m.expectancyUsd <= 0) notes.push("Kỳ vọng mỗi lệnh ≤ 0.");
  notes.push("Backtest không phải bằng chứng sinh lời. Không dùng để bật LIVE.");
  return notes;
}

const fmtPf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
const fmtUsd = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const HEAD = ["Nhóm", "Lệnh", "Thắng", "PF", "Lãi/lỗ USD", "Kỳ vọng USD/lệnh", "R TB", "Max DD USD", "Max DD R"];
const cells = (label, m) => [label, String(m.trades), fmtPct(m.winRate), fmtPf(m.profitFactor), fmtUsd(m.netUsd), fmtUsd(m.expectancyUsd), m.avgR.toFixed(3), m.maxDrawdownUsd.toFixed(2), m.maxDrawdownR.toFixed(2)];

function mdTable(rows) {
  return [`| ${HEAD.join(" | ")} |`, `|${HEAD.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export function describeConfig(c) {
  return `BE +${c.breakEvenTriggerPrice} → entry${c.breakEvenOffsetPrice ? ` +${c.breakEvenOffsetPrice}` : ""} · SL ${c.minInitialStopPrice}–${c.maxInitialStopPrice} · TP cố định ${c.fixedTpPrice ?? "tắt"} · lot ${c.volume} · ${c.strategies.join("+")}`;
}

export function renderMarkdown(r) {
  const out = [];
  out.push("# Backtest Phase 7C (mô phỏng lịch sử, offline)");
  out.push("");
  out.push(`> ${r.safety}`);
  out.push("");
  out.push(`- Dữ liệu: ${r.data.m5Bars} nến M5, ${r.data.m15Bars} nến M15, ${r.data.from} → ${r.data.to} (giờ server MT5).`);
  if (r.data.window) out.push(`- Chỉ tính lệnh vào trong: ${r.data.window.from ?? "đầu dữ liệu"} → ${r.data.window.to ?? "cuối dữ liệu"}.`);
  out.push(`- Cấu hình: ${describeConfig(r.config)}.`);
  out.push(`- Chi phí: ${r.costs.execution}; ${r.costs.spread}; phí ${r.costs.commissionPerLotRoundTurn} USD/lot khứ hồi; trượt giá ${r.costs.slippagePrice}.`);
  out.push("");
  out.push("## Nhận định");
  for (const n of r.verdict) out.push(`- ${n}`);
  out.push("");
  out.push("## Tổng quan");
  const rows = [cells("Cấu hình đang chạy thử", r.summary)];
  if (r.baseline) rows.push(cells("Baseline Phase 7C (BE 6 / SL 10 / TP tắt)", r.baseline.summary));
  out.push(mdTable(rows));
  out.push("");
  out.push("## BUY / SELL");
  out.push(mdTable(Object.entries(r.bySide).map(([k, m]) => cells(k, m))));
  out.push("");
  out.push("## Theo chiến lược và chiều");
  out.push(mdTable(Object.entries(r.byStrategySide).map(([k, m]) => cells(k, m))));
  out.push("");
  out.push("## Theo regime");
  out.push(mdTable(Object.entries(r.byRegime).map(([k, m]) => cells(k, m))));
  out.push("");
  out.push("## Theo tháng");
  out.push(mdTable(Object.entries(r.byMonth).map(([k, m]) => cells(k, m))));
  out.push("");
  out.push("## Lý do đóng lệnh");
  out.push(Object.entries(r.exitReasons).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (không có lệnh)");
  out.push("");
  out.push("## Không mô phỏng");
  for (const n of r.notModelled) out.push(`- ${n}`);
  out.push("");
  return out.join("\n");
}

const CSV_COLS = ["strategy", "side", "regime", "entryTime", "exitTime", "entry", "initialStop", "riskUsd", "pnlUsd", "r", "exitReason", "breakEvenApplied", "partialApplied"];
export function tradesCsv(trades) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [CSV_COLS.join(",")];
  for (const t of trades) {
    lines.push(CSV_COLS.map((c) => esc(c.endsWith("Time") ? iso(t[c]) : typeof t[c] === "number" ? round(t[c], 4) : t[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const escHtml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function htmlTable(rows) {
  return `<table><thead><tr>${HEAD.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${escHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function equitySvg(points) {
  if (!points.length) return '<p class="muted">Không có lệnh nào để vẽ.</p>';
  const W = 900;
  const H = 260;
  const pad = { l: 64, r: 16, t: 16, b: 28 };
  const values = [0, ...points.map((p) => p.equityUsd)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad.l + (i / Math.max(1, points.length)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = [`M${x(0).toFixed(1)},${y(0).toFixed(1)}`, ...points.map((p, i) => `L${x(i + 1).toFixed(1)},${y(p.equityUsd).toFixed(1)}`)].join(" ");
  const ticks = [min, (min + max) / 2, max];
  const data = JSON.stringify(points.map((p, i) => ({ x: +x(i + 1).toFixed(1), y: +y(p.equityUsd).toFixed(1), t: iso(p.time), e: p.equityUsd, r: p.cumR, dd: p.drawdownUsd })));
  return `<figure class="chart">
<svg id="eq" viewBox="0 0 ${W} ${H}" role="img" aria-label="Đường vốn tích luỹ (USD) theo lệnh">
${ticks.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="axis" x="${pad.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v.toFixed(0)}</text>`).join("\n")}
<line class="zero" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
<path class="line" d="${path}"/>
<text class="axis" x="${pad.l}" y="${H - 8}">lệnh 1</text><text class="axis" x="${W - pad.r}" y="${H - 8}" text-anchor="end">lệnh ${points.length}</text>
<line id="cross" class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
<circle id="dot" r="4" class="dot" visibility="hidden"/>
<rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" id="hit"/>
</svg>
<div id="tip" class="tip" hidden></div>
<figcaption>Đường vốn tích luỹ (USD, sau spread/phí/trượt giá) theo thứ tự lệnh đóng. Rê chuột để xem từng lệnh.</figcaption>
<script>
(() => {
  const pts = ${data};
  const svg = document.getElementById("eq"), hit = document.getElementById("hit"), cross = document.getElementById("cross"), dot = document.getElementById("dot"), tip = document.getElementById("tip");
  hit.addEventListener("mousemove", (ev) => {
    const box = svg.getBoundingClientRect();
    const sx = (ev.clientX - box.left) * (${W} / box.width);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - sx) < Math.abs(best.x - sx)) best = p;
    cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", best.x); dot.setAttribute("cy", best.y); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = best.t + " · vốn " + best.e.toFixed(2) + " USD · " + best.r.toFixed(2) + " R · DD " + best.dd.toFixed(2) + " USD";
  });
  hit.addEventListener("mouseleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
})();
</script>
</figure>`;
}

export function renderHtml(r) {
  const tiles = [
    ["Số lệnh", String(r.summary.trades)],
    ["Tỷ lệ thắng", fmtPct(r.summary.winRate)],
    ["Profit factor", fmtPf(r.summary.profitFactor)],
    ["Lãi/lỗ ròng", `${fmtUsd(r.summary.netUsd)} USD`],
    ["Kỳ vọng / lệnh", `${fmtUsd(r.summary.expectancyUsd)} USD · ${r.summary.avgR.toFixed(3)} R`],
    ["Max drawdown", `${r.summary.maxDrawdownUsd.toFixed(2)} USD · ${r.summary.maxDrawdownR.toFixed(2)} R`],
  ];
  const overview = [cells("Cấu hình đang chạy thử", r.summary)];
  if (r.baseline) overview.push(cells("Baseline Phase 7C", r.baseline.summary));
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backtest Phase 7C ${escHtml(r.data.from)} → ${escHtml(r.data.to)}</title>
<style>
:root { --surface:#ffffff; --text:#191919; --muted:#666666; --line:#257de0; --grid:#e6e6e6; --bad:#ec4647; }
@media (prefers-color-scheme: dark) { :root { --surface:#191919; --text:#efefef; --muted:#9c9c9c; --line:#338ced; --grid:#333333; --bad:#eb6263; } }
body { font: 14px/1.5 system-ui, sans-serif; background: var(--surface); color: var(--text); margin: 24px auto; max-width: 980px; padding: 0 16px; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
.muted, figcaption { color: var(--muted); font-size: 12px; }
.banner { border: 1px solid var(--grid); border-left: 4px solid var(--bad); padding: 8px 12px; margin: 12px 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
.tile { border: 1px solid var(--grid); border-radius: 6px; padding: 10px 12px; }
.tile .k { color: var(--muted); font-size: 12px; } .tile .v { font-size: 18px; font-variant-numeric: tabular-nums; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; margin: 8px 0; }
th, td { border-bottom: 1px solid var(--grid); padding: 4px 8px; text-align: left; } td.num, th:not(:first-child) { text-align: right; }
.chart svg { width: 100%; height: auto; } .grid { stroke: var(--grid); stroke-width: 1; } .zero { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.line { fill: none; stroke: var(--line); stroke-width: 2; stroke-linejoin: round; } .axis { fill: var(--muted); font-size: 11px; }
.cross { stroke: var(--muted); stroke-width: 1; } .dot { fill: var(--line); stroke: var(--surface); stroke-width: 2; }
.tip { font-size: 12px; color: var(--text); border: 1px solid var(--grid); border-radius: 4px; padding: 4px 8px; display: inline-block; }
</style></head><body>
<h1>Backtest Phase 7C — mô phỏng lịch sử</h1>
<div class="banner">${escHtml(r.safety)}. Backtest không phải bằng chứng sinh lời và không dùng để bật LIVE.</div>
<p>Dữ liệu: ${r.data.m5Bars} nến M5, ${r.data.m15Bars} nến M15, ${escHtml(r.data.from)} → ${escHtml(r.data.to)} (giờ server MT5).${r.data.window ? ` Chỉ tính lệnh vào trong ${escHtml(r.data.window.from ?? "đầu dữ liệu")} → ${escHtml(r.data.window.to ?? "cuối dữ liệu")}.` : ""}<br>
Cấu hình: ${escHtml(describeConfig(r.config))}.<br>
Chi phí: ${escHtml(r.costs.execution)}; ${escHtml(r.costs.spread)}; phí ${r.costs.commissionPerLotRoundTurn} USD/lot khứ hồi; trượt giá ${r.costs.slippagePrice}.</p>
<div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${escHtml(k)}</div><div class="v">${escHtml(v)}</div></div>`).join("")}</div>
<h2>Nhận định</h2><ul>${r.verdict.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul>
<h2>Đường vốn</h2>${equitySvg(r.equity)}
<h2>Tổng quan</h2>${htmlTable(overview)}
<h2>BUY / SELL</h2>${htmlTable(Object.entries(r.bySide).map(([k, m]) => cells(k, m)))}
<h2>Theo chiến lược và chiều</h2>${htmlTable(Object.entries(r.byStrategySide).map(([k, m]) => cells(k, m)))}
<h2>Theo regime</h2>${htmlTable(Object.entries(r.byRegime).map(([k, m]) => cells(k, m)))}
<h2>Theo tháng</h2>${htmlTable(Object.entries(r.byMonth).map(([k, m]) => cells(k, m)))}
<h2>Lý do đóng lệnh</h2><ul>${Object.entries(r.exitReasons).map(([k, v]) => `<li>${escHtml(k)}: ${v}</li>`).join("") || "<li>(không có lệnh)</li>"}</ul>
<h2>Không mô phỏng</h2><ul>${r.notModelled.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul>
<p class="muted">Tạo lúc ${escHtml(r.generatedAt)}. Danh sách lệnh chi tiết: trades.csv cùng thư mục.</p>
</body></html>
`;
}
