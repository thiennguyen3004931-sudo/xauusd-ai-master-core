// Regime template library (feature 3). Each template is a weighted list of quantitative criteria
// evaluated on one timeframe's features. Thresholds are a first version: they are documented in
// docs/market-intel/regime-library.md and may only change through a reviewed PR that bumps the version.

export const REGIME_LIBRARY_VERSION = "regime-library-v1";

/** Thresholds shared by the templates. ADX levels follow defaultStrategyEngineConfig (trend 22). */
export const THRESHOLDS = Object.freeze({
  emaFast: 50,
  emaSlow: 200,
  slopeLookback: 10,
  trendSlopeAtr: 0.5, // EMA50 moved >= 0.5 ATR over 10 bars
  flatSlopeAtr: 0.5, // complement of the trend slope: "no clear slope"
  trendAdx: 22,
  rangeAdx: 20,
  nearEmaAtr: 1.0,
  rangeLookback: 40,
  maxRangeWidthAtr: 8, // ~70th percentile of 40-bar H1 width on 2025-11..2026-11 XAUUSD
  edgeZone: 0.2, // top / bottom 20% of the range
  minEdgeVisits: 2,
  swingBars: 3,
  equalSwingAtr: 0.1, // swings within 0.1 ATR count as equal (EH / EL)
  minScore: 0.7,
  minMargin: 0.15,
});

const T = THRESHOLDS;

export const REGIME_TEMPLATES = Object.freeze([
  {
    id: "UPTREND",
    label: "Uptrend",
    criteria: [
      { id: "close_above_ema50", weight: 1, description: "Giá đóng cửa trên EMA50", value: (f) => f.distEma50Atr, test: (f) => f.distEma50Atr > 0 },
      { id: "ema50_above_ema200", weight: 1, description: "EMA50 nằm trên EMA200", value: (f) => f.ema50 - f.ema200, test: (f) => f.ema50 > f.ema200 },
      { id: "ema50_slope_up", weight: 1, description: `EMA50 dốc lên >= ${T.trendSlopeAtr} ATR trong ${T.slopeLookback} nến`, value: (f) => f.slopeAtr, test: (f) => f.slopeAtr >= T.trendSlopeAtr },
      { id: "adx_trend_up", weight: 1, description: `ADX(14) >= ${T.trendAdx} và +DI > -DI`, value: (f) => f.adx, test: (f) => f.adx >= T.trendAdx && f.plusDi > f.minusDi },
      { id: "structure_hh_hl", weight: 1.5, description: "Hai swing gần nhất: đỉnh cao hơn (HH) và đáy cao hơn (HL)", value: (f) => f.pattern, test: (f) => f.pattern === "HH_HL" },
      { id: "last_event_up", weight: 1, description: "Sự kiện cấu trúc gần nhất là phá lên (BOS/CHoCH tăng)", value: (f) => f.lastEvent, test: (f) => f.lastEventDirection === "UP" },
    ],
  },
  {
    id: "DOWNTREND",
    label: "Downtrend",
    criteria: [
      { id: "close_below_ema50", weight: 1, description: "Giá đóng cửa dưới EMA50", value: (f) => f.distEma50Atr, test: (f) => f.distEma50Atr < 0 },
      { id: "ema50_below_ema200", weight: 1, description: "EMA50 nằm dưới EMA200", value: (f) => f.ema50 - f.ema200, test: (f) => f.ema50 < f.ema200 },
      { id: "ema50_slope_down", weight: 1, description: `EMA50 dốc xuống >= ${T.trendSlopeAtr} ATR trong ${T.slopeLookback} nến`, value: (f) => f.slopeAtr, test: (f) => f.slopeAtr <= -T.trendSlopeAtr },
      { id: "adx_trend_down", weight: 1, description: `ADX(14) >= ${T.trendAdx} và -DI > +DI`, value: (f) => f.adx, test: (f) => f.adx >= T.trendAdx && f.minusDi > f.plusDi },
      { id: "structure_lh_ll", weight: 1.5, description: "Hai swing gần nhất: đỉnh thấp hơn (LH) và đáy thấp hơn (LL)", value: (f) => f.pattern, test: (f) => f.pattern === "LH_LL" },
      { id: "last_event_down", weight: 1, description: "Sự kiện cấu trúc gần nhất là phá xuống (BOS/CHoCH giảm)", value: (f) => f.lastEvent, test: (f) => f.lastEventDirection === "DOWN" },
    ],
  },
  {
    id: "SIDEWAY",
    label: "Sideway",
    criteria: [
      { id: "near_ema50", weight: 1, description: `Giá cách EMA50 không quá ${T.nearEmaAtr} ATR`, value: (f) => f.distEma50Atr, test: (f) => Math.abs(f.distEma50Atr) <= T.nearEmaAtr },
      { id: "flat_ema50", weight: 1, description: `EMA50 gần như phẳng (|độ dốc| < ${T.flatSlopeAtr} ATR / ${T.slopeLookback} nến)`, value: (f) => f.slopeAtr, test: (f) => Math.abs(f.slopeAtr) < T.flatSlopeAtr },
      { id: "adx_weak", weight: 1, description: `ADX(14) < ${T.rangeAdx}`, value: (f) => f.adx, test: (f) => f.adx < T.rangeAdx },
      { id: "compact_range", weight: 1, description: `Biên ${T.rangeLookback} nến gần nhất hẹp hơn ${T.maxRangeWidthAtr} ATR`, value: (f) => f.rangeWidthAtr, test: (f) => f.rangeWidthAtr <= T.maxRangeWidthAtr },
      { id: "structure_mixed", weight: 1.5, description: "Đỉnh/đáy không cùng chiều (không HH+HL, không LH+LL)", value: (f) => f.pattern, test: (f) => f.pattern === "MIXED" },
      { id: "two_sided_touches", weight: 1, description: `Giá chạm cả vùng trên và vùng dưới của biên ít nhất ${T.minEdgeVisits} lần`, value: (f) => `${f.upperVisits}/${f.lowerVisits}`, test: (f) => f.upperVisits >= T.minEdgeVisits && f.lowerVisits >= T.minEdgeVisits },
    ],
  },
]);
