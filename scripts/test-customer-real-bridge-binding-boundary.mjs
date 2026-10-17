import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "packages/customer-real-bridge-binding/src/index.ts";

test("real bridge binding contract remains validation-only", async () => {
  const source = await readFile(sourcePath, "utf8");

  for (const required of [
    "validateCustomerRealBridgeBinding",
    "CUSTOMER_REAL_BRIDGE_HTTPS_REQUIRED",
    "CUSTOMER_REAL_BRIDGE_ACCOUNT_MISMATCH",
    "CUSTOMER_REAL_BRIDGE_SERVER_MISMATCH",
    "CUSTOMER_REAL_BRIDGE_SESSION_MISSING",
  ]) {
    assert.ok(source.includes(required), "binding contract missing: " + required);
  }

  for (const forbidden of [
    "fetch(",
    "axios",
    "node:http",
    "node:https",
    "node:net",
    "node:child_process",
    "new Mt5BridgeClient",
    "HttpMt5Transport",
    "127.0.0.1",
    "localhost:",
    "order_send",
    "MetaTrader5",
    "liveExecutionArmed =",
    "liveArmStatus =",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      "binding contract contains forbidden runtime marker: " + forbidden,
    );
  }
});
