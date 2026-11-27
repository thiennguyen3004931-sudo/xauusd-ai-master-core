// Phase 7C T3/T4 — bar-replay simulator of the Phase 7C TREND + SIDEWAY rules (offline, no MT5, no orders).
//
// Conservative execution model (documented in docs/operations/phase7c-management-sweep-report.md):
//   - bars are BID; ASK = BID + bar spread (MT5 export <SPREAD> in points x point)
//   - entries fill at the NEXT M5 bar open (ASK for BUY, BID for SELL) plus slippage
//   - STOP_FIRST: inside a bar the stop that was live at bar open is checked before TP and before any
//     profit-side action (BE, partial, FastMove). Stops moved inside a bar take effect next bar.
//   - stop fills include slippage; TP fills at the TP price; partial / market exits include slippage
//   - commission per lot round turn is charged on every closed volume
//   - one position at a time across TREND and SIDEWAY (production controllers refuse a second position)
// Not modelled: daily recovery / RECOVERY_TP, REVERSAL entries (locked on LIVE), spread / freshness gates,
// broker stop-level gaps (assumed 0), weekend gaps beyond what the bars show.
import { buildSidewayPlan, chooseRangeSide, detectM5ConfirmationWithinBars } from "../phase7c-sideway-logic.mjs";
import { opposingFvgRejectionAtIndex } from "./phase7c-replay-data.mjs";

const EPS = 1e-9;

export const BASELINE_CONFIG = Object.freeze({
  breakEvenTriggerPrice: 6,
  breakEvenOffsetPrice: 0,
  maxInitialStopPrice: 10,
  minInitialStopPrice: 6,
  fixedTpPrice: null, // null = OFF
  partialTriggerPrice: 10,
  fastMoveActivationPrice: 10,
  fastMoveGivebackPrice: 10,
  pullbackWaitMinutes: 15,
  sidewayMinConfidence: 60,
  sidewayCarryBars: 1,
  structuralBufferPrice: 1,
  volume: 0.03,
  contractSize: 100,
  point: 0.01,
  commissionPerLotRoundTurn: 7,
  slippagePrice: 0.1,
  strategies: ["TREND", "SIDEWAY"],
  // Research filters (defaults = production behaviour): TREND entries only in these regimes;
  // optional max entry spread in price units (null = no extra gate).
  trendRegimes: ["TRENDING", "BREAKOUT"],
  maxEntrySpreadPrice: null,
  // TREND entry-condition toggles (production: both ON, see createVirtualStrategyEntryConditionState)
  requireSupertrendM15: true,
  requireSupertrendM5: true,
  // Entry-signal research: false lets a TREND-path signal fire in TREND or SIDEWAY regimes (production: true,
  // TREND only when the live regime recommends TREND and is in trendRegimes). PAUSE (REVERSAL / UNCERTAIN)
  // stays locked either way, as in LIVE AUTO.
  requireTrendMode: true,
});

const sideSign = (side) => (side === "BUY" ? 1 : -1);
const tighter = (side, a, b) => (side === "BUY" ? Math.max(a, b) : Math.min(a, b));
const strictlyTighter = (side, baseline, candidate) => (side === "BUY" ? candidate > baseline + EPS : candidate < baseline - EPS);
const atLeastAsTight = (side, stop, reference) => (side === "BUY" ? stop >= reference - EPS : stop <= reference + EPS);

function spreadPrice(bar, cfg) {
  return Math.max(0, Number(bar.spreadPoints) || 0) * cfg.point;
}

function m15IndexByM5(m15, m5) {
  // For each M5 bar, the index of the latest M15 bar closed at or before the M5 close.
  const out = new Int32Array(m5.length).fill(-1);
  let k = -1;
  for (let j = 0; j < m5.length; j += 1) {
    while (k + 1 < m15.length && m15[k + 1].closeTime <= m5[j].closeTime) k += 1;
    out[j] = k;
  }
  return out;
}

