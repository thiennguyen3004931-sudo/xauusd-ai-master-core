// One-click start, no boot/logon auto-start — source contract (no Windows, no MT5, no orders).
// Guards scripts/set-phase7c-manual-start-only-local.ps1 and the launcher it relies on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const SCRIPT = "scripts/set-phase7c-manual-start-only-local.ps1";
const LAUNCHER = "scripts/open-phase7c-control-center-local.ps1";
const DOC = "docs/operations/phase7c-one-click-start.md";

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`${name}=PASS`); } catch (error) { results.push(`${name}=FAIL`); throw error; }
};

check("FILES_PRESENT", () => {
  for (const rel of [SCRIPT, LAUNCHER, DOC]) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} missing`);
});

const src = read(SCRIPT);
const code = src.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join("\n");

check("DRY_RUN_BY_DEFAULT", () => {
  assert.match(src, /\[switch\]\$Apply/);
  assert.match(src, /\[switch\]\$Restore/);
  assert.match(code, /if \(-not \$Apply -and -not \$Restore\)/);
  assert.match(code, /PHASE7C_MANUAL_START_MODE=DRY_RUN/);
});

check("REQUIRES_ADMIN", () => {
  assert.match(code, /WindowsBuiltInRole\]::Administrator/);
});

check("COVERS_BOT_TASKS", () => {
  for (const task of [
    "XAUUSD-Phase7B-Bridge",
    "XAUUSD-Phase7B-Web",
    "XAUUSD-Phase7C-Executors",
    "XAUUSD-Phase7C-Bridge",
    "XAUUSD-Phase7C-Forward-Dashboard",
    "XAUUSD-Phase7B-Bot",
    "XAUUSD-Phase7B-Core",
    "XAUUSD-Phase7B-Telegram",
  ]) assert.ok(src.includes(`"${task}"`), `${task} not covered`);
});

check("ONLY_BOOT_AND_LOGON_TRIGGERS_REMOVED", () => {
  assert.match(code, /MSFT_TaskBootTrigger/);
  assert.match(code, /MSFT_TaskLogonTrigger/);
  assert.match(code, /Set-ScheduledTask -InputObject/);
});

check("BACKUP_BEFORE_CHANGE", () => {
  const backup = code.indexOf("Export-ScheduledTask");
  const change = code.indexOf("Set-ScheduledTask -InputObject");
  assert.ok(backup > 0 && change > backup, "Export-ScheduledTask backup must precede Set-ScheduledTask");
  assert.match(code, /Register-ScheduledTask -Xml/); // restore path
});

check("RUNNING_TASK_FAIL_CLOSED", () => {
  assert.match(code, /State -eq "Running"/);
  assert.match(code, /PHASE7C_MANUAL_START_BLOCKED=TASK_RUNNING/);
});

check("NEVER_STOPS_DELETES_OR_DISABLES", () => {
  for (const forbidden of ["Stop-ScheduledTask", "Unregister-ScheduledTask", "Disable-ScheduledTask", "Stop-Process", "taskkill", "schtasks"]) {
    assert.ok(!code.includes(forbidden), `${forbidden} must not appear`);
  }
});

check("NO_TRADING_OR_MODE_SIDE_EFFECTS", () => {
  for (const forbidden of ["/v1/orders", "/v1/positions", "bot-mode", "live-arm", "BOT_MODE", "MT5_TRADING_ENABLED", "Invoke-RestMethod", "Invoke-WebRequest"]) {
    assert.ok(!code.includes(forbidden), `${forbidden} must not appear`);
  }
});

check("LAUNCHER_STARTS_ON_CLICK_BOT_ON_BUTTON", () => {
  const launcher = read(LAUNCHER);
  assert.match(launcher, /Start-TaskIfNeeded \$BridgeTask/);
  assert.match(launcher, /Start-TaskIfNeeded \$WebTask/);
  assert.match(launcher, /PHASE7C_DESKTOP_BOT_AUTOSTART=FALSE/);
});

console.log(results.join("\n"));
console.log("PHASE7C_MANUAL_START_ONLY_SOURCE=PASS");
