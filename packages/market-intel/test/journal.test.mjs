// Feature 1 (part C1): trade journal statistics, market-context enrichment and the SQLite store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  performanceStats, groupStats, alignmentOf, journalBreakdown, enrichTradesWithContext,
  JOURNAL_MIN_SAMPLE, JOURNAL_FLAG, isJournalEnabled,
} from "../src/journal-stats.mjs";
import { openJournal, JOURNAL_SCHEMA_VERSION } from "../src/journal-store.mjs";
import { barsFromPath, upPath, H1_MS } from "./helpers.mjs";
import { resample, H4_MS } from "../src/candles.mjs";

const t = (netPnl, extra = {}) => ({ id: String(Math.random()), side: "BUY", strategy: "TREND", netPnl, ...extra });

test("journal flag is off unless exactly true", () => {
  assert.equal(JOURNAL_FLAG, "ZIQ_MARKET_INTEL_JOURNAL_ENABLED");
  assert.equal(isJournalEnabled({}), false);
  assert.equal(isJournalEnabled({ [JOURNAL_FLAG]: "1" }), false);
  assert.equal(isJournalEnabled({ [JOURNAL_FLAG]: "true" }), true);
});

test("performanceStats computes winrate, PF, expectancy, payoff ratio and loss streak", () => {
  const s = performanceStats([t(30), t(-10), t(-10), t(20), t(0), t(-5)]);
  assert.equal(s.trades, 6);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 3);
  assert.equal(s.breakeven, 1);
  assert.equal(s.winRatePct, 33.3);
  assert.equal(s.profitFactor, 2);
  assert.equal(s.netPnl, 25);
  assert.equal(s.expectancy, 4.17);
  assert.equal(s.avgWin, 25);
  assert.equal(s.avgLoss, -8.33);
  assert.equal(s.payoffRatio, 3);
  assert.equal(s.maxConsecutiveLosses, 2);
  assert.equal(s.enoughSample, false);
});

test("performanceStats handles empty and loss-free samples", () => {
  const e = performanceStats([]);
  assert.equal(e.trades, 0);
  assert.equal(e.winRatePct, null);
  assert.equal(e.profitFactor, null);
  const w = performanceStats([t(5), t(6)]);
  assert.equal(w.profitFactor, null);
  assert.equal(w.profitFactorInfinite, true);
});

test("enoughSample flips at the minimum sample", () => {
  assert.equal(JOURNAL_MIN_SAMPLE, 30);
  const s = performanceStats(Array.from({ length: 30 }, (_, i) => t(i % 2 ? 5 : -4)));
  assert.equal(s.enoughSample, true);
});

test("alignmentOf maps library state and side", () => {
  assert.equal(alignmentOf("UPTREND", "BUY"), "WITH_TREND");
  assert.equal(alignmentOf("UPTREND", "SELL"), "AGAINST_TREND");
  assert.equal(alignmentOf("DOWNTREND", "SELL"), "WITH_TREND");
  assert.equal(alignmentOf("DOWNTREND", "BUY"), "AGAINST_TREND");
  assert.equal(alignmentOf("SIDEWAY", "BUY"), "SIDEWAY");
  assert.equal(alignmentOf("TRANSITION", "SELL"), "TRANSITION");
  assert.equal(alignmentOf(null, "SELL"), "UNKNOWN");
});

test("groupStats sorts groups by trade count and keeps keys", () => {
  const g = groupStats([t(1, { side: "SELL" }), t(2), t(-1)], (x) => x.side);
  assert.deepEqual(g.map((x) => [x.key, x.trades]), [["BUY", 2], ["SELL", 1]]);
});

