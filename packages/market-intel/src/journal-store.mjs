// Feature 1 (C1): local SQLite journal (node:sqlite, built in). It stores copies of realized
// trades with their market context, recorded MTF scenarios and an append-only audit log.
// The file lives under .runtime/market-intel/ (git-ignored). Nothing here talks to a broker.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BASELINE_PARAMS, validateParamValue, validateParams } from "./proposals.mjs";

// v1: trades, mtf_scenarios, audit_log. v2 (feature 1, C2): analysis_runs, proposals, proposal_decisions,
// config_versions, config_deployments. Every C2 table is append-only (SQLite triggers).
export const JOURNAL_SCHEMA_VERSION = 2;
export const DEFAULT_JOURNAL_PATH = ".runtime/market-intel/market-intel.sqlite";

const TRADE_COLUMNS = [
  ["id", "id"], ["symbol", "symbol"], ["strategy", "strategy"], ["side", "side"],
  ["opened_at", "openedAt"], ["closed_at", "closedAt"], ["volume", "volume"], ["entry", "entry"],
  ["exit_price", "exit"], ["net_pnl", "netPnl"], ["session", "session"], ["correlation", "correlation"],
  ["production_regime", "productionRegime"], ["entry_type", "entryType"], ["entry_policy", "entryPolicy"],
  ["library_state", "libraryState"], ["library_h4", "libraryH4"], ["library_h1", "libraryH1"],
  ["library_score", "libraryScore"], ["library_as_of_h1", "libraryAsOfH1"], ["alignment", "alignment"],
  ["library_version", "libraryVersion"],
];

