import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CustomerFollowerExecutionAdapter,
  type CustomerCopyCommandVerifier,
} from "@xauusd/customer-agent";
import {
  DurableCustomerFollowerDispatcher,
  SqliteCustomerFollowerCommandJournal,
} from "./sqlite-command-journal.js";

const directories: string[] = [];
function filename(): string {
  const dir = mkdtempSync(join(tmpdir(), "xauusd-durable-copy-"));
  directories.push(dir);
  return join(dir, "commands.sqlite");
}
afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 });
  }
});
const binding = {
  licenseId: "license-follower-001",
  installationId: "installation-follower-001",
  mt5Login: 770001,
  brokerServer: "Broker-Demo",
  allowedSymbols: ["XAUUSD"],
};
function command(commandId: string, sequence: number) {
  return {
    action: "POSITION_OPEN" as const,
    commandId,
    sequence,
    symbol: "XAUUSD",
    masterPositionRef: "master-pos-" + sequence,
    payload: { side: "BUY", volume: 0.01, stopLoss: 4190, takeProfit: 4220 },
  };
}
function verifiedAdapter(
  execute: (value: unknown) => Promise<void>,
) {
  // Signature-verifier correctness is separately covered by
  // @xauusd/customer-agent. This mock isolates durable reservation behavior.
  const verifier = {
    accept(value: unknown) {
      return { ok: true, code: "ACCEPTED", command: value };
    },
  } as unknown as CustomerCopyCommandVerifier;
  return {
    verifier,
    adapter: new CustomerFollowerExecutionAdapter({ execute }),
  };
}

describe("SqliteCustomerFollowerCommandJournal", () => {
  it("persists reservations and prevents duplicate ID or stale sequence across restart", () => {
    const path = filename();
    const first = new SqliteCustomerFollowerCommandJournal(path, binding);
    expect(first.reserve({ commandId: "one", sequence: 5 })).toEqual({ ok: true, code: "RESERVED" });
    expect(first.reserve({ commandId: "one", sequence: 5 })).toEqual({
      ok: false, code: "REPLAYED_COMMAND",
    });
    first.close();
    const restarted = new SqliteCustomerFollowerCommandJournal(path, binding);
    expect(restarted.reserve({ commandId: "one", sequence: 6 })).toEqual({
      ok: false, code: "REPLAYED_COMMAND",
    });
    expect(restarted.reserve({ commandId: "older", sequence: 4 })).toEqual({
      ok: false, code: "SEQUENCE_NOT_MONOTONIC",
    });
    expect(restarted.listReserved()).toMatchObject([{ commandId: "one", sequence: 5, state: "RESERVED" }]);
    restarted.markDispatched("one");
    expect(restarted.listReserved()).toEqual([]);
    expect(() => restarted.markDispatched("one")).toThrow("FOLLOWER_JOURNAL_DISPATCH_TRANSITION_DENIED");
    restarted.close();
  });

  it("rejects switching account or installation using an existing journal file", () => {
    const path = filename();
    const first = new SqliteCustomerFollowerCommandJournal(path, binding);
    first.close();
    expect(() => new SqliteCustomerFollowerCommandJournal(path, {
      ...binding, mt5Login: binding.mt5Login + 1,
    })).toThrow("FOLLOWER_JOURNAL_BINDING_MISMATCH");
  });

  it("reserves before dispatch and blocks repeat OPEN even after reboot", async () => {
    const path = filename();
    let executions = 0;
    const runner = verifiedAdapter(async () => { executions++; });
    const firstJournal = new SqliteCustomerFollowerCommandJournal(path, binding);
    const first = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, firstJournal);
    await expect(first.dispatch(command("open-1", 1))).resolves.toMatchObject({
      ok: true, code: "DISPATCHED", commandId: "open-1",
    });
    expect(executions).toBe(1);
    firstJournal.close();

    const reopenedJournal = new SqliteCustomerFollowerCommandJournal(path, binding);
    const restarted = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, reopenedJournal);
    await expect(restarted.dispatch(command("open-1", 1))).resolves.toEqual({
      ok: false, code: "REPLAYED_COMMAND",
    });
    expect(executions).toBe(1);
    reopenedJournal.close();
  });

  it("refuses invalid payload without creating a reservation", async () => {
    const journal = new SqliteCustomerFollowerCommandJournal(filename(), binding);
    const runner = verifiedAdapter(async () => { throw new Error("must not reach executor"); });
    try {
      const dispatcher = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, journal);
      const bad = { ...command("bad-open", 10), payload: { side: "BUY", volume: 0 } };
      await expect(dispatcher.dispatch(bad)).resolves.toEqual({
        ok: false, code: "INVALID_EXECUTION_PAYLOAD",
      });
      expect(journal.listReserved()).toEqual([]);
      expect(journal.reserve({ commandId: "safe-next", sequence: 1 })).toEqual({
        ok: true, code: "RESERVED",
      });
    } finally {
      journal.close();
    }
  });

  it("leaves an uncertain order RESERVED instead of retrying after executor failure", async () => {
    const path = filename();
    const runner = verifiedAdapter(async () => { throw new Error("simulated broker disconnected"); });
    const journal = new SqliteCustomerFollowerCommandJournal(path, binding);
    const dispatcher = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, journal);
    await expect(dispatcher.dispatch(command("uncertain-2", 2))).resolves.toEqual({
      ok: false, code: "FOLLOWER_DISPATCH_UNCERTAIN_EXECUTOR_FAILED",
    });
    expect(journal.listReserved()).toMatchObject([{
      commandId: "uncertain-2", sequence: 2, state: "RESERVED",
    }]);
    journal.close();
    const reopened = new SqliteCustomerFollowerCommandJournal(path, binding);
    expect(reopened.reserve({ commandId: "uncertain-2", sequence: 2 })).toEqual({
      ok: false, code: "REPLAYED_COMMAND",
    });
    reopened.close();
  });
});
