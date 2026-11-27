// Backtest page — request validation, result shape and offline guard (synthetic bars, no MT5, no orders).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { BASELINE_CONFIG } from "./phase7c-management-sim.mjs";
import { isBaselineManagement } from "./phase7c-backtest.mjs";
import { RESEARCH_NOTICE, WEB_DEFAULT_REQUEST, downsample, jsonSafe, resolveWebRequest, runWebBacktest } from "./phase7c-backtest-web.mjs";
import { saveCache } from "./phase7c-replay-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 0, 5, 1, 0);
const M5 = 5 * 60_000;
const flat = (p) => [p, p, p, p];

// BUY that reaches +10.5 then drops (partial + runner), then a SELL that is stopped out.
function world() {
  const path5 = [
    flat(2000), flat(2000), flat(2000),
    [2000, 2010.5, 1999, 2010], [2010, 2010, 1985, 1985], flat(1985),
    flat(1985), flat(1985), flat(1985),
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
    version: 1, m15Count: m15.length, m5Count: m5.length, firstM15: m15[0].openTime, lastM15: m15.at(-1).openTime,
    regimes: m15.map(() => ({ regime: "TRENDING", confidence: 80, recommendedMode: "TREND", atr: 5, range: null })),
    m15St: m15.map((_, k) => sideAt(k)),
    m5St: m5.map((_, j) => sideAt(Math.floor(j / 3))),
    ma20: m15.map(() => null),
    ma50: m15.map(() => null),
    trendSignals: m15.map((_, k) => (k === 0 ? { side: "BUY", pattern: "ENGULFING", patternExtreme: 1991 } : k === 2 ? { side: "SELL", pattern: "ENGULFING", patternExtreme: 1994 } : null)),
  };
  return { m5, m15, pre };
}

const noCost = { lot: 0.03, strategies: ["TREND"], costs: { commissionPerLot: 0, slippagePrice: 0 } };

test("empty request = running Phase 7C management (BE +6 → entry, SL 6–10, TP off, 1/3 at +10, FastMove 10/10, TREND lot 0.12)", () => {
  const o = resolveWebRequest({});
  assert.equal(o.config.breakEvenEnabled, true);
  assert.equal(o.config.breakEvenTriggerPrice, 6);
  assert.equal(o.config.breakEvenOffsetPrice, 0);
  assert.equal(o.config.maxInitialStopPrice, 10);
  assert.equal(o.config.fixedTpPrice, null);
  assert.equal(o.config.partialEnabled, true);
  assert.equal(o.config.partialTriggerPrice, 10);
  assert.equal(o.config.partialFraction, 1 / 3);
  assert.equal(o.config.fastMoveActivationPrice, 10);
  assert.equal(o.config.fastMoveGivebackPrice, 10);
  assert.equal(o.config.volume, 0.12);
  assert.deepEqual(o.config.strategies, ["TREND", "SIDEWAY"]);
  assert.equal(isBaselineManagement(o.config), true);
  assert.deepEqual(resolveWebRequest(WEB_DEFAULT_REQUEST).config, o.config);
  // Every toggle switched away from the default counts as "not the baseline"
  for (const body of [
    { breakEven: { enabled: false } }, { fixedTp: { enabled: true } }, { partial: { enabled: false } },
    { partial: { fraction: "1/2" } }, { fastMove: { enabled: false } }, { m5Trail: { enabled: false } },
    { runnerExits: { enabled: false } }, { maxInitialStopPrice: 12 },
  ]) assert.equal(isBaselineManagement(resolveWebRequest(body).config), false, JSON.stringify(body));
});

