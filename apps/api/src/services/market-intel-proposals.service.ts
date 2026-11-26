// Feature 1 (C2): change proposals with owner approval.
// - Proposals come only from the allowlist in @xauusd/market-intel (entry-signal and regime filters).
// - Before/after numbers come from the offline backtest dataset (pnpm market-intel:proposal-dataset),
//   chosen on the in-sample window and labelled on the unseen window + walk-forward.
// - Approve / Edit create a new config version in the local journal ("pending deploy"). Nothing here
//   writes the bot's config, sends orders or changes BOT_MODE. Deploying a version is a separate,
//   guarded Phase 7C step done by the owner while PAUSE and flat, for new positions only.
// OFF unless ZIQ_MARKET_INTEL_PROPOSALS_ENABLED = true.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  EVIDENCE_RULE,
  ANALYSIS_CADENCE,
  PROPOSAL_PARAMETERS,
  analysisDue,
  applyParams,
  evaluateChange,
  generateProposals,
  isJournalEnabled,
  isProposalsEnabled,
  performanceStats,
  type Proposal,
} from "@xauusd/market-intel";
import { openJournal, type Journal } from "@xauusd/market-intel/journal-store";
import { journalPath as defaultJournalPath, syncMarketIntelJournal } from "./market-intel-journal.service";
import { notifyTelegram } from "./market-intel-telegram";

type Env = Record<string, string | undefined>;
export type Notifier = (text: string) => Promise<void>;

interface DatasetTrade { id: string; openedAt: number; closedAt?: number; strategy: string; side: string; alignment: string; libraryState: string | null; netPnl: number }
interface Dataset { schema: string; splitAt: number; generatedAt: number; source: unknown; trades: DatasetTrade[] }

const SAFETY = { readOnly: false, writesOnlyLocalJournal: true, orderMutation: false, runtimeMutation: false, botConfigMutation: false, autoApply: false } as const;

export function datasetPath(env: Env = process.env): string {
  const configured = env.ZIQ_MARKET_INTEL_PROPOSAL_DATASET?.trim();
  if (configured) return path.resolve(configured);
  const root = env.PHASE7C_RUNTIME_ROOT?.trim();
  return root ? path.resolve(root, "market-intel", "proposal-dataset.json") : path.resolve(process.cwd(), ".runtime", "market-intel", "proposal-dataset.json");
}

function loadDataset(file: string): Dataset | null {
  if (!existsSync(file)) return null;
  const d = JSON.parse(readFileSync(file, "utf8")) as Dataset;
  if (d.schema !== "market-intel-proposal-dataset-v1" || !Array.isArray(d.trades) || !Number.isFinite(d.splitAt)) {
    throw new Error("Dataset đề xuất không đúng định dạng market-intel-proposal-dataset-v1.");
  }
  return d;
}

interface Common { env?: Env; journalPath?: string; datasetPath?: string; now?: number }

function requireEnabled(env: Env) {
  if (!isProposalsEnabled(env)) throw new Error("Chức năng đề xuất đang tắt (ZIQ_MARKET_INTEL_PROPOSALS_ENABLED).");
}

async function withJournal<T>(file: string, now: number | undefined, fn: (j: Journal) => T | Promise<T>): Promise<T> {
  const j = await openJournal(file, now === undefined ? {} : { now: () => now });
  try { return await fn(j); } finally { j.close(); }
}

function liveCheck(j: Journal, p: Proposal, currentParams: Record<string, string>) {
  const trades = j.listTrades({ limit: 5000 }) as unknown as DatasetTrade[];
  const before = applyParams(trades, currentParams);
  const after = applyParams(trades, { ...currentParams, [p.parameterId]: p.newValue });
  return { source: "JOURNAL_REAL_TRADES", before: performanceStats(before), after: performanceStats(after), note: "Lệnh thật trong nhật ký, chỉ để đối chiếu; không dùng để gắn nhãn bằng chứng." };
}

