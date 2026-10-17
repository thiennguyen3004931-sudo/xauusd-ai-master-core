import { describe, expect, it } from "vitest";
import type { Mt5BridgeHealth } from "@xauusd/mt5-broker";
import { validateCustomerRealBridgeBinding } from "./index.js";

function health(overrides: Partial<Mt5BridgeHealth> = {}): Mt5BridgeHealth {
  return {
    status: "ok",
    connected: true,
    tradingEnabled: true,
    terminalTradeAllowed: true,
    expertTradeAllowed: true,
    accountLogin: 770001,
    accountMode: "real",
    server: "Broker-Real",
    configuredAccountMode: "LIVE",
    bridgeSessionId: "bridge-session-001",
    liveArmRequired: true,
    liveExecutionArmed: false,
    liveArmStatus: "DISARMED",
    timestamp: 1,
    ...overrides,
  };
}

describe("validateCustomerRealBridgeBinding", () => {
  it("accepts matching real-LIVE bridge evidence without arming execution", () => {
    expect(
      validateCustomerRealBridgeBinding(
        {
          endpoint: "https://bridge.customer.example/v1",
          mt5Login: 770001,
          brokerServer: "Broker-Real",
        },
        health(),
      ),
    ).toEqual({
      endpoint: "https://bridge.customer.example/v1",
      mt5Login: 770001,
      brokerServer: "Broker-Real",
      bridgeSessionId: "bridge-session-001",
      accountMode: "real",
      configuredAccountMode: "LIVE",
      executionArmed: false,
    });
  });

  it("reports armed evidence only when both bridge flags prove ARMED", () => {
    const evidence = validateCustomerRealBridgeBinding(
      {
        endpoint: "https://bridge.customer.example/v1",
        mt5Login: 770001,
        brokerServer: "Broker-Real",
      },
      health({
        liveExecutionArmed: true,
        liveArmStatus: "ARMED",
      }),
    );
    expect(evidence.executionArmed).toBe(true);
  });

  it.each([
    ["http://bridge.customer.example/v1", "CUSTOMER_REAL_BRIDGE_HTTPS_REQUIRED"],
    ["https://localhost:8000/v1", "CUSTOMER_REAL_BRIDGE_LOOPBACK_FORBIDDEN"],
    ["https://127.0.0.1:8000/v1", "CUSTOMER_REAL_BRIDGE_LOOPBACK_FORBIDDEN"],
    ["https://user:secret@bridge.customer.example/v1", "CUSTOMER_REAL_BRIDGE_ENDPOINT_CREDENTIALS_FORBIDDEN"],
  ])("rejects unsafe endpoint %s", (endpoint, error) => {
    expect(() =>
      validateCustomerRealBridgeBinding(
        { endpoint, mt5Login: 770001, brokerServer: "Broker-Real" },
        health(),
      ),
    ).toThrow(error);
  });

  it("fails closed on account/server/session and mode mismatches", () => {
    const config = {
      endpoint: "https://bridge.customer.example/v1",
      mt5Login: 770001,
      brokerServer: "Broker-Real",
    };

    expect(() =>
      validateCustomerRealBridgeBinding(config, health({ accountLogin: 770002 })),
    ).toThrow("CUSTOMER_REAL_BRIDGE_ACCOUNT_MISMATCH");

    expect(() =>
      validateCustomerRealBridgeBinding(config, health({ server: "Broker-Other" })),
    ).toThrow("CUSTOMER_REAL_BRIDGE_SERVER_MISMATCH");

    expect(() =>
      validateCustomerRealBridgeBinding(config, health({ accountMode: "demo" })),
    ).toThrow("CUSTOMER_REAL_BRIDGE_ACCOUNT_MODE_NOT_REAL");

    expect(() =>
      validateCustomerRealBridgeBinding(
        config,
        health({ configuredAccountMode: "DEMO" }),
      ),
    ).toThrow("CUSTOMER_REAL_BRIDGE_CONFIG_MODE_NOT_LIVE");

    expect(() =>
      validateCustomerRealBridgeBinding(config, health({ bridgeSessionId: "" })),
    ).toThrow("CUSTOMER_REAL_BRIDGE_SESSION_MISSING");
  });
});
