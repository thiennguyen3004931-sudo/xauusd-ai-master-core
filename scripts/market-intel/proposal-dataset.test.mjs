import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, splitTime, toDatasetTrades } from "./proposal-dataset.mjs";

test("parseArgs reads flags", () => {
  assert.deepEqual(parseArgs(["--trades", "t.csv", "--split", "0.5"]), { trades: "t.csv", split: "0.5" });
});

test("toDatasetTrades keeps strategy, side, regime, PnL and times", () => {
  const [t] = toDatasetTrades([{ strategy: "TREND", side: "SELL", regime: "BREAKOUT", entryMs: 1000, exitTime: "2024-01-01 10:00", pnlUsd: -5, r: -0.5 }]);
  assert.equal(t.id, "bt-1");
  assert.equal(t.openedAt, 1000);
  assert.equal(t.closedAt, Date.UTC(2024, 0, 1, 10));
  assert.equal(t.productionRegime, "BREAKOUT");
  assert.equal(t.netPnl, -5);
});

test("splitTime splits chronologically by trade count", () => {
  const trades = [5, 1, 4, 2, 3].map((openedAt) => ({ openedAt }));
  assert.equal(splitTime(trades, 0.6), 4);
  assert.equal(splitTime(trades, 0), 1);
  assert.equal(splitTime(trades, 1), 5);
});
