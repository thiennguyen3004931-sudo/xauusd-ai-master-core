// Feature 1 (C2): change proposals. Deterministic, no LLM.
// - Only parameters on the allowlist below can be proposed: entry-signal and regime filters. Lot size,
//   SL/TP, break-even, trailing and risk are NOT on the list (they belong to tasks T2-T5).
// - Every parameter's first value is "OFF" = today's behavior. A proposal is only a suggestion: nothing
//   here applies it. Approval creates a config version that must still be deployed through the guarded
//   Phase 7C path, while PAUSE and flat, for new positions only.
// - Candidates are chosen on the in-sample window only; the evidence label is decided on the later,
//   unseen window plus a walk-forward check. The rule is fixed here before any result is looked at.
import { createHash } from "node:crypto";
import { performanceStats } from "./journal-stats.mjs";

export const PROPOSALS_FLAG = "ZIQ_MARKET_INTEL_PROPOSALS_ENABLED";
export const PROPOSALS_VERSION = "proposals-v1";

export function isProposalsEnabled(env = process.env) {
  return String(env?.[PROPOSALS_FLAG] ?? "").trim().toLowerCase() === "true";
}

const TREND_STATES = new Set(["UPTREND", "DOWNTREND"]);

export const PROPOSAL_PARAMETERS = Object.freeze([
  Object.freeze({
    id: "trendStrategyLibraryGate",
    scope: "REGIME_FILTER",
    label: "Cổng thư viện mẫu cho lệnh TREND",
    values: Object.freeze(["OFF", "BLOCK_AGAINST_TREND", "WITH_TREND_ONLY"]),
    valueLabels: Object.freeze({
      OFF: "Tắt (như hiện tại)",
      BLOCK_AGAINST_TREND: "Chặn lệnh TREND ngược xu hướng của thư viện",
      WITH_TREND_ONLY: "Chỉ vào lệnh TREND khi cùng xu hướng của thư viện",
    }),
    keep(trade, value) {
      if (value === "OFF" || trade.strategy !== "TREND") return true;
      if (value === "BLOCK_AGAINST_TREND") return trade.alignment !== "AGAINST_TREND";
      if (value === "WITH_TREND_ONLY") return trade.alignment === "WITH_TREND";
      return true;
    },
  }),
  Object.freeze({
    id: "sidewayStrategyLibraryGate",
    scope: "REGIME_FILTER",
    label: "Cổng thư viện mẫu cho lệnh SIDEWAY",
    values: Object.freeze(["OFF", "BLOCK_IN_TREND", "SIDEWAY_ONLY"]),
    valueLabels: Object.freeze({
      OFF: "Tắt (như hiện tại)",
      BLOCK_IN_TREND: "Chặn lệnh SIDEWAY khi thư viện thấy Uptrend/Downtrend",
      SIDEWAY_ONLY: "Chỉ vào lệnh SIDEWAY khi thư viện thấy Sideway",
    }),
    keep(trade, value) {
      if (value === "OFF" || trade.strategy !== "SIDEWAY") return true;
      if (value === "BLOCK_IN_TREND") return !TREND_STATES.has(trade.libraryState);
      if (value === "SIDEWAY_ONLY") return trade.libraryState === "SIDEWAY";
      return true;
    },
  }),
]);

export const BASELINE_PARAMS = Object.freeze(Object.fromEntries(PROPOSAL_PARAMETERS.map((p) => [p.id, "OFF"])));

/** Fixed before results were computed. All checks must pass for "ENOUGH_EVIDENCE". */
export const EVIDENCE_RULE = Object.freeze({
  minInSampleTrades: 30,
  minOutOfSampleTrades: 30,
  minOutOfSampleProfitFactor: 1.2,
  walkForwardFolds: 6,
  minPositiveFolds: 4,
});

const parameterById = (id) => PROPOSAL_PARAMETERS.find((p) => p.id === id) ?? null;

export function validateParamValue(id, value) {
  const p = parameterById(id);
  if (!p) return { ok: false, error: `Tham số ${id} không nằm trong danh sách cho phép.` };
  if (!p.values.includes(value)) return { ok: false, error: `Giá trị ${value} không hợp lệ cho ${id}.` };
  return { ok: true };
}

