import type {
  CustomerFollowerExecutionRequest,
  CustomerFollowerExecutor,
} from "./follower-execution.js";

export interface CustomerMt5BridgePort {
  health(): Promise<{
    connected: boolean;
    tradingEnabled?: boolean;
    terminalTradeAllowed?: boolean;
    expertTradeAllowed?: boolean;
  }>;
  quote(symbol: string): Promise<{ bid: number; ask: number }>;
  placeOrder(request: {
    symbol: string;
    side: "BUY" | "SELL";
    orderType: "MARKET";
    timeInForce: "GTC";
    volume: number;
    requestedPrice: number;
    stopLoss: number;
    takeProfit: number;
    deviationPoints: number;
    magicNumber: number;
    comment: string;
    clientOrderId: string;
    idempotencyKey: string;
  }): Promise<{
    accepted: boolean;
    status: string;
    ticket?: string;
    position?: { ticket: string };
    message?: string;
  }>;
  modifyPosition(
    ticket: string,
    stopLoss: number,
    takeProfit: number | undefined,
    commandId: string,
  ): Promise<{ success: boolean; message?: string }>;
  closePosition(
    ticket: string,
    volume: number,
    commandId: string,
  ): Promise<{ success: boolean; message?: string }>;
  openPositions(symbol?: string): Promise<
    Array<{
      ticket: string;
      symbol: string;
      volume: number;
      stopLoss: number;
      takeProfit: number;
    }>
  >;
}

export interface CustomerFollowerPositionRegistry {
  get(masterPositionRef: string): Promise<string | undefined>;
  set(masterPositionRef: string, followerTicket: string): Promise<void>;
  delete(masterPositionRef: string): Promise<void>;
}

export class InMemoryCustomerFollowerPositionRegistry
  implements CustomerFollowerPositionRegistry
{
  private readonly tickets = new Map<string, string>();

  async get(masterPositionRef: string): Promise<string | undefined> {
    return this.tickets.get(masterPositionRef);
  }

  async set(masterPositionRef: string, followerTicket: string): Promise<void> {
    this.tickets.set(masterPositionRef, followerTicket);
  }

  async delete(masterPositionRef: string): Promise<void> {
    this.tickets.delete(masterPositionRef);
  }
}

export interface CustomerMt5FollowerExecutorConfig {
  readonly deviationPoints: number;
  readonly magicNumber: number;
  readonly comment: string;
  readonly requireTradingEnabled: boolean;
}

