// Synthetic bar generators for tests. No market data, no network.
export const M15_MS = 15 * 60_000;
export const H1_MS = 60 * 60_000;

/**
 * Build bars from a price path. Each bar opens at path(i - 1) and closes at path(i);
 * the wick extends `wick` beyond the body on both sides.
 */
export function barsFromPath(count, path, { periodMs = H1_MS, start = Date.UTC(2026, 0, 5), wick = 0.6 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const open = path(i - 1);
    const close = path(i);
    const openTime = start + i * periodMs;
    bars.push({
      openTime,
      closeTime: openTime + periodMs,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
    });
  }
  return bars;
}

/** Rising zig-zag: drift per bar plus a sine wave, so swings form HH + HL. */
export const upPath = (base = 2000, drift = 0.8, amp = 12, cycle = 24) => (i) =>
  base + drift * i + amp * Math.sin((2 * Math.PI * i) / cycle);

export const downPath = (base = 2600, drift = 0.8, amp = 12, cycle = 24) => (i) =>
  base - drift * i + amp * Math.sin((2 * Math.PI * i) / cycle);

/** Flat oscillation inside a band: no drift. */
export const rangePath = (base = 2300, amp = 6, cycle = 20) => (i) =>
  base + amp * Math.sin((2 * Math.PI * i) / cycle);
