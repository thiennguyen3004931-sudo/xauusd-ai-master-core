// Source contract for the industrial control-room UI (display layer only).
// Checks: one shared token module drives the theme, the status strip is mounted in the shell,
// its only mutation is PAUSE (behind a confirmation), motion respects prefers-reduced-motion,
// and the phone gets a bottom tab bar. No order path is added.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

const TOKENS = "apps/web/src/ui/industrial-theme.ts";
const STRIP = "apps/web/src/ui/Phase7CStatusStrip.tsx";
const LAYOUT = "apps/web/src/ui/DashboardLayout.tsx";
const MAIN = "apps/web/src/main.tsx";
const CSS = "apps/web/src/styles.css";

check("TOKENS_MODULE_EXISTS", () => {
  assert.ok(existsSync(TOKENS), `${TOKENS} missing`);
  const tokens = read(TOKENS);
  for (const key of ["bg", "panel", "line", "gold", "ok", "warn", "bad", "info", "mono"]) {
    assert.match(tokens, new RegExp(`\\b${key}:`), `token ${key} missing`);
  }
  assert.match(tokens, /export const industrialTheme = createTheme\(/);
});

check("MAIN_USES_SHARED_THEME", () => {
  const main = read(MAIN);
  assert.match(main, /import \{ industrialTheme \} from "\.\/ui\/industrial-theme";/);
  assert.match(main, /<ThemeProvider theme=\{industrialTheme\}>/);
  assert.ok(!/primary: \{ main: "#/.test(main), "palette must live in the token module, not main.tsx");
});

check("STATUS_STRIP_MOUNTED_IN_SHELL", () => {
  assert.ok(existsSync(STRIP), `${STRIP} missing`);
  const layout = read(LAYOUT);
  assert.match(layout, /import \{ Phase7CStatusStrip \} from "\.\/Phase7CStatusStrip";/);
  assert.match(layout, /<Phase7CStatusStrip \/>/);
});

check("STATUS_STRIP_ONLY_MUTATION_IS_CONFIRMED_PAUSE", () => {
  const strip = read(STRIP);
  const modeCalls = [...strip.matchAll(/setPhase7CBotMode\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(modeCalls, ['"PAUSE"'], "status strip may only request PAUSE");
  for (const forbidden of ["runPhase7CLifecycleAction", "ARM_LIVE", "setPhase7CLotSettings", "order_send", "closePosition", "/orders"]) {
    assert.ok(!strip.includes(forbidden), `${forbidden} must not appear in the status strip`);
  }
  assert.match(strip, /<Dialog/, "PAUSE must sit behind a confirmation dialog");
  assert.match(strip, /Chỉ chặn lệnh mới/, "dialog must say PAUSE does not close positions");
});

check("STATUS_STRIP_SHOWS_SAFETY_STATE", () => {
  const strip = read(STRIP);
  for (const text of ["MT5", "Spread", "Lãi/lỗ ngày", "Lệnh mở", "DỪNG KHẨN"]) {
    assert.ok(strip.includes(text), `status strip must show ${text}`);
  }
  assert.match(strip, /getPhase7CDailyPnlStop/);
});

check("MOTION_RESPECTS_REDUCED_MOTION", () => {
  const css = read(CSS);
  for (const kf of ["led-pulse", "tick-up", "tick-down"]) assert.match(css, new RegExp(`@keyframes ${kf}`));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

check("PHONE_BOTTOM_TAB_BAR", () => {
  const layout = read(LAYOUT);
  assert.match(layout, /BottomNavigation/);
  assert.match(layout, /display: \{ xs: "flex", lg: "none" \}/);
});

check("SHELL_KEEPS_EXISTING_BOUNDARIES", () => {
  const layout = read(LAYOUT);
  assert.match(layout, /Web không có quyền đặt lệnh\./);
  assert.match(layout, /LIVE ARM vẫn là thao tác riêng/);
  assert.match(layout, /Vận hành \{runtime\}/);
});

if (failed > 0) { console.error(`PHASE7C_INDUSTRIAL_UI_SOURCE=FAIL (${failed})`); process.exit(1); }
console.log("PHASE7C_INDUSTRIAL_UI_SOURCE=PASS");
