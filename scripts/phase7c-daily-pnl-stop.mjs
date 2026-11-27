// Phase 7C daily loss limit / daily profit target — single source for TREND,
// SIDEWAY and the API/Web view.
//
// When the operator turns it on and today's XAUUSD P/L reaches either limit,
// the controllers stop opening NEW positions until the next broker trading day.
// Nothing is closed or modified: open positions keep their normal management
// (SL/BE/partial/trailing). BOT_MODE is not changed.
//
// Default: OFF (no file, or enabled=false) -> no extra broker calls, the frozen
// baseline behaves exactly as before.
//
// Day boundary: MT5 D1 current bar of the symbol (broker server midnight), read
// from the bridge `/v1/session/day-boundary/{symbol}` (same source as Daily
// Recovery). A new D1 bar resets the day, so the bot resumes automatically.
//
// Day P/L = realized net P/L (profit + commission + swap + fee) of every XAUUSD
// trading deal since the day start, any magic (bot TREND/SIDEWAY and manual/SEMI
// trades alike), plus floating P/L (profit + swap + commission) of open XAUUSD
// positions.
//
// Units: USD, or PERCENT of the balance at the start of the broker day
// (current balance minus today's realized XAUUSD P/L).
//
// Fail closed: while enabled, an unreadable/invalid config file or missing broker
// data blocks new entries (never opens a position on unknown risk state).
//
// Data path: the API computes the status from the canonical deal ledger
// (`GET /api/v1/phase7c/daily-pnl-stop`); the controllers ask it through
// `checkDailyPnlStopViaControlApi` right before a new order, so they never
// aggregate broker deal history themselves.

import fs from "node:fs";
import path from "node:path";

export const DAILY_PNL_STOP_FILE_ENV = "PHASE7C_DAILY_PNL_STOP_FILE";
export const DAILY_PNL_STOP_DEFAULT_FILE_NAME = "phase7c-daily-pnl-stop.json";
export const DAILY_PNL_STOP_UNITS = Object.freeze(["USD", "PERCENT"]);
export const DAILY_PNL_STOP_MAX_USD = 1_000_000;
export const DAILY_PNL_STOP_MAX_PERCENT = 50;
export const DAILY_PNL_STOP_APPLY_POLICY = "NEW_ENTRIES_ONLY_UNTIL_NEXT_BROKER_DAY";

const STATE_KEYS = Object.freeze([
  "version",
  "updatedAt",
  "updatedBy",
  "enabled",
  "unit",
  "dailyLossLimit",
  "dailyProfitTarget",
]);

const EPSILON = 1e-9;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Same runtime-root rule as the canonical deal ledger, so API and controllers
// agree on one file: PHASE7C_DAILY_PNL_STOP_FILE > PHASE7C_RUNTIME_ROOT >
// PHASE7B_DEMO_WORK_DIR/.. > <cwd>/.runtime.
export function resolveDailyPnlStopFile(env = process.env, cwd = process.cwd()) {
  const configured = env?.[DAILY_PNL_STOP_FILE_ENV];
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.trim());
  }
  const runtimeRoot = env?.PHASE7C_RUNTIME_ROOT;
  if (typeof runtimeRoot === "string" && runtimeRoot.trim()) {
    return path.resolve(runtimeRoot.trim(), DAILY_PNL_STOP_DEFAULT_FILE_NAME);
  }
  const demoDir = env?.PHASE7B_DEMO_WORK_DIR;
  if (typeof demoDir === "string" && demoDir.trim()) {
    return path.resolve(demoDir.trim(), "..", DAILY_PNL_STOP_DEFAULT_FILE_NAME);
  }
  return path.resolve(cwd, ".runtime", DAILY_PNL_STOP_DEFAULT_FILE_NAME);
}

export function createDefaultDailyPnlStopState() {
  return {
    version: 0,
    updatedAt: null,
    updatedBy: "DEFAULT",
    enabled: false,
    unit: "USD",
    dailyLossLimit: null,
    dailyProfitTarget: null,
  };
}

