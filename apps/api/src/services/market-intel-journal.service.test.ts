import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  syncMarketIntelJournal,
  getMarketIntelJournalSummary,
  type JournalTradeSource,
} from "./market-intel-journal.service";
import type { CandleLoader } from "./market-intel.service";

const H1 = 3_600_000;
const END = Date.UTC(2026, 10, 20, 12);

function trendBars(count: number, periodMs: number) {
  const bars = [];
  const start = END - count * periodMs;
  for (let i = 0; i < count; i += 1) {
    const p = (k: number) => 2000 + 0.8 * k * (periodMs / H1) + 12 * Math.sin((2 * Math.PI * k) / 24);
    const open = p(i - 1), close = p(i);
    bars.push({ openTime: start + i * periodMs, closeTime: start + (i + 1) * periodMs, open, close, high: Math.max(open, close) + 0.6, low: Math.min(open, close) - 0.6 });
  }
  return bars;
}

const loader: CandleLoader = async (_s, tf, count) => trendBars(Math.min(count, 600), tf === "H4" ? 4 * H1 : tf === "H1" ? H1 : H1 / 4);

const trades: JournalTradeSource = async () => [
  { id: "101", side: "BUY", strategy: "TREND", openedAt: END - 10 * H1, closedAt: END - 8 * H1, volume: 0.03, entry: 2400, exit: 2410, netPnl: 30, session: "LONDON", correlation: "EXACT", productionRegime: "TRENDING", entryType: "PULLBACK", entryPolicy: null },
  { id: "102", side: "SELL", strategy: "TREND", openedAt: END - 6 * H1, closedAt: END - 5 * H1, volume: 0.03, entry: 2410, exit: 2415, netPnl: -15, session: "NEW_YORK", correlation: "UNMATCHED", productionRegime: null, entryType: "UNKNOWN", entryPolicy: null },
];

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), "mi-journal-api-"));
  return { dir, file: path.join(dir, "j.sqlite") };
}

test("journal is off by default: no trade read, no candle read, no file", async () => {
  const { dir, file } = tmp();
  try {
    let calls = 0;
    const res = await syncMarketIntelJournal({ env: {}, journalPath: file, loader: async () => { calls += 1; return []; }, tradeSource: async () => { calls += 1; return []; } });
    assert.equal(res.enabled, false);
    assert.equal(calls, 0);
    const summary = await getMarketIntelJournalSummary({ env: {}, journalPath: file });
    assert.equal(summary.enabled, false);
    assert.equal(summary.breakdown, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync stores trades with library context, is idempotent and audited", async () => {
  const { dir, file } = tmp();
  const env = { ZIQ_MARKET_INTEL_JOURNAL_ENABLED: "true" };
  try {
    const first = await syncMarketIntelJournal({ env, journalPath: file, loader, tradeSource: trades, now: END });
    assert.equal(first.enabled, true);
    assert.equal(first.inserted, 2);
    const second = await syncMarketIntelJournal({ env, journalPath: file, loader, tradeSource: trades, now: END });
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 2);
    const summary = await getMarketIntelJournalSummary({ env, journalPath: file });
    assert.equal(summary.totalTrades, 2);
    assert.equal(summary.breakdown?.overall.trades, 2);
    assert.equal(summary.breakdown?.overall.netPnl, 15);
    const buy = summary.recentTrades.find((t) => t.id === "101");
    assert.equal(buy?.libraryState, "UPTREND");
    assert.equal(buy?.alignment, "WITH_TREND");
    assert.equal(summary.recentTrades.find((t) => t.id === "102")?.alignment, "AGAINST_TREND");
    assert.equal(summary.audit.filter((a) => a.action === "JOURNAL_SYNC").length, 2);
    assert.equal(summary.safety.orderMutation, false);
    assert.equal(summary.sampleNote.includes("30"), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("journal service and route stay read-only toward broker and runtime", () => {
  const service = readFileSync(new URL("./market-intel-journal.service.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../routes/market-intel-journal.route.ts", import.meta.url), "utf8");
  for (const text of [service, route]) {
    for (const bad of [/order_send/i, /\/v1\/orders?/, /\/v1\/positions?/, /setPhase7CBotMode/, /LIVE_ARM/, /method:\s*"(POST|PUT|PATCH|DELETE)"/, /execution-engine/, /mt5-broker/]) {
      assert.ok(!bad.test(text), `forbidden ${bad}`);
    }
  }
  // The only write route is the journal sync, and it is restricted to loopback or the operator token.
  assert.deepEqual([...route.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`), ["post /sync"]);
  assert.match(route, /canSyncJournal\(req\)/);
});
