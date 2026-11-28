// The MT5 decision panel uses the same industrial palette as the web (apps/web/src/ui/industrial-theme.ts),
// draws the same gold corner bracket on cards, and stays display-only (ORDER PERMISSION = NONE).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mq5 = readFileSync("mt5/XAUUSD_AI_Master_Decision_Panel.mq5", "utf8");
// Web industrial tokens (apps/web/src/ui/industrial-theme.ts, PR #249). If that file exists, it must agree.
const WEB_TOKENS = { bg: "#0a0d12", panel: "#11161e", panel2: "#161c26", line2: "#2e3846", text: "#e6ebf2", muted: "#8592a3", gold: "#e9b949", ok: "#3ccf7a", warn: "#f5a623", bad: "#f2645a", info: "#4aa3ff" };
let web = null;
try { web = readFileSync("apps/web/src/ui/industrial-theme.ts", "utf8"); } catch { web = null; }
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { failed += 1; console.error(`FAIL ${name}: ${e.message}`); } };

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
const PAIRS = { UI_BG: "bg", UI_PANEL: "panel", UI_PANEL2: "panel2", UI_LINE: "line2", UI_TEXT: "text", UI_MUTED: "muted", UI_GOLD: "gold", UI_OK: "ok", UI_WARN: "warn", UI_BAD: "bad", UI_INFO: "info" };

check("PALETTE_MATCHES_WEB_TOKENS", () => {
  for (const [macro, token] of Object.entries(PAIRS)) {
    const webHex = WEB_TOKENS[token];
    if (web) assert.equal(web.match(new RegExp(`\\b${token}: "(#[0-9a-fA-F]{6})"`))?.[1], webHex, `web token ${token} drifted`);
    const def = mq5.match(new RegExp(`#define ${macro}\\s+C'([0-9]+,[0-9]+,[0-9]+)'`))?.[1];
    assert.equal(def, hexToRgb(webHex), `${macro} must equal web ${token} ${webHex}`);
  }
});

check("NO_LEGACY_CYAN_THEME", () => {
  for (const legacy of ["C'0,210,255'", "C'0,160,200'", "C'0,72,102'", "clrDeepSkyBlue", "clrAqua", "clrSilver"]) {
    assert.ok(!mq5.includes(legacy), `${legacy} must be replaced by the shared palette`);
  }
});

check("CARD_HAS_GOLD_CORNER_BRACKET", () => {
  const card = mq5.slice(mq5.indexOf("void Card("), mq5.indexOf("void VerticalDivider("));
  assert.match(card, /UI_GOLD/);
});

check("DISPLAY_ONLY_MARKER_KEPT", () => {
  assert.match(mq5, /ORDER PERMISSION = NONE/);
  for (const bad of ["OrderSend", "PositionClose", "CTrade", "OrderModify", "TRADE_ACTION_"]) {
    assert.ok(!mq5.includes(bad), `${bad} must not appear in the panel`);
  }
});

if (failed) { console.error(`PHASE7C_MT5_PANEL_INDUSTRIAL=FAIL (${failed})`); process.exit(1); }
console.log("PHASE7C_MT5_PANEL_INDUSTRIAL=PASS");
