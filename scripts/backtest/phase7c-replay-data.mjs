// Phase 7C T3/T4 replay — data loading and per-bar signal precompute (offline, no MT5, no orders).
//
// Reuses the production logic wherever it is importable:
//   - regime / supply-demand range: AnalysisPipeline + IndicatorPipeline + MarketRegimeClassifier +
//     RangeBoundaryUtils, exactly as apps/api/src/services/phase7c-live-regime.service.ts (320 M15 bars)
//   - SuperTrend(10,3): phase7BSupertrend from @xauusd/risk-engine
//   - SIDEWAY range side / M5 confirmation / plan: scripts/phase7c-sideway-logic.mjs
//   - structural buffer: scripts/phase7c-stop-monotonicity.mjs
// The TREND pattern detector is a verbatim port of detectEntryPattern() in
// scripts/run-phase7b-demo-controller.ts (it is not exported there).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = (name) => path.join(root, "packages", name, "dist", "index.js");

export const M5_MS = 5 * 60_000;
export const M15_MS = 15 * 60_000;
const ENGULF_BODY_TOLERANCE_PRICE = 0.1;

// MT5 "Export bars" format: <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>
// Times are broker server time; they are kept as-is (treated as UTC epoch) because every rule
// here only needs ordering and bar alignment, not wall-clock sessions.
export function parseMt5Csv(text, periodMs) {
  const lines = text.trim().split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const cols = line.trim().split(/[\t,;]/);
    if (cols.length < 6 || !/^\d{4}[.-]\d{2}[.-]\d{2}$/.test(cols[0])) continue;
    const openTime = Date.parse(`${cols[0].replaceAll(".", "-")}T${cols[1]}Z`);
    if (!Number.isFinite(openTime)) continue;
    out.push({
      openTime,
      closeTime: openTime + periodMs,
      open: Number(cols[2]),
      high: Number(cols[3]),
      low: Number(cols[4]),
      close: Number(cols[5]),
      tickVolume: Number(cols[6] ?? 0),
      spreadPoints: Number(cols[8] ?? 0),
    });
  }
  out.sort((a, b) => a.openTime - b.openTime);
  return out;
}

export function loadMt5Bars(file, periodMs) {
  return parseMt5Csv(fs.readFileSync(file, "utf8"), periodMs);
}

const isBullish = (bar) => bar.close > bar.open;
const isBearish = (bar) => bar.close < bar.open;
const bodySize = (bar) => Math.abs(bar.close - bar.open);

// Verbatim port of detectEntryPattern (Pattern Rule V2: THREE -> TWO -> ENGULFING).
export function detectEntryPattern(bars, index) {
  const current = bars[index];
  if (index >= 3) {
    const anchor = bars[index - 3];
    const b = bars[index - 2];
    const c = bars[index - 1];
    const d = current;
    const anchorBody = bodySize(anchor);
    const bcBodyTotal = bodySize(b) + bodySize(c);
    const bcdBodyTotal = bcBodyTotal + bodySize(d);
    if (isBearish(anchor) && isBullish(b) && isBullish(c) && isBullish(d) && bcBodyTotal < anchorBody && bcdBodyTotal > anchorBody) {
      return { side: "BUY", pattern: "THREE_CANDLE_BODY_DOMINANCE", patternExtreme: Math.min(anchor.low, b.low, c.low, d.low) };
    }
    if (isBullish(anchor) && isBearish(b) && isBearish(c) && isBearish(d) && bcBodyTotal < anchorBody && bcdBodyTotal > anchorBody) {
      return { side: "SELL", pattern: "THREE_CANDLE_BODY_DOMINANCE", patternExtreme: Math.max(anchor.high, b.high, c.high, d.high) };
    }
  }
  if (index >= 2) {
    const anchor = bars[index - 2];
    const b = bars[index - 1];
    const c = current;
    const anchorBody = bodySize(anchor);
    const bBody = bodySize(b);
    const bcBodyTotal = bBody + bodySize(c);
    if (isBearish(anchor) && isBullish(b) && isBullish(c) && bBody < anchorBody && bcBodyTotal > anchorBody) {
      return { side: "BUY", pattern: "TWO_CANDLE_BODY_DOMINANCE", patternExtreme: Math.min(anchor.low, b.low, c.low) };
    }
    if (isBullish(anchor) && isBearish(b) && isBearish(c) && bBody < anchorBody && bcBodyTotal > anchorBody) {
      return { side: "SELL", pattern: "TWO_CANDLE_BODY_DOMINANCE", patternExtreme: Math.max(anchor.high, b.high, c.high) };
    }
  }
  if (index >= 1) {
    const previous = bars[index - 1];
    if (isBearish(previous) && isBullish(current) &&
      current.open <= previous.close + ENGULF_BODY_TOLERANCE_PRICE + 1e-9 &&
      current.close + ENGULF_BODY_TOLERANCE_PRICE + 1e-9 >= previous.open) {
      return { side: "BUY", pattern: "ENGULFING", patternExtreme: current.low };
    }
    if (isBullish(previous) && isBearish(current) &&
      current.open + ENGULF_BODY_TOLERANCE_PRICE + 1e-9 >= previous.close &&
      current.close <= previous.open + ENGULF_BODY_TOLERANCE_PRICE + 1e-9) {
      return { side: "SELL", pattern: "ENGULFING", patternExtreme: current.high };
    }
  }
  return null;
}

