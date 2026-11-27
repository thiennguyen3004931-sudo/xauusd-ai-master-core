// Type declarations for the TypeScript apps (API, web). The package itself is plain ESM JavaScript.
export interface Bar { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; tickVolume?: number }
export type RegimeState = "UPTREND" | "DOWNTREND" | "SIDEWAY" | "TRANSITION";
export interface Safety { readOnly: true; advisoryOnly: true; orderMutation: false; runtimeMutation: false }
export interface CriterionResult { id: string; description: string; weight: number; passed: boolean; value: unknown }
export interface TimeframeClassification {
  state: RegimeState; confidence: number; bestTemplate?: string; scores: Record<string, number>;
  criteria: Record<string, CriterionResult[]>; reasons: string[]; features: Record<string, unknown> | null;
}
export interface MarketClassification {
  libraryVersion: string; state: RegimeState; alignment: "ALIGNED" | "NEUTRAL" | "CONFLICT"; confidence: number;
  reasons: string[]; h4: TimeframeClassification; h1: TimeframeClassification; safety: Safety;
}
export interface Scenario {
  role: "PRIMARY" | "ALTERNATE"; direction: "BUY" | "SELL";
  entryZone: { low: number; high: number; sources: string[] }; entry: number; stopLoss: number;
  takeProfit1: number; takeProfit2: number; targetsSource: { tp1: string; tp2: string }; rr1: number; rr2: number;
  invalidation: { price: number; text: string }; m15: { status: "TRIGGERED" | "TOUCHED_NO_TRIGGER" | "WAITING"; triggers: { type: string; index: number }[] };
  confidence: number; confidenceBreakdown: { factor: string; points: number }[]; confidenceNote: string;
  botStopRule: { stopDistance: number; withinRule: boolean; note: string }; pricePositionInH1Leg: number | null;
}
export interface Level { price: number; low: number; high: number; touches: number; kind: "SUPPORT" | "RESISTANCE" }
export interface OrderBlock { index: number; direction: "BULLISH" | "BEARISH"; low: number; high: number }
export interface ScenarioResult {
  version: string; asOf: number; safety: Safety;
  h4: { state: RegimeState; confidence: number; bias: "BUY" | "SELL" | "RANGE" | "NONE"; keyLevels: Level[]; orderBlocks: OrderBlock[]; index: number };
  h1: { state: RegimeState; confidence: number; agreement: "AGREE" | "DISAGREE" | "NEUTRAL"; phase: string; keyLevels: Level[]; orderBlocks: OrderBlock[]; index: number };
  m15: { close: number; index: number }; scenarios: Scenario[]; notes: string[];
}
export const REGIME_LIBRARY_VERSION: string;
export const MTF_VERSION: string;
export const REGIME_LIBRARY_FLAG: string;
export const MTF_FLAG: string;
export const H1_MS: number;
export const H4_MS: number;
export const M15_MS: number;
export function isRegimeLibraryEnabled(env?: Record<string, string | undefined>): boolean;
export function isMtfEnabled(env?: Record<string, string | undefined>): boolean;
export function classifyMarket(input: { h4: Bar[]; h1: Bar[]; asOf?: number }): MarketClassification;
export function buildScenarios(input: { h4: Bar[]; h1: Bar[]; m15: Bar[]; asOf?: number }): ScenarioResult;
export function renderScenarioCharts(frames: { h4: Bar[]; h1: Bar[]; m15: Bar[] }, result: ScenarioResult): { h4: string; h1: string; m15: string };
export function lastClosedIndex(bars: Bar[], asOf: number): number;

