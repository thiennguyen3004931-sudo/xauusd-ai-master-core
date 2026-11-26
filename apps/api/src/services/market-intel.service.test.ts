import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMarketIntelSnapshot, type CandleLoader } from "./market-intel.service";

const PERIOD = { M15: 15 * 60_000, H1: 60 * 60_000, H4: 4 * 60 * 60_000 } as const;
const synthetic: CandleLoader = async (_symbol, timeframe, count) => {
  const p = PERIOD[timeframe];
  const k = p / PERIOD.M15;
  // All timeframes end at the same time, like the bridge (most recent `count` closed bars).
  const end = Date.UTC(2026, 2, 2);
  const start = end - count * p;
  const offset = (start - Date.UTC(2025, 0, 1)) / PERIOD.M15;
  return Array.from({ length: count }, (_, i) => {
    const f = (j: number) => { const m = offset + j * k; return 2000 + 0.06 * m + 15 * Math.sin((2 * Math.PI * m) / 384) + 4 * Math.sin((2 * Math.PI * m) / 40); };
    const open = f(i - 1), close = f(i);
    return { openTime: start + i * p, closeTime: start + (i + 1) * p, open, close, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2 };
  });
};

test("both features OFF by default: no candle request, empty advisory snapshot", async () => {
  let calls = 0;
  const loader: CandleLoader = async (...args) => { calls += 1; return synthetic(...args); };
  const s = await getMarketIntelSnapshot("XAUUSD", { env: {}, loader, useCache: false });
  assert.equal(calls, 0);
  assert.deepEqual(s.enabled, { regimeLibrary: false, mtf: false });
  assert.equal(s.regime, null);
  assert.equal(s.mtf, null);
  assert.deepEqual(s.safety, { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
});

test("regime library only: classification without scenarios and without M15 request", async () => {
  const asked: string[] = [];
  const loader: CandleLoader = async (sym, tf, n) => { asked.push(tf); return synthetic(sym, tf, n); };
  const s = await getMarketIntelSnapshot("XAUUSD", { env: { ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: "true" }, loader, useCache: false });
  assert.ok(s.regime);
  assert.equal(s.mtf, null);
  assert.ok(!asked.includes("M15"));
});

test("MTF enabled: scenarios and three SVG charts", async () => {
  const s = await getMarketIntelSnapshot("XAUUSD", { env: { ZIQ_MARKET_INTEL_MTF_ENABLED: "true" }, loader: synthetic, useCache: false });
  assert.ok(s.mtf && s.mtf.scenarios.length >= 1, JSON.stringify({ notes: s.mtf?.notes, h4: s.mtf?.h4.state, h1: s.mtf?.h1.state, i: [s.mtf?.h4.index, s.mtf?.h1.index, s.mtf?.m15.index] }));
  assert.ok(s.charts && s.charts.h4.startsWith("<svg") && s.charts.m15.includes("SL "));
});

test("route and service are GET-only and never reach orders, positions or bot mode", () => {
  const route = readFileSync(new URL("../routes/market-intel.route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("./market-intel.service.ts", import.meta.url), "utf8");
  assert.ok(!/router\.(post|put|patch|delete)\(/.test(route));
  for (const src of [route, service]) {
    for (const bad of [/order_send/i, /\/v1\/orders?/, /\/v1\/positions?/, /setPhase7CBotMode/, /LIVE_ARM/, /method:\s*"(POST|PUT|PATCH|DELETE)"/, /execution-engine/, /mt5-broker/]) {
      assert.ok(!bad.test(src), `${bad} found`);
    }
  }
});

test("real-time cadence: cache lasts until the next M15 close; refresh bypasses it", async () => {
  let calls = 0;
  const loader: CandleLoader = async (...args) => { calls += 1; return synthetic(...args); };
  const env = { ZIQ_MARKET_INTEL_MTF_ENABLED: "true" };
  const t0 = Date.UTC(2026, 2, 2, 0, 1); // synthetic bars end at 00:00
  const a = await getMarketIntelSnapshot("XAUUSD", { env, loader, now: t0 });
  assert.equal(a.lastM15CloseAt, Date.UTC(2026, 2, 2, 0, 0));
  assert.equal(a.nextM15CloseAt, Date.UTC(2026, 2, 2, 0, 15));
  const n1 = calls;
  // Same M15 bar, 5 minutes later: cached even past the old 60 s TTL.
  await getMarketIntelSnapshot("XAUUSD", { env, loader, now: t0 + 5 * 60_000 });
  assert.equal(calls, n1);
  // A new M15 bar closed: reload.
  await getMarketIntelSnapshot("XAUUSD", { env, loader, now: Date.UTC(2026, 2, 2, 0, 15, 5) });
  assert.ok(calls > n1);
  const n2 = calls;
  // Manual refresh: reload now.
  const r = await getMarketIntelSnapshot("XAUUSD", { env, loader, now: Date.UTC(2026, 2, 2, 0, 16), refresh: true });
  assert.ok(calls > n2);
  assert.equal(r.refreshed, true);
  // Refresh twice within the throttle window: served from cache.
  const n3 = calls;
  await getMarketIntelSnapshot("XAUUSD", { env, loader, now: Date.UTC(2026, 2, 2, 0, 16, 3), refresh: true });
  assert.equal(calls, n3);
});

test("bridge lag: a snapshot built before the just-closed M15 bar is published is not pinned", async () => {
  let calls = 0;
  const loader: CandleLoader = async (...args) => { calls += 1; return synthetic(...args); };
  const env = { ZIQ_MARKET_INTEL_MTF_ENABLED: "true" };
  // Clock says 00:31, but the newest bar the bridge returns closed at 00:00.
  await getMarketIntelSnapshot("XAUUSD", { env, loader, now: Date.UTC(2026, 2, 2, 0, 31) });
  const n = calls;
  await getMarketIntelSnapshot("XAUUSD", { env, loader, now: Date.UTC(2026, 2, 2, 0, 32) });
  assert.ok(calls > n);
});
