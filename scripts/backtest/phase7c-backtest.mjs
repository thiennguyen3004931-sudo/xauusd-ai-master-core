#!/usr/bin/env node
// Phase 7C backtest mode — chạy lại luật TREND + SIDEWAY trên dữ liệu MT5 lịch sử cho một cấu hình.
//
// AN TOÀN: offline hoàn toàn. Không import broker/MT5, không mở kết nối mạng, không đọc/ghi .runtime của bot
// (chỉ ghi kết quả vào thư mục --out, mặc định .runtime/backtest/ đã nằm trong .gitignore).
//
// Cách dùng (xem docs/operations/phase7c-backtest-mode.md):
//   node scripts/backtest/phase7c-backtest.mjs --m5 XAUUSD_M5.csv --m15 XAUUSD_M15.csv
//        [--from 2026-01-01] [--to 2026-11-01]
//        [--be 6] [--be-offset 0] [--sl-cap 10] [--tp off|20|30|40]
//        [--lot 0.12] [--strategies TREND,SIDEWAY]
//        [--commission 7] [--slippage 0.1] [--min-spread-points 0]
//        [--cache .runtime/backtest/phase7c-replay-cache.json] [--out .runtime/backtest/<thời-gian>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASELINE_CONFIG, simulate } from "./phase7c-management-sim.mjs";
import { M15_MS, M5_MS, loadCache, loadMt5Bars, precomputeReplay, saveCache } from "./phase7c-replay-data.mjs";
import { buildBacktestReport, describeConfig, renderHtml, renderMarkdown, tradesCsv } from "./phase7c-backtest-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STRATEGIES = ["TREND", "SIDEWAY"];
// Production TREND uses a fixed 0.12 lot (PHASE7C-FINAL-RUNTIME-BASELINE.md); R metrics do not depend on lot.
export const DEFAULT_LOT = 0.12;

export const USAGE = `Backtest Phase 7C (offline, không gửi lệnh)

Bắt buộc:
  --m5 <file>            CSV M5 xuất từ MT5 (Export bars)
  --m15 <file>           CSV M15 xuất từ MT5 (cùng khoảng thời gian)
Tuỳ chọn:
  --from YYYY-MM-DD      chỉ tính lệnh vào từ ngày này (giờ server MT5)
  --to YYYY-MM-DD        chỉ tính lệnh vào trước ngày này
  --be <4..15>           ngưỡng hoà vốn, giá (mặc định 6)
  --be-offset <0..3>     SL về entry + offset khi hoà vốn (mặc định 0, phải < --be)
  --sl-cap <6..20>       SL ban đầu tối đa, giá (mặc định 10)
  --tp off|<5..100>      TP cố định, giá (mặc định off)
  --lot <0.01..1>        khối lượng cố định (mặc định ${DEFAULT_LOT} = TREND thật)
  --strategies <list>    TREND,SIDEWAY (mặc định cả hai)
  --commission <usd>     phí USD/lot khứ hồi (mặc định ${BASELINE_CONFIG.commissionPerLotRoundTurn})
  --slippage <giá>       trượt giá mỗi lần khớp thị trường/SL (mặc định ${BASELINE_CONFIG.slippagePrice})
  --min-spread-points <n> spread tối thiểu mỗi nến M5, point (mặc định 0 = dùng spread MT5)
  --cache <file>         cache regime (mặc định .runtime/backtest/phase7c-replay-cache.json)
  --out <thư mục>        nơi ghi report.html, report.md, report.json, trades.csv
`;

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (!a.startsWith("--")) throw new Error(`Tham số không hợp lệ: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Thiếu giá trị cho ${a}`);
    args[a.slice(2)] = value;
    i += 1;
  }
  return args;
}

const KNOWN = new Set(["m5", "m15", "from", "to", "be", "be-offset", "sl-cap", "tp", "lot", "strategies", "commission", "slippage", "min-spread-points", "cache", "out", "help"]);