// Verbatim port of hasRelevantFvg / opposingFvgRejectionAt (index-based).
export function hasRelevantFvg(bars, index, side, lookback) {
  if (index < 2) return false;
  const start = Math.max(2, index - lookback);
  const current = bars[index];
  for (let i = index - 1; i >= start; i -= 1) {
    const first = bars[i - 2];
    const third = bars[i];
    if (side === "BUY" && third.low > first.high && current.low <= third.low && current.high >= first.high) return true;
    if (side === "SELL" && third.high < first.low && current.high >= third.high && current.low <= first.low) return true;
  }
  return false;
}

export function opposingFvgRejectionAtIndex(side, bars, currentIndex, lookback, afterSignalTimestamp) {
  if (currentIndex < 2) return false;
  const current = bars[currentIndex];
  if (current.closeTime <= afterSignalTimestamp) return false;
  const rejectionDirection = side === "BUY" ? current.close < current.open : current.close > current.open;
  if (!rejectionDirection) return false;
  const start = Math.max(2, currentIndex - lookback);
  for (let i = currentIndex - 1; i >= start; i -= 1) {
    const first = bars[i - 2];
    const third = bars[i];
    if (side === "BUY" && third.high < first.low) {
      if (current.high >= third.high && current.low <= first.low && current.close < first.low) return true;
    }
    if (side === "SELL" && third.low > first.high) {
      if (current.high >= first.high && current.low <= third.low && current.close > first.high) return true;
    }
  }
  return false;
}

function rollingSma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Precompute everything that does not depend on management parameters:
 * per-M15 regime (production classifier), TREND candidate signals, SuperTrend
 * directions and moving averages. Expensive (~3 ms per M15 bar); cache with saveCache().
 */
export async function precomputeReplay({ m15, m5, regimeWindow = 320, onProgress } = {}) {
  const { AnalysisPipeline } = await import(pkg("analysis-engine"));
  const { IndicatorPipeline } = await import(pkg("indicators"));
  const { MarketRegimeClassifier, RangeBoundaryUtils, defaultStrategyEngineConfig } = await import(pkg("strategy-engine"));
  const { Timeframe } = await import(pkg("market-data"));
  const { phase7BSupertrend } = await import(pkg("risk-engine"));

  const analysisPipeline = new AnalysisPipeline();
  const indicatorPipeline = new IndicatorPipeline();
  const classifier = new MarketRegimeClassifier();
  const candles = m15.map((bar) => ({
    symbol: "XAUUSD", timeframe: Timeframe.M15, openTime: bar.openTime, closeTime: bar.closeTime,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.tickVolume, spread: bar.spreadPoints,
  }));

  const regimes = new Array(m15.length).fill(null);
  for (let i = regimeWindow - 1; i < m15.length; i += 1) {
    const window = candles.slice(i - regimeWindow + 1, i + 1);
    const analysis = analysisPipeline.analyze("XAUUSD", Timeframe.M15, window);
    const indicators = indicatorPipeline.calculate(window);
    const assessment = classifier.classify({ analysis, indicators }, defaultStrategyEngineConfig);
    const range = RangeBoundaryUtils.find(indicators.latest.close, analysis.supplyDemandZones);
    const regime = assessment.regime;
    regimes[i] = {
      regime,
      confidence: assessment.confidence,
      recommendedMode: regime === "RANGING" ? "SIDEWAY" : (regime === "TRENDING" || regime === "BREAKOUT") ? "TREND" : "PAUSE",
      atr: Number(indicators.latest.atr),
      range: range
        ? { demand: { low: range.demand.low, high: range.demand.high }, supply: { low: range.supply.low, high: range.supply.high } }
        : null,
    };
    if (onProgress && i % 1000 === 0) onProgress(i, m15.length);
  }

  const m15St = phase7BSupertrend(m15, 10, 3).direction;
  const m5St = phase7BSupertrend(m5, 10, 3).direction;
  const closes = m15.map((bar) => bar.close);
  const ma20 = rollingSma(closes, 20);
  const ma50 = rollingSma(closes, 50);

  const trendSignals = new Array(m15.length).fill(null);
  for (let i = 200; i < m15.length; i += 1) {
    const trigger = detectEntryPattern(m15, i);
    if (!trigger) continue;
    trendSignals[i] = trigger;
  }

  return {
    version: 1,
    m15Count: m15.length,
    m5Count: m5.length,
    firstM15: m15[0]?.openTime ?? null,
    lastM15: m15.at(-1)?.openTime ?? null,
    regimes,
    m15St,
    m5St,
    ma20,
    ma50,
    trendSignals,
  };
}

export function saveCache(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

export function loadCache(file, m15, m5) {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.version !== 1 || data.m15Count !== m15.length || data.m5Count !== m5.length ||
    data.firstM15 !== m15[0]?.openTime || data.lastM15 !== m15.at(-1)?.openTime) return null;
  return data;
}