function notifyText(inserted: Proposal[]): string {
  const lines = inserted.map((p) => `• ${p.label}: ${p.oldLabel} → ${p.newLabel} (${p.evidenceLabel === "ENOUGH_EVIDENCE" ? "Đủ bằng chứng" : "Chưa đủ bằng chứng"})`);
  return [`XAUUSD Market Intel: ${inserted.length} đề xuất mới chờ anh xem.`, ...lines, "Mở Control Center → Phân tích thị trường để Duyệt / Từ chối / Sửa. Bot không tự áp dụng."].join("\n");
}

export async function runProposalAnalysis({
  env = process.env, journalPath = defaultJournalPath(env), datasetPath: dsFile = datasetPath(env), now, reason = "MANUAL", notify = (t: string) => notifyTelegram(t, env),
}: Common & { reason?: string; notify?: Notifier } = {}) {
  if (!isProposalsEnabled(env)) return { enabled: false as const, ok: false, safety: SAFETY };
  const dataset = loadDataset(dsFile);
  if (!dataset) {
    return { enabled: true as const, ok: false, error: "Chưa có dữ liệu backtest cho đề xuất. Chạy: pnpm market-intel:proposal-dataset --trades <trades.csv> --h1 <H1.csv> --h4 <H4.csv>", safety: SAFETY };
  }
  const result = await withJournal(journalPath, now, (j) => {
    const current = j.latestConfig().params;
    const proposals = generateProposals({ trades: dataset.trades, currentParams: current, splitAt: dataset.splitAt, now: now ?? Date.now() })
      .map((p) => ({ ...p, liveCheck: liveCheck(j, p, current) }));
    const known = new Set(j.listProposals().map((p) => p.id));
    const fresh = proposals.filter((p) => !known.has(p.id));
    const run = j.recordAnalysisRun({ reason, proposals, summary: { datasetTrades: dataset.trades.length, splitAt: dataset.splitAt, datasetGeneratedAt: dataset.generatedAt, journalTrades: j.countTrades() } });
    return { run, fresh };
  });
  if (result.fresh.length > 0) {
    try { await notify(notifyText(result.fresh)); } catch { /* notify-only: a Telegram failure never blocks the analysis */ }
  }
  return { enabled: true as const, ok: true, runSeq: result.run.seq, fresh: result.fresh.length, inserted: result.run.inserted, safety: SAFETY };
}

/** Weekly, or after every 30 closed trades since the last run. Syncs the journal first when it is on. */
export async function maybeRunScheduledAnalysis({ env = process.env, journalPath = defaultJournalPath(env), datasetPath: dsFile = datasetPath(env), now = Date.now(), notify, syncJournal = false }: Common & { notify?: Notifier; syncJournal?: boolean } = {}) {
  if (!isProposalsEnabled(env)) return { ran: false, reason: "DISABLED" };
  if (syncJournal && isJournalEnabled(env)) {
    try { await syncMarketIntelJournal({ env, journalPath, now, actor: "scheduler" }); } catch { /* bridge/MT5 unavailable: analyse what we have */ }
  }
  const due = await withJournal(journalPath, now, (j) => {
    const last = j.lastAnalysisRun();
    return analysisDue({ lastRunAt: last?.at ?? null, closedTradesSinceLastRun: j.closedTradesSince(last?.at ?? null), now });
  });
  if (!due.due) return { ran: false, reason: due.reason };
  const run = await runProposalAnalysis({ env, journalPath, datasetPath: dsFile, now, reason: due.reason, ...(notify ? { notify } : {}) });
  return { ran: run.ok === true, reason: due.reason, run };
}