export function simulate({ m15, m5, pre, config = {}, from = -Infinity, to = Infinity }) {
  const cfg = { ...BASELINE_CONFIG, ...config };
  const map = m15IndexByM5(m15, m5);
  const trades = [];
  let pos = null;
  let pending = null;
  const lotUsd = cfg.contractSize; // USD per 1.00 price per 1.00 lot
  const commission = (volume) => volume * cfg.commissionPerLotRoundTurn;

  const closeVolume = (volume, price, reason, time) => {
    const pnl = sideSign(pos.side) * (price - pos.entry) * volume * lotUsd - commission(volume);
    pos.realized += pnl;
    pos.remaining = Math.round((pos.remaining - volume) * 100) / 100;
    pos.legs.push({ volume, price, reason, time });
  };
  const finish = (reason, time) => {
    trades.push({
      strategy: pos.strategy,
      side: pos.side,
      regime: pos.regime,
      entryTime: pos.entryTime,
      exitTime: time,
      entry: pos.entry,
      initialStop: pos.initialStop,
      riskUsd: pos.riskUsd,
      pnlUsd: pos.realized,
      r: pos.riskUsd > 0 ? pos.realized / pos.riskUsd : 0,
      exitReason: reason,
      breakEvenApplied: pos.beApplied,
      partialApplied: pos.partial,
    });
    pos = null;
  };
  const exitAll = (price, reason, time) => {
    if (pos.remaining > EPS) closeVolume(pos.remaining, price, reason, time);
    finish(reason, time);
  };

  const open = ({ strategy, side, entry, stop, tp, regime, time, signalTime }) => {
    const riskUsd = Math.abs(entry - stop) * cfg.volume * lotUsd + commission(cfg.volume);
    pos = {
      strategy, side, entry, stop, initialStop: stop, tp, regime, entryTime: time, signalTime,
      remaining: cfg.volume, realized: 0, riskUsd, legs: [],
      beApplied: false, partial: false, partialAt: null,
      peak: null, handedOff: false, anchor: 0, cycleStart: null, lastStruct: 0, latestPivot: null,
      lastM15Checked: -1,
    };
  };

  const fixedTp = (side, entry) => (cfg.fixedTpPrice ? entry + sideSign(side) * cfg.fixedTpPrice : null);

  for (let j = 0; j < m5.length; j += 1) {
    const bar = m5[j];
    const inWindow = bar.openTime >= from && bar.openTime < to;
    const spread = spreadPrice(bar, cfg);
    const bidHigh = bar.high;
    const bidLow = bar.low;
    const askHigh = bar.high + spread;
    const askLow = bar.low + spread;

    // ---------- management of an open position ----------
    if (pos) {
      const s = pos.side;
      // 1) STOP_FIRST: stop live at bar open.
      const stopHit = s === "BUY" ? bidLow <= pos.stop + EPS : askHigh >= pos.stop - EPS;
      if (stopHit) {
        // gap through the stop fills at the open
        const gapOpen = s === "BUY" ? bar.open < pos.stop : bar.open + spread > pos.stop;
        const base = gapOpen ? (s === "BUY" ? bar.open : bar.open + spread) : pos.stop;
        exitAll(base - sideSign(s) * cfg.slippagePrice, pos.beApplied ? "STOP_AFTER_BE" : "STOP_LOSS", bar.closeTime);
      } else if (pos.tp !== null && (s === "BUY" ? bidHigh >= pos.tp - EPS : askLow <= pos.tp + EPS)) {
        exitAll(pos.tp, "TAKE_PROFIT", bar.closeTime);
      } else {
        const best = s === "BUY" ? bidHigh : askLow; // best exit-side price this bar
        const favorable = sideSign(s) * (best - pos.entry);

        // 2) break-even (snapshot rule)
        if (!pos.beApplied && favorable + EPS >= cfg.breakEvenTriggerPrice) {
          const beStop = pos.entry + sideSign(s) * cfg.breakEvenOffsetPrice;
          if (strictlyTighter(s, pos.stop, beStop)) pos.stop = beStop;
          pos.beApplied = true;
        }

        // 3) FastMove reactivation after an M5 handoff, then FastMove profit lock
        if (pos.handedOff && pos.anchor > 0 && sideSign(s) * (best - pos.anchor) + EPS >= cfg.fastMoveActivationPrice) {
          pos.handedOff = false;
          pos.cycleStart = bar.closeTime;
          pos.peak = best;
          pos.latestPivot = null;
        }
        if (!pos.handedOff && atLeastAsTight(s, pos.stop, pos.entry)) {
          const ref = pos.anchor > 0 ? pos.anchor : pos.entry;
          pos.peak = pos.peak === null ? best : (s === "BUY" ? Math.max(pos.peak, best) : Math.min(pos.peak, best));
          if (s === "BUY" ? pos.peak < ref : pos.peak > ref) pos.peak = ref;
          if (sideSign(s) * (pos.peak - ref) + EPS >= cfg.fastMoveActivationPrice) {
            const candidate = pos.peak - sideSign(s) * cfg.fastMoveGivebackPrice;
            if (strictlyTighter(s, pos.stop, candidate)) pos.stop = candidate;
          }
        }

        // 4) TREND partial 1/3 at +10 (SIDEWAY is brokerTpSlTrailOnly: no partial)
        if (pos.strategy === "TREND" && !pos.partial && favorable + EPS >= cfg.partialTriggerPrice) {
          const vol = Math.floor((cfg.volume / 3) * 100 + EPS) / 100;
          if (vol > 0) {
            const price = pos.entry + sideSign(s) * cfg.partialTriggerPrice - sideSign(s) * cfg.slippagePrice;
            closeVolume(vol, price, "PARTIAL_PLUS_10", bar.closeTime);
            pos.partial = true;
            pos.partialAt = bar.closeTime;
          }
        }

        // 5) bar-close actions: M5 structural trail
        const trailActive = pos.strategy === "SIDEWAY" || pos.partial;
        if (j >= 2 && trailActive) {
          const after = pos.cycleStart ?? pos.partialAt ?? pos.signalTime;
          const left = m5[j - 2];
          const mid = m5[j - 1];
          const right = bar;
          if (right.closeTime > after) {
            if (s === "BUY" && mid.low < left.low && mid.low <= right.low) pos.latestPivot = mid.low;
            if (s === "SELL" && mid.high > left.high && mid.high >= right.high) pos.latestPivot = mid.high;
          }
          if (pos.latestPivot !== null) {
            const candidate = pos.latestPivot - sideSign(s) * cfg.structuralBufferPrice;
            const baseline = pos.lastStruct ? tighter(s, pos.stop, pos.lastStruct) : pos.stop;
            const market = s === "BUY" ? bar.close : bar.close + spread;
            const validVsMarket = s === "BUY" ? candidate < market - EPS : candidate > market + EPS;
            if (strictlyTighter(s, baseline, candidate) && validVsMarket) {
              pos.stop = candidate;
              pos.lastStruct = candidate;
              if (!pos.handedOff) {
                pos.handedOff = true;
                pos.anchor = market;
                pos.peak = market;
              }
            }
          }
        }

        // 6) M15-close exits (TREND only)
        const k = map[j];
        if (pos && pos.strategy === "TREND" && k >= 0 && m15[k].closeTime === bar.closeTime && k > pos.lastM15Checked &&
          m15[k].closeTime > pos.signalTime) {
          pos.lastM15Checked = k;
          const exitPrice = (s === "BUY" ? bar.close : bar.close + spread) - sideSign(s) * cfg.slippagePrice;
          if (pos.partial && m15[k].closeTime >= pos.partialAt &&
            opposingFvgRejectionAtIndex(s, m15, k, 48, pos.signalTime)) {
            exitAll(exitPrice, "REVERSAL_FVG_REJECTION", bar.closeTime);
          } else if (pos.partial && pre.ma50[k] !== null &&
            (s === "BUY" ? m15[k].close < pre.ma50[k] : m15[k].close > pre.ma50[k])) {
            exitAll(exitPrice, "RUNNER_TREND_MA50", bar.closeTime);
          }
        }
      }
      if (pos) continue; // still managing: no new entry on this bar
      continue; // closed this bar: re-entry is evaluated from the next bar
    }

    if (!inWindow || j + 1 >= m5.length) {
      pending = null;
      continue;
    }
    const next = m5[j + 1];
    const nextSpread = spreadPrice(next, cfg);
    const k = map[j];
    const regime = k >= 0 ? pre.regimes[k] : null;

    // ---------- TREND pending pullback (SL wider than cap at signal) ----------
    if (pending) {
      const p = pending;
      const brokenStructure = p.side === "BUY" ? bidLow <= p.structuralStop + EPS : askHigh >= p.structuralStop - EPS;
      const stM15 = pre.m15St[k];
      const stM5 = pre.m5St[j];
      if (brokenStructure || (cfg.requireSupertrendM15 && stM15 !== p.side) || (cfg.requireSupertrendM5 && stM5 !== p.side) || bar.closeTime > p.expiresAt) {
        pending = null;
      } else {
        // fill when the market reaches the price at which the stop distance equals the cap
        const level = p.structuralStop + sideSign(p.side) * cfg.maxInitialStopPrice;
        const reached = p.side === "BUY" ? askLow <= level + EPS : bidHigh >= level - EPS;
        if (reached) {
          const entry = level + sideSign(p.side) * cfg.slippagePrice;
          const dist = Math.max(cfg.minInitialStopPrice, sideSign(p.side) * (entry - p.structuralStop));
          const stop = entry - sideSign(p.side) * dist;
          open({ strategy: "TREND", side: p.side, entry, stop, tp: fixedTp(p.side, entry), regime: p.regime, time: bar.closeTime, signalTime: p.signalTime });
          pending = null;
          continue;
        }
      }
    }

    // ---------- TREND signal at an M15 close ----------
    if (cfg.strategies.includes("TREND") && k >= 0 && m15[k].closeTime === bar.closeTime &&
      (cfg.requireTrendMode
        ? (regime?.recommendedMode === "TREND" && cfg.trendRegimes.includes(regime.regime))
        : (regime !== null && regime.recommendedMode !== "PAUSE")) && // AUTO still PAUSEs on REVERSAL / UNCERTAIN
      (cfg.maxEntrySpreadPrice === null || nextSpread <= cfg.maxEntrySpreadPrice + EPS)) {
      const sig = pre.trendSignals[k];
      if (sig && (!cfg.requireSupertrendM15 || pre.m15St[k] === sig.side) && (!cfg.requireSupertrendM5 || pre.m5St[j] === sig.side)) {
        const structuralStop = sig.patternExtreme - sideSign(sig.side) * cfg.structuralBufferPrice;
        const entry = (sig.side === "BUY" ? next.open + nextSpread : next.open) + sideSign(sig.side) * cfg.slippagePrice;
        const dist = sideSign(sig.side) * (entry - structuralStop);
        if (dist > 0 && dist <= cfg.maxInitialStopPrice + EPS) {
          const stop = entry - sideSign(sig.side) * Math.max(cfg.minInitialStopPrice, dist);
          open({ strategy: "TREND", side: sig.side, entry, stop, tp: fixedTp(sig.side, entry), regime: regime?.regime ?? null, time: next.openTime, signalTime: bar.closeTime });
          pending = null;
          continue;
        }
        if (dist > cfg.maxInitialStopPrice) {
          pending = {
            side: sig.side, structuralStop, signalTime: bar.closeTime, regime: regime?.regime ?? null,
            expiresAt: bar.closeTime + cfg.pullbackWaitMinutes * 60_000,
          };
          continue;
        }
      }
    }

    // ---------- SIDEWAY at every M5 close ----------
    if (cfg.strategies.includes("SIDEWAY") && regime && regime.regime === "RANGING" && regime.recommendedMode === "SIDEWAY" &&
      Number(regime.confidence) >= cfg.sidewayMinConfidence && regime.range &&
      (cfg.maxEntrySpreadPrice === null || nextSpread <= cfg.maxEntrySpreadPrice + EPS)) {
      const bid = bar.close;
      const ask = bar.close + spread;
      const side = chooseRangeSide(regime.range, bid, ask);
      if (side) {
        const window = m5.slice(Math.max(0, j - 3), j + 1);
        const confirmation = detectM5ConfirmationWithinBars(window, side, cfg.sidewayCarryBars);
        if (confirmation) {
          const plan = buildSidewayPlanWithCap({
            side, bid: next.open, ask: next.open + nextSpread, range: regime.range, atr: regime.atr,
            point: cfg.point, cap: cfg.maxInitialStopPrice, minStop: cfg.minInitialStopPrice,
          });
          if (plan.accepted) {
            const entry = plan.entry + sideSign(side) * cfg.slippagePrice;
            const stop = entry - sideSign(side) * plan.stopDistance;
            let tp = plan.takeProfit;
            const ftp = fixedTp(side, entry);
            if (ftp !== null) tp = side === "BUY" ? Math.min(tp, ftp) : Math.max(tp, ftp);
            open({ strategy: "SIDEWAY", side, entry, stop, tp, regime: regime.regime, time: next.openTime, signalTime: bar.closeTime });
          }
        }
      }
    }
  }
  if (pos) {
    const last = m5.at(-1);
    exitAll(pos.side === "BUY" ? last.close : last.close + spreadPrice(last, cfg), "END_OF_DATA", last.closeTime);
  }
  return trades;
}

