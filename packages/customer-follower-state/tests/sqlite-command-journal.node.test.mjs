// Node 24 native test runner is required for node:sqlite. Vitest 2's Vite
// module loader does not recognize this newer built-in and reports
// "Failed to load url sqlite". These tests exercise real SQLite, never a mock.
// No MT5 connection or real order execution is possible here.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomerFollowerExecutionAdapter } from "@xauusd/customer-agent";
import {
  DurableCustomerFollowerDispatcher,
  SqliteCustomerFollowerCommandJournal,
} from "../dist/sqlite-command-journal.js";

const binding = {
  licenseId: "synthetic-follower-license",
  installationId: "synthetic-follower-installation",
  mt5Login: 770001,
  brokerServer: "Synthetic-Demo",
  allowedSymbols: ["XAUUSD"],
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "xauusd-follower-journal-node-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }));
  return join(root, "journal.sqlite");
}

function command(commandId, sequence) {
  return {
    action: "POSITION_OPEN", commandId, sequence, symbol: "XAUUSD",
    masterPositionRef: "synthetic-master-" + sequence,
    payload: { side: "BUY", volume: 0.01, stopLoss: 4190, takeProfit: 4220 },
  };
}

function simulatedAdapter(execute) {
  // Signature validation has separate tests; this suite isolates the
  // persistent reservation boundary with a fake in-memory executor.
  return {
    verifier: { accept: value => ({ ok: true, code: "ACCEPTED", command: value }) },
    adapter: new CustomerFollowerExecutionAdapter({ execute }),
  };
}

test("durable reservations deny duplicate command and non-monotonic sequence after restart", t => {
  const path = fixture(t);
  const first = new SqliteCustomerFollowerCommandJournal(path, binding);
  assert.deepEqual(first.reserve({ commandId: "one", sequence: 5 }), { ok: true, code: "RESERVED" });
  assert.deepEqual(first.reserve({ commandId: "one", sequence: 5 }), { ok: false, code: "REPLAYED_COMMAND" });
  first.close();

  const restarted = new SqliteCustomerFollowerCommandJournal(path, binding);
  try {
    assert.deepEqual(restarted.reserve({ commandId: "one", sequence: 6 }), { ok: false, code: "REPLAYED_COMMAND" });
    assert.deepEqual(restarted.reserve({ commandId: "older", sequence: 4 }), { ok: false, code: "SEQUENCE_NOT_MONOTONIC" });
    assert.deepEqual(restarted.listReserved(), [{ commandId: "one", sequence: 5, state: "RESERVED" }]);
    restarted.markDispatched("one");
    assert.deepEqual(restarted.listReserved(), []);
    assert.throws(() => restarted.markDispatched("one"), /FOLLOWER_JOURNAL_DISPATCH_TRANSITION_DENIED/);
  } finally {
    restarted.close();
  }
});

test("journal cannot be reopened under another installation or broker identity", t => {
  const path = fixture(t);
  const first = new SqliteCustomerFollowerCommandJournal(path, binding);
  first.close();
  assert.throws(
    () => new SqliteCustomerFollowerCommandJournal(path, { ...binding, mt5Login: binding.mt5Login + 1 }),
    /FOLLOWER_JOURNAL_BINDING_MISMATCH/,
  );
  assert.throws(
    () => new SqliteCustomerFollowerCommandJournal(path, { ...binding, installationId: "other-installation" }),
    /FOLLOWER_JOURNAL_BINDING_MISMATCH/,
  );
});

test("reservation occurs before fake execution and survives restart", async t => {
  const path = fixture(t);
  let executions = 0;
  const runner = simulatedAdapter(async () => { executions++; });
  const firstJournal = new SqliteCustomerFollowerCommandJournal(path, binding);
  const first = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, firstJournal);
  try {
    assert.deepEqual(await first.dispatch(command("open-1", 1)), {
      ok: true, code: "DISPATCHED", commandId: "open-1",
    });
    assert.equal(executions, 1);
  } finally {
    firstJournal.close();
  }
  const secondJournal = new SqliteCustomerFollowerCommandJournal(path, binding);
  try {
    const second = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, secondJournal);
    assert.deepEqual(await second.dispatch(command("open-1", 1)), {
      ok: false, code: "REPLAYED_COMMAND",
    });
    assert.equal(executions, 1);
  } finally {
    secondJournal.close();
  }
});

test("invalid fake execution payload cannot consume a journal sequence", async t => {
  const journal = new SqliteCustomerFollowerCommandJournal(fixture(t), binding);
  const runner = simulatedAdapter(async () => { throw new Error("must not reach fake executor"); });
  try {
    const dispatcher = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, journal);
    const bad = { ...command("bad-open", 10), payload: { side: "BUY", volume: 0 } };
    assert.deepEqual(await dispatcher.dispatch(bad), { ok: false, code: "INVALID_EXECUTION_PAYLOAD" });
    assert.deepEqual(journal.listReserved(), []);
    assert.deepEqual(journal.reserve({ commandId: "safe-next", sequence: 1 }), { ok: true, code: "RESERVED" });
  } finally {
    journal.close();
  }
});

test("uncertain fake executor failure remains RESERVED and cannot be retried", async t => {
  const path = fixture(t);
  const runner = simulatedAdapter(async () => { throw new Error("simulated disconnected executor"); });
  const journal = new SqliteCustomerFollowerCommandJournal(path, binding);
  const dispatcher = new DurableCustomerFollowerDispatcher(runner.verifier, runner.adapter, journal);
  try {
    assert.deepEqual(await dispatcher.dispatch(command("uncertain-2", 2)), {
      ok: false, code: "FOLLOWER_DISPATCH_UNCERTAIN_EXECUTOR_FAILED",
    });
    assert.deepEqual(journal.listReserved(), [{
      commandId: "uncertain-2", sequence: 2, state: "RESERVED",
    }]);
  } finally {
    journal.close();
  }
  const reopened = new SqliteCustomerFollowerCommandJournal(path, binding);
  try {
    assert.deepEqual(reopened.reserve({ commandId: "uncertain-2", sequence: 2 }), {
      ok: false, code: "REPLAYED_COMMAND",
    });
  } finally {
    reopened.close();
  }
});
