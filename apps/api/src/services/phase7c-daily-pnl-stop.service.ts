import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  checkDailyPnlStopBeforeEntry,
  readDailyPnlStopConfig,
  resolveDailyPnlStopFile,
  validateDailyPnlStopState,
} from "../../../../scripts/phase7c-daily-pnl-stop.mjs";
import type {
  Phase7CDailyPnlStopDecision,
  Phase7CDailyPnlStopReadResult,
  Phase7CDailyPnlStopUnit,
} from "../../../../scripts/phase7c-daily-pnl-stop.mjs";
import { getMt5Telemetry, type Mt5TelemetrySnapshot } from "./mt5.service";
import { getMt5TradingDayBoundary } from "./mt5-market.service";
import { getPhase7CCanonicalDeals } from "./phase7c-canonical-deal-ledger.service";
import { accountModeAllowsBroker, getPhase7CAccountModeState } from "./phase7c-account-mode.service";

export type Phase7CDailyPnlStopErrorCode =
  | "DAILY_PNL_STOP_CONFIG_INVALID"
  | "CONFIG_VERSION_CONFLICT";

export class Phase7CDailyPnlStopError extends Error {
  constructor(
    public readonly code: Phase7CDailyPnlStopErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Phase7CDailyPnlStopError";
  }
}

export interface Phase7CDailyPnlStopWriteInput {
  expectedVersion: number;
  source: string;
  enabled: boolean;
  unit: Phase7CDailyPnlStopUnit;
  dailyLossLimit: number | null;
  dailyProfitTarget: number | null;
}

const WRITE_KEYS = [
  "expectedVersion",
  "source",
  "enabled",
  "unit",
  "dailyLossLimit",
  "dailyProfitTarget",
] as const;

function hasExactWriteKeys(value: unknown): value is Phase7CDailyPnlStopWriteInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...WRITE_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function writeJsonAtomic(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export class Phase7CDailyPnlStopService {
  readonly filePath: string;

  constructor(filePath = resolveDailyPnlStopFile()) {
    this.filePath = filePath;
  }

  read(): Phase7CDailyPnlStopReadResult {
    return readDailyPnlStopConfig(this.filePath);
  }

  set(input: unknown): Phase7CDailyPnlStopReadResult {
    const current = this.read();
    if (!hasExactWriteKeys(input)) {
      throw new Phase7CDailyPnlStopError(
        "DAILY_PNL_STOP_CONFIG_INVALID",
        `Payload must contain exactly ${WRITE_KEYS.join(", ")}.`,
      );
    }
    if (input.source !== "web-control-center") {
      throw new Phase7CDailyPnlStopError(
        "DAILY_PNL_STOP_CONFIG_INVALID",
        "Only source=web-control-center is accepted.",
      );
    }
    // A corrupt file blocks new entries; the operator may overwrite it with a
    // valid config (version restarts above 0) to recover.
    const currentVersion = current.valid ? current.state.version : 0;
    if (current.valid && input.expectedVersion !== currentVersion) {
      throw new Phase7CDailyPnlStopError(
        "CONFIG_VERSION_CONFLICT",
        `Daily P/L stop version conflict: expected ${input.expectedVersion}, current ${currentVersion}.`,
      );
    }
    const candidate = {
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: input.source,
      enabled: input.enabled,
      unit: input.unit,
      dailyLossLimit: input.dailyLossLimit,
      dailyProfitTarget: input.dailyProfitTarget,
    };
    const validation = validateDailyPnlStopState(candidate);
    if (!validation.valid) {
      throw new Phase7CDailyPnlStopError("DAILY_PNL_STOP_CONFIG_INVALID", validation.error);
    }
    writeJsonAtomic(this.filePath, validation.state);
    return this.read();
  }

  /**
   * Status used by the web card AND by the TREND/SIDEWAY controllers right
   * before a new order. Never throws: broker/ledger problems while enabled
   * come back as blocked=DATA_UNAVAILABLE. OFF makes no broker calls.
   * Realized P/L comes from the canonical deal ledger (all magics, XAUUSD).
   */
  async status(symbol = "XAUUSD"): Promise<Phase7CDailyPnlStopDecision> {
    let telemetry: Mt5TelemetrySnapshot | null = null;
    const loadTelemetry = async () => {
      if (!telemetry) {
        const snapshot = await getMt5Telemetry(symbol);
        if (!snapshot.reachable || !snapshot.quote) {
          throw new Error(snapshot.message || "MT5 bridge is unreachable.");
        }
        if (!accountModeAllowsBroker(snapshot.health?.accountMode, getPhase7CAccountModeState())) {
          throw new Error("MT5 account mode does not match the configured Phase 7C account mode.");
        }
        telemetry = snapshot;
      }
      return telemetry;
    };
    const read = this.read();
    if (!read.valid || !read.state.enabled) {
      return checkDailyPnlStopBeforeEntry({
        filePath: this.filePath,
        historyEndTime: 0,
        fetchDayBoundary: async () => null,
        fetchDeals: async () => [],
        fetchPositions: async () => [],
      });
    }
    let accountBalance: number | null = null;
    let historyEndTime = 0;
    try {
      const snapshot = await loadTelemetry();
      accountBalance = snapshot.health?.accountBalance ?? null;
      historyEndTime = Number(snapshot.quote?.timestamp);
    } catch {
      // Reported by the fetchers below as DATA_UNAVAILABLE.
    }
    return checkDailyPnlStopBeforeEntry({
      filePath: this.filePath,
      historyEndTime,
      accountBalance,
      fetchDayBoundary: async () => {
        await loadTelemetry();
        return getMt5TradingDayBoundary(symbol);
      },
      fetchDeals: async (fromMs, toMs) =>
        getPhase7CCanonicalDeals({ telemetry: await loadTelemetry(), symbol, fromMs, toMs }),
      fetchPositions: async () => (await loadTelemetry()).positions,
    });
  }
}

export const phase7CDailyPnlStopService = new Phase7CDailyPnlStopService();