test("validation refuses unknown keys and out-of-range values", () => {
  const bad = [
    null, [], { live: true }, { botMode: "AUTO" }, { breakEven: { enabled: true, arm: true } },
    { breakEven: { triggerPrice: 3 } }, { breakEven: { triggerPrice: 6, offsetPrice: 6 } }, { breakEven: { offsetPrice: 4 } },
    { breakEven: { enabled: "yes" } }, { maxInitialStopPrice: 25 }, { fixedTp: { enabled: true, price: 2 } },
    { partial: { fraction: "2/3" } }, { partial: { triggerPrice: 50 } }, { fastMove: { givebackPrice: 1 } },
    { lot: 0.125 }, { lot: 5 }, { strategies: [] }, { strategies: ["REVERSAL"] }, { strategies: "TREND" },
    { from: "2026-05-01", to: "2026-04-01" }, { from: "01/05/2026" }, { costs: { slippagePrice: 9 } },
  ];
  for (const body of bad) assert.throws(() => resolveWebRequest(body), undefined, JSON.stringify(body));
  assert.equal(resolveWebRequest({ fixedTp: { enabled: false, price: 30 } }).config.fixedTpPrice, null);
  assert.equal(resolveWebRequest({ fixedTp: { enabled: true, price: 30 } }).config.fixedTpPrice, 30);
  assert.deepEqual(resolveWebRequest({ strategies: ["sideway", "TREND"] }).config.strategies, ["TREND", "SIDEWAY"]);
  assert.equal(resolveWebRequest({ breakEven: { triggerPrice: "8,5" } }).config.breakEvenTriggerPrice, 8.5);
});

test("result has PF, expectancy, drawdown USD/R, BUY/SELL split, halves, research notice", () => {
  const r = runWebBacktest({ ...world(), body: noCost });
  assert.equal(r.kind, "phase7c-web-backtest");
  assert.match(r.safety, /không gửi\/sửa\/đóng lệnh/);
  assert.equal(r.isBaseline, true);
  assert.equal(r.baseline, null);
  assert.equal(r.summary.trades, 2);
  assert.deepEqual(Object.keys(r.bySide), ["BUY", "SELL"]);
  assert.ok(Math.abs(r.bySide.BUY.netUsd - 11) < 1e-6);
  assert.ok(Math.abs(r.bySide.SELL.netUsd - -30) < 1e-6);
  for (const k of ["profitFactor", "expectancyUsd", "avgR", "winRate", "maxDrawdownUsd", "maxDrawdownR"]) assert.ok(k in r.summary, k);
  assert.equal(r.tradesTotal, 2);
  assert.equal(r.trades[0].side, "SELL", "latest trade first");
  assert.equal(r.equity.length, 2);
  assert.ok(r.halves && r.halves.first.trades === 1 && r.halves.second.trades === 1);
  assert.deepEqual(r.research, RESEARCH_NOTICE);
  assert.match(r.research.overfitWarning, /overfit/);
  assert.ok(r.research.knownOutOfSample.some((s) => s.includes("PF 0,96")));
  assert.ok(r.verdict.some((v) => v.includes("Không dùng để bật LIVE")));
});

test("changed rules are compared against the running baseline on the same data", () => {
  const r = runWebBacktest({ ...world(), body: { ...noCost, fastMove: { enabled: false } } });
  assert.equal(r.isBaseline, false);
  assert.ok(r.baseline);
  assert.ok(Math.abs(r.baseline.summary.netUsd - -19) < 1e-6, JSON.stringify(r.baseline.summary));
  assert.ok(Math.abs(r.summary.netUsd - -20) < 1e-6, JSON.stringify(r.summary)); // runner stays at BE: +10 - 30
  assert.ok(r.baselineEquity.length === 2);
  assert.ok(r.baseline.byStrategy.TREND);
});

test("PF of a run without losses is JSON-safe; downsample keeps the last point", () => {
  assert.deepEqual(jsonSafe({ pf: Infinity, x: 1 }), { pf: null, x: 1 });
  const pts = Array.from({ length: 1000 }, (_, i) => i);
  const d = downsample(pts, 50);
  assert.equal(d.length, 50);
  assert.equal(d.at(-1), 999);
  assert.equal(downsample([1, 2], 50).length, 2);
});

