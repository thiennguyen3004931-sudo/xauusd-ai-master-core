#!/usr/bin/env node
// Render the T3/T4 sweep JSON into markdown tables (Vietnamese labels).
// usage: node scripts/backtest/phase7c-sweep-report.mjs <sweep.json>  > tables.md
import fs from "node:fs";

const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
const usd = (x) => (x >= 0 ? "+" : "") + x.toFixed(0);
const row = (label, m) => `| ${label} | ${m.trades} | ${pf(m.profitFactor)} | ${usd(m.netUsd)} | ${m.expectancyUsd.toFixed(2)} | ${m.avgR.toFixed(3)} | ${(m.winRate * 100).toFixed(0)}% | ${m.maxDrawdownUsd.toFixed(0)} | ${m.maxDrawdownR.toFixed(1)} |`;
const head = "| | Lệnh | PF | Lãi/lỗ USD | Kỳ vọng USD/lệnh | R TB | Thắng | Max DD USD | Max DD R |\n|---|---|---|---|---|---|---|---|---|";
const out = [];

out.push(`Dữ liệu: ${r.data.m5Bars} nến M5, ${r.data.m15Bars} nến M15, ${r.data.from} → ${r.data.to} (giờ server MT5).`);
out.push(`In-sample: ${r.windows.inSample.join(" → ")} · Out-of-sample: ${r.windows.outOfSample.join(" → ")}.`);
out.push("");
out.push("### Cấu hình hiện tại (BE 6 / offset 0 / SL tối đa 10 / TP cố định tắt)");
out.push(head);
out.push(row("Cả 12 tháng", r.baseline.full));
out.push(row("In-sample", r.baseline.inSample));
out.push(row("Out-of-sample", r.baseline.outOfSample));
out.push("");
out.push("Lý do đóng lệnh (12 tháng): " + Object.entries(r.baseline.exitReasons).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
out.push("");
out.push("### Out-of-sample tách theo chiều, chiến lược, regime — cấu hình hiện tại");
out.push(head);
for (const [g, m] of Object.entries(r.baseline.outOfSampleBreakdown)) out.push(row(g, m));
out.push("");
if (r.candidate) {
  out.push(`### Ứng viên chọn trên in-sample: ${r.candidate.key} (PF trung vị vùng lân cận ${r.candidate.inSampleNeighbourMedianPf})`);
  out.push(head);
  out.push(row("In-sample", r.candidate.inSample));
  out.push(row("Out-of-sample", r.candidate.outOfSample));
  for (const [g, m] of Object.entries(r.candidate.outOfSampleBreakdown)) out.push(row(`OOS ${g}`, m));
  out.push("");
}
out.push("### Walk-forward 6 fold (anchored: train từ đầu dữ liệu tới hết block trước, test block kế tiếp)");
out.push("| Fold | Test | Chọn trên train | WF test: lệnh / PF / USD | Hiện tại: PF / USD | Ứng viên: PF / USD |\n|---|---|---|---|---|---|");
for (const f of r.walkForward) {
  const w = f.walkForwardTest;
  out.push(`| ${f.fold} | ${f.test.join(" → ")} | ${f.selectedOnTrain ?? "—"} | ${w ? `${w.trades} / ${pf(w.profitFactor)} / ${usd(w.netUsd)}` : "—"} | ${pf(f.baselineTest.profitFactor)} / ${usd(f.baselineTest.netUsd)} | ${f.candidateTest ? `${pf(f.candidateTest.profitFactor)} / ${usd(f.candidateTest.netUsd)}` : "—"} |`);
}
out.push("");
out.push("### Toàn bộ 108 cấu hình (sắp theo PF out-of-sample)");
out.push("| Cấu hình | IS lệnh | IS PF | IS USD | OOS lệnh | OOS PF | OOS USD | OOS kỳ vọng | OOS Max DD USD |\n|---|---|---|---|---|---|---|---|---|");
for (const t of [...r.table].sort((a, b) => b.outOfSample.profitFactor - a.outOfSample.profitFactor)) {
  out.push(`| ${t.key} | ${t.inSample.trades} | ${pf(t.inSample.profitFactor)} | ${usd(t.inSample.netUsd)} | ${t.outOfSample.trades} | ${pf(t.outOfSample.profitFactor)} | ${usd(t.outOfSample.netUsd)} | ${t.outOfSample.expectancyUsd.toFixed(2)} | ${t.outOfSample.maxDrawdownUsd.toFixed(0)} |`);
}
out.push("");
out.push("### Ngưỡng chấp nhận của phiếu giao việc (ứng viên)");
const a = r.acceptance;
if (a?.checks) for (const [k, v] of Object.entries(a.checks)) out.push(`- ${v ? "ĐẠT" : "KHÔNG ĐẠT"}: ${k}`);
out.push(`- Fold walk-forward dương: ${a?.positiveFolds ?? 0}/6`);
out.push(`- **Kết luận: ${a?.pass ? "ĐẠT — có thể đề xuất DEMO" : "KHÔNG ĐẠT — không đề xuất đổi cấu hình"}**`);
console.log(out.join("\n"));
