// Shadow comparison with the production regime classifier (MarketRegimeClassifier on M15).
// The library never replaces it; this only measures agreement for review.

export const REGIME_LIBRARY_FLAG = "ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED";

/** Default OFF: only the literal "true" (any case, trimmed) enables the shadow classifier. */
export function isRegimeLibraryEnabled(env = process.env) {
  return String(env?.[REGIME_LIBRARY_FLAG] ?? "").trim().toLowerCase() === "true";
}

/** Production regime -> the bot mode family it routes to. */
export function toProductionFamily(regime) {
  if (regime === "TRENDING" || regime === "BREAKOUT") return "TREND";
  if (regime === "RANGING") return "SIDEWAY";
  return "PAUSE";
}

const libraryFamily = (state) =>
  state === "UPTREND" || state === "DOWNTREND" ? "TREND" : state === "SIDEWAY" ? "SIDEWAY" : "PAUSE";

/** rows: [{ library: UPTREND|DOWNTREND|SIDEWAY|TRANSITION, production: TRENDING|BREAKOUT|RANGING|REVERSAL|UNCERTAIN }] */
export function agreementMatrix(rows) {
  const cells = {};
  let agree = 0;
  for (const { library, production } of rows) {
    cells[library] ??= {};
    cells[library][production] = (cells[library][production] ?? 0) + 1;
    if (libraryFamily(library) === toProductionFamily(production)) agree += 1;
  }
  return { total: rows.length, agree, agreementRate: rows.length ? Math.round((agree / rows.length) * 1e4) / 1e4 : null, cells };
}
