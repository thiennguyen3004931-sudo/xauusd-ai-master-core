import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSwings, structureAt } from "../src/structure.mjs";
import { barsFromPath, upPath, downPath } from "./helpers.mjs";

test("swings on a rising zig-zag are labelled HH / HL", () => {
  const bars = barsFromPath(120, upPath());
  const swings = detectSwings(bars, 3);
  const labels = swings.slice(2).map((s) => s.label);
  assert.ok(labels.length >= 4);
  assert.ok(labels.every((l) => l === "HH" || l === "HL"), labels.join(","));
});

test("swings on a falling zig-zag are labelled LH / LL and the last event is a bearish BOS", () => {
  const bars = barsFromPath(120, downPath());
  const s = structureAt(bars, detectSwings(bars, 3), bars.length - 1);
  assert.equal(s.pattern, "LH_LL");
  assert.equal(s.lastEvent?.type, "BOS");
  assert.equal(s.lastEvent?.direction, "DOWN");
});

test("a swing is only visible after its confirmation bars have closed (no look-ahead)", () => {
  const bars = barsFromPath(120, upPath());
  const swings = detectSwings(bars, 3);
  for (const swing of swings) {
    assert.equal(swing.confirmIndex, swing.index + 3);
  }
  const first = swings[0];
  const before = structureAt(bars, swings, first.confirmIndex - 1);
  assert.ok(!before.swings.some((s) => s.index === first.index));
});

test("a break against the prevailing structure is a CHoCH", () => {
  // Rise for 100 bars, then fall hard.
  const path = (i) => (i < 100 ? upPath()(i) : upPath()(100) - 4 * (i - 100));
  const bars = barsFromPath(140, path);
  const s = structureAt(bars, detectSwings(bars, 3), bars.length - 1);
  assert.ok(s.events.some((e) => e.type === "CHOCH" && e.direction === "DOWN"));
});
