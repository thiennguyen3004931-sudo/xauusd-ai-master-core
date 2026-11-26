// Phase 7C backtest mode — CLI validation, report contents and offline-only guard (synthetic bars, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASELINE_CONFIG } from "./phase7c-management-sim.mjs";
import { DEFAULT_LOT, isBaselineManagement, parseArgs, resolveOptions, runBacktest, withMinSpread, writeOutputs } from "./phase7c-backtest.mjs";
import { renderHtml, renderMarkdown, tradesCsv, verdict } from "./phase7c-backtest-report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 0, 5, 1, 0);
const M5 = 5 * 60_000;
const flat = (p) => [p, p, p, p];

// Two TREND signals: a BUY that hits +10 then the runner is stopped, and a SELL that is stopped out.
function world() {
  const path5 = [
    flat(2000), flat(2000), flat(2000), // M15 #0 -> BUY signal (extreme 1991 -> stop 1990)
    [2000, 2010.5, 1999, 2010], [2010, 2010, 1985, 1985], flat(1985), // partial +10, runner stopped
    flat(1985), flat(1985), flat(1985), // M15 #2 -> SELL signal (extreme 1994 -> stop 1995)
    [1985, 1996, 1984, 1995], flat(1995), flat(1995),
  ];
  const m5 = path5.map(([open, high, low, close], i) => ({
    openTime: T0 + i * M5, closeTime: T0 + (i + 1) * M5, open, high, low, close, tickVolume: 1, spreadPoints: 0,
  }));
  const m15 = [];
  for (let i = 0; i + 2 < m5.length; i += 3) {
    const b = m5.slice(i, i + 3);
    m15.push({ openTime: b[0].openTime, closeTime: b[2].closeTime, open: b[0].open, high: Math.max(...b.map((x) => x.high)), low: Math.min(...b.map((x) => x.low)), close: b[2].close, tickVolume: 3, spreadPoints: 0 });
  }
  const sideAt = (k) => (k < 2 ? "BUY" : "SELL");
  const pre = {
    regimes: m15.map(() => ({ regime: "TRENDING", confidence: 80, recommendedMode: "TREND", atr: 5, range: null })),
    m15St: m15.map((_, k) => sideAt(k)),
    m5St: m5.map((_, j) => sideAt(Math.floor(j / 3))),
    ma20: m15.map(() => null),
    ma50: m15.map(() => null),
    trendSignals: m15.map((_, k) => (k === 0 ? { side: "BUY", pattern: "ENGULFING", patternExtreme: 1991 } : k === 2 ? { side: "SELL", pattern: "ENGULFING", patternExtreme: 1994 } : null)),
  };
  return { m5, m15, pre };
}

const opts = (extra = []) => resolveOptions(parseArgs(["--m5", "a.csv", "--m15", "b.csv", "--commission", "0", "--slippage", "0", "--strategies", "TREND", ...extra]));

test("defaults keep the frozen Phase 7C management (BE +6 -> entry, SL cap 10, TP off) at the TREND lot", () => {
  const o = resolveOptions(parseArgs(["--m5", "a.csv", "--m15", "b.csv"]));
  assert.equal(o.config.breakEvenTriggerPrice, 6);
  assert.equal(o.config.breakEvenOffsetPrice, 0);
  assert.equal(o.config.maxInitialStopPrice, 10);
  assert.equal(o.config.fixedTpPrice, null);
  assert.equal(o.config.volume, DEFAULT_LOT);
  assert.deepEqual(o.config.strategies, ["TREND", "SIDEWAY"]);
  assert.equal(o.config.commissionPerLotRoundTurn, BASELINE_CONFIG.commissionPerLotRoundTurn);
  assert.equal(o.config.slippagePrice, BASELINE_CONFIG.slippagePrice);
  assert.equal(isBaselineManagement(o.config), true);
});

test("argument validation rejects unsafe or ambiguous input", () => {
  const bad = [
    [],
    ["--m5", "a.csv"],
    ["--m5", "a.csv", "--m15", "b.csv", "--be", "3"],
    ["--m5", "a.csv", "--m15", "b.csv", "--be", "6", "--be-offset", "6"],
    ["--m5", "a.csv", "--m15", "b.csv", "--be-offset", "4"],
    ["--m5", "a.csv", "--m15", "b.csv", "--sl-cap", "25"],
    ["--m5", "a.csv", "--m15", "b.csv", "--tp", "2"],
    ["--m5", "a.csv", "--m15", "b.csv", "--lot", "0.125"],
    ["--m5", "a.csv", "--m15", "b.csv", "--strategies", "REVERSAL"],
    ["--m5", "a.csv", "--m15", "b.csv", "--from", "2026-05-01", "--to", "2026-04-01"],
    ["--m5", "a.csv", "--m15", "b.csv", "--from", "01/05/2026"],
    ["--m5", "a.csv", "--m15", "b.csv", "--live", "true"],
  ];
  for (const argv of bad) assert.throws(() => resolveOptions(parseArgs(argv)), undefined, argv.join(" "));
  assert.throws(() => parseArgs(["--be"]));
  assert.equal(opts(["--tp", "OFF"]).config.fixedTpPrice, null);
  assert.equal(opts(["--tp", "30"]).config.fixedTpPrice, 30);
});

