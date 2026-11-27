#!/usr/bin/env node
// Feature 2 — one top-down H4 -> H1 -> M15 analysis with 1-2 scenarios and three annotated charts.
// Offline and read-only: reads MT5 CSV exports, writes to --out (default .runtime/market-intel/mtf/<time>).
//
//   node scripts/market-intel/mtf-scenario.mjs --h4 H4.csv --h1 H1.csv --m15 M15.csv [--at "2026-11-20 14:00"] [--out dir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { H1_MS, H4_MS, M15_MS, buildScenarios, renderScenarioCharts } from "../../packages/market-intel/src/index.mjs";
import { loadMt5Bars } from "../backtest/phase7c-replay-data.mjs";
import { parseArgs } from "./regime-library-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const DIR = { BUY: "MUA", SELL: "BÁN" };
const STATE = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };
const PHASE = { PHA_HOI: "pha hồi", PHA_DAY: "pha đẩy", KHONG_RO: "chưa rõ" };
const M15 = { TRIGGERED: "đã có tín hiệu", TOUCHED_NO_TRIGGER: "đã chạm vùng, chưa có tín hiệu", WAITING: "chưa chạm vùng" };

export function renderMarkdown(r) {
  const lines = [];
  lines.push(`# Phân tích H4 → H1 → M15 · ${fmt(r.asOf)} (giờ server)`, "");
  lines.push("> Chỉ để tham khảo. Không gửi lệnh. Độ tin cậy là điểm theo luật, chưa phải xác suất (xem docs/market-intel/mtf-scenarios.md).", "");
  const lv = (l) => `${l.kind === "SUPPORT" ? "hỗ trợ" : "kháng cự"} ${l.price.toFixed(2)} (${l.touches} chạm)`;
  lines.push(`**H4:** ${STATE[r.h4.state] ?? r.h4.state} (${r.h4.confidence}%), hướng ưu tiên **${r.h4.bias}**. Vùng chính: ${r.h4.keyLevels.slice(0, 4).map(lv).join("; ") || "—"}. Order block còn hiệu lực: ${r.h4.orderBlocks.slice(0, 3).map((o) => `${o.direction === "BULLISH" ? "tăng" : "giảm"} ${o.low.toFixed(2)}–${o.high.toFixed(2)}`).join("; ") || "—"}.`, "");
  lines.push(`**H1:** ${STATE[r.h1.state] ?? r.h1.state} (${r.h1.confidence}%), ${r.h1.agreement === "AGREE" ? "đồng thuận H4" : r.h1.agreement === "DISAGREE" ? "ngược H4" : "trung tính"}, ${PHASE[r.h1.phase] ?? r.h1.phase}.`, "");
  lines.push(`**M15:** giá ${r.m15.close.toFixed(2)}.`, "");
  for (const n of r.notes) lines.push(`- ${n}`);
  for (const s of r.scenarios) {
    lines.push("", `## ${s.role === "PRIMARY" ? "Kịch bản chính" : "Kịch bản thay thế"}: ${DIR[s.direction]} · tin cậy ${s.confidence}%`, "");
    lines.push("| Mục | Giá trị |", "|---|---|");
    lines.push(`| Vùng vào | ${s.entryZone.low}–${s.entryZone.high} (${s.entryZone.sources.join(" + ")}) |`);
    lines.push(`| Entry tham chiếu | ${s.entry} |`, `| SL | ${s.stopLoss} (cách ${s.botStopRule.stopDistance} giá; ${s.botStopRule.note}) |`);
    lines.push(`| TP1 | ${s.takeProfit1} (${s.targetsSource.tp1}) · R:R ${s.rr1} |`, `| TP2 | ${s.takeProfit2} (${s.targetsSource.tp2}) · R:R ${s.rr2} |`);
    lines.push(`| Mất hiệu lực | ${s.invalidation.text} |`, `| M15 | ${M15[s.m15.status]} |`, "");
    lines.push("Điểm tin cậy:", "");
    for (const f of s.confidenceBreakdown) lines.push(`- ${f.points >= 0 ? "+" : ""}${f.points}: ${f.factor}`);
  }
  return lines.join("\n") + "\n";
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.m15 || !args.h1 || !args.h4) {
    console.log('Usage: --h4 <file> --h1 <file> --m15 <file> [--at "YYYY-MM-DD HH:MM"] [--out dir]');
    return 2;
  }
  const m15 = loadMt5Bars(path.resolve(args.m15), M15_MS);
  const h1 = loadMt5Bars(path.resolve(args.h1), H1_MS);
  const h4 = loadMt5Bars(path.resolve(args.h4), H4_MS);
  const asOf = args.at ? Date.parse(`${args.at.replace(" ", "T")}Z`) : undefined;
  const result = buildScenarios({ h4, h1, m15, asOf });
  const outDir = path.resolve(root, args.out ?? `.runtime/market-intel/mtf/${fmt(result.asOf).replace(/[ :]/g, "-")}`);
  fs.mkdirSync(outDir, { recursive: true });
  const charts = renderScenarioCharts({ h4, h1, m15 }, result);
  for (const [k, svg] of Object.entries(charts)) fs.writeFileSync(path.join(outDir, `${k}.svg`), svg);
  fs.writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "analysis.md"), renderMarkdown(result));
  console.log(`MTF_ANALYSIS=${outDir}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
