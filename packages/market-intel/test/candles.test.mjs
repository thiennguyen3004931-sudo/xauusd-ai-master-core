import { test } from "node:test";
import assert from "node:assert/strict";
import { resample, lastClosedIndex, H1_MS, H4_MS } from "../src/candles.mjs";
import { barsFromPath, M15_MS } from "./helpers.mjs";

const m15 = barsFromPath(40, (i) => 100 + i, { periodMs: M15_MS, start: Date.UTC(2026, 0, 5, 0, 0), wick: 0 });

test("resample: M15 -> H1 keeps first open, max high, min low, last close", () => {
  const h1 = resample(m15, H1_MS);
  assert.equal(h1.length, 10);
  assert.deepEqual(
    { open: h1[0].open, high: h1[0].high, low: h1[0].low, close: h1[0].close },
    { open: 99, high: 103, low: 99, close: 103 },
  );
  assert.equal(h1[0].closeTime - h1[0].openTime, H1_MS);
  assert.equal(h1[0].sourceBars, 4);
});

test("resample: H4 groups align to 00/04/08 broker hours", () => {
  const h4 = resample(m15, H4_MS);
  assert.equal(h4.length, 3);
  assert.equal(new Date(h4[1].openTime).getUTCHours(), 4);
  assert.equal(h4[2].sourceBars, 8); // last group is still forming
});

test("lastClosedIndex: a higher-timeframe bar is only usable once it has closed", () => {
  const h1 = resample(m15, H1_MS);
  // As of the close of the 6th M15 bar (01:30), only the 00:00 H1 bar has closed.
  assert.equal(lastClosedIndex(h1, m15[5].closeTime), 0);
  // As of 02:00 exactly, the 01:00 H1 bar has closed too.
  assert.equal(lastClosedIndex(h1, m15[7].closeTime), 1);
  assert.equal(lastClosedIndex(h1, m15[0].openTime), -1);
});
