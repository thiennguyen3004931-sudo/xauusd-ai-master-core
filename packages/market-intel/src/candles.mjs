// Higher-timeframe bars built from lower-timeframe bars (broker time kept as-is).
export const M15_MS = 15 * 60_000;
export const H1_MS = 60 * 60_000;
export const H4_MS = 4 * H1_MS;

/**
 * Group bars into `periodMs` buckets aligned to epoch (00/04/08... for H4, matching MT5 broker-time bars).
 * The last bucket may still be forming; callers must use lastClosedIndex() before reading it.
 */
export function resample(bars, periodMs) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const start = Math.floor(b.openTime / periodMs) * periodMs;
    if (!cur || cur.openTime !== start) {
      cur = {
        openTime: start,
        closeTime: start + periodMs,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        tickVolume: b.tickVolume ?? 0,
        sourceBars: 0,
      };
      out.push(cur);
    }
    cur.high = Math.max(cur.high, b.high);
    cur.low = Math.min(cur.low, b.low);
    cur.close = b.close;
    cur.tickVolume += b.tickVolume ?? 0;
    cur.sourceBars += 1;
  }
  return out;
}

/** Index of the last bar whose closeTime <= asOf (binary search), or -1. */
export function lastClosedIndex(bars, asOf) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].closeTime <= asOf) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
