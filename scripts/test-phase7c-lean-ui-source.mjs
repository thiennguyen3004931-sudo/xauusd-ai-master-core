// Lean Control Center UI (approved proposal) — source contract. No MT5, no orders, no API changes.
// Main screen = status bar + execution/control/decision block + collapsed source attestation.
// Analysis (Intelligence) moves to "Hiệu quả"; legacy pages leave the main menu but stay routable.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const SHELL = "apps/web/src/pages/Phase7CControlCenterShellPage.tsx";
const SECTION = "apps/web/src/ui/Phase7CIntelligenceSection.tsx";
const PERFORMANCE = "apps/web/src/pages/PerformancePage.tsx";
const TECHNICAL = "apps/web/src/pages/Phase7CTechnicalPage.tsx";
const LAYOUT = "apps/web/src/ui/DashboardLayout.tsx";
const ROUTER = "apps/web/src/router.tsx";
const PAGES = "apps/web/src/routing-pages.tsx";

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`${name}=PASS`); } catch (error) { results.push(`${name}=FAIL`); console.log(results.join("\n")); throw error; }
};

check("FILES_PRESENT", () => {
  for (const rel of [SHELL, SECTION, PERFORMANCE, TECHNICAL, LAYOUT, ROUTER, PAGES]) assert.ok(exists(rel), `${rel} missing`);
});

const shell = read(SHELL);
const section = read(SECTION);
const performance = read(PERFORMANCE);
const technical = read(TECHNICAL);
const layout = read(LAYOUT);
const router = read(ROUTER);

check("MAIN_SCREEN_THREE_BLOCKS", () => {
  const order = [
    "<Phase7COperatorStatusBar />",
    "<Phase7CExecutionAuthorizationCard />",
    "<Phase7CControlCenterCompactSection",
    "<Phase7CRuntimeSourceAttestationCard />",
  ].map((token) => shell.indexOf(token));
  assert.ok(order.every((index) => index >= 0), "a main-screen block is missing");
  assert.ok(order.every((index, i) => i === 0 || index > order[i - 1]), "main-screen blocks out of order");
});

check("INTELLIGENCE_MOVED_OFF_MAIN_SCREEN", () => {
  for (const token of [
    "Phase7CIntelligenceSummaryCard",
    "Phase7CPerformanceIntelligenceCard",
    "Phase7CPerformanceEffectivenessCard",
    "Phase7CCounterfactualIntelligenceCard",
    "Phase7CRecommendationIntelligenceCard",
    "Phase7CIntelligenceSection",
  ]) assert.ok(!shell.includes(token), `${token} must not be on the main screen`);
});

check("INTELLIGENCE_ON_PERFORMANCE_PAGE", () => {
  assert.match(performance, /import \{ Phase7CIntelligenceSection \} from "\.\.\/ui\/Phase7CIntelligenceSection";/);
  assert.match(performance, /<Phase7CIntelligenceSection \/>/);
  assert.match(section, /const \[showIntelligenceDetails, setShowIntelligenceDetails\] = useState\(false\);/);
  const order = [
    "<Phase7CIntelligenceSummaryCard",
    "<Phase7CPerformanceIntelligenceCard />",
    "<Phase7CPerformanceEffectivenessCard />",
    "<Phase7CCounterfactualIntelligenceCard />",
    "<Phase7CRecommendationIntelligenceCard />",
  ].map((token) => section.indexOf(token));
  assert.ok(order.every((index) => index >= 0), "an intelligence card is missing");
  assert.ok(order.every((index, i) => i === 0 || index > order[i - 1]), "intelligence cards out of order");
});

check("MENU_FOUR_ITEMS_ONLY", () => {
  const block = layout.slice(layout.indexOf("const links"), layout.indexOf("] as const;"));
  const hrefs = [...block.matchAll(/\["(\/[^"]*)",/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/phase7c-control-center", "/phase7b-ops", "/performance", "/technical"]);
  assert.match(block, /"Vận hành"/);
  assert.match(block, /"Tài khoản & LIVE"/);
  assert.match(block, /"Hiệu quả"/);
  assert.match(block, /"Kỹ thuật"/);
});

check("LEGACY_PAGES_KEPT_AND_LINKED_FROM_TECHNICAL", () => {
  for (const href of ["/phase7b-dashboard", "/phase7b-pattern-check", "/phase7c-mobile"]) {
    assert.ok(technical.includes(`"${href}"`), `technical page must link ${href}`);
  }
  assert.match(router, /path: "phase7b-dashboard", element: <Phase7BDemoPage \/>/);
  assert.match(router, /path: "phase7b-pattern-check"/);
  assert.match(router, /path: "phase7c-mobile"/);
  assert.match(router, /path: "technical"/);
  assert.match(router, /\{ index: true, element: <Navigate to="\/phase7c-control-center" replace \/> \}/);
});

check("DISPLAY_ONLY_NO_NEW_MUTATIONS", () => {
  for (const source of [section, technical]) {
    for (const forbidden of ["useMutation", "setPhase7CBotMode", "runPhase7CLifecycleAction", "fetch(", 'method: "POST"', "ARM_LIVE"]) {
      assert.ok(!source.includes(forbidden), `${forbidden} must not appear in new display-only files`);
    }
  }
});

check("SAFETY_COPY_KEPT", () => {
  assert.match(layout, /Web không có quyền đặt lệnh\./);
  assert.match(layout, /LIVE ARM vẫn là thao tác riêng/);
  assert.match(layout, /Vận hành \{runtime\}/);
});

console.log(results.join("\n"));
console.log("PHASE7C_LEAN_UI_SOURCE=PASS");
