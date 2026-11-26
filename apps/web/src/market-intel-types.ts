// Mirrors apps/api/src/services/market-intel.service.ts (read-only snapshot).
export type MarketIntelState = "UPTREND" | "DOWNTREND" | "SIDEWAY" | "TRANSITION";

export interface MarketIntelCriterion { id: string; description: string; weight: number; passed: boolean; value: unknown }
export interface MarketIntelTimeframe {
  state: MarketIntelState; confidence: number; scores: Record<string, number>;
  criteria: Record<string, MarketIntelCriterion[]>; reasons: string[];
}
export interface MarketIntelScenario {
  role: "PRIMARY" | "ALTERNATE"; direction: "BUY" | "SELL";
  entryZone: { low: number; high: number; sources: string[] }; entry: number; stopLoss: number;
  takeProfit1: number; takeProfit2: number; targetsSource: { tp1: string; tp2: string }; rr1: number; rr2: number;
  invalidation: { price: number; text: string }; m15: { status: "TRIGGERED" | "TOUCHED_NO_TRIGGER" | "WAITING" };
  confidence: number; confidenceBreakdown: { factor: string; points: number }[]; confidenceNote: string;
  botStopRule: { stopDistance: number; withinRule: boolean; note: string };
}
export interface MarketIntelSnapshot {
  enabled: { regimeLibrary: boolean; mtf: boolean };
  versions: { regimeLibrary: string; mtf: string };
  symbol: string;
  generatedAt: number;
  regime: null | { state: MarketIntelState; alignment: "ALIGNED" | "NEUTRAL" | "CONFLICT"; confidence: number; reasons: string[]; h4: MarketIntelTimeframe; h1: MarketIntelTimeframe };
  mtf: null | {
    asOf: number;
    h4: { state: MarketIntelState; confidence: number; bias: string };
    h1: { state: MarketIntelState; confidence: number; agreement: string; phase: string };
    m15: { close: number };
    scenarios: MarketIntelScenario[];
    notes: string[];
  };
  charts: { h4: string; h1: string; m15: string } | null;
  lastM15CloseAt: number;
  nextM15CloseAt: number;
  refreshed: boolean;
}
