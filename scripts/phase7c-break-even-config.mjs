// Phase 7C break-even (BE) configuration — single source for TREND, SIDEWAY
// and SEMI (which inherits TREND management).
//
// Defaults keep the frozen baseline exactly: +6 price units -> SL to entry
// (offset 0). Values are read once at controller start from:
//   ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE  (4..15, default 6)
//   ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE   (0..3,  default 0, must be < trigger)
// An invalid value fails closed: the controller refuses to start instead of
// silently trading a different rule. The resolved values are snapshotted into
// the pending entry and the managed position at entry (NEW_POSITIONS_ONLY);
// an open position keeps its own snapshot across restarts and env changes.
// Positions persisted before this change carry no snapshot and keep 6/0.

import {
  stopIsAtLeastAsTight,
  stopStrictlyTightens,
} from "./phase7c-stop-monotonicity.mjs";

export const DEFAULT_BREAK_EVEN_TRIGGER_PRICE = 6;
export const DEFAULT_BREAK_EVEN_OFFSET_PRICE = 0;
export const BREAK_EVEN_TRIGGER_MIN_PRICE = 4;
export const BREAK_EVEN_TRIGGER_MAX_PRICE = 15;
export const BREAK_EVEN_OFFSET_MIN_PRICE = 0;
export const BREAK_EVEN_OFFSET_MAX_PRICE = 3;
export const BREAK_EVEN_TRIGGER_ENV = "ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE";
export const BREAK_EVEN_OFFSET_ENV = "ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE";
export const BREAK_EVEN_APPLY_POLICY = "NEW_POSITIONS_ONLY";

const EPSILON = 1e-9;

function parseEnvNumber(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { value: fallback, source: "DEFAULT" };
  }
  const text = String(raw).trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) {
    throw new Error(`${name} must be a plain non-negative number; received "${text}".`);
  }
  return { value: Number(text), source: "ENV" };
}

export function validateBreakEvenConfig(triggerPrice, offsetPrice) {
  const trigger = Number(triggerPrice);
  const offset = Number(offsetPrice);
  if (!Number.isFinite(trigger) || trigger < BREAK_EVEN_TRIGGER_MIN_PRICE - EPSILON || trigger > BREAK_EVEN_TRIGGER_MAX_PRICE + EPSILON) {
    return { valid: false, reason: `breakEvenTriggerPrice must be within ${BREAK_EVEN_TRIGGER_MIN_PRICE}..${BREAK_EVEN_TRIGGER_MAX_PRICE}; received ${triggerPrice}.` };
  }
  if (!Number.isFinite(offset) || offset < BREAK_EVEN_OFFSET_MIN_PRICE - EPSILON || offset > BREAK_EVEN_OFFSET_MAX_PRICE + EPSILON) {
    return { valid: false, reason: `breakEvenOffsetPrice must be within ${BREAK_EVEN_OFFSET_MIN_PRICE}..${BREAK_EVEN_OFFSET_MAX_PRICE}; received ${offsetPrice}.` };
  }
  if (!(offset < trigger - EPSILON)) {
    return { valid: false, reason: `breakEvenOffsetPrice (${offset}) must be lower than breakEvenTriggerPrice (${trigger}).` };
  }
  return { valid: true, reason: "BREAK_EVEN_CONFIG_VALID", breakEvenTriggerPrice: trigger, breakEvenOffsetPrice: offset };
}

/** Resolve the process-wide BE config. Throws on any invalid value (fail closed). */
export function resolvePhase7CBreakEvenConfig(env = process.env) {
  const trigger = parseEnvNumber(env, BREAK_EVEN_TRIGGER_ENV, DEFAULT_BREAK_EVEN_TRIGGER_PRICE);
  const offset = parseEnvNumber(env, BREAK_EVEN_OFFSET_ENV, DEFAULT_BREAK_EVEN_OFFSET_PRICE);
  const validation = validateBreakEvenConfig(trigger.value, offset.value);
  if (!validation.valid) {
    throw new Error(`Phase7C break-even config invalid; refusing to start: ${validation.reason}`);
  }
  return Object.freeze({
    breakEvenTriggerPrice: validation.breakEvenTriggerPrice,
    breakEvenOffsetPrice: validation.breakEvenOffsetPrice,
    source: trigger.source === "DEFAULT" && offset.source === "DEFAULT" ? "DEFAULT" : "ENV",
    applyPolicy: BREAK_EVEN_APPLY_POLICY,
  });
}

