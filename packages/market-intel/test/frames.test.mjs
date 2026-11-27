import { test } from "node:test";
import assert from "node:assert/strict";
import { frameSummaries, resample, H1_MS, H4_MS, M15_MS } from "../src/index.mjs";
import { barsFromPath, upPath } from "./helpers.mjs";

const path = (i) => 2000 + 0.06 * i + 15 * Math.sin((2 * Math.PI * i) / 384) + 4 * Math.sin((2 * Math.PI * i) / 40);
function frames(n = 4200) {
  const m15 = barsFromPath(n, path, { periodMs: M15_MS, start: Date.UTC(2026, 0, 5), wick: 0.3 });
  return { m15, h1: resample(m15, H1_MS), h4: resample(m15, H4_MS) };
}

test("frameSummaries: open / close / high / low of the last closed bar per timeframe, plus trend", () => {
  const { m15, h1, h4 } = frames();
  const asOf = m15.at(-1).closeTime;
  const out = frameSummaries({ h4, h1, m15 }, asOf);
  assert.deepEqual(Object.keys(out), ["h4", "h1", "m15"]);
  const last = m15.at(-1);
  assert.equal(out.m15.open, Math.round(last.open * 100) / 100);
  assert.equal(out.m15.close, Math.round(last.close * 100) / 100);
  assert.equal(out.m15.closeTime, last.closeTime);
  for (const f of Object.values(out)) {
    assert.ok(f.high >= Math.max(f.open, f.close) && f.low <= Math.min(f.open, f.close));
    assert.equal(f.change, Math.round((f.close - f.open) * 100) / 100);
    assert.ok(["UPTREND", "DOWNTREND", "SIDEWAY", "TRANSITION"].includes(f.state));
    assert.ok(f.confidence >= 0 && f.confidence <= 100);
    assert.ok(["UP", "DOWN", "FLAT"].includes(f.candle));
  }
});

test("frameSummaries: a still-forming bar (closeTime > asOf) is never used", () => {
  const { m15, h1, h4 } = frames();
  const asOf = m15.at(-1).closeTime - 30 * 60_000; // H1 / H4 last bars still forming
  const out = frameSummaries({ h4, h1, m15 }, asOf);
  for (const f of Object.values(out)) assert.ok(f.closeTime <= asOf);
});

test("frameSummaries: missing series gives null for that timeframe", () => {
  const h1 = barsFromPath(300, upPath());
  const out = frameSummaries({ h4: h1, h1, m15: [] }, h1.at(-1).closeTime);
  assert.equal(out.m15, null);
  assert.ok(out.h1);
});
