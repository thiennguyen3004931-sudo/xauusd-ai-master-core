import {
  activateCopyFollowerCustomer,
  activateSelfManagedCustomer,
  type CopyFollowerActivationRequest,
  type CustomerActivationDecision,
  type SelfManagedActivationRequest,
} from "@xauusd/customer-activation";
import type { CustomerGrantRegistryRepository } from "@xauusd/customer-grant-registry";
import {
  COPY_FOLLOWER_SIZING_MODES,
  SELF_MANAGED_BOT_MODES,
  assertCustomerProductGrantLifecycleRecord,
  type CustomerProductGrantLifecycleRecord,
} from "@xauusd/customer-product-access";
import {
  assertLicenseRecord,
  type LicenseRecord,
} from "@xauusd/license-service";

export interface CustomerLicenseResolver {
  get(licenseId: string): Promise<unknown | null>;
}

export interface SelfManagedRuntimeActivationRequest
  extends SelfManagedActivationRequest {
  readonly grantId: string;
}

export interface CopyFollowerRuntimeActivationRequest
  extends CopyFollowerActivationRequest {
  readonly grantId: string;
}

type RuntimeContextFailure = {
  readonly ok: false;
  readonly code:
    | "GRANT_NOT_FOUND"
    | "INVALID_GRANT_SOURCE"
    | "PRODUCT_MODE_MISMATCH"
    | "LICENSE_NOT_FOUND"
    | "INVALID_LICENSE_SOURCE";
};

export type CustomerRuntimeActivationDecision =
  | CustomerActivationDecision
  | RuntimeContextFailure
  | {
      readonly ok: false;
      readonly code: "INVALID_RUNTIME_REQUEST";
    };

type ProductMode = "SELF_MANAGED" | "COPY_FOLLOWER";

const SELF_MANAGED_KEYS = new Set([
  "grantId",
  "installationId",
  "mt5Login",
  "brokerServer",
  "now",
  "requestedBotMode",
  "proof",
  "consumeOnce",
]);

const COPY_FOLLOWER_KEYS = new Set([
  "grantId",
  "installationId",
  "mt5Login",
  "brokerServer",
  "now",
  "requestedSizingMode",
  "proof",
  "consumeOnce",
]);

function isCanonicalNonBlankString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.trim() === value
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  if (keys.length !== required.size) return false;
  return keys.every((key) => required.has(key));
}

function isValidBaseRequest(
  request: Record<string, unknown>,
  required: ReadonlySet<string>,
): boolean {
  return (
    hasExactKeys(request, required) &&
    isCanonicalNonBlankString(request.grantId) &&
    isCanonicalNonBlankString(request.installationId) &&
    isPositiveSafeInteger(request.mt5Login) &&
    isCanonicalNonBlankString(request.brokerServer) &&
    isSafeInteger(request.now) &&
    typeof request.consumeOnce === "function"
  );
}

function isSelfManagedRuntimeRequest(
  value: unknown,
): value is SelfManagedRuntimeActivationRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;
  return (
    isValidBaseRequest(request, SELF_MANAGED_KEYS) &&
    SELF_MANAGED_BOT_MODES.includes(
      request.requestedBotMode as (typeof SELF_MANAGED_BOT_MODES)[number],
    )
  );
}

function isCopyFollowerRuntimeRequest(
  value: unknown,
): value is CopyFollowerRuntimeActivationRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;
  return (
    isValidBaseRequest(request, COPY_FOLLOWER_KEYS) &&
    COPY_FOLLOWER_SIZING_MODES.includes(
      request.requestedSizingMode as (typeof COPY_FOLLOWER_SIZING_MODES)[number],
    )
  );
}

async function loadCurrentRuntimeContext(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  grantId: string,
  expectedMode: ProductMode,
): Promise<
  | {
      readonly ok: true;
      readonly lifecycle: CustomerProductGrantLifecycleRecord;
      readonly license: LicenseRecord;
    }
  | RuntimeContextFailure
> {
  const lifecycle = await registry.get(grantId);
  if (!lifecycle) {
    return { ok: false, code: "GRANT_NOT_FOUND" };
  }

  try {
    assertCustomerProductGrantLifecycleRecord(lifecycle);
  } catch {
    return { ok: false, code: "INVALID_GRANT_SOURCE" };
  }

  if (lifecycle.grant.productMode !== expectedMode) {
    return { ok: false, code: "PRODUCT_MODE_MISMATCH" };
  }

  const rawLicense = await licenses.get(lifecycle.grant.licenseId);
  if (rawLicense === null) {
    return { ok: false, code: "LICENSE_NOT_FOUND" };
  }

  try {
    assertLicenseRecord(rawLicense);
  } catch {
    return { ok: false, code: "INVALID_LICENSE_SOURCE" };
  }

  if (rawLicense.licenseId !== lifecycle.grant.licenseId) {
    return { ok: false, code: "INVALID_LICENSE_SOURCE" };
  }

  return {
    ok: true,
    lifecycle,
    license: rawLicense,
  };
}

export async function activateSelfManagedRuntime(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  request: unknown,
): Promise<CustomerRuntimeActivationDecision> {
  if (!isSelfManagedRuntimeRequest(request)) {
    return { ok: false, code: "INVALID_RUNTIME_REQUEST" };
  }

  const context = await loadCurrentRuntimeContext(
    registry,
    licenses,
    request.grantId,
    "SELF_MANAGED",
  );

  if (!context.ok) {
    return context;
  }

  return activateSelfManagedCustomer(
    context.license,
    context.lifecycle,
    {
      installationId: request.installationId,
      mt5Login: request.mt5Login,
      brokerServer: request.brokerServer,
      now: request.now,
      requestedBotMode: request.requestedBotMode,
      proof: request.proof,
      consumeOnce: request.consumeOnce,
    },
  );
}

export async function activateCopyFollowerRuntime(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  request: unknown,
): Promise<CustomerRuntimeActivationDecision> {
  if (!isCopyFollowerRuntimeRequest(request)) {
    return { ok: false, code: "INVALID_RUNTIME_REQUEST" };
  }

  const context = await loadCurrentRuntimeContext(
    registry,
    licenses,
    request.grantId,
    "COPY_FOLLOWER",
  );

  if (!context.ok) {
    return context;
  }

  return activateCopyFollowerCustomer(
    context.license,
    context.lifecycle,
    {
      installationId: request.installationId,
      mt5Login: request.mt5Login,
      brokerServer: request.brokerServer,
      now: request.now,
      requestedSizingMode: request.requestedSizingMode,
      proof: request.proof,
      consumeOnce: request.consumeOnce,
    },
  );
}
