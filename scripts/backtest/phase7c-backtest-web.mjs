// Phase 7C backtest page — request validation and result shaping for the web "Backtest" page.
//
// AN TOÀN: pure functions, offline. No broker, no network, no runtime state, no orders. The API runs this in a
// worker thread on CSV files exported from MT5 (see phase7c-backtest-worker.mjs). Nothing here can change
// BOT_MODE, LIVE ARM, lot settings or the running bot: it only replays history with the chosen rules.
import { BASELINE_CONFIG, metrics, simulate } from "./phase7c-management-sim.mjs";
import { buildBacktestReport } from "./phase7c-backtest-report.mjs";
import { DEFAULT_LOT, isBaselineManagement, withMinSpread } from "./phase7c-backtest.mjs";

const STRATEGIES = ["TREND", "SIDEWAY"];
const FRACTIONS = { "1/4": 0.25, "1/3": 1 / 3, "1/2": 0.5 };

/** Request that reproduces the running Phase 7C management (PHASE7C-FINAL-RUNTIME-BASELINE.md). */
export const WEB_DEFAULT_REQUEST = Object.freeze({
  strategies: ["TREND", "SIDEWAY"],
  from: null,
  to: null,
  lot: DEFAULT_LOT,
  maxInitialStopPrice: BASELINE_CONFIG.maxInitialStopPrice,
  breakEven: { enabled: true, triggerPrice: BASELINE_CONFIG.breakEvenTriggerPrice, offsetPrice: BASELINE_CONFIG.breakEvenOffsetPrice },
  fixedTp: { enabled: false, price: 30 },
  partial: { enabled: true, triggerPrice: BASELINE_CONFIG.partialTriggerPrice, fraction: "1/3" },
  fastMove: { enabled: true, activationPrice: BASELINE_CONFIG.fastMoveActivationPrice, givebackPrice: BASELINE_CONFIG.fastMoveGivebackPrice },
  m5Trail: { enabled: true },
  runnerExits: { enabled: true },
  costs: { commissionPerLot: BASELINE_CONFIG.commissionPerLotRoundTurn, slippagePrice: BASELINE_CONFIG.slippagePrice, minSpreadPoints: 0 },
});

/** Ranges shown on the page and enforced here. */
export const WEB_LIMITS = Object.freeze({
  lot: [0.01, 1],
  maxInitialStopPrice: [BASELINE_CONFIG.minInitialStopPrice, 20],
  breakEvenTriggerPrice: [4, 15],
  breakEvenOffsetPrice: [0, 3],
  fixedTpPrice: [5, 100],
  partialTriggerPrice: [4, 30],
  fastMoveActivationPrice: [4, 30],
  fastMoveGivebackPrice: [2, 30],
  commissionPerLot: [0, 100],
  slippagePrice: [0, 5],
  minSpreadPoints: [0, 500],
});

/**
 * What earlier offline research already found (docs/operations/*report.md). Shown on the page so a good
 * in-sample number is read against the known out-of-sample results.
 */
export const RESEARCH_NOTICE = Object.freeze({
  overfitWarning:
    "Chỉnh tham số rồi xem kết quả trên cùng dữ liệu rất dễ overfit: cấu hình đẹp nhất ở đây thường kém hơn trên dữ liệu chưa xem. Kết quả trang này là mô phỏng, không phải bằng chứng sinh lời và không dùng để bật LIVE.",
  knownOutOfSample: [
    "Kiểm mù 11/2021 → 11/2023 (cổng xu hướng + chỉ TREND): 244 lệnh, PF 0,96, −346 USD, 2/6 block dương. Cấu hình hiện tại trên cùng đoạn: PF 0,83.",
    "Sweep 108 cấu hình BE/offset/trần SL/TP cố định (12 tháng): không cấu hình nào đạt ngưỡng ngoài mẫu (PF > 1,20, ≥ 4/6 fold dương). Ứng viên tốt nhất trong mẫu còn PF 0,95 ngoài mẫu.",
  ],
  acceptance: "Ngưỡng đề xuất DEMO: ≥ 30 lệnh ngoài mẫu, PF > 1,20, kỳ vọng > 0, ≥ 4/6 fold walk-forward dương.",
});

const KNOWN_TOP = new Set(["strategies", "from", "to", "lot", "maxInitialStopPrice", "breakEven", "fixedTp", "partial", "fastMove", "m5Trail", "runnerExits", "costs"]);
const KNOWN_SUB = {
  breakEven: new Set(["enabled", "triggerPrice", "offsetPrice"]),
  fixedTp: new Set(["enabled", "price"]),
  partial: new Set(["enabled", "triggerPrice", "fraction"]),
  fastMove: new Set(["enabled", "activationPrice", "givebackPrice"]),
  m5Trail: new Set(["enabled"]),
  runnerExits: new Set(["enabled"]),
  costs: new Set(["commissionPerLot", "slippagePrice", "minSpreadPoints"]),
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function number(value, fallback, label, [min, max]) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${label} phải là số trong khoảng ${min}–${max} (nhận: ${String(value)})`);
  }
  return v;
}

function bool(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} phải là true/false`);
  return value;
}