function num(args, key, fallback, { min, max }) {
  if (args[key] === undefined) return fallback;
  const v = Number(args[key]);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`--${key} phải là số trong khoảng ${min}..${max} (nhận: ${args[key]})`);
  return v;
}

function day(args, key) {
  if (args[key] === undefined) return key === "from" ? -Infinity : Infinity;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args[key])) throw new Error(`--${key} phải có dạng YYYY-MM-DD`);
  const ms = Date.parse(`${args[key]}T00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`--${key} không phải ngày hợp lệ`);
  return ms;
}

/** Validate CLI args into simulator options. Throws with a Vietnamese message on bad input. */
export function resolveOptions(args) {
  for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`Không biết tham số --${k}`);
  if (!args.m5 || !args.m15) throw new Error("Cần cả --m5 và --m15");
  const be = num(args, "be", BASELINE_CONFIG.breakEvenTriggerPrice, { min: 4, max: 15 });
  const beOffset = num(args, "be-offset", BASELINE_CONFIG.breakEvenOffsetPrice, { min: 0, max: 3 });
  if (beOffset >= be) throw new Error("--be-offset phải nhỏ hơn --be");
  const slCap = num(args, "sl-cap", BASELINE_CONFIG.maxInitialStopPrice, { min: BASELINE_CONFIG.minInitialStopPrice, max: 20 });
  let tp = null;
  if (args.tp !== undefined && args.tp.toLowerCase() !== "off") tp = num(args, "tp", null, { min: 5, max: 100 });
  const lot = num(args, "lot", DEFAULT_LOT, { min: 0.01, max: 1 });
  if (Math.abs(lot * 100 - Math.round(lot * 100)) > 1e-9) throw new Error("--lot phải là bội số của 0.01");
  const strategies = args.strategies === undefined ? [...STRATEGIES] : args.strategies.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!strategies.length || strategies.some((s) => !STRATEGIES.includes(s))) throw new Error("--strategies chỉ nhận TREND và/hoặc SIDEWAY");
  const from = day(args, "from");
  const to = day(args, "to");
  if (from >= to) throw new Error("--from phải trước --to");
  const costs = {
    commissionPerLotRoundTurn: num(args, "commission", BASELINE_CONFIG.commissionPerLotRoundTurn, { min: 0, max: 100 }),
    slippagePrice: num(args, "slippage", BASELINE_CONFIG.slippagePrice, { min: 0, max: 5 }),
    minSpreadPoints: num(args, "min-spread-points", 0, { min: 0, max: 500 }),
  };
  const common = { ...costs, volume: Math.round(lot * 100) / 100, strategies };
  return {
    m5File: args.m5,
    m15File: args.m15,
    cacheFile: args.cache ?? path.join(root, ".runtime/backtest/phase7c-replay-cache.json"),
    outDir: args.out ?? path.join(root, ".runtime/backtest", `backtest-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`),
    window: { from, to },
    config: { ...BASELINE_CONFIG, ...common, breakEvenTriggerPrice: be, breakEvenOffsetPrice: beOffset, maxInitialStopPrice: slCap, fixedTpPrice: tp },
    baselineConfig: { ...BASELINE_CONFIG, ...common },
  };
}

const MANAGEMENT_KEYS = ["breakEvenTriggerPrice", "breakEvenOffsetPrice", "maxInitialStopPrice", "fixedTpPrice"];
export const isBaselineManagement = (config) => MANAGEMENT_KEYS.every((k) => config[k] === BASELINE_CONFIG[k]);

export function withMinSpread(bars, minSpreadPoints) {
  if (!(minSpreadPoints > 0)) return bars;
  return bars.map((b) => (b.spreadPoints >= minSpreadPoints ? b : { ...b, spreadPoints: minSpreadPoints }));
}

/** Pure core: run the tested config (and the frozen baseline for comparison) and build the report. */
export function runBacktest({ m5, m15, pre, options }) {
  const m5Exec = withMinSpread(m5, options.config.minSpreadPoints);
  const { from, to } = options.window;
  const trades = simulate({ m15, m5: m5Exec, pre, config: options.config, from, to });
  const baselineTrades = isBaselineManagement(options.config) ? null : simulate({ m15, m5: m5Exec, pre, config: options.baselineConfig, from, to });
  const report = buildBacktestReport({
    trades,
    config: options.config,
    baselineTrades,
    data: { m5Bars: m5.length, m15Bars: m15.length, from: m5[0].openTime, to: m5.at(-1).closeTime },
    window: Number.isFinite(from) || Number.isFinite(to) ? { from, to } : null,
  });
  return { report, trades };
}

export function writeOutputs(outDir, { report, trades }) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    html: path.join(outDir, "report.html"),
    md: path.join(outDir, "report.md"),
    json: path.join(outDir, "report.json"),
    csv: path.join(outDir, "trades.csv"),
  };
  fs.writeFileSync(files.html, renderHtml(report));
  fs.writeFileSync(files.md, renderMarkdown(report));
  fs.writeFileSync(files.json, JSON.stringify(report, null, 2));
  fs.writeFileSync(files.csv, tradesCsv(trades));
  return files;
}

const REQUIRED_PACKAGES = ["analysis-engine", "indicators", "strategy-engine", "market-data", "risk-engine"];

async function main() {
  let options;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(USAGE); return; }
    options = resolveOptions(args);
  } catch (error) {
    console.error(`LỖI: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  for (const f of [options.m5File, options.m15File]) {
    if (!fs.existsSync(f)) { console.error(`LỖI: không tìm thấy file ${f}`); process.exitCode = 2; return; }
  }
  const m5 = loadMt5Bars(options.m5File, M5_MS);
  const m15 = loadMt5Bars(options.m15File, M15_MS);
  if (m5.length < 100 || m15.length < 400) {
    console.error(`LỖI: dữ liệu quá ít (${m5.length} nến M5, ${m15.length} nến M15). Cần ít nhất 400 nến M15 (regime dùng 320 nến).`);
    process.exitCode = 2;
    return;
  }
  let pre = loadCache(options.cacheFile, m15, m5);
  if (!pre) {
    const missing = REQUIRED_PACKAGES.filter((p) => !fs.existsSync(path.join(root, "packages", p, "dist", "index.js")));
    if (missing.length) {
      console.error(`LỖI: chưa build package: ${missing.join(", ")}. Chạy "pnpm install" rồi "pnpm build" ở thư mục repo một lần.`);
      process.exitCode = 2;
      return;
    }
    console.error(`Đang tính regime cho ${m15.length} nến M15 (lần đầu, sẽ cache lại)...`);
    pre = await precomputeReplay({ m15, m5, onProgress: (i, n) => console.error(`  ${i}/${n}`) });
    saveCache(options.cacheFile, pre);
  }
  const result = runBacktest({ m5, m15, pre, options });
  const files = writeOutputs(options.outDir, result);
  const s = result.report.summary;
  const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞";
  console.log([
    `Cấu hình: ${describeConfig(result.report.config)}`,
    `Lệnh ${s.trades} · thắng ${(s.winRate * 100).toFixed(1)}% · PF ${pf} · ròng ${s.netUsd.toFixed(2)} USD · kỳ vọng ${s.expectancyUsd.toFixed(2)} USD (${s.avgR.toFixed(3)} R) · max DD ${s.maxDrawdownUsd.toFixed(2)} USD / ${s.maxDrawdownR.toFixed(2)} R`,
    ...Object.entries(result.report.bySide).map(([k, m]) => `  ${k}: ${m.trades} lệnh · PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"} · ròng ${m.netUsd.toFixed(2)} USD`),
    ...result.report.verdict.map((n) => `- ${n}`),
    `Báo cáo: ${files.html}`,
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
