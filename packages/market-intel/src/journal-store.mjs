// Feature 1 (C1): local SQLite journal (node:sqlite, built in). It stores copies of realized
// trades with their market context, recorded MTF scenarios and an append-only audit log.
// The file lives under .runtime/market-intel/ (git-ignored). Nothing here talks to a broker.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const JOURNAL_SCHEMA_VERSION = 1;
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
`;

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
  };
}
