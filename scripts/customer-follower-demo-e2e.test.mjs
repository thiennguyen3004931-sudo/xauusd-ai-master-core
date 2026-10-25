import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { signCopyCommand } from "../packages/copy-protocol/dist/index.js";

test("signed COPY_FOLLOWER simulation is durable and has no broker mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "xauusd-signed-copy-demo-"));
  try {
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    const now = Date.now();
    const configPath = join(root, "config.json");
    const commandPath = join(root, "command.json");
    const journalPath = join(root, "journal.sqlite");
    writeFileSync(configPath, JSON.stringify({
      productMode: "COPY_FOLLOWER",
      executionMode: "SIMULATED_ONLY",
      licenseId: "demo-license-1",
      installationId: "demo-installation-1",
      mt5Login: 771001,
      brokerServer: "Broker-Demo",
      allowedSymbols: ["XAUUSD"],
      trustedPublicKeys: { "master-key-1": publicKey },
      journalPath,
    }));
    const signed = signCopyCommand({
      version: 1,
      commandId: "demo-copy-0001",
      sequence: 1,
      licenseId: "demo-license-1",
      installationId: "demo-installation-1",
      mt5Login: 771001,
      brokerServer: "Broker-Demo",
      symbol: "XAUUSD",
      action: "POSITION_OPEN",
      payload: { side: "BUY", volume: 0.01, stopLoss: 4190, takeProfit: 4220 },
      masterPositionRef: "demo-master-pos-0001",
      issuedAt: now - 1000,
      expiresAt: now + 60000,
      keyId: "master-key-1",
    }, privateKey);
    writeFileSync(commandPath, JSON.stringify(signed));
    function invoke() {
      return spawnSync(process.execPath, [
        "scripts/customer-follower-demo/verify-and-simulate.mjs",
        configPath, commandPath,
      ], { cwd: process.cwd(), encoding: "utf8" });
    }
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      ok: true, code: "DISPATCHED", commandId: "demo-copy-0001",
      simulatedOnly: true, mt5Mutation: false, action: "POSITION_OPEN",
      pendingReconciliation: 0,
    });
    const repeated = invoke();
    assert.equal(repeated.status, 2, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).code, "REPLAYED_COMMAND");

    writeFileSync(commandPath, JSON.stringify({
      ...signed, payload: { ...signed.payload, volume: 3 },
    }));
    const tampered = invoke();
    assert.equal(tampered.status, 2, tampered.stderr);
    assert.equal(JSON.parse(tampered.stdout).code, "SIGNATURE_DENIED");

    const source = readFileSync("scripts/customer-follower-demo/verify-and-simulate.mjs", "utf8");
    for (const banned of ["@xauusd/mt5-broker", "node:net", "node:http", "placeOrder(", "modifyPosition(", "closePosition("]) {
      assert.equal(source.includes(banned), false, "simulated runner must not contain broker mutation: " + banned);
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