function csv(bars) {
  const d = (ms) => new Date(ms).toISOString();
  return ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>",
    ...bars.map((b) => `${d(b.openTime).slice(0, 10).replaceAll("-", ".")}\t${d(b.openTime).slice(11, 19)}\t${b.open}\t${b.high}\t${b.low}\t${b.close}\t1\t0\t0`)].join("\n");
}

function callWorker(msg) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(here, "phase7c-backtest-worker.mjs"));
    w.once("message", (m) => { w.terminate(); resolve(m); });
    w.once("error", reject);
    w.postMessage({ id: 1, ...msg });
  });
}

test("worker: reads CSV + cache, reports a missing cache, rejects bad input, never writes", async () => {
  // 400+ M15 bars are required: pad a flat history in front of the synthetic world
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btw-"));
  const m5 = Array.from({ length: 1300 }, (_, i) => ({ openTime: T0 + i * M5, closeTime: T0 + (i + 1) * M5, open: 2000, high: 2000, low: 2000, close: 2000 }));
  const m15 = Array.from({ length: 433 }, (_, i) => ({ openTime: T0 + i * 3 * M5, closeTime: T0 + (i + 1) * 3 * M5, open: 2000, high: 2000, low: 2000, close: 2000 }));
  const files = { m5File: path.join(dir, "XAUUSD_M5.csv"), m15File: path.join(dir, "XAUUSD_M15.csv"), cacheFile: path.join(dir, "cache.json") };
  fs.writeFileSync(files.m5File, csv(m5));
  fs.writeFileSync(files.m15File, csv(m15));
  const before = fs.readdirSync(dir).sort();

  const status = await callWorker({ type: "status", ...files });
  assert.equal(status.ok, true);
  assert.equal(status.result.dataset.cacheReady, false);
  assert.equal(status.result.dataset.m15Bars, 433);
  assert.equal(status.result.defaults.breakEven.triggerPrice, 6);
  assert.ok(status.result.limits.breakEvenTriggerPrice);
  const missing = await callWorker({ type: "run", ...files, body: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "CACHE_MISSING");
  assert.deepEqual(fs.readdirSync(dir).sort(), before, "worker wrote nothing");

  saveCache(files.cacheFile, {
    version: 1, m15Count: 433, m5Count: 1300, firstM15: m15[0].openTime, lastM15: m15.at(-1).openTime,
    regimes: m15.map(() => null), m15St: m15.map(() => null), m5St: m5.map(() => null), ma20: m15.map(() => null), ma50: m15.map(() => null), trendSignals: m15.map(() => null),
  });
  const ok = await callWorker({ type: "run", ...files, body: { lot: 0.03 } });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.result.summary.trades, 0);
  const bad = await callWorker({ type: "run", ...files, body: { live: true } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "BAD_REQUEST");
  const noData = await callWorker({ type: "status", ...files, m5File: path.join(dir, "nope.csv") });
  assert.equal(noData.ok, true);
  assert.equal(noData.result.dataset, null);
  assert.equal(noData.result.problem.code, "DATA_MISSING");
  const noDataRun = await callWorker({ type: "run", ...files, m5File: path.join(dir, "nope.csv") });
  assert.equal(noDataRun.code, "DATA_MISSING");
});

test("offline guard: page backtest sources import no broker, network or process-spawning modules", () => {
  const forbidden = /mt5-broker|MetaTrader|node:(net|http|https|dgram|tls|child_process)|from\s+["'](net|http|https|child_process)["']|\bfetch\(|order_send|OrderSend|writeFileSync|\.runtime\/phase7c/;
  for (const f of ["phase7c-backtest-web.mjs", "phase7c-backtest-worker.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(here, f), "utf8"), forbidden, f);
  }
  assert.equal(BASELINE_CONFIG.breakEvenTriggerPrice, 6);
});
