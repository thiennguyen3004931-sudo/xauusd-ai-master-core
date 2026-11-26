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
