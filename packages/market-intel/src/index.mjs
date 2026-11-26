// @xauusd/market-intel — read-only market intelligence. Advisory only:
// nothing here sends, modifies or closes orders, or changes runtime / BOT_MODE.
export { ema, atr, adx } from "./indicators.mjs";
export { resample, lastClosedIndex, M15_MS, H1_MS, H4_MS } from "./candles.mjs";
export { detectSwings, detectStructureEvents, structureAt } from "./structure.mjs";
export { REGIME_LIBRARY_VERSION, REGIME_TEMPLATES, THRESHOLDS } from "./templates.mjs";
export { analyzeTimeframe, featuresAt, classifyTimeframe, classifyMarket, combine, SAFETY } from "./classifier.mjs";
export { REGIME_LIBRARY_FLAG, isRegimeLibraryEnabled, toProductionFamily, agreementMatrix } from "./shadow.mjs";
export { renderRegimeChartSvg } from "./chart-svg.mjs";
export { keyLevels, orderBlocks } from "./zones.mjs";
export { m15Trigger } from "./triggers.mjs";
export { MTF_VERSION, MTF_FLAG, isMtfEnabled, BOT_STOP_RULE, CONFIDENCE_POINTS, buildScenarios, scenariosFromAnalyses } from "./scenario.mjs";
export { renderScenarioCharts } from "./scenario-chart.mjs";