function validateLimit(name, value, unit) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return `${name} must be null (off) or a positive number; received ${JSON.stringify(value)}.`;
  }
  const cap = unit === "PERCENT" ? DAILY_PNL_STOP_MAX_PERCENT : DAILY_PNL_STOP_MAX_USD;
  if (value > cap + EPSILON) {
    return `${name} must be at most ${cap} ${unit}; received ${value}.`;
  }
  return null;
}

/** Validate a persisted (or candidate) state. Exact keys; numbers must be real numbers. */
export function validateDailyPnlStopState(raw) {
  if (!isRecord(raw)) return { valid: false, error: "Daily P/L stop state must be an object." };
  const keys = Object.keys(raw).sort();
  const expected = [...STATE_KEYS].sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    return { valid: false, error: `Daily P/L stop state must contain exactly: ${STATE_KEYS.join(", ")}.` };
  }
  if (!Number.isInteger(raw.version) || raw.version < 0) {
    return { valid: false, error: "version must be a non-negative integer." };
  }
  if (typeof raw.enabled !== "boolean") {
    return { valid: false, error: "enabled must be true or false." };
  }
  if (!DAILY_PNL_STOP_UNITS.includes(raw.unit)) {
    return { valid: false, error: `unit must be one of ${DAILY_PNL_STOP_UNITS.join("/")}.` };
  }
  const lossError = validateLimit("dailyLossLimit", raw.dailyLossLimit, raw.unit);
  if (lossError) return { valid: false, error: lossError };
  const profitError = validateLimit("dailyProfitTarget", raw.dailyProfitTarget, raw.unit);
  if (profitError) return { valid: false, error: profitError };
  if (raw.enabled && raw.dailyLossLimit === null && raw.dailyProfitTarget === null) {
    return { valid: false, error: "Enable requires a daily loss limit, a daily profit target, or both." };
  }
  return {
    valid: true,
    error: null,
    state: {
      version: raw.version,
      updatedAt: raw.updatedAt === null ? null : String(raw.updatedAt),
      updatedBy: String(raw.updatedBy),
      enabled: raw.enabled,
      unit: raw.unit,
      dailyLossLimit: raw.dailyLossLimit,
      dailyProfitTarget: raw.dailyProfitTarget,
    },
  };
}