const DEFAULT_CONFIG: CustomerMt5FollowerExecutorConfig = Object.freeze({
  deviationPoints: 30,
  magicNumber: 770701,
  comment: "xauusd-copy-follower",
  requireTradingEnabled: true,
});

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export class CustomerMt5FollowerExecutor implements CustomerFollowerExecutor {
  private readonly config: CustomerMt5FollowerExecutorConfig;

  constructor(
    private readonly bridge: CustomerMt5BridgePort,
    private readonly registry: CustomerFollowerPositionRegistry,
    config: Partial<CustomerMt5FollowerExecutorConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (
      !Number.isInteger(this.config.deviationPoints) ||
      this.config.deviationPoints < 0
    ) {
      throw new TypeError("deviationPoints must be a non-negative integer");
    }
    if (!Number.isSafeInteger(this.config.magicNumber) || this.config.magicNumber <= 0) {
      throw new TypeError("magicNumber must be a positive safe integer");
    }
    if (!this.config.comment.trim()) {
      throw new TypeError("comment must be non-blank");
    }
  }

  async execute(request: CustomerFollowerExecutionRequest): Promise<void> {
    await this.assertBridgeReady();

    switch (request.action) {
      case "POSITION_OPEN":
        await this.open(request);
        return;
      case "STOP_LOSS_UPDATE":
        await this.updateStopLoss(request);
        return;
      case "TAKE_PROFIT_UPDATE":
        await this.updateTakeProfit(request);
        return;
      case "PARTIAL_CLOSE":
        await this.partialClose(request);
        return;
      case "POSITION_CLOSE":
        await this.fullClose(request);
        return;
      case "POSITION_SNAPSHOT":
        await this.resolveOpenPosition(request.masterPositionRef, request.symbol);
        return;
    }
  }

  private async assertBridgeReady(): Promise<void> {
    const health = await this.bridge.health();
    if (!health.connected) fail("FOLLOWER_MT5_DISCONNECTED");
    if (this.config.requireTradingEnabled && health.tradingEnabled === false) {
      fail("FOLLOWER_MT5_TRADING_DISABLED");
    }
    if (health.terminalTradeAllowed === false) {
      fail("FOLLOWER_MT5_TERMINAL_TRADE_NOT_ALLOWED");
    }
    if (health.expertTradeAllowed === false) {
      fail("FOLLOWER_MT5_EXPERT_TRADE_NOT_ALLOWED");
    }
  }

  private async open(
    request: Extract<CustomerFollowerExecutionRequest, { action: "POSITION_OPEN" }>,
  ): Promise<void> {
    if (await this.registry.get(request.masterPositionRef)) {
      fail("FOLLOWER_POSITION_ALREADY_BOUND");
    }

    const quote = await this.bridge.quote(request.symbol);
    const requestedPrice =
      request.entry ?? (request.side === "BUY" ? quote.ask : quote.bid);

    const response = await this.bridge.placeOrder({
      symbol: request.symbol,
      side: request.side,
      orderType: "MARKET",
      timeInForce: "GTC",
      volume: request.volume,
      requestedPrice,
      stopLoss: request.stopLoss ?? 0,
      takeProfit: request.takeProfit ?? 0,
      deviationPoints: this.config.deviationPoints,
      magicNumber: this.config.magicNumber,
      comment: this.config.comment,
      clientOrderId: request.commandId,
      idempotencyKey: request.commandId,
    });

    if (!response.accepted) {
      fail("FOLLOWER_POSITION_OPEN_REJECTED", response.message);
    }

    const ticket = response.position?.ticket ?? response.ticket;
    if (!ticket) fail("FOLLOWER_POSITION_OPEN_TICKET_MISSING");
    await this.registry.set(request.masterPositionRef, ticket);
  }

  private async updateStopLoss(
    request: Extract<CustomerFollowerExecutionRequest, { action: "STOP_LOSS_UPDATE" }>,
  ): Promise<void> {
    const position = await this.resolveOpenPosition(
      request.masterPositionRef,
      request.symbol,
    );
    const result = await this.bridge.modifyPosition(
      position.ticket,
      request.stopLoss,
      position.takeProfit || undefined,
      request.commandId,
    );
    if (!result.success) fail("FOLLOWER_STOP_LOSS_UPDATE_FAILED", result.message);
  }

  private async updateTakeProfit(
    request: Extract<CustomerFollowerExecutionRequest, { action: "TAKE_PROFIT_UPDATE" }>,
  ): Promise<void> {
    const position = await this.resolveOpenPosition(
      request.masterPositionRef,
      request.symbol,
    );
    const result = await this.bridge.modifyPosition(
      position.ticket,
      position.stopLoss,
      request.takeProfit,
      request.commandId,
    );
    if (!result.success) fail("FOLLOWER_TAKE_PROFIT_UPDATE_FAILED", result.message);
  }

  private async partialClose(
    request: Extract<CustomerFollowerExecutionRequest, { action: "PARTIAL_CLOSE" }>,
  ): Promise<void> {
    const position = await this.resolveOpenPosition(
      request.masterPositionRef,
      request.symbol,
    );
    if (!finitePositive(request.volume) || request.volume >= position.volume) {
      fail("FOLLOWER_PARTIAL_CLOSE_VOLUME_INVALID");
    }
    const result = await this.bridge.closePosition(
      position.ticket,
      request.volume,
      request.commandId,
    );
    if (!result.success) fail("FOLLOWER_PARTIAL_CLOSE_FAILED", result.message);
  }

  private async fullClose(
    request: Extract<CustomerFollowerExecutionRequest, { action: "POSITION_CLOSE" }>,
  ): Promise<void> {
    const position = await this.resolveOpenPosition(
      request.masterPositionRef,
      request.symbol,
    );
    const result = await this.bridge.closePosition(
      position.ticket,
      position.volume,
      request.commandId,
    );
    if (!result.success) fail("FOLLOWER_POSITION_CLOSE_FAILED", result.message);
    await this.registry.delete(request.masterPositionRef);
  }

  private async resolveOpenPosition(masterPositionRef: string, symbol: string) {
    const ticket = await this.registry.get(masterPositionRef);
    if (!ticket) fail("FOLLOWER_POSITION_BINDING_MISSING");
    const positions = await this.bridge.openPositions(symbol);
    const position = positions.find(
      (candidate) => candidate.ticket === ticket && candidate.symbol === symbol,
    );
    if (!position) fail("FOLLOWER_POSITION_NOT_OPEN");
    return position;
  }
}
