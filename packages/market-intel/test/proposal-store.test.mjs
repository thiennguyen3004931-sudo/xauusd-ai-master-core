// Feature 1 (C2): proposals, decisions, config versions, rollback, deploy marks, all append-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openJournal, JOURNAL_SCHEMA_VERSION } from "../src/journal-store.mjs";
import { BASELINE_PARAMS } from "../src/proposals.mjs";

let clock = 1_000;
const now = () => (clock += 1_000);

function proposal(id, newValue = "WITH_TREND_ONLY", oldValue = "OFF", parameterId = "trendStrategyLibraryGate") {
  return { id, parameterId, oldValue, newValue, evidenceLabel: "NOT_ENOUGH_EVIDENCE", reason: "test", evaluation: {}, dataWindow: {}, createdAt: clock };
}

async function withJournal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "mi-prop-"));
  try {
    const j = await openJournal(join(dir, "j.sqlite"), { now });
    try { await fn(j, dir); } finally { j.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("schema v2 creates a deployed baseline config version equal to today's behavior", async () => {
  assert.equal(JOURNAL_SCHEMA_VERSION, 2);
  await withJournal((j) => {
    const versions = j.listConfigVersions();
    assert.equal(versions.length, 1);
    assert.equal(versions[0].version, 1);
    assert.deepEqual(versions[0].params, BASELINE_PARAMS);
    assert.equal(versions[0].source, "BASELINE");
    assert.equal(j.deployedConfig().version, 1);
    assert.equal(j.latestConfig().version, 1);
  });
});

test("analysis run stores proposals once; status is PENDING until decided", async () => {
  await withJournal((j) => {
    const run = j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")], summary: { trades: 10 } });
    assert.equal(run.inserted, 1);
    assert.equal(j.recordAnalysisRun({ reason: "WEEKLY", proposals: [proposal("p1")] }).inserted, 0);
    assert.equal(j.lastAnalysisRun().reason, "WEEKLY");
    const [p] = j.listProposals();
    assert.equal(p.id, "p1");
    assert.equal(p.status, "PENDING");
  });
});

test("approve creates a new config version pending deploy; the bot config is untouched", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")] });
    const out = j.decideProposal({ id: "p1", decision: "APPROVE", actor: "operator", note: "ok" });
    assert.equal(out.configVersion.version, 2);
    assert.equal(out.configVersion.params.trendStrategyLibraryGate, "WITH_TREND_ONLY");
    assert.equal(out.configVersion.parentVersion, 1);
    assert.equal(j.latestConfig().version, 2);
    assert.equal(j.deployedConfig().version, 1, "approval alone never deploys");
    assert.equal(j.listProposals()[0].status, "APPROVED");
    assert.throws(() => j.decideProposal({ id: "p1", decision: "REJECT", actor: "operator" }), /đã được quyết định|already/);
    assert.ok(j.listAudit().some((a) => a.action === "PROPOSAL_APPROVED"));
  });
});

test("edit approves a different allowed value; invalid values are refused", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")] });
    assert.throws(() => j.decideProposal({ id: "p1", decision: "EDIT", actor: "operator", editedValue: "YOLO" }), /không hợp lệ/);
    const out = j.decideProposal({ id: "p1", decision: "EDIT", actor: "operator", editedValue: "BLOCK_AGAINST_TREND", editedEvaluation: { evidence: { label: "NOT_ENOUGH_EVIDENCE" } } });
    assert.equal(out.configVersion.params.trendStrategyLibraryGate, "BLOCK_AGAINST_TREND");
    const [p] = j.listProposals();
    assert.equal(p.status, "APPROVED");
    assert.equal(p.decision.editedValue, "BLOCK_AGAINST_TREND");
  });
});

test("reject records the decision and creates no config version", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")] });
    j.decideProposal({ id: "p1", decision: "REJECT", actor: "operator", note: "chưa tin" });
    assert.equal(j.listConfigVersions().length, 1);
    assert.equal(j.listProposals()[0].status, "REJECTED");
  });
});

