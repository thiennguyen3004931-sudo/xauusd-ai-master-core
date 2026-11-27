import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, atr, adx } from "../src/indicators.mjs";
import { barsFromPath, upPath, rangePath } from "./helpers.mjs";

test("ema: seeded with SMA, null before the period, constant input stays constant", () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2); // SMA(1,2,3)
  assert.equal(out[3], 3); // 2 + (4 - 2) * 0.5
  assert.equal(out[4], 4);
  assert.deepEqual(ema([7, 7, 7, 7], 2).slice(1), [7, 7, 7]);
});

test("atr: Wilder smoothing of true range", () => {
  const bars = [
    { high: 10, low: 8, close: 9 },
    { high: 11, low: 9, close: 10 }, // TR 2
    { high: 12, low: 10, close: 11 }, // TR 2
    { high: 15, low: 11, close: 14 }, // TR 4
  ];
  const out = atr(bars, 2);
  assert.equal(out[1], null);
  assert.equal(out[2], 2); // mean(TR1, TR2)
  assert.equal(out[3], 3); // (2 * 1 + 4) / 2
});

test("adx: strong trend reads high with +DI above -DI; flat oscillation reads low", () => {
  const trend = adx(barsFromPath(200, upPath(2000, 2, 3, 24)), 14);
  const last = trend.at(-1);
  assert.ok(last.adx > 30, `trend ADX ${last.adx}`);
  assert.ok(last.plusDi > last.minusDi);

  const flat = adx(barsFromPath(200, rangePath()), 14).at(-1);
  assert.ok(flat.adx < 20, `range ADX ${flat.adx}`);
});
