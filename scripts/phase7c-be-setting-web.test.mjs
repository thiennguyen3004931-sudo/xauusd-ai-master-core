// Break-even (BE) trigger/offset editable from the web, persisted next to lot settings.
// Defaults keep the frozen baseline (+6 -> entry). Ranges come from the single BE source
// (scripts/phase7c-break-even-config.mjs). The executor supervisor exports the saved values to
// TREND and SIDEWAY through ZIQ_PHASE7C_BREAK_EVEN_*; controllers snapshot them per new position.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  Phase7CLotSettingsService,
  validatePhase7CLotSettings,
} from "../apps/api/dist/services/phase7c-lot-settings.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const base = { trendFixedLot: 0.03, sidewayRiskPercent: 0.25, sidewayMaxLot: 0.03 };

function block(source, start, end) {
  const i = source.indexOf(start);
  assert.notEqual(i, -1, `missing ${start}`);
  const j = source.indexOf(end, i + start.length);
  assert.notEqual(j, -1, `missing ${end} after ${start}`);
  return source.slice(i, j);
}

test("defaults keep the frozen baseline: BE +6 -> entry (offset 0)", () => {
  const v = validatePhase7CLotSettings(base);
  assert.equal(v.breakEvenTriggerPrice, 6);
  assert.equal(v.breakEvenOffsetPrice, 0);
});

test("accepts trigger 4..15 and offset 0..3 below trigger", () => {
  const v = validatePhase7CLotSettings({ ...base, breakEvenTriggerPrice: 8, breakEvenOffsetPrice: 1 });
  assert.equal(v.breakEvenTriggerPrice, 8);
  assert.equal(v.breakEvenOffsetPrice, 1);
  assert.equal(validatePhase7CLotSettings({ ...base, breakEvenTriggerPrice: 4 }).breakEvenTriggerPrice, 4);
  assert.equal(validatePhase7CLotSettings({ ...base, breakEvenTriggerPrice: 15, breakEvenOffsetPrice: 3 }).breakEvenOffsetPrice, 3);
});

test("rejects out-of-range or inconsistent BE values (fail closed)", () => {
  for (const bad of [
    { breakEvenTriggerPrice: 3 },
    { breakEvenTriggerPrice: 16 },
    { breakEvenTriggerPrice: Number.NaN },
    { breakEvenOffsetPrice: -1 },
    { breakEvenOffsetPrice: 3.5 },
    { breakEvenTriggerPrice: 4, breakEvenOffsetPrice: 3 + 1 },
    { breakEvenTriggerPrice: 4, breakEvenOffsetPrice: 4 },
  ]) {
    assert.throws(() => validatePhase7CLotSettings({ ...base, ...bad }), /breakEven/i, JSON.stringify(bad));
  }
});

test("legacy settings files without BE fields read as 6/0; saved values round-trip; mismatch needs restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "phase7c-be-setting-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    const activePath = path.join(dir, "active.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 2, ...base, trendFixedTpEnabled: false, trendFixedTpDistance: 0, sidewayFixedTpEnabled: false, sidewayFixedTpDistance: 0 }));
    writeFileSync(activePath, JSON.stringify({ version: 2, accountMode: "DEMO", ...base, armed: true, supervisorPid: process.pid, appliedAt: new Date().toISOString() }));
    writeFileSync(path.join(dir, "supervisor.pid"), String(process.pid));
    const service = new Phase7CLotSettingsService(settingsPath, activePath);
    const legacy = service.get();
    assert.equal(legacy.state.breakEvenTriggerPrice, 6);
    assert.equal(legacy.state.breakEvenOffsetPrice, 0);
    assert.equal(legacy.active?.breakEvenTriggerPrice, 6);

    writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, "utf8")), breakEvenTriggerPrice: 8, breakEvenOffsetPrice: 1 }));
    const changed = service.get();
    assert.equal(changed.state.breakEvenTriggerPrice, 8);
    assert.equal(changed.state.breakEvenOffsetPrice, 1);
    assert.equal(changed.restartRequired, true, "running executor still uses 6/0, so a restart is required");
    assert.equal(changed.appliesTo, "NEW_POSITIONS_ONLY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("API service reuses the single BE source for ranges", () => {
  const service = read("apps/api/src/services/phase7c-lot-settings.service.ts");
  assert.match(service, /from "\.\.\/\.\.\/\.\.\/\.\.\/scripts\/phase7c-break-even-config\.mjs"/);
  assert.match(service, /validateBreakEvenConfig\(/);
});

test("API save keeps the PAUSE + flat guard and keeps current BE when the client omits it", () => {
  const route = block(read("apps/api/src/routes/phase7c.route.ts"), 'router.post("/lot-settings"', 'router.get("/strategy-entry-conditions"');
  assert.match(route, /currentMode\.mode\s*!==\s*["']PAUSE["']/);
  assert.match(route, /telemetry\.positions\.length\s*>\s*0/);
  assert.match(route, /breakEvenTriggerPrice:\s*req\.body\?\.breakEvenTriggerPrice\s*\?\?\s*currentLotState\.breakEvenTriggerPrice/);
  assert.match(route, /breakEvenOffsetPrice:\s*req\.body\?\.breakEvenOffsetPrice\s*\?\?\s*currentLotState\.breakEvenOffsetPrice/);
});

test("executor supervisor validates and exports saved BE to TREND and SIDEWAY", () => {
  const profile = read("scripts/lib/phase7c-account-mode.ps1");
  const assertBlock = block(profile, "function Assert-Phase7CRiskProfile", "function Get-Phase7CRiskProfilePath");
  assert.match(assertBlock, /breakEvenTriggerPrice/);
  assert.match(assertBlock, /-lt 4 -or \$breakEvenTriggerPrice -gt 15/);
  assert.match(assertBlock, /-lt 0 -or \$breakEvenOffsetPrice -gt 3/);
  assert.match(assertBlock, /\$breakEvenOffsetPrice -ge \$breakEvenTriggerPrice/);

  const supervisor = read("scripts/run-phase7c-executors-local.ps1");
  assert.match(supervisor, /\$env:ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE = /);
  assert.match(supervisor, /\$env:ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE = /);
  const exportAt = supervisor.indexOf("$env:ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE = ");
  const launchAt = supervisor.indexOf('$trend = Start-Process -FilePath "powershell.exe"');
  assert.ok(launchAt > 0 && exportAt > 0 && exportAt < launchAt, "BE env must be exported before TREND/SIDEWAY start");
  const active = block(supervisor, "function Write-ActiveLotSettings", "function Start-TelegramModeChild");
  assert.match(active, /breakEvenTriggerPrice = \$BreakEvenTriggerPrice/);
  assert.match(active, /breakEvenOffsetPrice = \$BreakEvenOffsetPrice/);
});

test("web exposes BE fields on the Lot / Fixed TP card and sends them on save", () => {
  const types = read("apps/web/src/phase7c-types.ts");
  assert.match(block(types, "export interface Phase7CLotSettingsState {", "}"), /breakEvenTriggerPrice: number;/);
  const api = read("apps/web/src/api.ts");
  assert.match(block(api, "export async function setPhase7CLotSettings(", "}): Promise"), /breakEvenTriggerPrice\?: number;/);
  const card = read("apps/web/src/ui/Phase7CControlCenterCompactSection.tsx");
  assert.match(card, /BE kích hoạt \(giá\)/);
  assert.match(card, /SL dời về entry \+/);
  assert.match(card, /breakEvenTriggerPrice: breakEvenTriggerPrice/);
  assert.match(card, /Chỉ áp dụng cho lệnh mới/);
});