export async function getProposalsOverview({ env = process.env, journalPath = defaultJournalPath(env), datasetPath: dsFile = datasetPath(env), now }: Common = {}) {
  const parameters = PROPOSAL_PARAMETERS.map(({ id, scope, label, values, valueLabels }) => ({ id, scope, label, values: [...values], valueLabels: { ...valueLabels } }));
  const base = { enabled: false, parameters, evidenceRule: EVIDENCE_RULE, cadence: ANALYSIS_CADENCE, safety: SAFETY };
  if (!isProposalsEnabled(env)) {
    return { ...base, proposals: [], configVersions: [], deployments: [], latestConfig: null, deployedConfig: null, pendingDeploy: false, lastRun: null, closedTradesSinceLastRun: 0, audit: [], dataset: null };
  }
  let dataset: { generatedAt: number; trades: number; splitAt: number; source: unknown } | null = null;
  try {
    const d = loadDataset(dsFile);
    dataset = d ? { generatedAt: d.generatedAt, trades: d.trades.length, splitAt: d.splitAt, source: d.source } : null;
  } catch { dataset = null; }
  return withJournal(journalPath, now, (j) => {
    const latestConfig = j.latestConfig();
    const deployedConfig = j.deployedConfig();
    const last = j.lastAnalysisRun();
    return {
      ...base,
      enabled: true,
      proposals: j.listProposals(),
      configVersions: j.listConfigVersions(),
      deployments: j.listDeployments(),
      latestConfig,
      deployedConfig,
      pendingDeploy: latestConfig.version !== deployedConfig?.version,
      lastRun: last,
      closedTradesSinceLastRun: j.closedTradesSince(last?.at ?? null),
      audit: j.listAudit({ limit: 50 }),
      dataset,
    };
  });
}

export async function decideMarketIntelProposal({
  env = process.env, journalPath = defaultJournalPath(env), datasetPath: dsFile = datasetPath(env), now, id, decision, actor, note = null, editedValue = null,
}: Common & { id: string; decision: "APPROVE" | "REJECT" | "EDIT"; actor: string; note?: string | null; editedValue?: string | null }) {
  requireEnabled(env);
  return withJournal(journalPath, now, (j) => {
    let editedEvaluation: unknown = null;
    if (decision === "EDIT") {
      const p = j.listProposals().find((x) => x.id === id);
      const dataset = loadDataset(dsFile);
      if (p && dataset && editedValue) {
        editedEvaluation = evaluateChange(dataset.trades, p.parameterId, editedValue, { splitAt: dataset.splitAt, currentParams: j.latestConfig().params });
      }
    }
    return j.decideProposal({ id, decision, actor, note, editedValue, editedEvaluation });
  });
}

export async function rollbackMarketIntelConfig({ env = process.env, journalPath = defaultJournalPath(env), now, toVersion, actor, note = null }: Common & { toVersion: number; actor: string; note?: string | null }) {
  requireEnabled(env);
  return withJournal(journalPath, now, (j) => j.rollback({ toVersion, actor, note }));
}

/** Records that the owner deployed a version through the guarded Phase 7C path. It deploys nothing. */
export async function markMarketIntelConfigDeployed({ env = process.env, journalPath = defaultJournalPath(env), now, version, actor, note = null }: Common & { version: number; actor: string; note?: string | null }) {
  requireEnabled(env);
  return withJournal(journalPath, now, (j) => j.markDeployed({ version, actor, note }));
}

export async function exportMarketIntelConfig({ env = process.env, journalPath = defaultJournalPath(env), now, version }: Common & { version: number }) {
  requireEnabled(env);
  return withJournal(journalPath, now, (j) => j.exportConfigPackage(version));
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Hourly check inside the API process. Only started when the proposals flag is on. */
export function startMarketIntelProposalScheduler(env: Env = process.env): boolean {
  if (!isProposalsEnabled(env) || schedulerTimer) return false;
  const tick = () => {
    void maybeRunScheduledAnalysis({ env, syncJournal: true }).catch((error) => {
      console.warn(`MARKET_INTEL_PROPOSALS_SCHEDULER=ERROR|${error instanceof Error ? error.message : String(error)}`);
    });
  };
  schedulerTimer = setInterval(tick, 60 * 60_000);
  schedulerTimer.unref?.();
  setTimeout(tick, 60_000).unref?.();
  return true;
}