export function validateParams(params) {
  const keys = Object.keys(params ?? {}).sort();
  const expected = Object.keys(BASELINE_PARAMS).sort();
  if (keys.join(",") !== expected.join(",")) return { ok: false, error: "Bộ tham số phải có đúng các khoá trong danh sách cho phép." };
  for (const k of keys) {
    const v = validateParamValue(k, params[k]);
    if (!v.ok) return v;
  }
  return { ok: true };
}

export function applyParams(trades, params) {
  return trades.filter((t) => PROPOSAL_PARAMETERS.every((p) => p.keep(t, params[p.id] ?? "OFF")));
}

function chronologicalFolds(trades, k) {
  const sorted = [...trades].sort((a, b) => a.openedAt - b.openedAt);
  const size = Math.ceil(sorted.length / k);
  return Array.from({ length: k }, (_, i) => sorted.slice(i * size, (i + 1) * size));
}

const pfOf = (s) => (s.profitFactorInfinite ? Infinity : s.profitFactor ?? 0);

/** Before/after for changing one parameter, with in-sample, out-of-sample and walk-forward results. */
export function evaluateChange(trades, parameterId, newValue, { splitAt, currentParams = BASELINE_PARAMS } = {}) {
  const v = validateParamValue(parameterId, newValue);
  if (!v.ok) throw new Error(v.error);
  const before = { ...BASELINE_PARAMS, ...currentParams };
  const after = { ...before, [parameterId]: newValue };
  const sides = (list) => {
    const b = applyParams(list, before);
    const a = applyParams(list, after);
    return { before: performanceStats(b), after: performanceStats(a), removed: b.length - a.length };
  };
  const ins = trades.filter((t) => t.openedAt < splitAt);
  const oos = trades.filter((t) => t.openedAt >= splitAt);
  const inSample = sides(ins);
  const outOfSample = sides(oos);
  const full = sides(trades);
  const walkForward = chronologicalFolds(trades, EVIDENCE_RULE.walkForwardFolds).map((fold, i) => {
    const s = sides(fold);
    return {
      fold: i + 1,
      from: fold[0]?.openedAt ?? null,
      to: fold[fold.length - 1]?.openedAt ?? null,
      before: s.before,
      after: s.after,
      netDelta: Math.round((s.after.netPnl - s.before.netPnl) * 100) / 100,
      improved: s.after.netPnl > s.before.netPnl,
    };
  });
  const positive = walkForward.filter((f) => f.improved).length;
  const R = EVIDENCE_RULE;
  const checks = [
    { id: "OOS_TRADES", passed: outOfSample.after.trades >= R.minOutOfSampleTrades, text: `Giai đoạn chưa dùng có ${outOfSample.after.trades} lệnh sau thay đổi (cần ≥ ${R.minOutOfSampleTrades}).` },
    { id: "OOS_PF", passed: pfOf(outOfSample.after) > R.minOutOfSampleProfitFactor, text: `PF giai đoạn chưa dùng sau thay đổi ${outOfSample.after.profitFactor ?? "–"} (cần > ${R.minOutOfSampleProfitFactor}).` },
    { id: "OOS_IMPROVES", passed: pfOf(outOfSample.after) > pfOf(outOfSample.before) && outOfSample.after.netPnl > outOfSample.before.netPnl, text: `Giai đoạn chưa dùng: PF ${outOfSample.before.profitFactor ?? "–"} → ${outOfSample.after.profitFactor ?? "–"}, ròng ${outOfSample.before.netPnl} → ${outOfSample.after.netPnl}.` },
    { id: "WALK_FORWARD", passed: positive >= R.minPositiveFolds, text: `Walk-forward: ${positive}/${R.walkForwardFolds} đoạn cải thiện lãi ròng (cần ≥ ${R.minPositiveFolds}).` },
  ];
  return {
    parameterId, oldValue: before[parameterId], newValue, splitAt,
    inSample, outOfSample, full, removed: full.removed, walkForward,
    evidence: { label: checks.every((c) => c.passed) ? "ENOUGH_EVIDENCE" : "NOT_ENOUGH_EVIDENCE", checks },
  };
}

