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
export interface ConfigVersion { version: number; createdAt: number; parentVersion: number | null; params: Record<string, string>; source: string; actor: string; note: string | null }
export type StoredProposal = import("./index.d.mts").Proposal & {
  runSeq: number | null; status: "PENDING" | "APPROVED" | "REJECTED" | "OUTDATED" | "SUPERSEDED";
  decision: null | { decision: "APPROVE" | "REJECT" | "EDIT"; at: number; actor: string; note: string | null; editedValue: string | null; editedEvaluation: unknown; configVersion: number | null };
};
export interface ConfigPackage {
  schema: "market-intel-config-v1"; version: number; params: Record<string, string>; sha256: string; source: string; createdAt: number;
  applyTo: "NEW_POSITIONS_ONLY"; preconditions: string[]; note: string;
}
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
  latestConfig(): ConfigVersion;
  deployedConfig(): ConfigVersion | null;
  getConfigVersion(version: number): ConfigVersion | undefined;
  listConfigVersions(): (ConfigVersion & { everDeployed: boolean; deployed: boolean })[];
  listDeployments(): { seq: number; at: number; version: number; actor: string; note: string | null }[];
  recordAnalysisRun(input: { reason: string; proposals?: object[]; summary?: unknown }): { seq: number; inserted: number };
  lastAnalysisRun(): { seq: number; at: number; reason: string; proposals: number; summary: unknown } | null;
  closedTradesSince(ts: number | null): number;
  listProposals(): StoredProposal[];
  decideProposal(input: { id: string; decision: "APPROVE" | "REJECT" | "EDIT"; actor: string; note?: string | null; editedValue?: string | null; editedEvaluation?: unknown }): { proposalId: string; decision: string; configVersion: ConfigVersion | null };
  rollback(input: { toVersion: number; actor: string; note?: string | null }): ConfigVersion;
  markDeployed(input: { version: number; actor: string; note?: string | null }): ConfigVersion | null;
  exportConfigPackage(version: number): ConfigPackage;
}
export function openJournal(path?: string, opts?: { now?: () => number }): Promise<Journal>;
