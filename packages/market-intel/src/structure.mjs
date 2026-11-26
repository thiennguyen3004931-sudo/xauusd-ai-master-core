// Market structure: fractal swings (HH/HL/LH/LL), BOS and CHoCH. Causal: a swing exists only
// from its confirmIndex (index + swingBars), and events only use swings confirmed at that bar.

/**
 * @param bars OHLC bars
 * @param swingBars bars on each side that must be lower (high) / higher (low)
 * @param equalTolerance price distance treated as "equal" (labels EH / EL); a number or (index) => number
 */
export function detectSwings(bars, swingBars = 3, equalTolerance = 0) {
  const tol = typeof equalTolerance === "function" ? equalTolerance : () => equalTolerance;
  const swings = [];
  let prevHigh = null;
  let prevLow = null;
  for (let i = swingBars; i < bars.length - swingBars; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= swingBars; k += 1) {
      if (!(bars[i].high >= bars[i - k].high && bars[i].high > bars[i + k].high)) isHigh = false;
      if (!(bars[i].low <= bars[i - k].low && bars[i].low < bars[i + k].low)) isLow = false;
    }
    const t = tol(i + swingBars) ?? 0;
    if (isHigh) {
      const price = bars[i].high;
      const label = prevHigh === null ? "H" : price > prevHigh + t ? "HH" : price < prevHigh - t ? "LH" : "EH";
      swings.push({ index: i, confirmIndex: i + swingBars, type: "HIGH", price, label });
      prevHigh = price;
    }
    if (isLow) {
      const price = bars[i].low;
      const label = prevLow === null ? "L" : price > prevLow + t ? "HL" : price < prevLow - t ? "LL" : "EL";
      swings.push({ index: i, confirmIndex: i + swingBars, type: "LOW", price, label });
      prevLow = price;
    }
  }
  return swings;
}

/**
 * BOS / CHoCH events: a close beyond the latest confirmed, unbroken swing.
 * BOS = break in the direction of the prevailing structure (or the first break);
 * CHoCH = break against it.
 */
export function detectStructureEvents(bars, swings) {
  const byConfirm = new Map();
  for (const s of swings) {
    if (!byConfirm.has(s.confirmIndex)) byConfirm.set(s.confirmIndex, []);
    byConfirm.get(s.confirmIndex).push(s);
  }
  const events = [];
  let refHigh = null;
  let refLow = null;
  let trend = null;
  for (let j = 0; j < bars.length; j += 1) {
    for (const s of byConfirm.get(j) ?? []) {
      if (s.type === "HIGH") refHigh = { ...s, broken: false };
      else refLow = { ...s, broken: false };
    }
    const close = bars[j].close;
    if (refHigh && !refHigh.broken && close > refHigh.price) {
      events.push({ index: j, direction: "UP", type: trend === "DOWN" ? "CHOCH" : "BOS", level: refHigh.price, swingIndex: refHigh.index });
      refHigh.broken = true;
      trend = "UP";
    }
    if (refLow && !refLow.broken && close < refLow.price) {
      events.push({ index: j, direction: "DOWN", type: trend === "UP" ? "CHOCH" : "BOS", level: refLow.price, swingIndex: refLow.index });
      refLow.broken = true;
      trend = "DOWN";
    }
  }
  return events;
}

/** Structure as known at the close of bar i. */
export function structureAt(bars, swings, i, events = null) {
  const visible = swings.filter((s) => s.confirmIndex <= i);
  const allEvents = events ?? detectStructureEvents(bars, swings);
  const visibleEvents = allEvents.filter((e) => e.index <= i);
  const highs = visible.filter((s) => s.type === "HIGH").slice(-2);
  const lows = visible.filter((s) => s.type === "LOW").slice(-2);
  let pattern = "NONE";
  if (highs.length === 2 && lows.length === 2) {
    const hh = highs[1].label === "HH";
    const hl = lows[1].label === "HL";
    const lh = highs[1].label === "LH";
    const ll = lows[1].label === "LL";
    pattern = hh && hl ? "HH_HL" : lh && ll ? "LH_LL" : "MIXED";
  }
  const lastEvent = visibleEvents.at(-1) ?? null;
  return { swings: visible, events: visibleEvents, pattern, lastEvent };
}
