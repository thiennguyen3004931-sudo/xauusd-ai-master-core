import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { signCopyCommand } from "../packages/copy-protocol/dist/index.js";
import {
  CustomerCopyCommandVerifier,
  CustomerFollowerExecutionAdapter,
  CustomerMt5FollowerExecutor,
  InMemoryCustomerFollowerPositionRegistry,
} from "../packages/customer-agent/dist/index.js";

const NOW = 100_000_000;

test("signed COPY_FOLLOWER command reaches simulated MT5 bridge through production wiring chain", async () => {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

  const positions = [];
  const mutations = [];

  const bridge = {
    async health() {
      return {
        connected: true,
        tradingEnabled: true,
        terminalTradeAllowed: true,
        expertTradeAllowed: true,
      };
    },
    async quote() {
      return { bid: 4199.5, ask: 4200.5 };
    },
    async placeOrder(request) {
      mutations.push({ action: "OPEN", request });
      positions.push({
        ticket: "F90001",
        symbol: request.symbol,
        volume: request.volume,
        stopLoss: request.stopLoss,
        takeProfit: request.takeProfit,
      });
      return { accepted: true, status: "FILLED", ticket: "F90001", message: "simulated" };
    },
    async modifyPosition(ticket, stopLoss, takeProfit, commandId) {
      mutations.push({ action: "MODIFY", ticket, stopLoss, takeProfit, commandId });
      return { success: true };
    },
    async closePosition(ticket, volume, commandId) {
      mutations.push({ action: "CLOSE", ticket, volume, commandId });
      return { success: true };
    },
    async openPositions(symbol) {
      return positions.filter((position) => !symbol || position.symbol === symbol);
    },
  };

  const verifier = new CustomerCopyCommandVerifier(
    {
      licenseId: "license-prod-wire-001",
      installationId: "install-prod-wire-001",
      mt5Login: 770001,
      brokerServer: "Broker-Real",
      allowedSymbols: ["XAUUSD"],
    },
    new Map([["master-key-prod-wire", publicKey]]),
    { now: () => NOW },
  );

  const executor = new CustomerMt5FollowerExecutor(
    bridge,
    new InMemoryCustomerFollowerPositionRegistry(),
  );
  const adapter = new CustomerFollowerExecutionAdapter(executor);

  const command = signCopyCommand(
    {
      version: 1,
      commandId: "prod-wire-open-001",
      sequence: 1,
      licenseId: "license-prod-wire-001",
      installationId: "install-prod-wire-001",
      mt5Login: 770001,
      brokerServer: "Broker-Real",
      symbol: "XAUUSD",
      action: "POSITION_OPEN",
      payload: {
        side: "BUY",
        volume: 0.12,
        stopLoss: 4190,
        takeProfit: 4220,
      },
      masterPositionRef: "master-prod-wire-001",
      issuedAt: NOW - 100,
      expiresAt: NOW + 30_000,
      keyId: "master-key-prod-wire",
    },
    privateKey,
  );

  const decision = verifier.accept(command);
  assert.equal(decision.ok, true);

  const result = await adapter.dispatch(decision);
  assert.equal(result.ok, true);
  assert.equal(result.code, "FORWARDED_TO_EXECUTOR");
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].action, "OPEN");
  assert.equal(mutations[0].request.idempotencyKey, "prod-wire-open-001");
  assert.equal(mutations[0].request.symbol, "XAUUSD");
  assert.equal(mutations[0].request.volume, 0.12);

  assert.deepEqual(verifier.accept(command), {
    ok: false,
    code: "REPLAYED_COMMAND",
  });
});

test("production wiring remains simulated and source-only", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("packages/customer-agent/src/mt5-follower-executor.ts", "utf8"),
  );

  for (const forbidden of [
    "@xauusd/mt5-broker",
    "node:child_process",
    "MetaTrader5",
    "order_send",
    "127.0.0.1",
    "localhost",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      "production wiring source contains forbidden direct LIVE integration marker: " + forbidden,
    );
  }
});
