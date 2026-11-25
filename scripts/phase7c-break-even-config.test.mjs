// T2 — configurable break-even (BE) for TREND / SIDEWAY / SEMI. Source-only, no MT5.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BREAK_EVEN_OFFSET_PRICE,
  DEFAULT_BREAK_EVEN_TRIGGER_PRICE,
  breakEvenSnapshot,
  breakEvenStopPrice,
  entryBreakEvenSnapshot,
  evaluateBreakEvenStop,
  managedBreakEven,
  managedBreakEvenTriggerPrice,
  resolvePhase7CBreakEvenConfig,
  validateBreakEvenConfig,
} from "./phase7c-break-even-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const TREND = "scripts/run-phase7b-demo-controller.ts";
const SIDEWAY = "scripts/run-phase7c-sideway-controller.mjs";
const SEMI = "scripts/phase7c-semi-trend-adoption-runtime.mjs";

test("defaults keep the frozen baseline: +6 -> SL exactly at entry", () => {
  assert.equal(DEFAULT_BREAK_EVEN_TRIGGER_PRICE, 6);
  assert.equal(DEFAULT_BREAK_EVEN_OFFSET_PRICE, 0);
  const cfg = resolvePhase7CBreakEvenConfig({});
  assert.equal(cfg.breakEvenTriggerPrice, 6);
  assert.equal(cfg.breakEvenOffsetPrice, 0);
  assert.equal(cfg.source, "DEFAULT");
  assert.equal(cfg.applyPolicy, "NEW_POSITIONS_ONLY");
  assert.deepEqual(resolvePhase7CBreakEvenConfig({ ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: " ", ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "" }).breakEvenTriggerPrice, 6);
});

test("valid env values are accepted", () => {
  const cfg = resolvePhase7CBreakEvenConfig({
    ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "8",
    ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "1.5",
  });
  assert.equal(cfg.breakEvenTriggerPrice, 8);
  assert.equal(cfg.breakEvenOffsetPrice, 1.5);
  assert.equal(cfg.source, "ENV");
  for (const [t, o] of [[4, 0], [15, 3], [10, 2]]) assert.equal(validateBreakEvenConfig(t, o).valid, true, `${t}/${o}`);
});

test("invalid config fails closed (controller must refuse to start)", () => {
  const bad = [
    { ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "3.9" },
    { ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "15.1" },
    { ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "abc" },
    { ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "-6" },
    { ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "1e1" },
    { ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "3.5" },
    { ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "-0.5" },
    { ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "NaN" },
  ];
  for (const env of bad) {
    assert.throws(() => resolvePhase7CBreakEvenConfig(env), /refusing to start|plain non-negative/, JSON.stringify(env));
  }
  assert.equal(validateBreakEvenConfig(4, 4).valid, false, "offset must be lower than trigger");
});

test("snapshot is NEW_POSITIONS_ONLY: managed positions keep their own rule", () => {
  const legacy = managedBreakEven({ ticket: "1" });
  assert.equal(legacy.breakEvenTriggerPrice, 6);
  assert.equal(legacy.breakEvenOffsetPrice, 0);
  assert.equal(legacy.source, "LEGACY_DEFAULT");

  const snap = breakEvenSnapshot(resolvePhase7CBreakEvenConfig({ ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "10", ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE: "2" }));
  const managed = { ticket: "2", breakEven: snap };
  // A later process restart with different env must not change this position.
  resolvePhase7CBreakEvenConfig({ ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "6" });
  assert.equal(managedBreakEvenTriggerPrice(managed), 10);
  assert.equal(managedBreakEven(managed).breakEvenOffsetPrice, 2);

  const corrupted = managedBreakEven({ breakEven: { breakEvenTriggerPrice: 99, breakEvenOffsetPrice: 0 } });
  assert.equal(corrupted.breakEvenTriggerPrice, 6);
  assert.equal(corrupted.source, "LEGACY_DEFAULT_INVALID_SNAPSHOT");

  const processCfg = resolvePhase7CBreakEvenConfig({ ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE: "8" });
  assert.equal(entryBreakEvenSnapshot(snap, processCfg).breakEvenTriggerPrice, 10, "pending snapshot wins");
  assert.equal(entryBreakEvenSnapshot(undefined, processCfg).breakEvenTriggerPrice, 8);
  assert.equal(entryBreakEvenSnapshot(undefined, null).breakEvenTriggerPrice, 6);
});

