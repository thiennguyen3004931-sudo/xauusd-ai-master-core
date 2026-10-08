import fs from "node:fs";
import {
  chooseRangeSide,
  detectM5Confirmation,
  detectM5ConfirmationWithinBars,
} from "./phase7c-sideway-logic.mjs";

const [regimePath, quotePath, candlesPath] = process.argv.slice(2);
if (!regimePath || !quotePath || !candlesPath) {
  throw new Error("Usage: node diagnose-phase7c-sideway-live-shadow-onebar.mjs <regime.json> <quote.json> <candles.json>");
}

const regime = JSON.parse(fs.readFileSync(regimePath, "utf8"));
const quote = JSON.parse(fs.readFileSync(quotePath, "utf8"));
const candles = JSON.parse(fs.readFileSync(candlesPath, "utf8"));

const rows = Array.isArray(candles) ? candles : [];
const latest = rows.at(-1) ?? null;
const latestClose = Number(latest?.closeTime);

const side = regime?.supplyDemandRange
  ? chooseRangeSide(regime.supplyDemandRange, Number(quote?.bid), Number(quote?.ask))
  : null;

const current = side ? detectM5Confirmation(rows, side) : null;
const oneBar = side ? detectM5ConfirmationWithinBars(rows, side, 1) : null;

console.log(`SIDEWAY_SHADOW_REGIME=${String(regime?.regime ?? "UNKNOWN")}`);
console.log(`SIDEWAY_SHADOW_RECOMMENDED_MODE=${String(regime?.recommendedMode ?? "UNKNOWN")}`);
console.log(`SIDEWAY_SHADOW_CONFIDENCE=${String(regime?.confidence ?? "NA")}`);
console.log(`SIDEWAY_SHADOW_HAS_RANGE=${Boolean(regime?.supplyDemandRange)}`);
console.log(`SIDEWAY_SHADOW_BID=${String(quote?.bid ?? "NA")}`);
console.log(`SIDEWAY_SHADOW_ASK=${String(quote?.ask ?? "NA")}`);
console.log(`SIDEWAY_SHADOW_RANGE_SIDE=${side ?? "NONE"}`);
console.log(`SIDEWAY_SHADOW_LATEST_M5_CLOSE=${Number.isFinite(latestClose) ? latestClose : "NA"}`);
console.log(`SIDEWAY_SHADOW_CURRENT_CONFIRMATION=${current?.pattern ?? "NONE"}`);
console.log(`SIDEWAY_SHADOW_CURRENT_CONFIRMATION_CLOSE=${current?.closeTime ?? "NA"}`);
console.log(`SIDEWAY_SHADOW_ONEBAR_CONFIRMATION=${oneBar?.pattern ?? "NONE"}`);
console.log(`SIDEWAY_SHADOW_ONEBAR_CONFIRMATION_CLOSE=${oneBar?.closeTime ?? "NA"}`);
console.log(`SIDEWAY_SHADOW_ONEBAR_CONFIRMATION_AGE_BARS=${oneBar?.ageBars ?? "NA"}`);
console.log(`SIDEWAY_SHADOW_ONEBAR_USED=${Boolean(oneBar && Number(oneBar.ageBars) === 1)}`);
console.log(`SIDEWAY_SHADOW_M5_PASS=${Boolean(oneBar)}`);
console.log("SIDEWAY_SHADOW_READ_ONLY=TRUE");
console.log("SIDEWAY_SHADOW_ORDER_MUTATION=NONE");
console.log("SIDEWAY_SHADOW_POSITION_MUTATION=NONE");
console.log("SIDEWAY_SHADOW_LIVE_TEST_ORDER=NONE");
