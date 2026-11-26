import { test } from "node:test";
import assert from "node:assert/strict";
import { toProductionFamily, agreementMatrix, isRegimeLibraryEnabled } from "../src/index.mjs";

test("flag: regime library is OFF unless explicitly enabled", () => {
  assert.equal(isRegimeLibraryEnabled({}), false);
  assert.equal(isRegimeLibraryEnabled({ ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: "" }), false);
  assert.equal(isRegimeLibraryEnabled({ ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: "yes" }), false);
  assert.equal(isRegimeLibraryEnabled({ ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: "false" }), false);
  assert.equal(isRegimeLibraryEnabled({ ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: "true" }), true);
  assert.equal(isRegimeLibraryEnabled({ ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED: " TRUE " }), true);
});

test("production regimes map onto library families", () => {
  assert.equal(toProductionFamily("TRENDING"), "TREND");
  assert.equal(toProductionFamily("BREAKOUT"), "TREND");
  assert.equal(toProductionFamily("RANGING"), "SIDEWAY");
  assert.equal(toProductionFamily("REVERSAL"), "PAUSE");
  assert.equal(toProductionFamily("UNCERTAIN"), "PAUSE");
});

test("agreementMatrix counts pairs and the agreement rate", () => {
  const m = agreementMatrix([
    { library: "UPTREND", production: "TRENDING" },
    { library: "DOWNTREND", production: "BREAKOUT" },
    { library: "SIDEWAY", production: "TRENDING" },
    { library: "TRANSITION", production: "UNCERTAIN" },
  ]);
  assert.equal(m.total, 4);
  assert.equal(m.agree, 3);
  assert.equal(m.agreementRate, 0.75);
  assert.equal(m.cells.UPTREND.TRENDING, 1);
});