test("BE stop price: BUY entry+offset, SELL entry-offset", () => {
  assert.equal(breakEvenStopPrice("BUY", 2000, 0), 2000);
  assert.equal(breakEvenStopPrice("SELL", 2000, 0), 2000);
  assert.equal(breakEvenStopPrice("BUY", 2000, 1), 2001);
  assert.equal(breakEvenStopPrice("SELL", 2000, 1), 1999);
  assert.equal(breakEvenStopPrice("WAIT", 2000, 1), 0);
});

test("BE only tightens and respects broker stop/freeze level", () => {
  const base = { entry: 2000, offsetPrice: 0, point: 0.01, digits: 2 };
  // BUY at +6: SL 1992 -> 2000.
  assert.deepEqual(
    evaluateBreakEvenStop({ ...base, side: "BUY", currentStop: 1992, bid: 2006, ask: 2006.2 }).action,
    "MODIFY",
  );
  assert.equal(evaluateBreakEvenStop({ ...base, side: "BUY", currentStop: 1992, bid: 2006, ask: 2006.2 }).stopLoss, 2000);
  // SELL at +6: SL 2008 -> 2000.
  const sell = evaluateBreakEvenStop({ ...base, side: "SELL", currentStop: 2008, bid: 1993.8, ask: 1994 });
  assert.equal(sell.action, "MODIFY");
  assert.equal(sell.stopLoss, 2000);
  // Already tighter (e.g. FastMove/M5): never loosen.
  assert.equal(evaluateBreakEvenStop({ ...base, side: "BUY", currentStop: 2003, bid: 2010, ask: 2010.2 }).action, "ALREADY_AT_OR_TIGHTER");
  assert.equal(evaluateBreakEvenStop({ ...base, side: "SELL", currentStop: 1997, bid: 1990, ask: 1990.2 }).action, "ALREADY_AT_OR_TIGHTER");
  // Offset 2 at a +2.5 market with 100-point stops level: too close -> wait.
  const gap = evaluateBreakEvenStop({ ...base, offsetPrice: 2, side: "BUY", currentStop: 1992, bid: 2002.5, ask: 2002.7, stopsLevelTicks: 100 });
  assert.equal(gap.action, "BROKER_GAP_WAIT");
  const freeze = evaluateBreakEvenStop({ ...base, offsetPrice: 2, side: "SELL", currentStop: 2008, bid: 1997.3, ask: 1997.5, freezeLevelTicks: 100 });
  assert.equal(freeze.action, "BROKER_GAP_WAIT");
});

// ---------------------------------------------------------- wiring contract
const NEW_TRIGGER = "if (!managed.breakEvenApplied && favorable >= managedBreakEvenTriggerPrice(managed)) {";

test("TREND controller uses the shared BE source and snapshots at entry", () => {
  const src = read(TREND);
  assert.ok(!src.includes("favorable >= 6"), "literal +6 trigger must be gone");
  assert.ok(src.includes('from "./phase7c-break-even-config.mjs"'), "imports shared module");
  assert.ok(src.includes("const breakEvenConfig = resolvePhase7CBreakEvenConfig();"), "resolves config at start (fail closed)");
  assert.ok(src.includes(NEW_TRIGGER));
  assert.ok(src.includes("evaluateBreakEvenStop({"), "BE goes through the tighten/broker-gap helper");
  assert.ok(src.includes("breakEven: breakEvenSnapshot(breakEvenConfig),"), "pending entry snapshot");
  const managedSnapshots = src.split("breakEven: entryBreakEvenSnapshot(").length - 1;
  assert.ok(managedSnapshots >= 2, `managed snapshot on both fill paths (found ${managedSnapshots})`);
  assert.ok(src.includes("PLUS6_SL_TO_ENTRY"), "journal codes unchanged for observability");
});

test("SIDEWAY controller uses the shared BE source and snapshots at entry", () => {
  const src = read(SIDEWAY);
  assert.ok(!src.includes("favorable >= 6"));
  assert.ok(src.includes('from "./phase7c-break-even-config.mjs"'));
  assert.ok(src.includes("const breakEvenConfig = resolvePhase7CBreakEvenConfig();"));
  assert.ok(src.includes(NEW_TRIGGER));
  assert.ok(src.includes("evaluateBreakEvenStop({"));
  assert.ok(src.includes("breakEven: breakEvenSnapshot(breakEvenConfig),"));
  assert.ok(src.includes("breakEven: entryBreakEvenSnapshot("));
});

test("SEMI adoption snapshots the TREND BE rule", () => {
  const src = read(SEMI);
  assert.ok(src.includes('from "./phase7c-break-even-config.mjs"'));
  assert.ok(src.includes("breakEven: breakEvenSnapshot(resolvePhase7CBreakEvenConfig()),"));
});
