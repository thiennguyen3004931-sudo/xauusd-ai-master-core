// T3/T4 — sweep grid, stable-region selection and acceptance thresholds (no MT5, synthetic results).
import test from "node:test";
import assert from "node:assert/strict";
import { GRID, acceptance, configKey, gridConfigs, inWindow, selectStable } from "./phase7c-management-sweep.mjs";

test("grid is exactly the work-order T3 grid (108 configs, baseline included)", () => {
  assert.deepEqual(GRID.breakEvenTriggerPrice, [6, 8, 10]);
  assert.deepEqual(GRID.breakEvenOffsetPrice, [0, 1, 2]);
  assert.deepEqual(GRID.maxInitialStopPrice, [10, 12, 15]);
  assert.deepEqual(GRID.fixedTpPrice, [null, 20, 30, 40]);
  const configs = gridConfigs();
  assert.equal(configs.length, 108);
  assert.ok(configs.some((c) => configKey(c) === "BE6/OFF0/SL10/TPoff"));
});

test("selection prefers a stable neighbourhood over an isolated spike and ignores the test window", () => {
  const trade = (entryTime, pnlUsd) => ({ entryTime, pnlUsd, r: pnlUsd / 30 });
  const many = (n, win, loss, t = 0) => Array.from({ length: n }, (_, i) => trade(t + i, i % 2 ? -loss : win));
  const results = new Map();
  for (const config of gridConfigs()) {
    const key = configKey(config);
    let trades = many(40, 30, 30); // PF 1.0 everywhere in train
    if (key === "BE10/OFF2/SL15/TP40") trades = many(40, 300, 30); // isolated spike, poor neighbours
    if (config.breakEvenTriggerPrice === 8) trades = many(40, 45, 30); // stable plateau PF 1.5
    trades = trades.concat(many(40, key === "BE6/OFF0/SL10/TPoff" ? 999 : 1, 30, 1000)); // test window noise
    results.set(key, { config, trades });
  }
  const pick = selectStable(results, [0, 1000]);
  assert.equal(pick.config.breakEvenTriggerPrice, 8);
  assert.equal(inWindow([{ entryTime: 5 }, { entryTime: 1000 }], [0, 1000]).length, 1);
});

test("acceptance needs every work-order threshold", () => {
  const good = { trades: 40, profitFactor: 1.3, expectancyUsd: 1, avgR: 0.05 };
  const fold = (netUsd) => ({ candidateTest: { netUsd } });
  const report = (oos, nets) => ({ candidate: { outOfSample: oos }, walkForward: nets.map(fold) });
  assert.equal(acceptance(report(good, [1, 1, 1, 1, -1, -1])).pass, true);
  assert.equal(acceptance(report(good, [1, 1, 1, -1, -1, -1])).pass, false);
  assert.equal(acceptance(report({ ...good, trades: 29 }, [1, 1, 1, 1, 1, 1])).pass, false);
  assert.equal(acceptance(report({ ...good, profitFactor: 1.2 }, [1, 1, 1, 1, 1, 1])).pass, false);
  assert.equal(acceptance({ candidate: null, walkForward: [] }).pass, false);
});