// Feature 1 (C1): trade journal statistics.
export interface PerformanceStats {
  trades: number; wins: number; losses: number; breakeven: number; winRatePct: number | null;
  grossProfit: number; grossLoss: number; profitFactor: number | null; profitFactorInfinite: boolean;
  netPnl: number; expectancy: number | null; avgWin: number | null; avgLoss: number | null;
  payoffRatio: number | null; maxConsecutiveLosses: number; enoughSample: boolean;
}
export type GroupStats = PerformanceStats & { key: string };
export type Alignment = "WITH_TREND" | "AGAINST_TREND" | "SIDEWAY" | "TRANSITION" | "UNKNOWN";
export interface JournalTradeInput { id: string; side: string; openedAt: number }
export interface JournalTradeContext {
  libraryState: RegimeState | null; libraryH4: RegimeState | null; libraryH1: RegimeState | null;
  libraryScore: number | null; libraryAsOfH1: number | null; libraryVersion: string; alignment: Alignment;
}
export interface JournalBreakdown {
  overall: PerformanceStats; byLibraryState: GroupStats[]; byProductionRegime: GroupStats[]; byStrategy: GroupStats[];
  bySide: GroupStats[]; byAlignment: GroupStats[]; byStrategyAndLibraryState: GroupStats[];
}
export const JOURNAL_FLAG: string;
export const JOURNAL_MIN_SAMPLE: number;
export function isJournalEnabled(env?: Record<string, string | undefined>): boolean;
export function performanceStats(trades: { netPnl: number }[]): PerformanceStats;
export function groupStats<T extends { netPnl: number }>(trades: T[], keyOf: (t: T) => unknown): GroupStats[];
export function alignmentOf(state: string | null, side: string): Alignment;
export function journalBreakdown(trades: object[]): JournalBreakdown;
export function enrichTradesWithContext<T extends JournalTradeInput>(input: { trades: T[]; h4: Bar[]; h1: Bar[] }): (T & JournalTradeContext)[];

// Feature 1 (C2): proposals.
export type ProposalParams = Record<string, string>;
export interface ProposalParameter { id: string; scope: "ENTRY_FILTER" | "REGIME_FILTER"; label: string; values: readonly string[]; valueLabels: Record<string, string> }
export interface SidesStats { before: PerformanceStats; after: PerformanceStats; removed: number }
export interface WalkForwardFold { fold: number; from: number | null; to: number | null; before: PerformanceStats; after: PerformanceStats; netDelta: number; improved: boolean }
export interface EvidenceCheck { id: string; passed: boolean; text: string }
export interface ChangeEvaluation {
  parameterId: string; oldValue: string; newValue: string; splitAt: number;
  inSample: SidesStats; outOfSample: SidesStats; full: SidesStats; removed: number; walkForward: WalkForwardFold[];
  evidence: { label: "ENOUGH_EVIDENCE" | "NOT_ENOUGH_EVIDENCE"; checks: EvidenceCheck[] };
}
export interface Proposal {
  id: string; version: string; parameterId: string; scope: string; label: string; oldValue: string; newValue: string;
  oldLabel: string; newLabel: string; allowedValues: string[]; reason: string; evaluation: ChangeEvaluation;
  evidenceLabel: "ENOUGH_EVIDENCE" | "NOT_ENOUGH_EVIDENCE";
  dataWindow: { from: number | null; to: number | null; trades: number; splitAt: number; source: string };
  applyTo: "NEW_POSITIONS_ONLY"; caveats: string[]; createdAt: number;
}
export const PROPOSALS_FLAG: string;
export const PROPOSALS_VERSION: string;
export const PROPOSAL_PARAMETERS: readonly ProposalParameter[];
export const BASELINE_PARAMS: Readonly<ProposalParams>;
export const EVIDENCE_RULE: Readonly<{ minInSampleTrades: number; minOutOfSampleTrades: number; minOutOfSampleProfitFactor: number; walkForwardFolds: number; minPositiveFolds: number }>;
export const ANALYSIS_CADENCE: Readonly<{ weeklyMs: number; everyClosedTrades: number }>;
export function isProposalsEnabled(env?: Record<string, string | undefined>): boolean;
export function validateParamValue(id: string, value: string): { ok: boolean; error?: string };
export function validateParams(params: ProposalParams): { ok: boolean; error?: string };
export function applyParams<T>(trades: T[], params: ProposalParams): T[];
export function evaluateChange(trades: object[], parameterId: string, newValue: string, opts: { splitAt: number; currentParams?: ProposalParams }): ChangeEvaluation;
export function generateProposals(input: { trades: object[]; currentParams?: ProposalParams; splitAt: number; now?: number; source?: string }): Proposal[];
export function proposalId(p: object): string;
export function analysisDue(input: { lastRunAt: number | null; closedTradesSinceLastRun: number; now?: number }): { due: boolean; reason: "FIRST_RUN" | "TRADES_30" | "WEEKLY" | "NOT_DUE" };
