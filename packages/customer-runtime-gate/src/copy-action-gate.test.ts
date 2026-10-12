import { describe, expect, it } from "vitest";
import {
  InMemoryCustomerGrantRegistryRepository,
  registerCustomerGrant,
  revokeRegisteredCustomerGrant,
  type CustomerGrantRegistryRepository,
} from "@xauusd/customer-grant-registry";
import {
  createCustomerProductGrantLifecycle,
  issueCopyFollowerGrant,
  issueSelfManagedGrant,
} from "@xauusd/customer-product-access";
import type { LicenseRecord } from "@xauusd/license-service";
import {
  authorizeCopyFollowerRuntimeAction,
  type CustomerCopyActionSecurityServices,
  type CustomerCopyRuntimeActionRequest,
} from "./copy-action-gate.js";
import type { CustomerLicenseResolver } from "./runtime-gate.js";

const NOW = 8_000_000;

function license(status: LicenseRecord["status"] = "ACTIVE"): LicenseRecord {
  return {
    licenseId: "license-copy-action-001",
    status,
    customerId: "customer-copy-action-001",
    allowedMt5Logins: [990001],
    allowedBrokerServers: ["Broker-Real"],
    installationId: "install-copy-action-001",
    installationPublicKey: "device-public-key-placeholder",
    plan: "CUSTOMER_V1",
    maxAccounts: 1,
    issuedAt: NOW - 100_000,
    expiresAt: NOW + 100_000,
    revokedAt: status === "REVOKED" ? NOW - 1_000 : null,
  };
}

function resolver(
  value: unknown | null,
  seen: string[] = [],
): CustomerLicenseResolver {
  return {
    async get(licenseId) {
      seen.push(licenseId);
      return value;
    },
  };
}

function security(
  times: readonly number[] = [NOW, NOW],
): CustomerCopyActionSecurityServices {
  let index = 0;
  return {
    now() {
      const value = times[Math.min(index, times.length - 1)];
      index += 1;
      return value;
    },
  };
}

async function registeredCopyGrant(
  repository: InMemoryCustomerGrantRegistryRepository,
  currentLicense: LicenseRecord,
) {
  const lifecycle = createCustomerProductGrantLifecycle(
    issueCopyFollowerGrant(currentLicense, {
      grantId: "grant-copy-action-001",
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 10_000,
      allowedCopySizingModes: ["EQUITY_RATIO"],
    }),
  );
  await expect(registerCustomerGrant(repository, lifecycle)).resolves.toMatchObject({
    ok: true,
    code: "REGISTERED",
  });
  return lifecycle;
}

function request(
  overrides: Partial<CustomerCopyRuntimeActionRequest> = {},
): CustomerCopyRuntimeActionRequest {
  return {
    grantId: "grant-copy-action-001",
    licenseId: "license-copy-action-001",
    installationId: "install-copy-action-001",
    mt5Login: 990001,
    brokerServer: "Broker-Real",
    action: "POSITION_OPEN",
    masterPositionRef: "master-pos-001",
    ...overrides,
  };
}

const matchedBuyPosition = {
  masterPositionRef: "master-pos-001",
  side: "BUY" as const,
  currentStopLoss: 4386,
  requestedStopLoss: 4388,
};

