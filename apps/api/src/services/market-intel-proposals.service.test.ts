import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runProposalAnalysis,
  maybeRunScheduledAnalysis,
  getProposalsOverview,
  decideMarketIntelProposal,
  rollbackMarketIntelConfig,
  markMarketIntelConfigDeployed,
  exportMarketIntelConfig,
} from "./market-intel-proposals.service";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

function dataset() {
  const trades = [];
  for (let i = 0; i < 600; i += 1) {
    const k = i % 4;
    const alignment = ["WITH_TREND", "AGAINST_TREND", "SIDEWAY", "TRANSITION"][k];
    let pnl = 0;
    if (alignment === "WITH_TREND") pnl = i % 3 === 0 ? -50 : 60;
    else if (alignment === "AGAINST_TREND") pnl = i % 5 === 0 ? 40 : -55;
    else pnl = i % 2 ? 30 : -32;
    trades.push({ id: `bt-${i}`, openedAt: T0 + i * DAY, closedAt: T0 + i * DAY + 3_600_000, strategy: "TREND", side: "BUY", alignment, libraryState: ["UPTREND", "UPTREND", "SIDEWAY", "TRANSITION"][k], netPnl: pnl });
  }
  return { schema: "market-intel-proposal-dataset-v1", splitAt: T0 + 400 * DAY, generatedAt: T0 + 700 * DAY, source: { kind: "TEST" }, trades };
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "mi-prop-api-"));
  const datasetPath = path.join(dir, "dataset.json");
  writeFileSync(datasetPath, JSON.stringify(dataset()));
  return { dir, journalPath: path.join(dir, "j.sqlite"), datasetPath };
}

const ON = { ZIQ_MARKET_INTEL_PROPOSALS_ENABLED: "true" };

test("proposals are OFF by default: nothing runs, nothing is written", async () => {
  const s = setup();
  try {
    const run = await runProposalAnalysis({ env: {}, ...s, reason: "MANUAL" });
    assert.equal(run.enabled, false);
    const o = await getProposalsOverview({ env: {}, ...s });
    assert.equal(o.enabled, false);
    assert.deepEqual(o.proposals, []);
    await assert.rejects(decideMarketIntelProposal({ env: {}, ...s, id: "x", decision: "REJECT", actor: "operator" }), /tắt/);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("missing dataset gives a clear instruction instead of a proposal", async () => {
  const s = setup();
  try {
    const run = await runProposalAnalysis({ env: ON, ...s, datasetPath: path.join(s.dir, "missing.json"), reason: "MANUAL" });
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", /market-intel:proposal-dataset/);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("analysis -> approve (pending deploy) -> mark deployed -> rollback -> export, all audited", async () => {
  const s = setup();
  const notes: string[] = [];
  try {
    const run = await runProposalAnalysis({ env: ON, ...s, reason: "MANUAL", now: T0 + 700 * DAY, notify: async (t) => { notes.push(t); } });
    assert.equal(run.ok, true);
    assert.ok((run.inserted ?? 0) >= 1);
    assert.equal(notes.length, 1, "one notify-only message per run with new proposals");
    assert.match(notes[0], /Control Center/);
    assert.doesNotMatch(notes[0], /\/approve|callback_data/);

    let o = await getProposalsOverview({ env: ON, ...s });
    const p = o.proposals.find((x) => x.parameterId === "trendStrategyLibraryGate");
    assert.ok(p && p.status === "PENDING");
    assert.equal(o.latestConfig?.version, 1);
    assert.ok(o.parameters.length >= 2);

    const d = await decideMarketIntelProposal({ env: ON, ...s, id: p!.id, decision: "APPROVE", actor: "operator", note: "thử" });
    assert.equal(d.configVersion?.version, 2);
    o = await getProposalsOverview({ env: ON, ...s });
    assert.equal(o.latestConfig?.version, 2);
    assert.equal(o.deployedConfig?.version, 1);
    assert.equal(o.pendingDeploy, true);

    await markMarketIntelConfigDeployed({ env: ON, ...s, version: 2, actor: "operator", note: "PAUSE + flat" });
    const rb = await rollbackMarketIntelConfig({ env: ON, ...s, toVersion: 1, actor: "operator", note: "xấu" });
    assert.equal(rb.version, 3);
    const pkg = await exportMarketIntelConfig({ env: ON, ...s, version: 3 });
    assert.equal(pkg.applyTo, "NEW_POSITIONS_ONLY");
    o = await getProposalsOverview({ env: ON, ...s });
    const actions = o.audit.map((a) => a.action);
    for (const a of ["ANALYSIS_RUN", "PROPOSAL_APPROVED", "CONFIG_MARKED_DEPLOYED", "CONFIG_ROLLBACK"]) assert.ok(actions.includes(a), a);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("edit re-evaluates the edited value on the same data before approving", async () => {
  const s = setup();
  try {
    await runProposalAnalysis({ env: ON, ...s, reason: "MANUAL", now: T0 + 700 * DAY });
    const o = await getProposalsOverview({ env: ON, ...s });
    const p = o.proposals.find((x) => x.parameterId === "trendStrategyLibraryGate")!;
    const other = p.allowedValues.find((v) => v !== "OFF" && v !== p.newValue)!;
    const d = await decideMarketIntelProposal({ env: ON, ...s, id: p.id, decision: "EDIT", editedValue: other, actor: "operator" });
    assert.equal(d.configVersion?.params.trendStrategyLibraryGate, other);
    const after = (await getProposalsOverview({ env: ON, ...s })).proposals.find((x) => x.id === p.id)!;
    assert.equal((after.decision?.editedEvaluation as { newValue: string }).newValue, other);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("scheduled cadence: first run, then not again until a week or 30 closed trades", async () => {
  const s = setup();
  try {
    const t = T0 + 700 * DAY;
    const a = await maybeRunScheduledAnalysis({ env: ON, ...s, now: t });
    assert.equal(a.ran, true);
    assert.equal(a.reason, "FIRST_RUN");
    const b = await maybeRunScheduledAnalysis({ env: ON, ...s, now: t + DAY });
    assert.equal(b.ran, false);
    const c = await maybeRunScheduledAnalysis({ env: ON, ...s, now: t + 8 * DAY });
    assert.equal(c.ran, true);
    assert.equal(c.reason, "WEEKLY");
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("proposal service and route never reach orders, positions, bot mode or the bot config file", () => {
  const service = readFileSync(new URL("./market-intel-proposals.service.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../routes/market-intel-proposals.route.ts", import.meta.url), "utf8");
  for (const text of [service, route]) {
    for (const bad of [/order_send/i, /\/v1\/orders?/, /\/v1\/positions?/, /setPhase7CBotMode/, /LIVE_ARM/, /execution-engine/, /mt5-broker/,
      /phase7CStrategyEntryConditionsService/, /phase7c-strategy-entry-conditions/, /writeFileSync/]) {
      assert.ok(!bad.test(text), `forbidden ${bad}`);
    }
  }
  const writes = [...route.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(writes.length >= 4);
  assert.equal((route.match(/if \(!canOperate\(req\)\)/g) ?? []).length, writes.length, "every write route checks operator access");
});