const SCENARIO_COLUMNS = [
  ["as_of", "asOf"], ["role", "role"], ["direction", "direction"], ["entry", "entry"],
  ["stop_loss", "stopLoss"], ["take_profit_1", "takeProfit1"], ["take_profit_2", "takeProfit2"],
  ["rr1", "rr1"], ["confidence", "confidence"], ["m15_status", "m15Status"], ["version", "version"],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trades (
  ${TRADE_COLUMNS.map(([c]) => (c === "id" ? "id TEXT PRIMARY KEY" : `${c} ${/^(opened_at|closed_at|volume|entry|exit_price|net_pnl|library_score|library_as_of_h1)$/.test(c) ? "REAL" : "TEXT"}`)).join(",\n  ")},
  ingested_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_closed_at ON trades(closed_at);
CREATE TABLE IF NOT EXISTS mtf_scenarios (
  id TEXT PRIMARY KEY,
  ${SCENARIO_COLUMNS.map(([c]) => `${c} ${/^(role|direction|m15_status|version)$/.test(c) ? "TEXT" : "REAL"}`).join(",\n  ")},
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TABLE IF NOT EXISTS analysis_runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  proposals INTEGER NOT NULL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  run_seq INTEGER,
  parameter_id TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  evidence_label TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposal_decisions (
  proposal_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  decision TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  edited_value TEXT,
  edited_evaluation TEXT,
  config_version INTEGER
);
CREATE TABLE IF NOT EXISTS config_versions (
  version INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  parent_version INTEGER,
  params TEXT NOT NULL,
  source TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS config_deployments (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  note TEXT
);
${["analysis_runs", "proposals", "proposal_decisions", "config_versions", "config_deployments"].map((t) => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join("")}
`;

const canonical = (params) => JSON.stringify(Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]])));

const val = (v) => (v === undefined ? null : typeof v === "boolean" ? String(v) : v);

export async function openJournal(path = DEFAULT_JOURNAL_PATH, { now = () => Date.now() } = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  const version = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (version > JOURNAL_SCHEMA_VERSION) {
    db.close();
    throw new Error(`journal schema ${version} is newer than this code (${JOURNAL_SCHEMA_VERSION})`);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${JOURNAL_SCHEMA_VERSION}`);
  if (Number(db.prepare("SELECT COUNT(*) AS n FROM config_versions").get().n) === 0) {
    // Version 1 = today's behavior (every filter OFF), and it is what the bot runs.
    const at = now();
    db.prepare("INSERT INTO config_versions (version, created_at, parent_version, params, source, actor, note) VALUES (1, ?, NULL, ?, 'BASELINE', 'system', ?)")
      .run(at, canonical(BASELINE_PARAMS), "Hành vi hiện tại của bot: mọi bộ lọc mới đều tắt.");
    db.prepare("INSERT INTO config_deployments (created_at, version, actor, note) VALUES (?, 1, 'system', ?)").run(at, "Baseline đang chạy.");
  }

  const cols = TRADE_COLUMNS.map(([c]) => c);
  const existsTrade = db.prepare("SELECT 1 AS x FROM trades WHERE id = ?");
  const insertTrade = db.prepare(`INSERT INTO trades (${cols.join(", ")}, ingested_at, updated_at) VALUES (${cols.map(() => "?").join(", ")}, ?, ?)`);
  const updateTrade = db.prepare(`UPDATE trades SET ${cols.filter((c) => c !== "id").map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`);
  const scenarioCols = SCENARIO_COLUMNS.map(([c]) => c);
  const insertScenario = db.prepare(`INSERT OR IGNORE INTO mtf_scenarios (id, ${scenarioCols.join(", ")}, recorded_at) VALUES (?, ${scenarioCols.map(() => "?").join(", ")}, ?)`);
  const insertAudit = db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)");

  const fromRow = (columns, row) => Object.fromEntries(columns.map(([c, k]) => [k, row[c]]));

  function transaction(fn) {
    db.exec("BEGIN");
    try { const out = fn(); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  return {
    db,
    path,
    schemaVersion: () => Number(db.prepare("PRAGMA user_version").get().user_version),
    upsertTrades(rows) {
      return transaction(() => {
        let inserted = 0, updated = 0;
        const at = now();
        for (const r of rows) {
          if (!r?.id) continue;
          const values = TRADE_COLUMNS.map(([, k]) => val(k === "correlation" ? r.correlation?.verdict ?? r.correlation : r[k]));
          if (existsTrade.get(String(r.id))) {
            updateTrade.run(...values.slice(1), at, String(r.id));
            updated += 1;
          } else {
            values[0] = String(r.id);
            insertTrade.run(...values, at, at);
            inserted += 1;
          }
        }
        return { inserted, updated };
      });
    },
    listTrades({ since = null, limit = 5000 } = {}) {
      const rows = since === null
        ? db.prepare("SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?").all(limit)
        : db.prepare("SELECT * FROM trades WHERE closed_at >= ? ORDER BY closed_at DESC LIMIT ?").all(since, limit);
      return rows.map((row) => fromRow(TRADE_COLUMNS, row));
    },
    countTrades: () => Number(db.prepare("SELECT COUNT(*) AS n FROM trades").get().n),
    recordScenarios(rows) {
      return transaction(() => {
        let inserted = 0;
        const at = now();
        for (const r of rows) {
          const id = `${r.asOf}|${r.role}|${r.direction}`;
          const res = insertScenario.run(id, ...SCENARIO_COLUMNS.map(([, k]) => val(r[k])), at);
          inserted += Number(res.changes);
        }
        return { inserted };
      });
    },
    listScenarios({ limit = 500 } = {}) {
      return db.prepare("SELECT * FROM mtf_scenarios ORDER BY as_of DESC LIMIT ?").all(limit).map((row) => fromRow(SCENARIO_COLUMNS, row));
    },
    appendAudit({ actor, action, detail = null }) {
      if (!actor || !action) throw new Error("audit entry needs actor and action");
      insertAudit.run(now(), String(actor), String(action), detail === null ? null : JSON.stringify(detail));
    },
    listAudit({ limit = 200 } = {}) {
      return db.prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?").all(limit).map((r) => ({
        seq: Number(r.seq), at: Number(r.at), actor: r.actor, action: r.action, detail: r.detail === null ? null : JSON.parse(r.detail),
      }));
    },
    close: () => db.close(),
    ...proposalApi(db, now, transaction),
  };
}

function proposalApi(db, now, transaction) {
  const parse = (v) => (v === null || v === undefined ? null : JSON.parse(v));
  const versionRow = (r) => r && ({
    version: Number(r.version), createdAt: Number(r.created_at), parentVersion: r.parent_version === null ? null : Number(r.parent_version),
    params: parse(r.params), source: r.source, actor: r.actor, note: r.note,
  });
  const getVersion = (v) => versionRow(db.prepare("SELECT * FROM config_versions WHERE version = ?").get(v));
  const latestConfig = () => versionRow(db.prepare("SELECT * FROM config_versions ORDER BY version DESC LIMIT 1").get());
  const deployedConfig = () => {
    const d = db.prepare("SELECT version FROM config_deployments ORDER BY seq DESC LIMIT 1").get();
    return d ? getVersion(Number(d.version)) : null;
  };
  const audit = db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)");
  const log = (actor, action, detail) => audit.run(now(), String(actor), action, JSON.stringify(detail));

  function createVersion({ params, source, actor, note }) {
    const v = validateParams(params);
    if (!v.ok) throw new Error(v.error);
    const parent = latestConfig();
    const version = parent.version + 1;
    db.prepare("INSERT INTO config_versions (version, created_at, parent_version, params, source, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(version, now(), parent.version, canonical(params), source, String(actor), note ?? null);
    return getVersion(version);
  }

  function proposalRows() {
    const rows = db.prepare(`SELECT p.*, d.decision, d.created_at AS decided_at, d.actor AS decided_by, d.note AS decision_note,
      d.edited_value, d.edited_evaluation, d.config_version FROM proposals p LEFT JOIN proposal_decisions d ON d.proposal_id = p.id
      ORDER BY p.created_at DESC, p.id`).all();
    const latest = latestConfig();
    const newestPendingRun = new Map();
    for (const r of rows) {
      if (r.decision) continue;
      const k = r.parameter_id;
      newestPendingRun.set(k, Math.max(newestPendingRun.get(k) ?? -1, Number(r.run_seq ?? 0)));
    }
    return rows.map((r) => {
      let status = "PENDING";
      if (r.decision === "REJECT") status = "REJECTED";
      else if (r.decision) status = "APPROVED";
      else if (latest.params[r.parameter_id] !== r.old_value) status = "OUTDATED";
      else if (Number(r.run_seq ?? 0) < newestPendingRun.get(r.parameter_id)) status = "SUPERSEDED";
      return {
        ...parse(r.payload),
        id: r.id, runSeq: r.run_seq === null ? null : Number(r.run_seq), status,
        decision: r.decision ? {
          decision: r.decision, at: Number(r.decided_at), actor: r.decided_by, note: r.decision_note,
          editedValue: r.edited_value, editedEvaluation: parse(r.edited_evaluation),
          configVersion: r.config_version === null ? null : Number(r.config_version),
        } : null,
      };
    });
  }

  return {
    latestConfig,
    deployedConfig,
    getConfigVersion: getVersion,
    listConfigVersions() {
      const deployedSet = new Set(db.prepare("SELECT DISTINCT version FROM config_deployments").all().map((r) => Number(r.version)));
      const current = deployedConfig()?.version ?? null;
      return db.prepare("SELECT * FROM config_versions ORDER BY version DESC").all().map((r) => {
        const v = versionRow(r);
        return { ...v, everDeployed: deployedSet.has(v.version), deployed: v.version === current };
      });
    },
    listDeployments() {
      return db.prepare("SELECT * FROM config_deployments ORDER BY seq DESC").all().map((r) => ({ seq: Number(r.seq), at: Number(r.created_at), version: Number(r.version), actor: r.actor, note: r.note }));
    },
    recordAnalysisRun({ reason, proposals = [], summary = null }) {
      return transaction(() => {
        const res = db.prepare("INSERT INTO analysis_runs (created_at, reason, proposals, summary) VALUES (?, ?, ?, ?)").run(now(), String(reason), proposals.length, summary === null ? null : JSON.stringify(summary));
        const seq = Number(res.lastInsertRowid);
        const ins = db.prepare("INSERT OR IGNORE INTO proposals (id, created_at, run_seq, parameter_id, old_value, new_value, evidence_label, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        let inserted = 0;
        for (const p of proposals) {
          const v = validateParamValue(p.parameterId, p.newValue);
          if (!v.ok) throw new Error(v.error);
          inserted += Number(ins.run(p.id, now(), seq, p.parameterId, p.oldValue, p.newValue, p.evidenceLabel, JSON.stringify(p)).changes);
        }
        log("system", "ANALYSIS_RUN", { seq, reason, proposals: proposals.length, inserted });
        return { seq, inserted };
      });
    },
    lastAnalysisRun() {
      const r = db.prepare("SELECT * FROM analysis_runs ORDER BY seq DESC LIMIT 1").get();
      return r ? { seq: Number(r.seq), at: Number(r.created_at), reason: r.reason, proposals: Number(r.proposals), summary: parse(r.summary) } : null;
    },
    closedTradesSince(ts) {
      return Number((ts === null || ts === undefined
        ? db.prepare("SELECT COUNT(*) AS n FROM trades").get()
        : db.prepare("SELECT COUNT(*) AS n FROM trades WHERE closed_at > ?").get(ts)).n);
    },
    listProposals: proposalRows,
    decideProposal({ id, decision, actor, note = null, editedValue = null, editedEvaluation = null }) {
      if (!["APPROVE", "REJECT", "EDIT"].includes(decision)) throw new Error("decision phải là APPROVE, REJECT hoặc EDIT.");
      if (!actor) throw new Error("Thiếu người quyết định.");
      return transaction(() => {
        const p = proposalRows().find((x) => x.id === id);
        if (!p) throw new Error(`Không tìm thấy đề xuất ${id}.`);
        if (p.decision) throw new Error(`Đề xuất ${id} đã được quyết định (already decided).`);
        let configVersion = null;
        if (decision !== "REJECT") {
          if (p.status !== "PENDING") throw new Error(`Đề xuất ${id} không còn áp dụng được (${p.status}).`);
          const value = decision === "EDIT" ? editedValue : p.newValue;
          const v = validateParamValue(p.parameterId, value);
          if (!v.ok) throw new Error(v.error);
          if (value === p.oldValue) throw new Error("Giá trị sửa trùng giá trị hiện tại; hãy dùng Từ chối.");
          const params = { ...latestConfig().params, [p.parameterId]: value };
          configVersion = createVersion({ params, source: `PROPOSAL:${id}`, actor, note });
        }
        db.prepare("INSERT INTO proposal_decisions (proposal_id, created_at, decision, actor, note, edited_value, edited_evaluation, config_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, now(), decision, String(actor), note, decision === "EDIT" ? editedValue : null, editedEvaluation === null ? null : JSON.stringify(editedEvaluation), configVersion?.version ?? null);
        log(actor, decision === "REJECT" ? "PROPOSAL_REJECTED" : decision === "EDIT" ? "PROPOSAL_EDITED_APPROVED" : "PROPOSAL_APPROVED",
          { id, parameterId: p.parameterId, oldValue: p.oldValue, newValue: decision === "EDIT" ? editedValue : p.newValue, configVersion: configVersion?.version ?? null, note });
        if (decision === "EDIT") log(actor, "PROPOSAL_APPROVED", { id, edited: true, configVersion: configVersion.version });
        return { proposalId: id, decision, configVersion };
      });
    },
    rollback({ toVersion, actor, note = null }) {
      return transaction(() => {
        const target = getVersion(toVersion);
        if (!target) throw new Error(`Không có phiên bản cấu hình ${toVersion}.`);
        const v = createVersion({ params: target.params, source: `ROLLBACK:${toVersion}`, actor, note });
        log(actor, "CONFIG_ROLLBACK", { toVersion, newVersion: v.version, note });
        return v;
      });
    },
    markDeployed({ version, actor, note = null }) {
      const v = getVersion(version);
      if (!v) throw new Error(`Không có phiên bản cấu hình ${version}.`);
      db.prepare("INSERT INTO config_deployments (created_at, version, actor, note) VALUES (?, ?, ?, ?)").run(now(), version, String(actor), note);
      log(actor, "CONFIG_MARKED_DEPLOYED", { version, note });
      return deployedConfig();
    },
    exportConfigPackage(version) {
      const v = getVersion(version);
      if (!v) throw new Error(`Không có phiên bản cấu hình ${version}.`);
      const body = canonical(v.params);
      return {
        schema: "market-intel-config-v1",
        version: v.version,
        params: v.params,
        sha256: createHash("sha256").update(body).digest("hex"),
        source: v.source,
        createdAt: v.createdAt,
        applyTo: "NEW_POSITIONS_ONLY",
        preconditions: ["BOT_MODE: PAUSE", "XAUUSD positions = 0", "Guarded Phase 7C deploy path", "Owner approval"],
        note: "Gói này chỉ mô tả cấu hình đã duyệt. Bot hiện chưa đọc các bộ lọc này; cần PR riêng để nối vào bot trước khi triển khai.",
      };
    },
  };
}
