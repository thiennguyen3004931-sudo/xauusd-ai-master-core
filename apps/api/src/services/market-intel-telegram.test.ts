import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notifyTelegram, scenarioAlertText, maybeNotifyScenario, SCENARIO_ALERT_MIN_CONFIDENCE } from "./market-intel-telegram";

const ENV = { ZIQ_MARKET_INTEL_TELEGRAM_NOTIFY: "true", ZIQ_TELEGRAM_BOT_TOKEN: "t", ZIQ_TELEGRAM_CHAT_ID: "c" };

test("telegram is off by default and sends nothing", async () => {
  let calls = 0;
  await notifyTelegram("x", {}, (async () => { calls += 1; return new Response("{}"); }) as typeof fetch);
  assert.equal(calls, 0);
});

test("when on, it sends one plain sendMessage without buttons", async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  await notifyTelegram("hello", ENV, (async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return new Response("{}"); }) as unknown as typeof fetch);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
  assert.equal(sent[0].body.text, "hello");
  assert.equal(sent[0].body.reply_markup, undefined);
});

const snap = (confidence: number, asOf = 1000) => ({
  mtf: { asOf, scenarios: [{ role: "PRIMARY", direction: "BUY", entry: 2000, stopLoss: 1992, takeProfit1: 2012, takeProfit2: 2024, rr1: 1.5, confidence, entryZone: { low: 1998, high: 2002 }, invalidation: { text: "H1 đóng dưới 1990" } }] },
});

test("scenario alert only at confidence >= 60, deduplicated per analysis time", async () => {
  assert.equal(SCENARIO_ALERT_MIN_CONFIDENCE, 60);
  assert.equal(scenarioAlertText(snap(59) as never), null);
  assert.match(scenarioAlertText(snap(60) as never) ?? "", /không phải xác suất/);
  const sent: string[] = [];
  const state = { lastAsOf: null as number | null };
  const notify = async (t: string) => { sent.push(t); };
  await maybeNotifyScenario({ snapshot: async () => snap(70) as never, notify, state });
  await maybeNotifyScenario({ snapshot: async () => snap(70) as never, notify, state });
  await maybeNotifyScenario({ snapshot: async () => snap(70, 2000) as never, notify, state }); // same H1 bar
  await maybeNotifyScenario({ snapshot: async () => snap(70, 3_600_000 + 1000) as never, notify, state });
  assert.equal(sent.length, 2);
});

test("telegram module has no order, position or bot-mode path", () => {
  const src = readFileSync(new URL("./market-intel-telegram.ts", import.meta.url), "utf8");
  for (const bad of [/order_send/i, /\/v1\/orders?/, /\/v1\/positions?/, /setPhase7CBotMode/, /LIVE_ARM/, /reply_markup/, /callback_data/]) assert.ok(!bad.test(src), String(bad));
});
