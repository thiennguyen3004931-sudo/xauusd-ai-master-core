import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCustomerProductGrantLifecycle,
  issueSelfManagedGrant,
  revokeCustomerProductGrant,
} from "@xauusd/customer-product-access";
import { createInstallationChallenge } from "@xauusd/installation-proof";
import type { LicenseRecord } from "@xauusd/license-service";
import { SqliteCustomerSecurityStore } from "./sqlite-store.js";

const NOW = 12_000_000;
const tempDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "xauusd-customer-security-"));
  tempDirectories.push(directory);
  return join(directory, "customer-security.sqlite");
}

function license(): LicenseRecord {
  return {
    licenseId: "license-durable-001",
    status: "ACTIVE",
    customerId: "customer-durable-001",
    allowedMt5Logins: [770001],
    allowedBrokerServers: ["Broker-Real"],
    installationId: "install-durable-001",
    installationPublicKey: "installation-public-key",
    plan: "CUSTOMER_V1",
    maxAccounts: 1,
    issuedAt: NOW - 10_000,
    expiresAt: NOW + 500_000,
    revokedAt: null,
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("SqliteCustomerSecurityStore", () => {
  it("persists license and grant records across process-style reopen", async () => {
    const path = databasePath();
    const currentLicense = license();
    const lifecycle = createCustomerProductGrantLifecycle(
      issueSelfManagedGrant(currentLicense, {
        grantId: "grant-durable-001",
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 120_000,
        allowedBotModes: ["AUTO"],
      }),
    );

    const first = new SqliteCustomerSecurityStore(path);
    await first.licenses.put(currentLicense);
    expect(
      await first.grants.compareAndSet(
        lifecycle.grant.grantId,
        null,
        lifecycle,
      ),
    ).toBe(true);
    first.close();

    const reopened = new SqliteCustomerSecurityStore(path);
    await expect(reopened.licenses.get(currentLicense.licenseId)).resolves.toEqual(
      currentLicense,
    );
    await expect(reopened.grants.get(lifecycle.grant.grantId)).resolves.toEqual(
      lifecycle,
    );
    reopened.close();
  });

  it("preserves grant compare-and-set revision semantics", async () => {
    const path = databasePath();
    const currentLicense = license();
    const lifecycle = createCustomerProductGrantLifecycle(
      issueSelfManagedGrant(currentLicense, {
        grantId: "grant-cas-001",
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 120_000,
        allowedBotModes: ["AUTO"],
      }),
    );
    const revoked = revokeCustomerProductGrant(lifecycle, NOW + 1);

    const store = new SqliteCustomerSecurityStore(path);
    expect(
      await store.grants.compareAndSet(lifecycle.grant.grantId, null, lifecycle),
    ).toBe(true);
    expect(
      await store.grants.compareAndSet(
        lifecycle.grant.grantId,
        lifecycle.revision + 10,
        revoked,
      ),
    ).toBe(false);
    expect(
      await store.grants.compareAndSet(
        lifecycle.grant.grantId,
        lifecycle.revision,
        revoked,
      ),
    ).toBe(true);
    await expect(store.grants.get(lifecycle.grant.grantId)).resolves.toEqual(
      revoked,
    );
    store.close();
  });

  it("persists one-time challenge consumption across reopen", async () => {
    const path = databasePath();
    const challenge = createInstallationChallenge({
      purpose: "RECONNECT",
      licenseId: "license-durable-001",
      installationId: "install-durable-001",
      now: NOW,
      ttlMs: 60_000,
    });

    const first = new SqliteCustomerSecurityStore(path);
    await expect(first.challenges.put(challenge)).resolves.toBe(true);
    first.close();

    const reopened = new SqliteCustomerSecurityStore(path);
    await expect(reopened.challenges.put(challenge)).resolves.toBe(false);
    await expect(
      reopened.challenges.consume(challenge.challengeId, NOW + 1_000),
    ).resolves.toBe(true);
    reopened.close();

    const third = new SqliteCustomerSecurityStore(path);
    await expect(
      third.challenges.consume(challenge.challengeId, NOW + 2_000),
    ).resolves.toBe(false);
    third.close();
  });

  it("fails closed when consuming an expired or not-yet-valid challenge", async () => {
    const path = databasePath();
    const challenge = createInstallationChallenge({
      purpose: "RECONNECT",
      licenseId: "license-durable-001",
      installationId: "install-durable-001",
      now: NOW,
      ttlMs: 60_000,
    });

    const store = new SqliteCustomerSecurityStore(path);
    await expect(store.challenges.put(challenge)).resolves.toBe(true);
    await expect(
      store.challenges.consume(challenge.challengeId, NOW - 1),
    ).resolves.toBe(false);
    await expect(
      store.challenges.consume(challenge.challengeId, challenge.expiresAt + 1),
    ).resolves.toBe(false);
    store.close();
  });
});
