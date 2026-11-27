// Notify-only Telegram message for market intel (new proposals). Text only: no buttons, no commands,
// no approval through Telegram. OFF unless ZIQ_MARKET_INTEL_TELEGRAM_NOTIFY = true.
type Env = Record<string, string | undefined>;

export function isMarketIntelTelegramEnabled(env: Env = process.env): boolean {
  return String(env.ZIQ_MARKET_INTEL_TELEGRAM_NOTIFY ?? "").trim().toLowerCase() === "true";
}

export async function notifyTelegram(text: string, env: Env = process.env, send: typeof fetch = fetch): Promise<void> {
  if (!isMarketIntelTelegramEnabled(env)) return;
  const token = env.ZIQ_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.ZIQ_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    await send(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Agreed threshold: a scenario is pushed to Telegram only from this confidence score up. */
export const SCENARIO_ALERT_MIN_CONFIDENCE = 60;

interface AlertScenario {
  role: string; direction: string; entry: number; stopLoss: number; takeProfit1: number; takeProfit2: number;
  rr1: number; confidence: number; entryZone: { low: number; high: number }; invalidation: { text: string };
}
interface AlertSnapshot { mtf: { asOf: number; scenarios: AlertScenario[] } | null }

export function scenarioAlertText(snapshot: AlertSnapshot): string | null {
  const s = snapshot.mtf?.scenarios.find((x) => x.role === "PRIMARY");
  if (!s || s.confidence < SCENARIO_ALERT_MIN_CONFIDENCE) return null;
  return [
    `XAUUSD kịch bản ${s.direction === "BUY" ? "MUA" : "BÁN"} · điểm ${s.confidence}%`,
    `Vùng vào ${s.entryZone.low}–${s.entryZone.high} · entry ${s.entry} · SL ${s.stopLoss} · TP1 ${s.takeProfit1} · TP2 ${s.takeProfit2} · R:R ${s.rr1}`,
    `Mất hiệu lực: ${s.invalidation.text}`,
    "Điểm theo luật, không phải xác suất (tự chấm 3 năm PF 0,62). Chỉ tham khảo, bot không đặt lệnh theo tin này.",
  ].join("\n");
}

/** Sends at most one alert per H1 bar (the agreed cadence: on each H1 close), however often it is checked. */
export async function maybeNotifyScenario({ snapshot, notify, state }: {
  snapshot: () => Promise<AlertSnapshot>; notify: (text: string) => Promise<void>; state: { lastAsOf: number | null };
}): Promise<boolean> {
  const snap = await snapshot();
  const asOf = snap.mtf?.asOf ?? null;
  if (asOf === null) return false;
  const h1Bar = Math.floor(asOf / 3_600_000);
  if (h1Bar === state.lastAsOf) return false;
  const text = scenarioAlertText(snap);
  state.lastAsOf = h1Bar;
  if (!text) return false;
  await notify(text);
  return true;
}

let scenarioTimer: ReturnType<typeof setInterval> | null = null;

/** Checks the cached snapshot every 5 minutes; only when MTF and Telegram notify are both on. */
export function startMarketIntelScenarioAlerts(snapshot: () => Promise<AlertSnapshot>, env: Env = process.env): boolean {
  if (scenarioTimer || !isMarketIntelTelegramEnabled(env) || String(env.ZIQ_MARKET_INTEL_MTF_ENABLED ?? "").trim().toLowerCase() !== "true") return false;
  const state = { lastAsOf: null as number | null };
  scenarioTimer = setInterval(() => {
    void maybeNotifyScenario({ snapshot, notify: (t) => notifyTelegram(t, env), state }).catch(() => { /* notify-only */ });
  }, 5 * 60_000);
  scenarioTimer.unref?.();
  return true;
}
