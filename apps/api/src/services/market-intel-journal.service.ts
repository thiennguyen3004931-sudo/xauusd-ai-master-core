// Feature 1 (C1): trade journal. Copies realized system trades (read-only, from the existing
// Phase 7C performance intelligence) into a local SQLite file under .runtime/market-intel/, tags each
// trade with the regime-library state visible at its open time, and reports results by market type.
// It never sends, modifies or closes orders and never changes BOT_MODE, LIVE ARM, risk or strategy.
// OFF unless ZIQ_MARKET_INTEL_JOURNAL_ENABLED = true.
import path from "node:path";
import {
  JOURNAL_MIN_SAMPLE,
  enrichTradesWithContext,
  isJournalEnabled,
  journalBreakdown,
  type JournalBreakdown,
} from "@xauusd/market-intel";
import {
  DEFAULT_JOURNAL_PATH,
  openJournal,
  type AuditEntry,
  type JournalTradeRow,
} from "@xauusd/market-intel/journal-store";
import { bridgeCandleLoader, type CandleLoader } from "./market-intel.service";

export interface JournalSourceTrade {
  id: string; side: "BUY" | "SELL"; strategy: string; openedAt: number; closedAt: number; volume: number;
  entry: number; exit: number; netPnl: number; session: string | null; correlation: string;
  productionRegime: string | null; entryType: string | null; entryPolicy: string | null; symbol?: string;
}
export type JournalTradeSource = (days: number, symbol: string) => Promise<JournalSourceTrade[]>;

const SAFETY = { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false, strategyMutation: false } as const;
const HISTORY_BARS = 1000;

export function journalPath(env: Record<string, string | undefined> = process.env): string {
  const configured = env.ZIQ_MARKET_INTEL_JOURNAL_PATH?.trim();
  if (configured) return path.resolve(configured);
  const root = env.PHASE7C_RUNTIME_ROOT?.trim();
  return root ? path.resolve(root, "market-intel", "market-intel.sqlite") : path.resolve(process.cwd(), DEFAULT_JOURNAL_PATH);
}

/** Default source: the existing read-only Phase 7C performance intelligence (SYSTEM trades only). */
export const performanceIntelligenceTradeSource: JournalTradeSource = async (days, symbol) => {
  const { getPhase7CPerformanceIntelligence } = await import("./phase7c-performance-intelligence.service");
  const report = (await getPhase7CPerformanceIntelligence(days, symbol)) as Awaited<
    ReturnType<typeof import("./phase7c-performance-intelligence-core.service").getPhase7CPerformanceIntelligence>
  >;
  return report.trades.map((t) => ({
    id: String(t.positionId || t.id),
    symbol: t.symbol,
    side: t.side,
    strategy: t.attribution.performanceStrategy,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    volume: t.volume,
    entry: t.entry,
    exit: t.exit,
    netPnl: t.netPnl,
    session: t.session,
    correlation: t.correlation.verdict,
    productionRegime: t.attribution.regime,
    entryType: t.attribution.entryType,
    entryPolicy: t.attribution.entryPolicy,
  }));
};

export async function syncMarketIntelJournal({
  env = process.env, symbol = "XAUUSD", days = 90, loader = bridgeCandleLoader,
  tradeSource = performanceIntelligenceTradeSource, journalPath: file = journalPath(env), now = Date.now(), actor = "operator",
}: {
  env?: Record<string, string | undefined>; symbol?: string; days?: number; loader?: CandleLoader;
  tradeSource?: JournalTradeSource; journalPath?: string; now?: number; actor?: string;
} = {}) {
  if (!isJournalEnabled(env)) return { enabled: false as const, safety: SAFETY };
  const [trades, h4, h1] = await Promise.all([
    tradeSource(days, symbol),
    loader(symbol, "H4", HISTORY_BARS),
    loader(symbol, "H1", HISTORY_BARS),
  ]);
  const enriched = enrichTradesWithContext({ trades, h4, h1 }).map((t) => ({ symbol, ...t }));
  const journal = await openJournal(file, { now: () => now });
  try {
    const { inserted, updated } = journal.upsertTrades(enriched as JournalTradeRow[]);
    const withContext = enriched.filter((t) => t.libraryState !== null).length;
    journal.appendAudit({ actor, action: "JOURNAL_SYNC", detail: { symbol, days, received: trades.length, inserted, updated, withContext } });
    return { enabled: true as const, symbol, days, received: trades.length, inserted, updated, withContext, totalTrades: journal.countTrades(), safety: SAFETY };
  } finally {
    journal.close();
  }
}

export interface MarketIntelJournalSummary {
  enabled: boolean;
  totalTrades: number;
  breakdown: JournalBreakdown | null;
  recentTrades: JournalTradeRow[];
  audit: AuditEntry[];
  minSample: number;
  sampleNote: string;
  safety: typeof SAFETY;
}

export async function getMarketIntelJournalSummary({
  env = process.env, journalPath: file = journalPath(env), sinceDays = null as number | null, now = Date.now(),
}: { env?: Record<string, string | undefined>; journalPath?: string; sinceDays?: number | null; now?: number } = {}): Promise<MarketIntelJournalSummary> {
  const sampleNote = `Nhóm dưới ${JOURNAL_MIN_SAMPLE} lệnh được đánh dấu "chưa đủ mẫu" và không được dùng để đề xuất thay đổi.`;
  const empty = { totalTrades: 0, breakdown: null, recentTrades: [], audit: [], minSample: JOURNAL_MIN_SAMPLE, sampleNote, safety: SAFETY };
  if (!isJournalEnabled(env)) return { enabled: false, ...empty };
  const journal = await openJournal(file);
  try {
    const since = sinceDays === null ? null : now - sinceDays * 86_400_000;
    const trades = journal.listTrades({ since });
    return {
      enabled: true,
      ...empty,
      totalTrades: journal.countTrades(),
      breakdown: journalBreakdown(trades),
      recentTrades: trades.slice(0, 50),
      audit: journal.listAudit({ limit: 20 }),
    };
  } finally {
    journal.close();
  }
}
