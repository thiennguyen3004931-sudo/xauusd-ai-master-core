import assert from "node:assert/strict";
import test from "node:test";
import { __test } from "../apps/api/src/services/phase7c-performance-intelligence.service";

test("canonical entryConditions statuses become PASS/FAIL rule evidence", () => {
  const evidence = __test.ruleEvidence({
    entryConditions: {
      failedConditions: ["supertrendM5"],
      conditions: [
        { id: "patternM15", status: "PASS" },
        { id: "supertrendM5", status: "FAIL" },
        { id: "fvg", status: "IGNORED" },
      ],
    },
  });

  assert.deepEqual(evidence.passed, ["patternM15"]);
  assert.deepEqual(evidence.blocked, ["supertrendM5"]);
});

test("Trend fill exposes only explicit SIGNAL and POSITION identity", () => {
  const identifiers = __test.identifiersOf(
    {
      event: "ENTRY_FILLED",
      raw: {
        signalId: "trend-signal-1",
        position: { ticket: "304590358" },
      },
    },
    "ENTRY_FILLED",
  );

  assert.deepEqual(
    identifiers.map((item) => item.token).sort(),
    ["POSITION:304590358", "SIGNAL:trend-signal-1"],
  );
});

test("Sideway fill exposes explicit ORDER and POSITION identity", () => {
  const identifiers = __test.identifiersOf(
    {
      event: "ENTRY_FILLED",
      raw: {
        orderId: "p7c-sideway-123-BUY",
        position: { ticket: "4001" },
      },
    },
    "ENTRY_FILLED",
  );

  assert.deepEqual(
    identifiers.map((item) => item.token).sort(),
    ["ORDER:p7c-sideway-123-BUY", "POSITION:4001"],
  );
});

test("entry type uses canonical entryState and does not confuse recovery workflow with Daily Recovery", () => {
  assert.equal(
    __test.entryTypeOf({ setup: { entryState: "PULLBACK_ENTRY" } }, "ENTRY_FILLED", "TREND"),
    "PULLBACK",
  );
  assert.equal(
    __test.entryTypeOf({ setup: { entryState: "ENTRY_IMMEDIATE" } }, "ENTRY_FILLED", "TREND"),
    "IMMEDIATE",
  );
  assert.equal(
    __test.entryTypeOf({}, "PENDING_ENTRY_RECOVERED", "TREND"),
    "UNKNOWN",
  );
  assert.equal(
    __test.entryTypeOf({ plan: { dailyMode: "RECOVERY_TP" } }, "ENTRY_FILLED", "TREND"),
    "RECOVERY",
  );
  assert.equal(
    __test.entryTypeOf({}, "ENTRY_FILLED", "SIDEWAY"),
    "IMMEDIATE",
  );
});

test("untrusted generic ticket is not accepted outside entry fill/recovery events", () => {
  const identifiers = __test.identifiersOf(
    { event: "HOLD_POSITION", raw: { ticket: "999" } },
    "HOLD_POSITION",
  );
  assert.equal(identifiers.some((item) => item.token === "POSITION:999"), false);
});


test("Performance Intelligence v2 separates REVERSAL from TREND execution source", () => {
  assert.equal(
    __test.performanceStrategyOf(
      "TREND",
      "REVERSAL_CHOCH_PATTERN_STRUCTURE_NO_SUPERTREND",
      "REVERSAL",
    ),
    "REVERSAL",
  );
  assert.equal(__test.performanceStrategyOf("TREND", "TREND_CONTINUATION", "TRENDING"), "TREND");
  assert.equal(__test.performanceStrategyOf("SIDEWAY", null, "RANGING"), "SIDEWAY");
  assert.equal(
    __test.entryPolicyOf({
      lifecycle: { entryPolicy: "REVERSAL_CHOCH_PATTERN_STRUCTURE_NO_SUPERTREND" },
    }),
    "REVERSAL_CHOCH_PATTERN_STRUCTURE_NO_SUPERTREND",
  );
});

test("entry funnel keeps SIDEWAY and REVERSAL blocker statistics independent", () => {
  const source = (strategy: "TREND" | "SIDEWAY", events: unknown[]) => ({
    strategy,
    relativePath: strategy.toLowerCase() + "-decisions.jsonl",
    available: true,
    parsedRows: events.length,
    malformedRows: 0,
    events,
  });
  const event = (
    eventName: string,
    performanceStrategy: "TREND" | "SIDEWAY" | "REVERSAL",
    blockedRules: string[] = [],
    passedRules: string[] = [],
  ) => ({
    raw: {},
    index: 0,
    eventId: eventName + ":" + performanceStrategy,
    eventName,
    identifiers: [],
    passedRules,
    blockedRules,
    entryType: "UNKNOWN",
    regime: performanceStrategy === "REVERSAL" ? "REVERSAL" : null,
    entryPolicy: performanceStrategy === "REVERSAL"
      ? "REVERSAL_CHOCH_PATTERN_STRUCTURE_NO_SUPERTREND"
      : null,
    performanceStrategy,
  });

  const funnel = __test.buildEntryFunnel([
    source("SIDEWAY", [
      event("ENTRY_WAIT", "SIDEWAY", ["SIDEWAY_ZONE"], ["PATTERN_M15"]),
      event("ENTRY_SUBMIT", "SIDEWAY", [], ["PATTERN_M15", "STRUCTURE"]),
      event("ENTRY_FILLED", "SIDEWAY"),
    ]),
    source("TREND", [
      event("ENTRY_WAIT", "REVERSAL", ["STRUCTURAL_STOP_DISTANCE"], ["PATTERN_M15"]),
      event("ENTRY_SUBMIT", "REVERSAL", [], ["PATTERN_M15", "VALID_STRUCTURE"]),
    ]),
  ] as never);

  const sideway = funnel.find((item) => item.strategy === "SIDEWAY");
  assert.ok(sideway);
  assert.equal(sideway.blockedEvents, 1);
  assert.equal(sideway.entrySubmitEvents, 1);
  assert.equal(sideway.entryFilledEvents, 1);
  assert.deepEqual(sideway.blockedReasons[0], { rule: "SIDEWAY_ZONE", count: 1 });

  const reversal = funnel.find((item) => item.strategy === "REVERSAL");
  assert.ok(reversal);
  assert.equal(reversal.blockedEvents, 1);
  assert.equal(reversal.entrySubmitEvents, 1);
  assert.equal(reversal.entryFilledEvents, 0);
  assert.deepEqual(reversal.blockedReasons[0], { rule: "STRUCTURAL_STOP_DISTANCE", count: 1 });
});
