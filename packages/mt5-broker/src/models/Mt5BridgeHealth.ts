export interface Mt5BridgeHealth {
  status: "ok" | "degraded";
  connected: boolean;
  /** MT5 terminal's connection to the broker trade server, when reported. */
  brokerConnected?: boolean | null;
  tradingEnabled: boolean;
  terminalTradeAllowed: boolean;
  expertTradeAllowed: boolean;
  accountLogin?: number;
  accountMode?: "demo" | "contest" | "real";
  accountBalance?: number;
  accountEquity?: number;
  accountMargin?: number;
  accountFreeMargin?: number;
  accountProfit?: number;
  accountLeverage?: number;
  accountCurrency?: string;
  server?: string;
  terminalVersion?: string;
  configuredAccountMode?: "DEMO" | "LIVE";
  bridgeSessionId?: string;
  liveArmRequired?: boolean;
  liveExecutionArmed?: boolean;
  liveArmStatus?: "ARMED" | "DISARMED" | "NOT_REQUIRED";
  liveArmReason?: string;
  liveArmScope?: "BRIDGE_SESSION" | "LEGACY_TTL";
  liveRiskReductionAllowedWhenDisarmed?: boolean;
  lastError?: string;
  reconnectCount?: number;
  lastReconnectAt?: number;
  reconnecting?: boolean;
  timestamp: number;
}
