export const JOURNAL_SCHEMA_VERSION: number;
export const DEFAULT_JOURNAL_PATH: string;
export interface JournalTradeRow {
  id: string; symbol?: string | null; strategy?: string | null; side?: string | null; openedAt?: number | null; closedAt?: number | null;
  volume?: number | null; entry?: number | null; exit?: number | null; netPnl?: number | null; session?: string | null;
  correlation?: string | null; productionRegime?: string | null; entryType?: string | null; entryPolicy?: string | null;
  libraryState?: string | null; libraryH4?: string | null; libraryH1?: string | null; libraryScore?: number | null;
  libraryAsOfH1?: number | null; alignment?: string | null; libraryVersion?: string | null;
}
export interface JournalScenarioRow {
  asOf: number; role: string; direction: string; entry: number; stopLoss: number; takeProfit1: number; takeProfit2: number;
  rr1: number; confidence: number; m15Status: string; version: string;
}
export interface AuditEntry { seq: number; at: number; actor: string; action: string; detail: unknown }
export interface Journal {
  path: string;
  schemaVersion(): number;
  upsertTrades(rows: JournalTradeRow[]): { inserted: number; updated: number };
  listTrades(opts?: { since?: number | null; limit?: number }): JournalTradeRow[];
  countTrades(): number;
  recordScenarios(rows: JournalScenarioRow[]): { inserted: number };
  listScenarios(opts?: { limit?: number }): JournalScenarioRow[];
  appendAudit(entry: { actor: string; action: string; detail?: unknown }): void;
  listAudit(opts?: { limit?: number }): AuditEntry[];
  close(): void;
}
export function openJournal(path?: string, opts?: { now?: () => number }): Promise<Journal>;
