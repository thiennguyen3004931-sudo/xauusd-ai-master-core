import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { toCustomerFollowerExecutionRequest } from "@xauusd/customer-agent";
import type {
  CustomerCopyCommandBinding,
  CustomerCopyCommandVerifier,
  CustomerFollowerExecutionAdapter,
} from "@xauusd/customer-agent";

export interface FollowerCommandReservation {
  readonly commandId: string;
  readonly sequence: number;
}

export type FollowerCommandReservationDecision =
  | { readonly ok: true; readonly code: "RESERVED" }
  | { readonly ok: false; readonly code: "REPLAYED_COMMAND" | "SEQUENCE_NOT_MONOTONIC" };

export interface FollowerCommandJournalRecord extends FollowerCommandReservation {
  readonly state: "RESERVED" | "DISPATCHED";
}

function canonical(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export class SqliteCustomerFollowerCommandJournal {
  private readonly db: DatabaseSync;

  constructor(databasePath: string, binding: CustomerCopyCommandBinding) {
    if (!canonical(databasePath)) throw new TypeError("databasePath must be canonical");
    if (!canonical(binding.licenseId) || !canonical(binding.installationId) ||
        !canonical(binding.brokerServer) || !Number.isSafeInteger(binding.mt5Login) ||
        binding.mt5Login <= 0 || !Array.isArray(binding.allowedSymbols) ||
        binding.allowedSymbols.length === 0 || binding.allowedSymbols.some((x) => !canonical(x))) {
      throw new TypeError("copy follower identity binding invalid");
    }
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    this.db = new DatabaseSync(resolve(databasePath));
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS follower_binding (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS follower_command_journal (
          command_id TEXT PRIMARY KEY,
          sequence INTEGER UNIQUE NOT NULL CHECK(sequence > 0),
          state TEXT NOT NULL CHECK(state IN ('RESERVED', 'DISPATCHED'))
        );
      `);
      const snapshot = JSON.stringify({
        licenseId: binding.licenseId,
        installationId: binding.installationId,
        mt5Login: binding.mt5Login,
        brokerServer: binding.brokerServer,
        allowedSymbols: [...binding.allowedSymbols].sort(),
      });
      this.db.prepare("INSERT OR IGNORE INTO follower_binding(id, payload) VALUES (1, ?)").run(snapshot);
      const actual = this.db.prepare("SELECT payload FROM follower_binding WHERE id = 1").get() as
        | { payload: string } | undefined;
      if (actual?.payload !== snapshot) throw new Error("FOLLOWER_JOURNAL_BINDING_MISMATCH");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  // Reservation happens *before* any broker-facing executor call.
  // Any crash leaves RESERVED, never silently retries a potentially executed order.
  reserve(request: FollowerCommandReservation): FollowerCommandReservationDecision {
    if (!canonical(request.commandId) ||
        !Number.isSafeInteger(request.sequence) || request.sequence <= 0) {
      throw new TypeError("command reservation invalid");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const already = this.db.prepare("SELECT 1 FROM follower_command_journal WHERE command_id = ?")
        .get(request.commandId);
      if (already) {
        this.db.exec("ROLLBACK");
        return { ok: false, code: "REPLAYED_COMMAND" };
      }
      const row = this.db.prepare("SELECT MAX(sequence) AS lastSequence FROM follower_command_journal")
        .get() as { lastSequence: number | null };
      if (row.lastSequence !== null && request.sequence <= row.lastSequence) {
        this.db.exec("ROLLBACK");
        return { ok: false, code: "SEQUENCE_NOT_MONOTONIC" };
      }
      this.db.prepare("INSERT INTO follower_command_journal(command_id, sequence, state) VALUES (?, ?, 'RESERVED')")
        .run(request.commandId, request.sequence);
      this.db.exec("COMMIT");
      return { ok: true, code: "RESERVED" };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw error;
    }
  }

  markDispatched(commandId: string): void {
    if (!canonical(commandId)) throw new TypeError("commandId must be canonical");
    const result = this.db.prepare(
      "UPDATE follower_command_journal SET state = 'DISPATCHED' WHERE command_id = ? AND state = 'RESERVED'",
    ).run(commandId);
    if (result.changes !== 1) throw new Error("FOLLOWER_JOURNAL_DISPATCH_TRANSITION_DENIED");
  }

  listReserved(): readonly FollowerCommandJournalRecord[] {
    // node:sqlite returns null-prototype rows. Expose ordinary records to
    // callers without changing the persisted reservation or replay semantics.
    const rows = this.db.prepare(
      "SELECT command_id AS commandId, sequence, state FROM follower_command_journal WHERE state = 'RESERVED' ORDER BY sequence ASC",
    ).all() as unknown as readonly FollowerCommandJournalRecord[];
    return rows.map(({ commandId, sequence, state }) => ({ commandId, sequence, state }));
  }

  close(): void {
    this.db.close();
  }
}

export class DurableCustomerFollowerDispatcher {
  constructor(
    private readonly verifier: CustomerCopyCommandVerifier,
    private readonly adapter: CustomerFollowerExecutionAdapter,
    private readonly journal: SqliteCustomerFollowerCommandJournal,
  ) {}

  async dispatch(signedCommand: unknown): Promise<
    | { readonly ok: true; readonly code: "DISPATCHED"; readonly commandId: string }
    | { readonly ok: false; readonly code: string }
  > {
    const verified = this.verifier.accept(signedCommand);
    if (!verified.ok) return { ok: false, code: verified.code };

    // Reject malformed payload without reserving a broker slot.
    // The execution adapter separately rechecks this strict contract.
    if (toCustomerFollowerExecutionRequest(verified.command) === null) {
      return { ok: false, code: "INVALID_EXECUTION_PAYLOAD" };
    }
    const reserved = this.journal.reserve({
      commandId: verified.command.commandId,
      sequence: verified.command.sequence,
    });
    if (!reserved.ok) return reserved;

    const result = await this.adapter.dispatch(verified);
    if (!result.ok) {
      // Unknown broker status must be reconciled by an operator; never
      // retry this command ID on restart.
      return { ok: false, code: "FOLLOWER_DISPATCH_UNCERTAIN_" + result.code };
    }
    this.journal.markDispatched(verified.command.commandId);
    return { ok: true, code: "DISPATCHED", commandId: verified.command.commandId };
  }
}
