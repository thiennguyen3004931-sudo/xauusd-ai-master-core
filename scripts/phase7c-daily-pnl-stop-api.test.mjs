// API service for the daily loss limit / profit target. Run with:
//   pnpm --dir apps/api exec tsx ../../scripts/phase7c-daily-pnl-stop-api.test.mjs
// No MT5: only the OFF path of status() is exercised (it must not touch the bridge).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.MT5_BRIDGE_ENABLED = "false";
const { Phase7CDailyPnlStopService, Phase7CDailyPnlStopError } = await import(
  "../apps/api/src/services/phase7c-daily-pnl-stop.service.ts"
);

function service() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p7c-daily-stop-api-"));
  return new Phase7CDailyPnlStopService(path.join(dir, "phase7c-daily-pnl-stop.json"));
}

const payload = (patch = {}) => ({
  expectedVersion: 0,
  source: "web-control-center",
  enabled: true,
  unit: "USD",
  dailyLossLimit: 100,
  dailyProfitTarget: 200,
  ...patch,
});

test("OFF by default and status() makes no broker call", async () => {
  const svc = service();
  const read = svc.read();
  assert.equal(read.valid, true);
  assert.equal(read.persisted, false);
  assert.equal(read.state.enabled, false);
  const status = await svc.status();
  assert.equal(status.blocked, false);
  assert.equal(status.reason, "DISABLED");
});

test("save writes a versioned file; stale version is rejected", () => {
  const svc = service();
  const saved = svc.set(payload());
  assert.equal(saved.valid, true);
  assert.equal(saved.state.version, 1);
  assert.equal(saved.state.dailyLossLimit, 100);
  assert.throws(() => svc.set(payload()), (error) => error instanceof Phase7CDailyPnlStopError && error.code === "CONFIG_VERSION_CONFLICT");
  assert.equal(svc.set(payload({ expectedVersion: 1, enabled: false })).state.version, 2);
});

test("invalid payloads are rejected", () => {
  const svc = service();
  for (const bad of [
    payload({ source: "elsewhere" }),
    payload({ unit: "EUR" }),
    payload({ dailyLossLimit: -1 }),
    payload({ dailyLossLimit: null, dailyProfitTarget: null }),
    { ...payload(), extra: 1 },
  ]) {
    assert.throws(() => svc.set(bad), (error) => error instanceof Phase7CDailyPnlStopError && error.code === "DAILY_PNL_STOP_CONFIG_INVALID", JSON.stringify(bad));
  }
});

test("ON with the bridge unavailable blocks new entries (fail closed)", async () => {
  const svc = service();
  svc.set(payload());
  const status = await svc.status();
  assert.equal(status.blocked, true);
  assert.equal(status.reason, "DATA_UNAVAILABLE");
});

test("a corrupt file blocks and can be repaired by saving", async () => {
  const svc = service();
  fs.mkdirSync(path.dirname(svc.filePath), { recursive: true });
  fs.writeFileSync(svc.filePath, "{broken");
  assert.equal((await svc.status()).reason, "CONFIG_INVALID");
  const repaired = svc.set(payload({ expectedVersion: 0, enabled: false }));
  assert.equal(repaired.valid, true);
  assert.equal((await svc.status()).reason, "DISABLED");
});
