export type Phase7CDailyPnlStopUnit = "USD" | "PERCENT";

export interface Phase7CDailyPnlStopState {
  version: number;
  updatedAt: string | null;
  updatedBy: string;
  enabled: boolean;
  unit: Phase7CDailyPnlStopUnit;
  dailyLossLimit: number | null;
  dailyProfitTarget: number | null;
}

export type Phase7CDailyPnlStopReason =
  | "DISABLED"
  | "WITHIN_LIMITS"
  | "DAILY_LOSS_LIMIT_HIT"
  | "DAILY_PROFIT_TARGET_HIT"
  | "CONFIG_INVALID"
  | "DATA_UNAVAILABLE";

export interface Phase7CDailyPnlStopDecision {
  applyPolicy: string;
  enabled: boolean;
  unit: Phase7CDailyPnlStopUnit | null;
  dailyLossLimit: number | null;
  dailyProfitTarget: number | null;
  configVersion: number | null;
  dayStartTime: number | null;
  blocked: boolean;
  reason: Phase7CDailyPnlStopReason;
  error?: string | null;
  realizedPnl?: number;
  floatingPnl?: number;
  dayPnl?: number;
  baseBalance?: number | null;
  lossLimitUsd?: number | null;
  profitTargetUsd?: number | null;
  dealCount?: number;
  openPositionCount?: number;
}

export type Phase7CDailyPnlStopReadResult =
  | { valid: true; persisted: boolean; state: Phase7CDailyPnlStopState; error: null; filePath: string }
  | { valid: false; persisted: true; state: null; error: string; filePath: string };

export const DAILY_PNL_STOP_FILE_ENV: string;
export const DAILY_PNL_STOP_DEFAULT_FILE_NAME: string;
export const DAILY_PNL_STOP_UNITS: readonly Phase7CDailyPnlStopUnit[];
export const DAILY_PNL_STOP_MAX_USD: number;
export const DAILY_PNL_STOP_MAX_PERCENT: number;
export const DAILY_PNL_STOP_APPLY_POLICY: string;

export function resolveDailyPnlStopFile(env?: Record<string, string | undefined>, cwd?: string): string;
export function createDefaultDailyPnlStopState(): Phase7CDailyPnlStopState;
export function validateDailyPnlStopState(
  raw: unknown,
): { valid: true; error: null; state: Phase7CDailyPnlStopState } | { valid: false; error: string; state?: undefined };
export function readDailyPnlStopConfig(filePath?: string): Phase7CDailyPnlStopReadResult;
export function summarizeDailyPnl(input: { deals: readonly unknown[]; positions: readonly unknown[] }): {
  dealCount: number;
  openPositionCount: number;
  realizedPnl: number;
  floatingPnl: number;
  dayPnl: number;
};
export function evaluateDailyPnlStop(input: {
  config: unknown;
  dayStartTime: number | null | undefined;
  realizedPnl: number;
  floatingPnl?: number;
  accountBalance?: number | null;
}): Phase7CDailyPnlStopDecision;
export function checkDailyPnlStopBeforeEntry(input: {
  filePath?: string;
  historyEndTime: number;
  accountBalance?: number | null;
  fetchDayBoundary: () => Promise<{ currentStartTime?: number | null } | null | undefined>;
  fetchDeals: (fromMs: number, toMs: number) => Promise<unknown>;
  fetchPositions: () => Promise<unknown>;
}): Promise<Phase7CDailyPnlStopDecision>;
export function checkDailyPnlStopViaControlApi(input: {
  filePath?: string;
  fetchStatus: () => Promise<unknown>;
}): Promise<Phase7CDailyPnlStopDecision>;
