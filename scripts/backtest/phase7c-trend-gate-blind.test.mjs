// Blind test helpers: locked parameters, thresholds and blocks (synthetic, no MT5).
import test from "node:test";
import assert from "node:assert/strict";
import { LOCKED, equalBlocks, verdict } from "./phase7c-trend-gate-blind.mjs";

test("locked hypothesis matches the committed plan", () => {
  assert.equal(new Date(LOCKED.intradayStart).toISOString().slice(0, 10), "2021-11-11");
  assert.deepEqual([...LOCKED.strategies], ["TREND"]);
  assert.equal(LOCKED.volume, 0.12);
  assert.equal(LOCKED.blocks, 6);
  assert.ok(Object.isFrozen(LOCKED));
});

test("verdict needs every threshold", () => {
  const ok = { trades: 30, profitFactor: 1.21, expectancyUsd: 0.1, avgR: 0.01 };
  const blocks = (n) => Array.from({ length: 6 }, (_, i) => ({ netUsd: i < n ? 1 : 0 }));
  assert.equal(verdict(ok, blocks(4)).pass, true);
  assert.equal(verdict(ok, blocks(3)).pass, false); // a flat block is not positive
  assert.equal(verdict({ ...ok, profitFactor: 1.2 }, blocks(6)).pass, false);
  assert.equal(verdict({ ...ok, trades: 29 }, blocks(6)).pass, false);
  assert.equal(verdict({ ...ok, avgR: 0 }, blocks(6)).pass, false);
});

test("equal blocks tile the span without gaps", () => {
  const b = equalBlocks(0, 600, 6);
  assert.equal(b.length, 6);
  assert.equal(b[0][0], 0);
  assert.equal(b[5][1], 600);
  for (let i = 1; i < 6; i += 1) assert.equal(b[i][0], b[i - 1][1]);
});