/** Read the config file. Missing file = virtual OFF default. */
export function readDailyPnlStopConfig(filePath = resolveDailyPnlStopFile()) {
  if (!fs.existsSync(filePath)) {
    return { valid: true, persisted: false, state: createDefaultDailyPnlStopState(), error: null, filePath };
  }
  try {
    const validation = validateDailyPnlStopState(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (!validation.valid) {
      return { valid: false, persisted: true, state: null, error: validation.error, filePath };
    }
    return { valid: true, persisted: true, state: validation.state, error: null, filePath };
  } catch (error) {
    return {
      valid: false,
      persisted: true,
      state: null,
      error: error instanceof Error ? error.message : String(error),
      filePath,
    };
  }
}

function dealNetPnl(deal) {
  const net = Number(deal?.netPnl);
  if (deal?.netPnl !== undefined && deal?.netPnl !== null && Number.isFinite(net)) return net;
  return ["profit", "commission", "swap", "fee"]
    .map((key) => Number(deal?.[key] ?? 0))
    .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

/** Today's realized (trading deals, any magic) + floating P/L of the symbol. */
export function summarizeDailyPnl({ deals, positions }) {
  let dealCount = 0;
  let realizedPnl = 0;
  for (const deal of deals ?? []) {
    if (deal?.isTradingDeal !== true) continue;
    dealCount += 1;
    realizedPnl += dealNetPnl(deal);
  }
  let floatingPnl = 0;
  for (const position of positions ?? []) {
    for (const key of ["profit", "swap", "commission"]) {
      const value = Number(position?.[key] ?? 0);
      if (Number.isFinite(value)) floatingPnl += value;
    }
  }
  return {
    dealCount,
    openPositionCount: (positions ?? []).length,
    realizedPnl: round2(realizedPnl),
    floatingPnl: round2(floatingPnl),
    dayPnl: round2(realizedPnl + floatingPnl),
  };
}

function baseResult(state, dayStartTime) {
  return {
    applyPolicy: DAILY_PNL_STOP_APPLY_POLICY,
    enabled: Boolean(state?.enabled),
    unit: state?.unit ?? null,
    dailyLossLimit: state?.dailyLossLimit ?? null,
    dailyProfitTarget: state?.dailyProfitTarget ?? null,
    configVersion: state?.version ?? null,
    dayStartTime: Number.isFinite(Number(dayStartTime)) && Number(dayStartTime) > 0 ? Number(dayStartTime) : null,
  };
}

/** Pure decision. `blocked=true` means: do not open a new position now. */
export function evaluateDailyPnlStop({ config, dayStartTime, realizedPnl, floatingPnl, accountBalance }) {
  const validation = validateDailyPnlStopState(config);
  if (!validation.valid) {
    return { ...baseResult(null, dayStartTime), enabled: true, blocked: true, reason: "CONFIG_INVALID", error: validation.error };
  }
  const state = validation.state;
  const base = baseResult(state, dayStartTime);
  if (!state.enabled) {
    return { ...base, blocked: false, reason: "DISABLED" };
  }

  const realized = Number(realizedPnl);
  const floating = Number(floatingPnl ?? 0);
  if (!base.dayStartTime || !Number.isFinite(realized) || !Number.isFinite(floating)) {
    return { ...base, blocked: true, reason: "DATA_UNAVAILABLE", error: "Broker day boundary or P/L is unavailable." };
  }
  const dayPnl = round2(realized + floating);

  let baseBalance = null;
  let lossLimitUsd = state.dailyLossLimit;
  let profitTargetUsd = state.dailyProfitTarget;
  if (state.unit === "PERCENT") {
    const balance = Number(accountBalance);
    baseBalance = Number.isFinite(balance) ? round2(balance - realized) : null;
    if (!(baseBalance > 0)) {
      return {
        ...base,
        realizedPnl: round2(realized),
        floatingPnl: round2(floating),
        dayPnl,
        blocked: true,
        reason: "DATA_UNAVAILABLE",
        error: "Account balance is required for percent limits.",
      };
    }
    lossLimitUsd = lossLimitUsd === null ? null : round2((baseBalance * lossLimitUsd) / 100);
    profitTargetUsd = profitTargetUsd === null ? null : round2((baseBalance * profitTargetUsd) / 100);
  }

  const result = {
    ...base,
    realizedPnl: round2(realized),
    floatingPnl: round2(floating),
    dayPnl,
    baseBalance,
    lossLimitUsd,
    profitTargetUsd,
  };
  if (lossLimitUsd !== null && dayPnl <= -lossLimitUsd + EPSILON) {
    return { ...result, blocked: true, reason: "DAILY_LOSS_LIMIT_HIT" };
  }
  if (profitTargetUsd !== null && dayPnl >= profitTargetUsd - EPSILON) {
    return { ...result, blocked: true, reason: "DAILY_PROFIT_TARGET_HIT" };
  }
  return { ...result, blocked: false, reason: "WITHIN_LIMITS" };
}

/**
 * Pre-entry gate used by the controllers right before a new order.
 * Fetchers are injected so the same logic runs in TREND (TS), SIDEWAY (mjs)
 * and the API, and can be unit-tested without MT5.
 *   fetchDayBoundary(): { currentStartTime }
 *   fetchDeals(fromMs, toMs): deal[]   (symbol-filtered)
 *   fetchPositions(): position[]        (symbol-filtered)
 */
export async function checkDailyPnlStopBeforeEntry({
  filePath = resolveDailyPnlStopFile(),
  historyEndTime,
  accountBalance,
  fetchDayBoundary,
  fetchDeals,
  fetchPositions,
}) {
  const configRead = readDailyPnlStopConfig(filePath);
  if (!configRead.valid) {
    return { ...baseResult(null, null), enabled: true, blocked: true, reason: "CONFIG_INVALID", error: configRead.error };
  }
  const state = configRead.state;
  if (!state.enabled) {
    return { ...baseResult(state, null), blocked: false, reason: "DISABLED" };
  }

  try {
    const boundary = await fetchDayBoundary();
    const dayStartTime = Number(boundary?.currentStartTime);
    if (!Number.isFinite(dayStartTime) || dayStartTime <= 0) {
      throw new Error("Broker day boundary is invalid.");
    }
    const endTime = Number(historyEndTime);
    if (!Number.isFinite(endTime) || endTime <= 0) {
      throw new Error("History end time is invalid.");
    }
    const deals = endTime > dayStartTime ? await fetchDeals(dayStartTime, endTime) : [];
    if (!Array.isArray(deals)) throw new Error("Deal history is invalid.");
    const positions = await fetchPositions();
    if (!Array.isArray(positions)) throw new Error("Position list is invalid.");
    const summary = summarizeDailyPnl({ deals, positions });
    return {
      ...evaluateDailyPnlStop({
        config: state,
        dayStartTime,
        realizedPnl: summary.realizedPnl,
        floatingPnl: summary.floatingPnl,
        accountBalance,
      }),
      dealCount: summary.dealCount,
      openPositionCount: summary.openPositionCount,
    };
  } catch (error) {
    return {
      ...baseResult(state, null),
      blocked: true,
      reason: "DATA_UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const STATUS_REASONS = new Set([
  "DISABLED",
  "WITHIN_LIMITS",
  "DAILY_LOSS_LIMIT_HIT",
  "DAILY_PROFIT_TARGET_HIT",
  "CONFIG_INVALID",
  "DATA_UNAVAILABLE",
]);

/**
 * Controller-side pre-entry gate. The control API (which owns the config file
 * the web UI writes and the canonical deal ledger) is the authority:
 *   - API status DISABLED            -> allow (baseline unchanged)
 *   - API status WITHIN_LIMITS       -> allow
 *   - any other API status           -> block
 * If the API cannot be reached or answers garbage, the controller falls back to
 * its own copy of the config: OFF -> allow (an API outage never changes the old
 * behaviour), ON or corrupt -> block (fail closed).
 * A local config that is ON while the API says DISABLED also blocks, because it
 * means the two processes read different files.
 *   fetchStatus(): body of GET /api/v1/phase7c/daily-pnl-stop
 */
export async function checkDailyPnlStopViaControlApi({
  filePath = resolveDailyPnlStopFile(),
  fetchStatus,
}) {
  const local = readDailyPnlStopConfig(filePath);
  let body = null;
  let apiError = null;
  try {
    body = await fetchStatus();
  } catch (error) {
    apiError = error instanceof Error ? error.message : String(error);
  }
  const status = isRecord(body) ? body.status : null;
  const apiValid = isRecord(status) && STATUS_REASONS.has(status.reason) && typeof status.blocked === "boolean";

  if (apiValid) {
    if (status.reason === "DISABLED") {
      if (!local.valid) {
        return { ...baseResult(null, null), enabled: true, blocked: true, reason: "CONFIG_INVALID", error: local.error, source: "LOCAL_FILE" };
      }
      if (local.state.enabled) {
        return {
          ...baseResult(local.state, null),
          blocked: true,
          reason: "DATA_UNAVAILABLE",
          error: "Controller config is ON but the control API reports OFF; check PHASE7C_DAILY_PNL_STOP_FILE / PHASE7C_RUNTIME_ROOT.",
          source: "LOCAL_FILE",
        };
      }
      return { ...status, blocked: false, source: "CONTROL_API" };
    }
    return { ...status, blocked: status.blocked === true || status.reason !== "WITHIN_LIMITS", source: "CONTROL_API" };
  }

  const reason = apiError ?? (isRecord(body) && body.statusError) ?? "Daily P/L stop status is missing from the control API.";
  if (!local.valid) {
    return { ...baseResult(null, null), enabled: true, blocked: true, reason: "CONFIG_INVALID", error: local.error, source: "LOCAL_FILE" };
  }
  if (!local.state.enabled) {
    return { ...baseResult(local.state, null), blocked: false, reason: "DISABLED", source: "LOCAL_FILE", apiError: String(reason) };
  }
  return { ...baseResult(local.state, null), blocked: true, reason: "DATA_UNAVAILABLE", error: String(reason), source: "LOCAL_FILE" };
}
