import { describe, expect, it } from "vitest";
import type { CustomerFollowerExecutionRequest } from "./follower-execution.js";
import {
  CustomerMt5FollowerExecutor,
  InMemoryCustomerFollowerPositionRegistry,
  type CustomerMt5BridgePort,
} from "./mt5-follower-executor.js";

function bridge(): CustomerMt5BridgePort & {
  calls: Array<{ kind: string; value: unknown }>;
  positions: Array<{
    ticket: string;
    symbol: string;
    volume: number;
    stopLoss: number;
    takeProfit: number;
  }>;
} {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const positions: Array<{
    ticket: string;
    symbol: string;
    volume: number;
    stopLoss: number;
    takeProfit: number;
  }> = [];
  return {
    calls,
    positions,
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
      calls.push({ kind: "placeOrder", value: request });
      positions.push({
        ticket: "9001",
        symbol: request.symbol,
        volume: request.volume,
        stopLoss: request.stopLoss,
        takeProfit: request.takeProfit,
      });
      return {
        accepted: true,
        status: "FILLED",
        ticket: "9001",
        message: "ok",
      };
    },
    async modifyPosition(ticket, stopLoss, takeProfit, commandId) {
      calls.push({
        kind: "modifyPosition",
        value: { ticket, stopLoss, takeProfit, commandId },
      });
      const position = positions.find((item) => item.ticket === ticket);
      if (!position) return { success: false, message: "missing" };
      position.stopLoss = stopLoss;
      position.takeProfit = takeProfit ?? 0;
      return { success: true };
    },
    async closePosition(ticket, volume, commandId) {
      calls.push({
        kind: "closePosition",
        value: { ticket, volume, commandId },
      });
      const position = positions.find((item) => item.ticket === ticket);
      if (!position) return { success: false, message: "missing" };
      if (volume >= position.volume) {
        positions.splice(positions.indexOf(position), 1);
      } else {
        position.volume -= volume;
      }
      return { success: true };
    },
    async openPositions(symbol) {
      return positions.filter((item) => !symbol || item.symbol === symbol);
    },
  };
}

const openRequest: CustomerFollowerExecutionRequest = {
  action: "POSITION_OPEN",
  commandId: "cmd-open-1",
  sequence: 1,
  symbol: "XAUUSD",
  masterPositionRef: "master-1",
  side: "BUY",
  volume: 0.12,
  stopLoss: 4190,
  takeProfit: 4220,
};

describe("CustomerMt5FollowerExecutor", () => {
  it("opens once with command idempotency and binds the follower ticket", async () => {
    const port = bridge();
    const registry = new InMemoryCustomerFollowerPositionRegistry();
    const executor = new CustomerMt5FollowerExecutor(port, registry);

    await executor.execute(openRequest);

    expect(port.calls[0]).toMatchObject({
      kind: "placeOrder",
      value: {
        symbol: "XAUUSD",
        side: "BUY",
        orderType: "MARKET",
        volume: 0.12,
        requestedPrice: 4200.5,
        clientOrderId: "cmd-open-1",
        idempotencyKey: "cmd-open-1",
      },
    });
    expect(await registry.get("master-1")).toBe("9001");

    await expect(executor.execute(openRequest)).rejects.toThrow(
      "FOLLOWER_POSITION_ALREADY_BOUND",
    );
  });

  it("updates SL/TP, partially closes, then fully closes by bound ticket", async () => {
    const port = bridge();
    const registry = new InMemoryCustomerFollowerPositionRegistry();
    const executor = new CustomerMt5FollowerExecutor(port, registry);

    await executor.execute(openRequest);
    await executor.execute({
      action: "STOP_LOSS_UPDATE",
      commandId: "cmd-sl-2",
      sequence: 2,
      symbol: "XAUUSD",
      masterPositionRef: "master-1",
      stopLoss: 4201,
    });
    await executor.execute({
      action: "TAKE_PROFIT_UPDATE",
      commandId: "cmd-tp-3",
      sequence: 3,
      symbol: "XAUUSD",
      masterPositionRef: "master-1",
      takeProfit: 4230,
    });
    await executor.execute({
      action: "PARTIAL_CLOSE",
      commandId: "cmd-pc-4",
      sequence: 4,
      symbol: "XAUUSD",
      masterPositionRef: "master-1",
      volume: 0.04,
    });
    await executor.execute({
      action: "POSITION_CLOSE",
      commandId: "cmd-close-5",
      sequence: 5,
      symbol: "XAUUSD",
      masterPositionRef: "master-1",
    });

    expect(port.positions).toHaveLength(0);
    expect(await registry.get("master-1")).toBeUndefined();
    expect(port.calls.filter((call) => call.kind === "modifyPosition")).toHaveLength(2);
    expect(port.calls.filter((call) => call.kind === "closePosition")).toHaveLength(2);
  });

  it("fails closed when MT5 health or binding evidence is missing", async () => {
    const disconnected = bridge();
    disconnected.health = async () => ({ connected: false });
    const executor = new CustomerMt5FollowerExecutor(
      disconnected,
      new InMemoryCustomerFollowerPositionRegistry(),
    );

    await expect(executor.execute(openRequest)).rejects.toThrow(
      "FOLLOWER_MT5_DISCONNECTED",
    );

    const connected = bridge();
    const noBindingExecutor = new CustomerMt5FollowerExecutor(
      connected,
      new InMemoryCustomerFollowerPositionRegistry(),
    );
    await expect(
      noBindingExecutor.execute({
        action: "POSITION_SNAPSHOT",
        commandId: "cmd-snapshot",
        sequence: 2,
        symbol: "XAUUSD",
        masterPositionRef: "missing",
      }),
    ).rejects.toThrow("FOLLOWER_POSITION_BINDING_MISSING");
  });

  it("rejects invalid partial-close volume without sending a broker mutation", async () => {
    const port = bridge();
    const registry = new InMemoryCustomerFollowerPositionRegistry();
    const executor = new CustomerMt5FollowerExecutor(port, registry);

    await executor.execute(openRequest);
    const before = port.calls.length;

    await expect(
      executor.execute({
        action: "PARTIAL_CLOSE",
        commandId: "cmd-bad-partial",
        sequence: 2,
        symbol: "XAUUSD",
        masterPositionRef: "master-1",
        volume: 0.12,
      }),
    ).rejects.toThrow("FOLLOWER_PARTIAL_CLOSE_VOLUME_INVALID");

    expect(port.calls).toHaveLength(before);
  });
});
