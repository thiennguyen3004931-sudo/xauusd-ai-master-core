// Price zones known as of bar i: support / resistance from clustered swings, and order blocks
// (last opposite candle before a BOS / CHoCH) that have not been mitigated by a close through them.

/**
 * Cluster confirmed swings (confirmIndex <= i) whose prices lie within `clusterAtr` ATR of each other.
 * Returns levels sorted by distance to the close at i.
 */
export function keyLevels(analysis, i, { clusterAtr = 0.5, maxSwings = 60, maxLevels = 8 } = {}) {
  const { bars, swings } = analysis;
  const atr = analysis.atr[i] ?? analysis.atr.findLast?.((v) => v) ?? 1;
  const close = bars[i].close;
  const visible = swings.filter((s) => s.confirmIndex <= i).slice(-maxSwings);
  const sorted = [...visible].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const s of sorted) {
    const last = clusters.at(-1);
    if (last && s.price - last.prices.at(-1) <= clusterAtr * atr) {
      last.prices.push(s.price);
      last.lastIndex = Math.max(last.lastIndex, s.index);
    } else {
      clusters.push({ prices: [s.price], lastIndex: s.index });
    }
  }
  return clusters
    .map((c) => {
      const price = c.prices.reduce((x, y) => x + y, 0) / c.prices.length;
      const pad = 0.1 * atr;
      return {
        price,
        low: Math.min(...c.prices) - pad,
        high: Math.max(...c.prices) + pad,
        touches: c.prices.length,
        lastIndex: c.lastIndex,
        kind: price >= close ? "RESISTANCE" : "SUPPORT",
      };
    })
    .sort((a, b) => b.touches - a.touches || Math.abs(a.price - close) - Math.abs(b.price - close))
    .slice(0, maxLevels)
    .sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close));
}

/**
 * Order blocks from structure events up to bar i. Bullish OB: the last bearish candle at or before
 * the start of the impulse that produced a bullish BOS / CHoCH. Mitigated (dropped) once a later close
 * (<= i) goes through the far side of the block.
 */
export function orderBlocks(analysis, i, { lookback = 150, searchBars = 20 } = {}) {
  const { bars, events } = analysis;
  const out = [];
  for (const e of events) {
    if (e.index > i || e.index < i - lookback) continue;
    const bullish = e.direction === "UP";
    let k = e.index - 1;
    const stop = Math.max(0, e.index - searchBars);
    while (k >= stop) {
      const b = bars[k];
      if (bullish ? b.close < b.open : b.close > b.open) break;
      k -= 1;
    }
    if (k < stop) continue;
    const b = bars[k];
    const zone = { index: k, eventIndex: e.index, eventType: e.type, direction: bullish ? "BULLISH" : "BEARISH", low: b.low, high: b.high };
    let mitigated = false;
    for (let j = e.index + 1; j <= i; j += 1) {
      if (bullish ? bars[j].close < zone.low : bars[j].close > zone.high) { mitigated = true; break; }
    }
    if (!mitigated && !out.some((o) => o.index === k && o.direction === zone.direction)) out.push(zone);
  }
  return out.sort((a, b) => b.index - a.index);
}
