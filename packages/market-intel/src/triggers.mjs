// M15 entry triggers inside a chosen zone: touch, then a structure break, an engulfing candle or a
// liquidity sweep in the trade direction. Only bars <= i are read.

export function m15Trigger(analysis, i, zone, side, { lookback = 8, sweepLookback = 10, nearAtr = 0.25 } = {}) {
  const { bars, events } = analysis;
  const atr = analysis.atr[i] ?? Math.max(0.01, bars[i].high - bars[i].low);
  const buy = side === "BUY";
  const from = Math.max(1, i - lookback + 1);
  let touchIndex = -1;
  for (let k = from; k <= i; k += 1) {
    const hit = buy ? bars[k].low <= zone.high + nearAtr * atr && bars[k].high >= zone.low - nearAtr * atr
                    : bars[k].high >= zone.low - nearAtr * atr && bars[k].low <= zone.high + nearAtr * atr;
    if (hit) { touchIndex = k; break; }
  }
  if (touchIndex < 0) return { status: "WAITING", touched: false, triggers: [] };
  const triggers = [];
  for (const e of events) {
    if (e.index >= touchIndex && e.index <= i && e.direction === (buy ? "UP" : "DOWN")) triggers.push({ type: e.type === "BOS" ? "BOS" : "CHOCH", index: e.index });
  }
  for (let k = Math.max(touchIndex, 1); k <= i; k += 1) {
    const b = bars[k], p = bars[k - 1];
    const engulf = buy
      ? b.close > b.open && p.close < p.open && b.close >= p.open && b.open <= p.close
      : b.close < b.open && p.close > p.open && b.close <= p.open && b.open >= p.close;
    if (engulf) triggers.push({ type: "ENGULFING", index: k });
    const ref = bars.slice(Math.max(0, k - sweepLookback), k);
    if (ref.length >= 3) {
      if (buy) {
        const lowRef = Math.min(...ref.map((x) => x.low));
        if (b.low < lowRef && b.close > lowRef) triggers.push({ type: "LIQUIDITY_SWEEP", index: k, level: lowRef });
      } else {
        const highRef = Math.max(...ref.map((x) => x.high));
        if (b.high > highRef && b.close < highRef) triggers.push({ type: "LIQUIDITY_SWEEP", index: k, level: highRef });
      }
    }
  }
  triggers.sort((a, b) => a.index - b.index);
  return { status: triggers.length ? "TRIGGERED" : "TOUCHED_NO_TRIGGER", touched: true, touchIndex, triggers };
}
