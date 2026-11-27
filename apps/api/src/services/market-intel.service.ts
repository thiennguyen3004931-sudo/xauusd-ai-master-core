// Read-only market intelligence for the Control Center (features 2 and 3).
// GET candles from the local MT5 bridge, classify the market with the regime template library and build
// H4 -> H1 -> M15 scenarios. Advisory only: no order, position, BOT_MODE or runtime mutation.
// Both features are OFF unless ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED / ZIQ_MARKET_INTEL_MTF_ENABLED = true.
import {
  MTF_VERSION,
  REGIME_LIBRARY_VERSION,
  buildScenarios,
  classifyMarket,
  frameSummaries,
  nearestLevels,
  isMtfEnabled,
  isRegimeLibraryEnabled,
  renderScenarioCharts,
  type Bar,
  type FrameSummary,
  type NearLevel,
  type MarketClassification,
  type ScenarioResult,
} from "@xauusd/market-intel";

export type MarketIntelTimeframe = "M15" | "H1" | "H4";

export interface MarketIntelSnapshot {
  enabled: { regimeLibrary: boolean; mtf: boolean };
  versions: { regimeLibrary: string; mtf: string };
  symbol: string;
  generatedAt: number;
  regime: MarketClassification | null;
  mtf: ScenarioResult | null;
  charts: { h4: string; h1: string; m15: string } | null;
  /** Last closed bar (open / high / low / close) and library trend per timeframe. M15 is null unless MTF is on. */
  frames: { h4: FrameSummary | null; h1: FrameSummary | null; m15: FrameSummary | null } | null;
  /** Nearest H4 / H1 resistance above and support below the M15 close (null unless MTF is on). */
  levels: { resistance: NearLevel[]; support: NearLevel[] } | null;
  safety: { readOnly: true; advisoryOnly: true; orderMutation: false; runtimeMutation: false };
  /** Close time of the last M15 bar at generation time, and of the next one (the auto-refresh point). */
  lastM15CloseAt: number;
  nextM15CloseAt: number;
  /** True when this snapshot was rebuilt because the operator pressed "Cập nhật". */
  refreshed: boolean;
  error?: string;
}

export type CandleLoader = (symbol: string, timeframe: MarketIntelTimeframe, count: number) => Promise<Bar[]>;

const PERIOD_MS: Record<MarketIntelTimeframe, number> = { M15: 15 * 60_000, H1: 60 * 60_000, H4: 4 * 60 * 60_000 };
const SAFETY = { readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false } as const;
const M15_MS = 15 * 60_000;
/** A manual refresh within this window is served from cache, so repeated clicks cannot flood the bridge. */
const REFRESH_THROTTLE_MS = 10_000;
let cache: { key: string; at: number; bar: number; value: MarketIntelSnapshot } | null = null;

interface BridgeBar { openTime?: number; closeTime: number; open: number; high: number; low: number; close: number; tickVolume?: number }

function bridgeBaseUrl(): string {
  return (process.env.MT5_BRIDGE_BASE_URL ?? "http://127.0.0.1:8765").trim().replace(/\/$/, "");
}

function bridgeApiKey(): string {
  return process.env.MT5_BRIDGE_API_KEY?.trim() || process.env.MT5_API_KEY?.trim() || "";
}

/** GET closed candles from the MT5 bridge (read-only). The still-forming bar is dropped. */
export const bridgeCandleLoader: CandleLoader = async (symbol, timeframe, count) => {
  const apiKey = bridgeApiKey();
  if (!apiKey) throw new Error("MT5_BRIDGE_API_KEY or MT5_API_KEY is required for market intel candles.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${bridgeBaseUrl()}/v1/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&count=${count}`,
      { method: "GET", headers: { "x-mt5-api-key": apiKey }, signal: controller.signal },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`MT5 bridge candles ${timeframe} failed ${response.status}`);
    const bars = JSON.parse(text) as BridgeBar[];
    const now = Date.now();
    return bars
      .map((b) => ({
        openTime: Number(b.openTime ?? b.closeTime - PERIOD_MS[timeframe]),
        closeTime: Number(b.closeTime),
        open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close),
        tickVolume: Number(b.tickVolume ?? 0),
      }))
      .filter((b) => Number.isFinite(b.close) && b.closeTime <= now)
      .sort((a, b) => a.openTime - b.openTime);
  } finally {
    clearTimeout(timeout);
  }
};

export async function getMarketIntelSnapshot(
  symbol = "XAUUSD",
  { env = process.env, loader = bridgeCandleLoader, now = Date.now(), useCache = true, refresh = false }: {
    env?: Record<string, string | undefined>; loader?: CandleLoader; now?: number; useCache?: boolean; refresh?: boolean;
  } = {},
): Promise<MarketIntelSnapshot> {
  const enabled = { regimeLibrary: isRegimeLibraryEnabled(env), mtf: isMtfEnabled(env) };
  const lastM15CloseAt = Math.floor(now / M15_MS) * M15_MS;
  const base: MarketIntelSnapshot = {
    enabled,
    versions: { regimeLibrary: REGIME_LIBRARY_VERSION, mtf: MTF_VERSION },
    symbol, generatedAt: now, regime: null, mtf: null, charts: null, frames: null, levels: null, safety: SAFETY,
    lastM15CloseAt, nextM15CloseAt: lastM15CloseAt + M15_MS, refreshed: false,
  };
  if (!enabled.regimeLibrary && !enabled.mtf) return base;
  // Real-time cadence: one rebuild per closed M15 bar; "Cập nhật" forces a rebuild (throttled).
  const key = `${symbol}|${enabled.regimeLibrary}|${enabled.mtf}`;
  if (useCache && cache && cache.key === key) {
    const sameBar = cache.bar === lastM15CloseAt;
    if (refresh ? now - cache.at < REFRESH_THROTTLE_MS : sameBar) return cache.value;
  }

  const [h4, h1, m15] = await Promise.all([
    loader(symbol, "H4", 400),
    loader(symbol, "H1", 400),
    enabled.mtf ? loader(symbol, "M15", 400) : Promise.resolve([] as Bar[]),
  ]);
  const value: MarketIntelSnapshot = { ...base, refreshed: refresh };
  value.regime = classifyMarket({ h4, h1 });
  const asOf = m15.at(-1)?.closeTime ?? h1.at(-1)?.closeTime;
  if (asOf !== undefined) value.frames = frameSummaries({ h4, h1, m15 }, asOf);
  if (enabled.mtf && m15.length > 0) {
    value.mtf = buildScenarios({ h4, h1, m15 });
    value.levels = nearestLevels(value.mtf);
    value.charts = renderScenarioCharts({ h4, h1, m15 }, value.mtf, { compact: true, theme: "dark" });
  }
  // If the bridge has not published the just-closed bar yet, do not pin the stale result for 15 minutes.
  const dataBar = m15.length > 0 ? m15[m15.length - 1].closeTime : h1.length > 0 ? h1[h1.length - 1].closeTime : lastM15CloseAt;
  if (useCache) cache = { key, at: now, bar: enabled.mtf && dataBar < lastM15CloseAt ? dataBar : lastM15CloseAt, value };
  return value;
}
