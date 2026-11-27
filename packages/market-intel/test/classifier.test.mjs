import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGIME_LIBRARY_VERSION,
  REGIME_TEMPLATES,
  analyzeTimeframe,
  classifyTimeframe,
  classifyMarket,
} from "../src/index.mjs";
import { barsFromPath, upPath, downPath, rangePath, H1_MS } from "./helpers.mjs";

const H4_MS = 4 * H1_MS;
const up = (n, period = H1_MS) => barsFromPath(n, upPath(), { periodMs: period });
const down = (n, period = H1_MS) => barsFromPath(n, downPath(), { periodMs: period });
const flat = (n, period = H1_MS) => barsFromPath(n, rangePath(), { periodMs: period, wick: 0.4 });

test("library: three versioned templates with documented, weighted criteria", () => {
  assert.match(REGIME_LIBRARY_VERSION, /^regime-library-v\d+$/);
  assert.deepEqual(REGIME_TEMPLATES.map((t) => t.id), ["UPTREND", "DOWNTREND", "SIDEWAY"]);
  for (const template of REGIME_TEMPLATES) {
    assert.ok(template.criteria.length >= 5);
    for (const c of template.criteria) {
      assert.equal(typeof c.id, "string");
      assert.equal(typeof c.description, "string");
      assert.ok(c.weight > 0);
      assert.equal(typeof c.test, "function");
    }
  }
});

test("classifyTimeframe: rising zig-zag -> UPTREND", () => {
  const r = classifyTimeframe(analyzeTimeframe(up(300)));
  assert.equal(r.state, "UPTREND", JSON.stringify(r.scores));
  assert.ok(r.scores.UPTREND >= 0.7);
});

test("classifyTimeframe: falling zig-zag -> DOWNTREND", () => {
  const r = classifyTimeframe(analyzeTimeframe(down(300)));
  assert.equal(r.state, "DOWNTREND", JSON.stringify(r.scores));
});

test("classifyTimeframe: flat oscillation -> SIDEWAY", () => {
  const r = classifyTimeframe(analyzeTimeframe(flat(300)));
  assert.equal(r.state, "SIDEWAY", JSON.stringify(r.scores));
});

test("classifyTimeframe: every criterion is reported as passed or failed with its value", () => {
  const r = classifyTimeframe(analyzeTimeframe(up(300)));
  const criteria = r.criteria.UPTREND;
  assert.equal(criteria.length, REGIME_TEMPLATES[0].criteria.length);
  for (const c of criteria) {
    assert.equal(typeof c.passed, "boolean");
    assert.ok("value" in c);
  }
});

test("classifyTimeframe: too few bars -> TRANSITION with INSUFFICIENT_DATA", () => {
  const r = classifyTimeframe(analyzeTimeframe(up(60)));
  assert.equal(r.state, "TRANSITION");
  assert.ok(r.reasons.includes("INSUFFICIENT_DATA"));
});

test("classifyMarket: H1 and H4 agree -> combined state with ALIGNED", () => {
  const r = classifyMarket({ h4: up(300, H4_MS), h1: up(300) });
  assert.equal(r.state, "UPTREND");
  assert.equal(r.alignment, "ALIGNED");
  assert.equal(r.libraryVersion, REGIME_LIBRARY_VERSION);
});

test("classifyMarket: H1 uptrend against an H4 downtrend -> TRANSITION (CONFLICT)", () => {
  const r = classifyMarket({ h4: down(300, H4_MS), h1: up(300) });
  assert.equal(r.state, "TRANSITION");
  assert.equal(r.alignment, "CONFLICT");
});

test("classifyMarket: result is advisory and carries the safety contract", () => {
  const r = classifyMarket({ h4: up(300, H4_MS), h1: up(300) });
  assert.deepEqual(r.safety, { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
});

test("analyzeTimeframe: features at bar i do not change when later bars are appended", () => {
  const bars = barsFromPath(400, (i) => (i < 250 ? upPath()(i) : upPath()(250) - 3 * (i - 250)));
  const early = classifyTimeframe(analyzeTimeframe(bars.slice(0, 240)));
  const full = analyzeTimeframe(bars);
  const atSame = classifyTimeframe(full, 239);
  assert.deepEqual(atSame.scores, early.scores);
  assert.equal(atSame.state, early.state);
});
