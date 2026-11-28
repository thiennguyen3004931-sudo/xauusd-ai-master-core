// Backtest page (offline replay). Mirrors scripts/backtest/phase7c-backtest-web.mjs.

export type BacktestStrategy = "TREND" | "SIDEWAY";
export type PartialFraction = "1/4" | "1/3" | "1/2";

export type OfflineBacktestRequest = {
  strategies: BacktestStrategy[];
  from: string | null;
  to: string | null;
  lot: number;
  maxInitialStopPrice: number;
  breakEven: { enabled: boolean; triggerPrice: number; offsetPrice: number };
  fixedTp: { enabled: boolean; price: number };
  partial: { enabled: boolean; triggerPrice: number; fraction: PartialFraction };
  fastMove: { enabled: boolean; activationPrice: number; givebackPrice: number };
  m5Trail: { enabled: boolean };
  runnerExits: { enabled: boolean };
  costs: { commissionPerLot: number; slippagePrice: number; minSpreadPoints: number };
};

export type BacktestMetrics = {
  trades: number;
  netUsd: number;
  /** null = no losing trade (∞) */
  profitFactor: number | null;
  expectancyUsd: number;
  avgR: number;
  winRate: number;
  maxDrawdownUsd: number;
  maxDrawdownR: number;
};

export type ResearchNotice = { overfitWarning: string; knownOutOfSample: string[]; acceptance: string };

export type OfflineBacktestStatus = {
  safety: string;
  files: { dataDir: string; m5: string | null; m15: string | null };
  prepareCommand: string;
  defaults: OfflineBacktestRequest;
  limits: Record<string, [number, number]>;
  research: ResearchNotice;
  dataset: { m5Bars: number; m15Bars: number; from: string; to: string; cacheReady: boolean } | null;
  problem: { code: string; error: string } | null;
};

export type EquityPoint = { time: number; equityUsd: number; cumR: number };

export type BacktestTrade = {
  strategy: BacktestStrategy;
  side: "BUY" | "SELL";
  regime: string | null;
  entryTime: number;
  exitTime: number;
  entry: number;
  initialStop: number;
  pnlUsd: number;
  r: number;
  exitReason: string;
  breakEvenApplied: boolean;
  partialApplied: boolean;
};

export type OfflineBacktestResult = {
  kind: "phase7c-web-backtest";
  safety: string;
  generatedAt: string;
  elapsedMs: number;
  request: OfflineBacktestRequest;
  isBaseline: boolean;
  data: { m5Bars: number; m15Bars: number; from: string; to: string; window: { from: string | null; to: string | null } | null };
  costs: { execution: string; spread: string; commissionPerLotRoundTurn: number; slippagePrice: number };
  notModelled: string[];
  summary: BacktestMetrics;
  bySide: Record<string, BacktestMetrics>;
  byStrategy: Record<string, BacktestMetrics>;
  byStrategySide: Record<string, BacktestMetrics>;
  byRegime: Record<string, BacktestMetrics>;
  byMonth: Record<string, BacktestMetrics>;
  exitReasons: Record<string, number>;
  halves: { splitAt: string; first: BacktestMetrics; second: BacktestMetrics } | null;
  baseline: { summary: BacktestMetrics; bySide: Record<string, BacktestMetrics>; byStrategy: Record<string, BacktestMetrics> } | null;
  equity: EquityPoint[];
  baselineEquity: EquityPoint[] | null;
  tradesTotal: number;
  trades: BacktestTrade[];
  verdict: string[];
  research: ResearchNotice;
};
