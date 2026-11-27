// Feature 1 (C2): proposals from an allowlist, before/after evaluation, walk-forward, evidence label.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSALS_FLAG, isProposalsEnabled, PROPOSAL_PARAMETERS, BASELINE_PARAMS, EVIDENCE_RULE,
  applyParams, evaluateChange, generateProposals, analysisDue, validateParamValue, proposalId,
} from "../src/proposals.mjs";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

// 600 synthetic trades: TREND with-trend trades win, against-trend trades lose, others flat-ish.
function dataset({ n = 600, againstWins = false } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const k = i % 4;
    const alignment = ["WITH_TREND", "AGAINST_TREND", "SIDEWAY", "TRANSITION"][k];
    const strategy = k === 2 && i % 8 === 2 ? "SIDEWAY" : "TREND";
    const libraryState = ["UPTREND", "UPTREND", "SIDEWAY", "TRANSITION"][k];
    let pnl = 0;
    if (alignment === "WITH_TREND") pnl = i % 3 === 0 ? -50 : 60;
    else if (alignment === "AGAINST_TREND") pnl = againstWins ? 60 : i % 5 === 0 ? 40 : -55;
    else pnl = i % 2 ? 30 : -32;
    out.push({ id: String(i), openedAt: T0 + i * DAY, strategy, side: "BUY", alignment, libraryState, netPnl: pnl });
  }
  return out;
}

test("proposals flag is off unless exactly true", () => {
  assert.equal(PROPOSALS_FLAG, "ZIQ_MARKET_INTEL_PROPOSALS_ENABLED");
  assert.equal(isProposalsEnabled({}), false);
  assert.equal(isProposalsEnabled({ [PROPOSALS_FLAG]: "true" }), true);
});

test("allowlist covers only entry/regime filters and the baseline keeps today's behavior", () => {
  for (const p of PROPOSAL_PARAMETERS) {
    assert.ok(["ENTRY_FILTER", "REGIME_FILTER"].includes(p.scope), p.id);
    assert.equal(p.values[0], "OFF");
    assert.equal(BASELINE_PARAMS[p.id], "OFF");
  }
  const ids = PROPOSAL_PARAMETERS.map((p) => p.id).join(",");
  assert.doesNotMatch(ids, /lot|volume|stop|sl|tp|trail|breakeven|be|risk|martingale/i);
  const all = dataset();
  assert.equal(applyParams(all, BASELINE_PARAMS).length, all.length);
});

test("validateParamValue rejects unknown parameters and values", () => {
  assert.equal(validateParamValue("trendStrategyLibraryGate", "WITH_TREND_ONLY").ok, true);
  assert.equal(validateParamValue("trendStrategyLibraryGate", "YOLO").ok, false);
  assert.equal(validateParamValue("lotSize", "0.06").ok, false);
});

test("applyParams gates only the targeted strategy", () => {
  const all = dataset();
  const kept = applyParams(all, { ...BASELINE_PARAMS, trendStrategyLibraryGate: "BLOCK_AGAINST_TREND" });
  assert.ok(kept.every((t) => !(t.strategy === "TREND" && t.alignment === "AGAINST_TREND")));
  assert.equal(kept.filter((t) => t.strategy === "SIDEWAY").length, all.filter((t) => t.strategy === "SIDEWAY").length);
});

test("evaluateChange gives before/after, out-of-sample and 6 walk-forward folds", () => {
  const all = dataset();
  const ev = evaluateChange(all, "trendStrategyLibraryGate", "BLOCK_AGAINST_TREND", { splitAt: T0 + 400 * DAY });
  assert.equal(ev.walkForward.length, 6);
  assert.ok(ev.inSample.after.profitFactor > ev.inSample.before.profitFactor);
  assert.ok(ev.outOfSample.after.trades >= 30);
  assert.equal(ev.evidence.label, "ENOUGH_EVIDENCE");
  assert.ok(ev.evidence.checks.every((c) => typeof c.passed === "boolean" && c.text));
  assert.ok(ev.removed > 0);
});

test("evidence is NOT_ENOUGH when the out-of-sample sample is small", () => {
  const all = dataset({ n: 120 });
  const ev = evaluateChange(all, "trendStrategyLibraryGate", "BLOCK_AGAINST_TREND", { splitAt: T0 + 100 * DAY });
  assert.equal(ev.evidence.label, "NOT_ENOUGH_EVIDENCE");
  assert.ok(ev.evidence.checks.some((c) => !c.passed && /30/.test(c.text)));
  assert.equal(EVIDENCE_RULE.minOutOfSampleTrades, 30);
});

test("generateProposals picks candidates on in-sample data only and states old -> new with data", () => {
  const all = dataset();
  const props = generateProposals({ trades: all, currentParams: BASELINE_PARAMS, splitAt: T0 + 400 * DAY, now: T0 + 700 * DAY });
  assert.ok(props.length >= 1);
  const p = props.find((x) => x.parameterId === "trendStrategyLibraryGate");
  assert.ok(p);
  assert.equal(p.oldValue, "OFF");
  assert.notEqual(p.newValue, "OFF");
  assert.match(p.reason, /PF/);
  assert.equal(p.id, proposalId(p));
  assert.equal(p.applyTo, "NEW_POSITIONS_ONLY");
  // Nothing proposed when the change would not help in-sample.
  const none = generateProposals({ trades: dataset({ againstWins: true }).filter((t) => t.alignment !== "TRANSITION" && t.alignment !== "SIDEWAY"), currentParams: BASELINE_PARAMS, splitAt: T0 + 400 * DAY, now: 0 });
  assert.equal(none.filter((x) => x.parameterId === "trendStrategyLibraryGate").length, 0);
});

test("generateProposals skips values equal to the current config", () => {
  const all = dataset();
  const props = generateProposals({ trades: all, currentParams: { ...BASELINE_PARAMS, trendStrategyLibraryGate: "BLOCK_AGAINST_TREND" }, splitAt: T0 + 400 * DAY, now: 0 });
  assert.ok(props.every((p) => !(p.parameterId === "trendStrategyLibraryGate" && p.newValue === "BLOCK_AGAINST_TREND")));
  assert.ok(props.filter((p) => p.parameterId === "trendStrategyLibraryGate").every((p) => p.oldValue === "BLOCK_AGAINST_TREND"));
});

test("analysisDue: weekly or after every 30 closed trades", () => {
  const now = T0 + 30 * DAY;
  assert.equal(analysisDue({ lastRunAt: null, closedTradesSinceLastRun: 0, now }).due, true);
  assert.equal(analysisDue({ lastRunAt: now - 2 * DAY, closedTradesSinceLastRun: 5, now }).due, false);
  assert.equal(analysisDue({ lastRunAt: now - 7 * DAY, closedTradesSinceLastRun: 0, now }).reason, "WEEKLY");
  assert.equal(analysisDue({ lastRunAt: now - DAY, closedTradesSinceLastRun: 30, now }).reason, "TRADES_30");
});
