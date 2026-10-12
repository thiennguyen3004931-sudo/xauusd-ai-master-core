import { DatabaseSync } from "node:sqlite";
import type { CustomerGrantRegistryRepository } from "@xauusd/customer-grant-registry";
import {
  assertCustomerProductGrantLifecycleRecord,
  type CustomerProductGrantLifecycleRecord,
} from "@xauusd/customer-product-access";
import {
  assertInstallationChallenge,
  type InstallationChallenge,
} from "@xauusd/installation-proof";
import {
  assertLicenseRecord,
  type LicenseRecord,
} from "@xauusd/license-service";
import type { CustomerLicenseResolver } from "@xauusd/customer-runtime-gate";
import type { CustomerRuntimeChallengeStore } from "./session.js";

type SqlRow = Record<string, unknown>;

function canonicalNonBlank(value: string, field: string): void {
  if (value.length === 0 || value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`${field} must be a canonical non-blank string`);
  }
}

function safeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer`);
  }
}

function cloneLicense(record: LicenseRecord): LicenseRecord {
  assertLicenseRecord(record);
  return Object.freeze({
    ...record,
    allowedMt5Logins: Object.freeze([...record.allowedMt5Logins]),
    allowedBrokerServers: Object.freeze([...record.allowedBrokerServers]),
  });
}

function cloneGrant(
  record: CustomerProductGrantLifecycleRecord,
): CustomerProductGrantLifecycleRecord {
  assertCustomerProductGrantLifecycleRecord(record);
  return Object.freeze({
    version: 1,
    grant: Object.freeze({
      ...record.grant,
      allowedBotModes: Object.freeze([...record.grant.allowedBotModes]),
      allowedCopySizingModes: Object.freeze([
        ...record.grant.allowedCopySizingModes,
      ]),
    }),
    status: record.status,
    revokedAt: record.revokedAt,
    revision: record.revision,
  });
}

function parseLicense(payload: unknown): LicenseRecord {
  if (typeof payload !== "string") {
    throw new TypeError("persisted license payload must be text");
  }
  const parsed: unknown = JSON.parse(payload);
  assertLicenseRecord(parsed);
  return cloneLicense(parsed);
}

function parseGrant(payload: unknown): CustomerProductGrantLifecycleRecord {
  if (typeof payload !== "string") {
    throw new TypeError("persisted grant payload must be text");
  }
  const parsed: unknown = JSON.parse(payload);
  assertCustomerProductGrantLifecycleRecord(parsed);
  return cloneGrant(parsed);
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS customer_security_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO customer_security_meta(key, value)
    VALUES ('schema_version', '1');

    CREATE TABLE IF NOT EXISTS customer_license_records (
      license_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_grant_records (
      grant_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_runtime_challenges (
      challenge_id TEXT PRIMARY KEY,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_runtime_challenges_expiry
      ON customer_runtime_challenges(expires_at);
  `);
}

export class SqliteCustomerLicenseRepository
  implements CustomerLicenseResolver
{
  constructor(private readonly db: DatabaseSync) {}

  async get(licenseId: string): Promise<LicenseRecord | null> {
    canonicalNonBlank(licenseId, "licenseId");
    const row = this.db
      .prepare(
        "SELECT payload_json FROM customer_license_records WHERE license_id = ?",
      )
      .get(licenseId) as SqlRow | undefined;

    return row ? parseLicense(row.payload_json) : null;
  }

  async put(record: LicenseRecord): Promise<void> {
    assertLicenseRecord(record);
    this.db
      .prepare(`
        INSERT INTO customer_license_records(license_id, payload_json)
        VALUES (?, ?)
        ON CONFLICT(license_id) DO UPDATE SET
          payload_json = excluded.payload_json
      `)
      .run(record.licenseId, JSON.stringify(record));
  }
}

export class SqliteCustomerGrantRegistryRepository
  implements CustomerGrantRegistryRepository
{
  constructor(private readonly db: DatabaseSync) {}

  async get(
    grantId: string,
  ): Promise<CustomerProductGrantLifecycleRecord | null> {
    canonicalNonBlank(grantId, "grantId");
    const row = this.db
      .prepare(
        "SELECT payload_json FROM customer_grant_records WHERE grant_id = ?",
      )
      .get(grantId) as SqlRow | undefined;

    return row ? parseGrant(row.payload_json) : null;
  }

  async compareAndSet(
    grantId: string,
    expectedRevision: number | null,
    next: CustomerProductGrantLifecycleRecord,
  ): Promise<boolean> {
    canonicalNonBlank(grantId, "grantId");
    assertCustomerProductGrantLifecycleRecord(next);

    if (next.grant.grantId !== grantId) {
      throw new TypeError("repository grantId must match lifecycle grantId");
    }

    if (
      expectedRevision !== null &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0)
    ) {
      throw new TypeError(
        "expectedRevision must be null or a positive safe integer",
      );
    }

    const payload = JSON.stringify(next);

    if (expectedRevision === null) {
      const result = this.db
        .prepare(`
          INSERT OR IGNORE INTO customer_grant_records(
            grant_id,
            revision,
            payload_json
          ) VALUES (?, ?, ?)
        `)
        .run(grantId, next.revision, payload);
      return result.changes === 1;
    }

    const result = this.db
      .prepare(`
        UPDATE customer_grant_records
        SET revision = ?, payload_json = ?
        WHERE grant_id = ? AND revision = ?
      `)
      .run(next.revision, payload, grantId, expectedRevision);

    return result.changes === 1;
  }

  async list(): Promise<readonly CustomerProductGrantLifecycleRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT payload_json FROM customer_grant_records ORDER BY grant_id ASC",
      )
      .all() as SqlRow[];

    return Object.freeze(rows.map((row) => parseGrant(row.payload_json)));
  }
}

export class SqliteCustomerRuntimeChallengeStore
  implements CustomerRuntimeChallengeStore
{
  constructor(private readonly db: DatabaseSync) {}

  async put(challenge: InstallationChallenge): Promise<boolean> {
    assertInstallationChallenge(challenge);

    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO customer_runtime_challenges(
          challenge_id,
          issued_at,
          expires_at,
          consumed_at,
          payload_json
        ) VALUES (?, ?, ?, NULL, ?)
      `)
      .run(
        challenge.challengeId,
        challenge.issuedAt,
        challenge.expiresAt,
        JSON.stringify(challenge),
      );

    return result.changes === 1;
  }

  async consume(challengeId: string, now: number): Promise<boolean> {
    canonicalNonBlank(challengeId, "challengeId");
    safeInteger(now, "now");

    const result = this.db
      .prepare(`
        UPDATE customer_runtime_challenges
        SET consumed_at = ?
        WHERE challenge_id = ?
          AND consumed_at IS NULL
          AND ? >= issued_at
          AND ? <= expires_at
      `)
      .run(now, challengeId, now, now);

    return result.changes === 1;
  }
}

export class SqliteCustomerSecurityStore {
  private readonly db: DatabaseSync;

  readonly licenses: SqliteCustomerLicenseRepository;
  readonly grants: SqliteCustomerGrantRegistryRepository;
  readonly challenges: SqliteCustomerRuntimeChallengeStore;

  constructor(databasePath: string) {
    canonicalNonBlank(databasePath, "databasePath");
    this.db = new DatabaseSync(databasePath);
    initializeSchema(this.db);
    this.licenses = new SqliteCustomerLicenseRepository(this.db);
    this.grants = new SqliteCustomerGrantRegistryRepository(this.db);
    this.challenges = new SqliteCustomerRuntimeChallengeStore(this.db);
  }

  close(): void {
    this.db.close();
  }
}