function day(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} phải có dạng YYYY-MM-DD`);
  const ms = Date.parse(`${value}T00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`${label} không phải ngày hợp lệ`);
  return value;
}

function section(body, key) {
  const v = body[key];
  if (v === undefined || v === null) return {};
  if (!isObj(v)) throw new Error(`${key} phải là object`);
  for (const k of Object.keys(v)) if (!KNOWN_SUB[key].has(k)) throw new Error(`Không biết tham số ${key}.${k}`);
  return v;
}

/**
 * Validate a page request into simulator options. Unknown keys are refused so a request can never carry
 * anything but replay parameters. Throws an Error with a Vietnamese message on bad input.
 */
export function resolveWebRequest(body = {}) {
  if (!isObj(body)) throw new Error("Yêu cầu backtest phải là object JSON");
  for (const k of Object.keys(body)) if (!KNOWN_TOP.has(k)) throw new Error(`Không biết tham số ${k}`);
  const D = WEB_DEFAULT_REQUEST;
  const L = WEB_LIMITS;

  let strategies = D.strategies;
  if (body.strategies !== undefined) {
    if (!Array.isArray(body.strategies)) throw new Error("strategies phải là danh sách");
    strategies = [...new Set(body.strategies.map((s) => String(s).trim().toUpperCase()))];
    if (!strategies.length || strategies.some((s) => !STRATEGIES.includes(s))) throw new Error("Chỉ chọn TREND và/hoặc SIDEWAY");
    strategies = STRATEGIES.filter((s) => strategies.includes(s));
  }
  const from = day(body.from, "Từ ngày");
  const to = day(body.to, "Đến ngày");
  if (from && to && from >= to) throw new Error("Từ ngày phải trước Đến ngày");

  const lot = number(body.lot, D.lot, "Khối lượng", L.lot);
  if (Math.abs(lot * 100 - Math.round(lot * 100)) > 1e-9) throw new Error("Khối lượng phải là bội số của 0,01");
  const maxInitialStopPrice = number(body.maxInitialStopPrice, D.maxInitialStopPrice, "SL tối đa", L.maxInitialStopPrice);

  const be = section(body, "breakEven");
  const breakEven = {
    enabled: bool(be.enabled, D.breakEven.enabled, "Hoà vốn"),
    triggerPrice: number(be.triggerPrice, D.breakEven.triggerPrice, "Ngưỡng hoà vốn", L.breakEvenTriggerPrice),
    offsetPrice: number(be.offsetPrice, D.breakEven.offsetPrice, "Offset hoà vốn", L.breakEvenOffsetPrice),
  };
  if (breakEven.offsetPrice >= breakEven.triggerPrice) throw new Error("Offset hoà vốn phải nhỏ hơn ngưỡng hoà vốn");

  const tp = section(body, "fixedTp");
  const fixedTp = {
    enabled: bool(tp.enabled, D.fixedTp.enabled, "TP cố định"),
    price: number(tp.price, D.fixedTp.price, "TP cố định", L.fixedTpPrice),
  };

  const pa = section(body, "partial");
  const fraction = pa.fraction === undefined || pa.fraction === null ? D.partial.fraction : String(pa.fraction);
  if (!(fraction in FRACTIONS)) throw new Error("Tỷ lệ chốt một phần chỉ nhận 1/4, 1/3 hoặc 1/2");
  const partial = {
    enabled: bool(pa.enabled, D.partial.enabled, "Chốt một phần"),
    triggerPrice: number(pa.triggerPrice, D.partial.triggerPrice, "Ngưỡng chốt một phần", L.partialTriggerPrice),
    fraction,
  };

  const fm = section(body, "fastMove");
  const fastMove = {
    enabled: bool(fm.enabled, D.fastMove.enabled, "FastMove"),
    activationPrice: number(fm.activationPrice, D.fastMove.activationPrice, "FastMove kích hoạt", L.fastMoveActivationPrice),
    givebackPrice: number(fm.givebackPrice, D.fastMove.givebackPrice, "FastMove khoảng lùi", L.fastMoveGivebackPrice),
  };
  const m5Trail = { enabled: bool(section(body, "m5Trail").enabled, D.m5Trail.enabled, "Dời SL theo cấu trúc M5") };
  const runnerExits = { enabled: bool(section(body, "runnerExits").enabled, D.runnerExits.enabled, "Thoát phần còn lại theo FVG/MA50") };

  const c = section(body, "costs");
  const costs = {
    commissionPerLot: number(c.commissionPerLot, D.costs.commissionPerLot, "Phí", L.commissionPerLot),
    slippagePrice: number(c.slippagePrice, D.costs.slippagePrice, "Trượt giá", L.slippagePrice),
    minSpreadPoints: number(c.minSpreadPoints, D.costs.minSpreadPoints, "Spread tối thiểu", L.minSpreadPoints),
  };

  const request = { strategies, from, to, lot, maxInitialStopPrice, breakEven, fixedTp, partial, fastMove, m5Trail, runnerExits, costs };
  const common = {
    volume: Math.round(lot * 100) / 100,
    strategies,
    commissionPerLotRoundTurn: costs.commissionPerLot,
    slippagePrice: costs.slippagePrice,
    minSpreadPoints: costs.minSpreadPoints,
  };
  const config = {
    ...BASELINE_CONFIG,
    ...common,
    maxInitialStopPrice,
    breakEvenEnabled: breakEven.enabled,
    breakEvenTriggerPrice: breakEven.triggerPrice,
    breakEvenOffsetPrice: breakEven.offsetPrice,
    fixedTpPrice: fixedTp.enabled ? fixedTp.price : null,
    partialEnabled: partial.enabled,
    partialTriggerPrice: partial.triggerPrice,
    partialFraction: FRACTIONS[partial.fraction],
    fastMoveEnabled: fastMove.enabled,
    fastMoveActivationPrice: fastMove.activationPrice,
    fastMoveGivebackPrice: fastMove.givebackPrice,
    m5TrailEnabled: m5Trail.enabled,
    runnerExitsEnabled: runnerExits.enabled,
  };
  return {
    request,
    config,
    baselineConfig: { ...BASELINE_CONFIG, ...common },
    window: { from: from ? Date.parse(`${from}T00:00Z`) : -Infinity, to: to ? Date.parse(`${to}T00:00Z`) : Infinity },
  };
}