test("report has PF, expectancy, drawdown USD/R, win rate, trade count and BUY/SELL split", () => {
  const w = world();
  const { report, trades } = runBacktest({ ...w, options: opts(["--lot", "0.03"]) });
  assert.equal(trades.length, 2);
  assert.deepEqual(Object.keys(report.bySide), ["BUY", "SELL"]);
  // BUY: partial 0.01 x +10 = +10, runner stopped at FastMove 2000.5 -> +1 => +11. SELL: stop 10 away => -30.
  assert.ok(Math.abs(report.bySide.BUY.netUsd - 11) < 1e-6, JSON.stringify(report.bySide));
  assert.ok(Math.abs(report.bySide.SELL.netUsd - -30) < 1e-6, JSON.stringify(report.bySide));
  const s = report.summary;
  for (const k of ["trades", "winRate", "profitFactor", "expectancyUsd", "avgR", "maxDrawdownUsd", "maxDrawdownR", "netUsd"]) assert.ok(k in s, k);
  assert.equal(s.trades, 2);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.maxDrawdownUsd, 30);
  assert.equal(report.baseline, null); // tested config IS the baseline
  assert.equal(report.equity.length, 2);
  assert.match(report.safety, /không gửi\/sửa\/đóng lệnh/);
});

test("lot scales USD but not R; a changed config is compared against the baseline", () => {
  const w = world();
  const small = runBacktest({ ...w, options: opts(["--lot", "0.03"]) }).report.summary;
  const big = runBacktest({ ...w, options: opts(["--lot", "0.12"]) }).report.summary;
  assert.ok(Math.abs(big.netUsd - small.netUsd * 4) < 1e-6);
  assert.equal(big.avgR, small.avgR);
  const changed = runBacktest({ ...w, options: opts(["--lot", "0.03", "--be", "8"]) }).report;
  assert.ok(changed.baseline, "baseline comparison present when management differs");
  assert.equal(changed.baseline.summary.trades, 2);
});

test("date window filters entries; min spread makes results no better", () => {
  const w = world();
  const onlyFirst = runBacktest({ ...w, options: { ...opts(["--lot", "0.03"]), window: { from: -Infinity, to: T0 + 6 * M5 } } }).report;
  assert.equal(onlyFirst.summary.trades, 1);
  assert.equal(withMinSpread(w.m5, 0), w.m5);
  assert.ok(withMinSpread(w.m5, 30).every((b) => b.spreadPoints === 30));
  const plain = runBacktest({ ...w, options: opts(["--lot", "0.03"]) }).report.summary.netUsd;
  const wide = runBacktest({ ...w, options: opts(["--lot", "0.03", "--min-spread-points", "30"]) }).report.summary.netUsd;
  assert.ok(wide <= plain + 1e-9, `${wide} > ${plain}`);
});

test("verdict never claims profit and flags small samples", () => {
  const v = verdict({ trades: 12, profitFactor: 2.5, expectancyUsd: 5 });
  assert.ok(v.some((n) => n.includes("< 30")));
  assert.ok(v.some((n) => n.includes("Không dùng để bật LIVE")));
  assert.ok(verdict({ trades: 50, profitFactor: 0.8, expectancyUsd: -1 }).some((n) => n.includes("lỗ")));
});

test("renderers: HTML is self-contained and escaped, Markdown has the tables, CSV has one row per trade", () => {
  const w = world();
  const result = runBacktest({ ...w, options: opts(["--lot", "0.03", "--be", "8"]) });
  const html = renderHtml(result.report);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\//, "no external resources");
  assert.match(html, /BUY \/ SELL/);
  assert.match(html, /Baseline Phase 7C/);
  const md = renderMarkdown(result.report);
  assert.match(md, /## BUY \/ SELL/);
  assert.match(md, /Max DD R/);
  const csv = tradesCsv(result.trades).trim().split("\n");
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^strategy,side,regime,entryTime/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-"));
  const files = writeOutputs(dir, result);
  for (const f of Object.values(files)) assert.ok(fs.statSync(f).size > 0, f);
});

test("offline guard: backtest sources import no broker, network or process-spawning modules", () => {
  const forbidden = /mt5-broker|MetaTrader|node:(net|http|https|dgram|tls|child_process)|from\s+["'](net|http|https|child_process)["']|\bfetch\(|order_send|OrderSend/;
  for (const f of ["phase7c-backtest.mjs", "phase7c-backtest-report.mjs", "phase7c-management-sim.mjs", "phase7c-replay-data.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(here, f), "utf8"), forbidden, f);
  }
});

test("CLI: --help works and bad input exits 2 without writing anything", () => {
  const cli = path.join(here, "phase7c-backtest.mjs");
  assert.match(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }), /offline, không gửi lệnh/);
  let code = 0;
  try {
    execFileSync(process.execPath, [cli, "--m5", "missing.csv"], { stdio: "pipe" });
  } catch (error) {
    code = error.status;
  }
  assert.equal(code, 2);
});