export function proposalId(p) {
  const key = JSON.stringify([PROPOSALS_VERSION, p.parameterId, p.oldValue, p.newValue, p.dataWindow?.from, p.dataWindow?.to, p.dataWindow?.trades]);
  return `prop_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function reasonText(param, ev) {
  const b = ev.inSample.before;
  const a = ev.inSample.after;
  return `${param.label}: ${param.valueLabels[ev.oldValue]} → ${param.valueLabels[ev.newValue]}. `
    + `Giai đoạn dùng để chọn: bỏ ${ev.inSample.removed} lệnh, PF ${b.profitFactor ?? "–"} → ${a.profitFactor ?? "–"}, `
    + `winrate ${b.winRatePct ?? "–"}% → ${a.winRatePct ?? "–"}%, ròng ${b.netPnl} → ${a.netPnl}. `
    + `Giai đoạn chưa dùng: PF ${ev.outOfSample.before.profitFactor ?? "–"} → ${ev.outOfSample.after.profitFactor ?? "–"}, ròng ${ev.outOfSample.before.netPnl} → ${ev.outOfSample.after.netPnl}.`;
}

/**
 * Propose at most one value per parameter: the value that improves both net PnL and PF the most on the
 * in-sample window. The out-of-sample window and walk-forward only decide the evidence label.
 */
export function generateProposals({ trades, currentParams = BASELINE_PARAMS, splitAt, now = Date.now(), source = "BACKTEST" }) {
  const current = { ...BASELINE_PARAMS, ...currentParams };
  const sorted = [...trades].sort((a, b) => a.openedAt - b.openedAt);
  const dataWindow = { from: sorted[0]?.openedAt ?? null, to: sorted[sorted.length - 1]?.openedAt ?? null, trades: sorted.length, splitAt, source };
  const out = [];
  for (const param of PROPOSAL_PARAMETERS) {
    let best = null;
    for (const value of param.values) {
      if (value === current[param.id]) continue;
      const ev = evaluateChange(sorted, param.id, value, { splitAt, currentParams: current });
      const b = ev.inSample.before;
      const a = ev.inSample.after;
      if (a.trades < EVIDENCE_RULE.minInSampleTrades) continue;
      if (!(a.netPnl > b.netPnl && pfOf(a) > pfOf(b))) continue;
      const gain = a.netPnl - b.netPnl;
      if (!best || gain > best.gain) best = { ev, gain };
    }
    if (!best) continue;
    const p = {
      version: PROPOSALS_VERSION,
      parameterId: param.id,
      scope: param.scope,
      label: param.label,
      oldValue: best.ev.oldValue,
      newValue: best.ev.newValue,
      oldLabel: param.valueLabels[best.ev.oldValue],
      newLabel: param.valueLabels[best.ev.newValue],
      allowedValues: [...param.values],
      reason: reasonText(param, best.ev),
      evaluation: best.ev,
      evidenceLabel: best.ev.evidence.label,
      dataWindow,
      applyTo: "NEW_POSITIONS_ONLY",
      caveats: [
        "Ước lượng bằng cách bỏ bớt lệnh trong danh sách lệnh backtest có sẵn; không mô phỏng lệnh khác có thể mở thay vào.",
        "Backtest không phải bằng chứng sinh lời. Không tự áp dụng: cần duyệt và triển khai qua đường Phase 7C có bảo vệ.",
      ],
      createdAt: now,
    };
    p.id = proposalId(p);
    out.push(p);
  }
  return out;
}

export const ANALYSIS_CADENCE = Object.freeze({ weeklyMs: 7 * 86_400_000, everyClosedTrades: 30 });

export function analysisDue({ lastRunAt, closedTradesSinceLastRun, now = Date.now() }) {
  if (lastRunAt === null || lastRunAt === undefined) return { due: true, reason: "FIRST_RUN" };
  if (closedTradesSinceLastRun >= ANALYSIS_CADENCE.everyClosedTrades) return { due: true, reason: "TRADES_30" };
  if (now - lastRunAt >= ANALYSIS_CADENCE.weeklyMs) return { due: true, reason: "WEEKLY" };
  return { due: false, reason: "NOT_DUE" };
}
