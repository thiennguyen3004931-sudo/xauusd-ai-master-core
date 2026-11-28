import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMobileGatewayServer } = require("../server.cjs");
const { validateProductionConfig, buildServer, resolveControlMode } = require("../gateway.js");

const ORIGIN = "https://test-device.example-tailnet.ts.net:8443";
const USER = "operator@example.com";
const AUTH = { origin: ORIGIN, "tailscale-user-login": USER };

function config(extra = {}) {
  return {
    listenHost: "127.0.0.1",
    listenPort: 5791,
    webOrigin: "http://127.0.0.1:5717",
    apiOrigin: "http://127.0.0.1:3711",
    allowedUsers: [USER],
    allowedOrigin: ORIGIN,
    auditPath: "C:\\ProgramData\\XAUUSD-AI-MASTER\\mobile-readonly-gateway\\m4-audit.jsonl",
    ...extra,
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function request(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, json };
}

test("control mode defaults to READ_ONLY when config omits it", () => {
  assert.equal(resolveControlMode(config()), "READ_ONLY");
  assert.equal(validateProductionConfig(config()).controlMode, "READ_ONLY");
});

test("control mode accepts only READ_ONLY or M4 (case-sensitive) and fails closed otherwise", () => {
  assert.equal(validateProductionConfig(config({ controlMode: "READ_ONLY" })).controlMode, "READ_ONLY");
  assert.equal(validateProductionConfig(config({ controlMode: "M4" })).controlMode, "M4");
  for (const bad of ["m4", "FULL", "", "ON", true, 1, null]) {
    assert.throws(() => validateProductionConfig(config({ controlMode: bad })), /GATEWAY_CONTROL_MODE_INVALID/);
  }
});

test("READ_ONLY production server never reaches the canonical API for actions", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = buildServer(validateProductionConfig(config()), { fetchImpl });
  const base = await listen(server);
  try {
    const health = await request(base, "/__m2/health");
    assert.equal(health.json.mode, "M2_READ_ONLY");

    for (const action of ["MODE_AUTO", "MODE_PAUSE", "ARM_LIVE", "DISARM_LIVE"]) {
      const res = await request(base, "/__m4/action", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ action, confirmation: action }),
      });
      assert.equal(res.status, 403, action);
      assert.equal(res.json.error, "MOBILE_CONTROL_READ_ONLY", action);
    }

    const state = await request(base, "/__m4/state", { headers: AUTH });
    assert.equal(state.status, 200);
    assert.equal(state.json.controlMode, "READ_ONLY");
    assert.equal(state.json.controlsEnabled, false);
    assert.equal(state.json.operator, USER);

    const status = await request(base, "/__m4/status?transactionId=x", { headers: AUTH });
    assert.equal(status.status, 403);
    assert.equal(status.json.error, "MOBILE_CONTROL_READ_ONLY");

    assert.equal(calls.filter((c) => c.url.startsWith("http://127.0.0.1:3711")).length, 0);
  } finally {
    await close(server);
  }
});

test("READ_ONLY state still requires the allowed Tailscale identity", async () => {
  const server = createMobileGatewayServer({ config: config({ controlMode: "READ_ONLY" }) });
  const base = await listen(server);
  try {
    assert.equal((await request(base, "/__m4/state")).status, 403);
    assert.equal((await request(base, "/__m4/state", { headers: { "tailscale-user-login": "intruder@example.com" } })).status, 403);
    assert.equal((await request(base, "/__m4/action", { method: "POST" })).status, 403);
  } finally {
    await close(server);
  }
});

test("M4 must be opted in explicitly to build an action broker", async () => {
  const server = buildServer(validateProductionConfig(config({ controlMode: "M4", auditPath: "/tmp/m4-readonly-test-audit.jsonl" })), {
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const base = await listen(server);
  try {
    const health = await request(base, "/__m2/health");
    assert.equal(health.json.mode, "M4");
  } finally {
    await close(server);
  }
});