test("a proposal whose old value no longer matches the latest config is OUTDATED and cannot be approved", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1"), proposal("p2", "BLOCK_AGAINST_TREND")] });
    j.decideProposal({ id: "p1", decision: "APPROVE", actor: "operator" });
    const p2 = j.listProposals().find((p) => p.id === "p2");
    assert.equal(p2.status, "OUTDATED");
    assert.throws(() => j.decideProposal({ id: "p2", decision: "APPROVE", actor: "operator" }), /OUTDATED|không còn/);
  });
});

test("rollback creates a new version with an older version's params; deploy marks are separate", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")] });
    j.decideProposal({ id: "p1", decision: "APPROVE", actor: "operator" });
    j.markDeployed({ version: 2, actor: "operator", note: "deployed while PAUSE and flat" });
    assert.equal(j.deployedConfig().version, 2);
    const rb = j.rollback({ toVersion: 1, actor: "operator", note: "xấu đi" });
    assert.equal(rb.version, 3);
    assert.deepEqual(rb.params, BASELINE_PARAMS);
    assert.equal(rb.source, "ROLLBACK:1");
    assert.equal(j.deployedConfig().version, 2, "rollback also needs a deploy");
    assert.throws(() => j.rollback({ toVersion: 99, actor: "operator" }), /99/);
    assert.throws(() => j.markDeployed({ version: 42, actor: "operator" }), /42/);
  });
});

test("export package carries params, checksum and the deploy preconditions", async () => {
  await withJournal((j) => {
    const pkg = j.exportConfigPackage(1);
    assert.equal(pkg.schema, "market-intel-config-v1");
    assert.equal(pkg.version, 1);
    assert.deepEqual(pkg.params, BASELINE_PARAMS);
    assert.match(pkg.sha256, /^[0-9a-f]{64}$/);
    assert.equal(pkg.applyTo, "NEW_POSITIONS_ONLY");
    assert.ok(pkg.preconditions.includes("BOT_MODE: PAUSE"));
  });
});

test("proposals, decisions, config versions and deployments are append-only", async () => {
  await withJournal((j) => {
    j.recordAnalysisRun({ reason: "FIRST_RUN", proposals: [proposal("p1")] });
    j.decideProposal({ id: "p1", decision: "APPROVE", actor: "operator" });
    for (const table of ["proposals", "proposal_decisions", "config_versions", "config_deployments", "analysis_runs"]) {
      assert.throws(() => j.db.exec(`DELETE FROM ${table}`), /append-only/, table);
      assert.throws(() => j.db.exec(`UPDATE ${table} SET created_at = 0`), /append-only|no such column/, table);
    }
  });
});

test("closed trades since the last run drive the 30-trade cadence", async () => {
  await withJournal((j) => {
    j.upsertTrades([{ id: "a", closedAt: 5 }, { id: "b", closedAt: 50_000 }]);
    assert.equal(j.closedTradesSince(10), 1);
    assert.equal(j.closedTradesSince(null), 2);
  });
});

test("a v1 journal file upgrades to v2 in place and keeps its trades", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-prop-"));
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const file = join(dir, "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE trades (id TEXT PRIMARY KEY, symbol TEXT, strategy TEXT, side TEXT, opened_at REAL, closed_at REAL, volume REAL, entry REAL, exit_price REAL, net_pnl REAL, session TEXT, correlation TEXT, production_regime TEXT, entry_type TEXT, entry_policy TEXT, library_state TEXT, library_h4 TEXT, library_h1 TEXT, library_score REAL, library_as_of_h1 REAL, alignment TEXT, library_version TEXT, ingested_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    old.exec("INSERT INTO trades (id, net_pnl, ingested_at, updated_at) VALUES ('t1', 5, 1, 1)");
    old.exec("PRAGMA user_version = 1");
    old.close();
    const j = await openJournal(file);
    assert.equal(j.schemaVersion(), 2);
    assert.equal(j.countTrades(), 1);
    assert.equal(j.latestConfig().version, 1);
    j.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