/** Plain JSON snapshot stored on the pending entry / managed position. */
export function breakEvenSnapshot(config) {
  return {
    breakEvenTriggerPrice: Number(config.breakEvenTriggerPrice),
    breakEvenOffsetPrice: Number(config.breakEvenOffsetPrice),
    source: String(config.source ?? "DEFAULT"),
    applyPolicy: BREAK_EVEN_APPLY_POLICY,
  };
}

/** Legacy (pre-snapshot) positions keep the frozen 6/0 rule. */
export function legacyBreakEvenSnapshot() {
  return {
    breakEvenTriggerPrice: DEFAULT_BREAK_EVEN_TRIGGER_PRICE,
    breakEvenOffsetPrice: DEFAULT_BREAK_EVEN_OFFSET_PRICE,
    source: "LEGACY_DEFAULT",
    applyPolicy: BREAK_EVEN_APPLY_POLICY,
  };
}

/** Snapshot to persist for a new position: carried from pending when present. */
export function entryBreakEvenSnapshot(pendingSnapshot, processConfig) {
  if (pendingSnapshot && validateBreakEvenConfig(pendingSnapshot.breakEvenTriggerPrice, pendingSnapshot.breakEvenOffsetPrice).valid) {
    return breakEvenSnapshot(pendingSnapshot);
  }
  return processConfig ? breakEvenSnapshot(processConfig) : legacyBreakEvenSnapshot();
}

/** BE rule that applies to an already-managed position. */
export function managedBreakEven(managed) {
  const snapshot = managed?.breakEven;
  if (!snapshot) return legacyBreakEvenSnapshot();
  const validation = validateBreakEvenConfig(snapshot.breakEvenTriggerPrice, snapshot.breakEvenOffsetPrice);
  // A corrupted persisted snapshot must never loosen protection: fall back
  // to the frozen 6/0 rule.
  if (!validation.valid) return { ...legacyBreakEvenSnapshot(), source: "LEGACY_DEFAULT_INVALID_SNAPSHOT" };
  return breakEvenSnapshot(snapshot);
}

export function managedBreakEvenTriggerPrice(managed) {
  return managedBreakEven(managed).breakEvenTriggerPrice;
}

export function breakEvenStopPrice(side, entry, offsetPrice) {
  const normalized = String(side ?? "").trim().toUpperCase();
  const base = Number(entry);
  const offset = Number(offsetPrice);
  if (!(base > 0) || !Number.isFinite(offset) || (normalized !== "BUY" && normalized !== "SELL")) return 0;
  return normalized === "BUY" ? base + offset : base - offset;
}

function roundToDigits(value, digits) {
  const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(Number(digits) || 0)));
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Decide the +trigger BE step for one cycle.
 * Returns ALREADY_AT_OR_TIGHTER (no broker command, mark applied),
 * MODIFY (send stopLoss), or BROKER_GAP_WAIT (candidate violates the broker
 * stop/freeze distance; keep current SL and retry next cycle).
 * The candidate only ever tightens the stop.
 */
export function evaluateBreakEvenStop({
  side,
  entry,
  currentStop,
  offsetPrice,
  bid,
  ask,
  point = 0,
  stopsLevelTicks = 0,
  freezeLevelTicks = 0,
  digits = 2,
}) {
  const candidate = roundToDigits(breakEvenStopPrice(side, entry, offsetPrice), digits);
  if (!(candidate > 0)) return { action: "INVALID", stopLoss: 0, reason: "BREAK_EVEN_INPUT_INVALID" };
  if (stopIsAtLeastAsTight(side, Number(currentStop), candidate)) {
    return { action: "ALREADY_AT_OR_TIGHTER", stopLoss: candidate, reason: "STOP_ALREADY_AT_OR_TIGHTER" };
  }
  if (!stopStrictlyTightens(side, Number(currentStop), candidate)) {
    return { action: "INVALID", stopLoss: candidate, reason: "BREAK_EVEN_WOULD_NOT_TIGHTEN" };
  }
  const gap = Math.max(0, Number(stopsLevelTicks) || 0, Number(freezeLevelTicks) || 0) * Math.max(0, Number(point) || 0);
  const marketBid = Number(bid);
  const marketAsk = Number(ask);
  const normalized = String(side).toUpperCase();
  const validAgainstMarket = normalized === "BUY"
    ? Number.isFinite(marketBid) && candidate < marketBid - gap
    : Number.isFinite(marketAsk) && candidate > marketAsk + gap;
  if (!validAgainstMarket) {
    return { action: "BROKER_GAP_WAIT", stopLoss: candidate, reason: "BROKER_STOP_OR_FREEZE_GAP", minimumGap: gap };
  }
  return { action: "MODIFY", stopLoss: candidate, reason: "BREAK_EVEN_TIGHTEN", minimumGap: gap };
}