describe("COPY_FOLLOWER per-command runtime gate", () => {
  it("authorizes new exposure only with current active grant and license", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);
    const lookups: string[] = [];

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense, lookups),
        security(),
        request(),
      ),
    ).resolves.toEqual({
      ok: true,
      code: "AUTHORIZED",
      grantStatus: "ACTIVE",
      effectiveLicenseStatus: "ACTIVE",
      exposureAllowed: true,
    });

    expect(lookups).toEqual([
      currentLicense.licenseId,
      currentLicense.licenseId,
    ]);
  });

  it("rejects caller-supplied now before any source access", async () => {
    let registryCalls = 0;
    let licenseCalls = 0;
    const repository: CustomerGrantRegistryRepository = {
      async get() {
        registryCalls += 1;
        return null;
      },
      async compareAndSet() {
        throw new Error("must not write");
      },
      async list() {
        throw new Error("must not list");
      },
    };

    const decision = await authorizeCopyFollowerRuntimeAction(
      repository,
      {
        async get() {
          licenseCalls += 1;
          return null;
        },
      },
      security(),
      { ...request(), now: NOW },
    );

    expect(decision).toEqual({
      ok: false,
      code: "INVALID_RUNTIME_ACTION_REQUEST",
    });
    expect(registryCalls).toBe(0);
    expect(licenseCalls).toBe(0);
  });

  it("blocks POSITION_OPEN immediately after the current grant is revoked", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);
    await revokeRegisteredCustomerGrant(
      repository,
      "grant-copy-action-001",
      NOW - 1,
    );

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security(),
        request(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "GRANT_NOT_ACTIVE",
      grantStatus: "REVOKED",
      effectiveLicenseStatus: "ACTIVE",
    });
  });

  it.each(["PARTIAL_CLOSE", "POSITION_CLOSE", "POSITION_SNAPSHOT"] as const)(
    "keeps matched risk-reducing/reconcile action %s available after grant revoke",
    async (action) => {
      const repository = new InMemoryCustomerGrantRegistryRepository();
      const currentLicense = license();
      await registeredCopyGrant(repository, currentLicense);
      await revokeRegisteredCustomerGrant(
        repository,
        "grant-copy-action-001",
        NOW - 1,
      );

      await expect(
        authorizeCopyFollowerRuntimeAction(
          repository,
          resolver(currentLicense),
          security([NOW]),
          request({
            action,
            existingPosition: matchedBuyPosition,
          }),
        ),
      ).resolves.toEqual({
        ok: true,
        code: "AUTHORIZED",
        grantStatus: "REVOKED",
        effectiveLicenseStatus: "ACTIVE",
        exposureAllowed: false,
      });
    },
  );

  it("blocks take-profit changes after grant revoke", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);
    await revokeRegisteredCustomerGrant(
      repository,
      "grant-copy-action-001",
      NOW - 1,
    );

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({
          action: "TAKE_PROFIT_UPDATE",
          existingPosition: matchedBuyPosition,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "ACTION_NOT_ALLOWED_FOR_GRANT_STATE",
      grantStatus: "REVOKED",
    });
  });

  it("allows only non-loosening stop-loss changes after grant revoke", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);
    await revokeRegisteredCustomerGrant(
      repository,
      "grant-copy-action-001",
      NOW - 1,
    );

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({
          action: "STOP_LOSS_UPDATE",
          existingPosition: matchedBuyPosition,
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      code: "AUTHORIZED",
      grantStatus: "REVOKED",
      exposureAllowed: false,
    });

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({
          action: "STOP_LOSS_UPDATE",
          existingPosition: {
            ...matchedBuyPosition,
            requestedStopLoss: 4385,
          },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "STOP_LOSS_NOT_RISK_REDUCING",
      grantStatus: "REVOKED",
    });
  });

  it("requires an existing matched position for safe actions after grant revoke", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);
    await revokeRegisteredCustomerGrant(
      repository,
      "grant-copy-action-001",
      NOW - 1,
    );

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({ action: "POSITION_CLOSE" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "EXISTING_POSITION_REQUIRED",
      grantStatus: "REVOKED",
    });

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({
          action: "POSITION_CLOSE",
          existingPosition: {
            ...matchedBuyPosition,
            masterPositionRef: "master-pos-other",
          },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "POSITION_MISMATCH",
      grantStatus: "REVOKED",
    });
  });

  it("also obeys the license non-active safety matrix", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const activeLicense = license();
    await registeredCopyGrant(repository, activeLicense);
    const suspended: LicenseRecord = {
      ...activeLicense,
      status: "SUSPENDED",
      revokedAt: null,
    };

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(suspended),
        security([NOW]),
        request(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "LICENSE_NOT_ACTIVE",
      effectiveLicenseStatus: "SUSPENDED",
    });

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(suspended),
        security([NOW]),
        request({
          action: "POSITION_CLOSE",
          existingPosition: matchedBuyPosition,
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      code: "AUTHORIZED",
      grantStatus: "ACTIVE",
      effectiveLicenseStatus: "SUSPENDED",
      exposureAllowed: false,
    });
  });

  it("rejects a license/grant identity mismatch", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request({ licenseId: "license-other" }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "LICENSE_GRANT_MISMATCH",
    });
  });

  it("rejects a SELF_MANAGED grant through the copy action gate", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    const lifecycle = createCustomerProductGrantLifecycle(
      issueSelfManagedGrant(currentLicense, {
        grantId: "grant-copy-action-001",
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 10_000,
        allowedBotModes: ["AUTO"],
      }),
    );
    await registerCustomerGrant(repository, lifecycle);

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW]),
        request(),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "PRODUCT_MODE_MISMATCH",
    });
  });

  it("fails closed if grant state changes before a new exposure decision returns", async () => {
    const currentLicense = license();
    const active = createCustomerProductGrantLifecycle(
      issueCopyFollowerGrant(currentLicense, {
        grantId: "grant-copy-action-001",
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 10_000,
        allowedCopySizingModes: ["EQUITY_RATIO"],
      }),
    );
    const revoked = {
      ...active,
      status: "REVOKED" as const,
      revokedAt: NOW,
      revision: 2,
    };

    let reads = 0;
    const repository: CustomerGrantRegistryRepository = {
      async get() {
        reads += 1;
        return reads === 1 ? active : revoked;
      },
      async compareAndSet() {
        throw new Error("must not write");
      },
      async list() {
        throw new Error("must not list");
      },
    };

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security(),
        request(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "RUNTIME_STATE_CHANGED",
    });
    expect(reads).toBe(2);
  });

  it("fails closed if server time crosses grant expiry before POSITION_OPEN returns", async () => {
    const repository = new InMemoryCustomerGrantRegistryRepository();
    const currentLicense = license();
    await registeredCopyGrant(repository, currentLicense);

    await expect(
      authorizeCopyFollowerRuntimeAction(
        repository,
        resolver(currentLicense),
        security([NOW, NOW + 20_000]),
        request(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "RUNTIME_STATE_CHANGED",
    });
  });
});
