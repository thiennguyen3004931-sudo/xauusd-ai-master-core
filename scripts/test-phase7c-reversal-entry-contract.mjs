import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutoTrendEntryModeGate } from "./phase7c-trend-mode-gate.mjs";

function regime(overrides = {}) {
  return {
    activeMode: "AUTO",
    recommendedMode: "PAUSE",
    regime: "REVERSAL",
    confidence: 78,
    reversal: {
      direction: "BEARISH",
      side: "SELL",
      timestamp: 1_000,
      level: 4300,
    },
    ...overrides,
  };
}

function demo({
  side = "SELL",
  closeTime = 2_000,
  eligible = false,
  reversalEligible = true,
  structuralStopDistance = 8,
} = {}) {
  return {
    entryDiagnostics: {
      closeTime,
      pattern: {
        matched: true,
        side,
        name: "ENGULFING",
      },
      trend: {
        m15Supertrend: side === "SELL" ? "BUY" : "SELL",
        m5Supertrend: side === "SELL" ? "BUY" : "SELL",
      },
      entry: {
        eligible,
        reversalEligible,
        side,
        structuralStopDistance,
        stopDistance: structuralStopDistance < 6 ? 6 : structuralStopDistance,
        action: "ENTRY_IMMEDIATE",
      },
    },
  };
}

test("AUTO REVERSAL allows CHOCH-direction entry without SuperTrend alignment", () => {
  const result = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime(),
    demo: demo({
      side: "SELL",
      eligible: false,
      reversalEligible: true,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "AUTO_REVERSAL_CHOCH_DIRECTION_ENTRY");
  assert.equal(result.reversalSide, "SELL");
  assert.equal(result.reversalTimestamp, 1_000);
});

test("AUTO REVERSAL blocks a signal that continues the old trend", () => {
  const result = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime(),
    demo: demo({
      side: "BUY",
      eligible: true,
      reversalEligible: true,
    }),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "REVERSAL_DIRECTION_MISMATCH");
});

test("AUTO REVERSAL requires the signal to be strictly newer than CHOCH", () => {
  const sameCandle = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime(),
    demo: demo({
      side: "SELL",
      closeTime: 1_000,
      eligible: true,
      reversalEligible: true,
    }),
  });

  assert.equal(sameCandle.allowed, false);
  assert.equal(sameCandle.reason, "REVERSAL_SIGNAL_NOT_AFTER_CHOCH");

  const older = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime(),
    demo: demo({
      side: "SELL",
      closeTime: 999,
      eligible: true,
      reversalEligible: true,
    }),
  });

  assert.equal(older.allowed, false);
  assert.equal(older.reason, "REVERSAL_SIGNAL_NOT_AFTER_CHOCH");
});

test("AUTO REVERSAL fails closed when canonical CHOCH direction metadata is missing", () => {
  const result = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime({ reversal: null }),
    demo: demo({
      side: "SELL",
      eligible: true,
      reversalEligible: true,
    }),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "REVERSAL_CONTEXT_MISSING");
});

test("AUTO REVERSAL requires pattern plus valid structure and SL at most 10", () => {
  const tooWide = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: regime(),
    demo: demo({
      side: "SELL",
      eligible: false,
      reversalEligible: false,
      structuralStopDistance: 10.01,
    }),
  });

  assert.equal(tooWide.allowed, false);
  assert.equal(tooWide.reason, "REVERSAL_ENTRY_CONDITIONS_NOT_READY");
});

test("TRENDING/BREAKOUT continuation behavior remains unchanged", () => {
  const result = evaluateAutoTrendEntryModeGate({
    activeMode: "AUTO",
    regime: {
      activeMode: "AUTO",
      recommendedMode: "TREND",
      regime: "TRENDING",
      confidence: 80,
    },
    demo: demo({
      side: "BUY",
      eligible: false,
      reversalEligible: false,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "AUTO_REGIME_ALLOWS_TREND");
});