// buildSidewayPlan with the canonical 10 cap; when the sweep raises the cap we re-evaluate the
// structural distance against the new cap using the same buffer formula (production logic unchanged).
function buildSidewayPlanWithCap({ side, bid, ask, range, atr, point, cap, minStop }) {
  const plan = buildSidewayPlan({ side, bid, ask, range, atr, point, stopsLevelTicks: 0, digits: 2 });
  if (plan.accepted || cap <= 10 + EPS || plan.reason !== "WAIT_PULLBACK_STOP_GT_10") return plan;
  const dist = Number(plan.structuralStopDistance);
  if (!(dist > 0) || dist > cap + EPS) return plan;
  const entry = side === "BUY" ? ask : bid;
  const stopDistance = Math.max(minStop, dist);
  const finalTarget = side === "BUY" ? Number(range.supply.low) : Number(range.demand.high);
  const finalDistance = sideSign(side) * (finalTarget - entry);
  if (!(finalDistance > 10 + EPS)) return { accepted: false, reason: "FINAL_TARGET_BEFORE_PLUS_10" };
  if (finalDistance / stopDistance < 1.2) return { accepted: false, reason: "FINAL_RR_BELOW_1_2" };
  return { accepted: true, entry, stopDistance, takeProfit: finalTarget };
}

export function metrics(trades) {
  const n = trades.length;
  let grossWin = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let cumR = 0;
  let peakR = 0;
  let maxDdR = 0;
  let wins = 0;
  let sumR = 0;
  for (const t of trades) {
    if (t.pnlUsd > 0) { grossWin += t.pnlUsd; wins += 1; } else grossLoss += -t.pnlUsd;
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    cumR += t.r;
    sumR += t.r;
    peakR = Math.max(peakR, cumR);
    maxDdR = Math.max(maxDdR, peakR - cumR);
  }
  return {
    trades: n,
    netUsd: round(equity),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : (grossWin > 0 ? Infinity : 0),
    expectancyUsd: n ? round(equity / n, 3) : 0,
    avgR: n ? round(sumR / n, 3) : 0,
    winRate: n ? round(wins / n, 3) : 0,
    maxDrawdownUsd: round(maxDd),
    maxDrawdownR: round(maxDdR, 2),
  };
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
