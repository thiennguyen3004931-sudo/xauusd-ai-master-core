// Causal indicators: the value at index i only uses bars 0..i.

/** EMA seeded with the SMA of the first `period` values; null before that. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = prev + (values[i] - prev) * k;
    out[i] = prev;
  }
  return out;
}

function trueRange(bars, i) {
  const b = bars[i];
  if (i === 0) return b.high - b.low;
  const pc = bars[i - 1].close;
  return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
}

/** Wilder ATR: first value at index `period` (mean of TR[1..period]). */
export function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += trueRange(bars, i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i += 1) {
    prev = (prev * (period - 1) + trueRange(bars, i)) / period;
    out[i] = prev;
  }
  return out;
}

/** Wilder ADX with +DI / -DI. Entries are null until ADX is defined (index 2 * period - 1). */
export function adx(bars, period = 14) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  if (n < 2 * period) return out;
  let trS = 0, pS = 0, mS = 0;
  const dx = new Array(n).fill(null);
  const di = new Array(n).fill(null);
  for (let i = 1; i < n; i += 1) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = trueRange(bars, i);
    if (i <= period) {
      trS += tr; pS += pdm; mS += mdm;
      if (i < period) continue;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    const plusDi = trS > 0 ? (100 * pS) / trS : 0;
    const minusDi = trS > 0 ? (100 * mS) / trS : 0;
    const sum = plusDi + minusDi;
    di[i] = { plusDi, minusDi };
    dx[i] = sum > 0 ? (100 * Math.abs(plusDi - minusDi)) / sum : 0;
  }
  let prev = 0;
  for (let i = period; i < 2 * period; i += 1) prev += dx[i];
  prev /= period;
  out[2 * period - 1] = { adx: prev, ...di[2 * period - 1] };
  for (let i = 2 * period; i < n; i += 1) {
    prev = (prev * (period - 1) + dx[i]) / period;
    out[i] = { adx: prev, ...di[i] };
  }
  return out;
}
