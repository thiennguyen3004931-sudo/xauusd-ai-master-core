import type { Mt5BridgeHealth } from "@xauusd/mt5-broker";

export interface CustomerRealBridgeBindingConfig {
  readonly endpoint: string;
  readonly mt5Login: number;
  readonly brokerServer: string;
}

export interface CustomerRealBridgeBindingEvidence {
  readonly endpoint: string;
  readonly mt5Login: number;
  readonly brokerServer: string;
  readonly bridgeSessionId: string;
  readonly accountMode: "real";
  readonly configuredAccountMode: "LIVE";
  readonly executionArmed: boolean;
}

function fail(code: string): never {
  throw new Error(code);
}

function canonical(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function assertEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    fail("CUSTOMER_REAL_BRIDGE_ENDPOINT_INVALID");
  }

  if (url.protocol !== "https:") {
    fail("CUSTOMER_REAL_BRIDGE_HTTPS_REQUIRED");
  }
  if (url.username || url.password) {
    fail("CUSTOMER_REAL_BRIDGE_ENDPOINT_CREDENTIALS_FORBIDDEN");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  ) {
    fail("CUSTOMER_REAL_BRIDGE_LOOPBACK_FORBIDDEN");
  }
  return url;
}

export function validateCustomerRealBridgeBinding(
  config: CustomerRealBridgeBindingConfig,
  health: Mt5BridgeHealth,
): CustomerRealBridgeBindingEvidence {
  const url = assertEndpoint(config.endpoint);

  if (!Number.isSafeInteger(config.mt5Login) || config.mt5Login <= 0) {
    fail("CUSTOMER_REAL_BRIDGE_MT5_LOGIN_INVALID");
  }
  if (!canonical(config.brokerServer)) {
    fail("CUSTOMER_REAL_BRIDGE_SERVER_INVALID");
  }

  if (health.connected !== true) fail("CUSTOMER_REAL_BRIDGE_DISCONNECTED");
  if (health.status !== "ok") fail("CUSTOMER_REAL_BRIDGE_HEALTH_NOT_OK");
  if (health.accountLogin !== config.mt5Login) {
    fail("CUSTOMER_REAL_BRIDGE_ACCOUNT_MISMATCH");
  }
  if (health.server !== config.brokerServer) {
    fail("CUSTOMER_REAL_BRIDGE_SERVER_MISMATCH");
  }
  if (health.accountMode !== "real") {
    fail("CUSTOMER_REAL_BRIDGE_ACCOUNT_MODE_NOT_REAL");
  }
  if (health.configuredAccountMode !== "LIVE") {
    fail("CUSTOMER_REAL_BRIDGE_CONFIG_MODE_NOT_LIVE");
  }
  if (!canonical(health.bridgeSessionId ?? "")) {
    fail("CUSTOMER_REAL_BRIDGE_SESSION_MISSING");
  }

  return Object.freeze({
    endpoint: url.toString(),
    mt5Login: config.mt5Login,
    brokerServer: config.brokerServer,
    bridgeSessionId: health.bridgeSessionId!,
    accountMode: "real" as const,
    configuredAccountMode: "LIVE" as const,
    executionArmed:
      health.liveExecutionArmed === true && health.liveArmStatus === "ARMED",
  });
}