test("journalBreakdown reports by market type, strategy, side and alignment", () => {
  const trades = [
    t(10, { libraryState: "UPTREND", alignment: "WITH_TREND", productionRegime: "TRENDING" }),
    t(-5, { libraryState: "SIDEWAY", alignment: "SIDEWAY", productionRegime: "RANGING", side: "SELL", strategy: "SIDEWAY" }),
  ];
  const b = journalBreakdown(trades);
  assert.equal(b.overall.trades, 2);
  for (const k of ["byLibraryState", "byProductionRegime", "byStrategy", "bySide", "byAlignment", "byStrategyAndLibraryState"]) {
    assert.ok(Array.isArray(b[k]), k);
  }
  assert.equal(b.byStrategyAndLibraryState.find((x) => x.key === "SIDEWAY|SIDEWAY").trades, 1);
});

test("enrichTradesWithContext classifies each trade causally at its open time", () => {
  const h1 = barsFromPath(600, upPath(), { periodMs: H1_MS });
  const h4 = resample(h1, H4_MS);
  const lastClose = h1[h1.length - 1].closeTime;
  const trades = [
    { id: "a", side: "BUY", openedAt: lastClose - 5 * H1_MS, netPnl: 3 },
    { id: "b", side: "SELL", openedAt: lastClose - 5 * H1_MS, netPnl: -3 },
    { id: "c", side: "BUY", openedAt: h1[0].openTime - H1_MS, netPnl: 1 },
  ];
  const out = enrichTradesWithContext({ trades, h4, h1 });
  assert.equal(out[0].libraryState, "UPTREND");
  assert.equal(out[0].alignment, "WITH_TREND");
  assert.equal(out[1].alignment, "AGAINST_TREND");
  assert.equal(out[2].libraryState, null);
  assert.equal(out[2].alignment, "UNKNOWN");
  assert.equal(out[0].libraryVersion, "regime-library-v1");
  // Causality: a trade opened mid-bar must not see that bar.
  const mid = enrichTradesWithContext({ trades: [{ id: "m", side: "BUY", openedAt: h1[300].openTime + 1000 }], h4, h1 })[0];
  assert.ok(mid.libraryAsOfH1 <= h1[300].openTime);
});

test("SQLite journal: schema, idempotent trade upsert, scenarios, audit log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-journal-"));
  try {
    const j = await openJournal(join(dir, "nested", "journal.sqlite"));
    assert.equal(j.schemaVersion(), JOURNAL_SCHEMA_VERSION);
    const row = { id: "p1", symbol: "XAUUSD", strategy: "TREND", side: "BUY", openedAt: 1, closedAt: 2, volume: 0.03, entry: 2000, exit: 2010, netPnl: 30, libraryState: "UPTREND", alignment: "WITH_TREND" };
    assert.equal(j.upsertTrades([row]).inserted, 1);
    const again = j.upsertTrades([{ ...row, netPnl: 31 }]);
    assert.equal(again.inserted, 0);
    assert.equal(again.updated, 1);
    const list = j.listTrades();
    assert.equal(list.length, 1);
    assert.equal(list[0].netPnl, 31);
    assert.equal(list[0].libraryState, "UPTREND");
    assert.equal(j.countTrades(), 1);

    const sc = { asOf: 100, role: "PRIMARY", direction: "BUY", entry: 2000, stopLoss: 1990, takeProfit1: 2015, takeProfit2: 2030, rr1: 1.5, confidence: 65, m15Status: "WAITING", version: "mtf-scenario-v1" };
    assert.equal(j.recordScenarios([sc, sc]).inserted, 1);
    assert.equal(j.listScenarios().length, 1);

    j.appendAudit({ actor: "system", action: "JOURNAL_SYNC", detail: { trades: 1 } });
    const audit = j.listAudit();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "JOURNAL_SYNC");
    assert.deepEqual(audit[0].detail, { trades: 1 });
    j.close();

    const reopened = await openJournal(join(dir, "nested", "journal.sqlite"));
    assert.equal(reopened.countTrades(), 1);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit log is append-only at the database level", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-journal-"));
  try {
    const j = await openJournal(join(dir, "j.sqlite"));
    j.appendAudit({ actor: "system", action: "X" });
    assert.throws(() => j.db.exec("UPDATE audit_log SET action = 'Y'"), /append-only/);
    assert.throws(() => j.db.exec("DELETE FROM audit_log"), /append-only/);
    j.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