/** Keep at most `max` points, always including the last one. */
export function downsample(points, max = 300) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points.at(-1));
  return out;
}

const finite = (v) => (typeof v === "number" && !Number.isFinite(v) ? null : v);
/** JSON has no Infinity: PF of a run without losses becomes null (shown as ∞). */
export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, v) => finite(v)));
}

function halves(trades) {
  if (trades.length < 2) return null;
  const mid = Math.floor(trades.length / 2);
  return {
    splitAt: new Date(trades[mid].entryTime).toISOString().slice(0, 10),
    first: metrics(trades.slice(0, mid)),
    second: metrics(trades.slice(mid)),
  };
}

const MAX_TRADES = 300;

/** Run the requested rules (and, when they differ, the running baseline) on the loaded history. */
export function runWebBacktest({ m5, m15, pre, body }) {
  const opts = resolveWebRequest(body);
  const m5Exec = withMinSpread(m5, opts.config.minSpreadPoints);
  const { from, to } = opts.window;
  const started = Date.now();
  const trades = simulate({ m15, m5: m5Exec, pre, config: opts.config, from, to });
  const isBaseline = isBaselineManagement(opts.config);
  const baselineTrades = isBaseline ? null : simulate({ m15, m5: m5Exec, pre, config: opts.baselineConfig, from, to });
  const report = buildBacktestReport({
    trades,
    config: opts.config,
    baselineTrades,
    data: { m5Bars: m5.length, m15Bars: m15.length, from: m5[0].openTime, to: m5.at(-1).closeTime },
    window: Number.isFinite(from) || Number.isFinite(to) ? { from, to } : null,
  });
  const point = (e) => ({ time: e.time, equityUsd: e.equityUsd, cumR: e.cumR });
  const baselineEquity = baselineTrades ? downsample(baselineEquityCurve(baselineTrades)).map(point) : null;
  return jsonSafe({
    kind: "phase7c-web-backtest",
    safety: report.safety,
    generatedAt: report.generatedAt,
    elapsedMs: Date.now() - started,
    request: opts.request,
    isBaseline,
    data: report.data,
    costs: report.costs,
    notModelled: [...report.notModelled, "dời SL theo swing M15 (chỉ mô phỏng cấu trúc M5)"],
    summary: report.summary,
    bySide: report.bySide,
    byStrategy: report.byStrategy,
    byStrategySide: report.byStrategySide,
    byRegime: report.byRegime,
    byMonth: report.byMonth,
    exitReasons: report.exitReasons,
    halves: halves(trades),
    baseline: report.baseline
      ? { ...report.baseline, byStrategy: Object.fromEntries(Object.entries(groupBy(baselineTrades, (t) => t.strategy)).map(([k, ts]) => [k, metrics(ts)])) }
      : null,
    equity: downsample(report.equity).map(point),
    baselineEquity,
    tradesTotal: trades.length,
    trades: trades.slice(-MAX_TRADES).reverse().map((t) => ({
      strategy: t.strategy, side: t.side, regime: t.regime, entryTime: t.entryTime, exitTime: t.exitTime,
      entry: round(t.entry), initialStop: round(t.initialStop), pnlUsd: round(t.pnlUsd), r: round(t.r, 3),
      exitReason: t.exitReason, breakEvenApplied: t.breakEvenApplied, partialApplied: t.partialApplied,
    })),
    verdict: report.verdict,
    research: RESEARCH_NOTICE,
  });
}

function baselineEquityCurve(trades) {
  let equity = 0;
  let cumR = 0;
  return trades.map((t) => {
    equity += t.pnlUsd;
    cumR += t.r;
    return { time: t.exitTime, equityUsd: round(equity), cumR: round(cumR, 3) };
  });
}

function groupBy(items, keyOf) {
  const out = {};
  for (const it of items) (out[keyOf(it)] ??= []).push(it);
  return out;
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
