import type { CustomerGrantRegistryRepository } from "@xauusd/customer-grant-registry";
import {
  assertCustomerProductGrantLifecycleRecord,
  effectiveCustomerGrantStatus,
  type CustomerProductGrantLifecycleRecord,
  type EffectiveCustomerGrantStatus,
} from "@xauusd/customer-product-access";
import {
  assertLicenseRecord,
  authorizeLicenseAction,
  effectiveLicenseStatus,
  type ExistingPositionContext,
  type LicenseActionRequest,
  type LicenseRecord,
  type LicenseStatus,
} from "@xauusd/license-service";
import type { CustomerLicenseResolver } from "./runtime-gate.js";

export interface CustomerCopyActionSecurityServices {
  readonly now: () => number;
}

export interface CustomerCopyRuntimeActionRequest
  extends Omit<LicenseActionRequest, "now"> {
  readonly grantId: string;
  readonly licenseId: string;
}

export type CustomerCopyRuntimeActionDecision =
  | {
      readonly ok: true;
      readonly code: "AUTHORIZED";
      readonly grantStatus: EffectiveCustomerGrantStatus;
      readonly effectiveLicenseStatus: LicenseStatus;
      readonly exposureAllowed: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_RUNTIME_ACTION_REQUEST"
        | "INVALID_RUNTIME_SECURITY_CONTEXT"
        | "GRANT_NOT_FOUND"
        | "INVALID_GRANT_SOURCE"
        | "PRODUCT_MODE_MISMATCH"
        | "LICENSE_NOT_FOUND"
        | "INVALID_LICENSE_SOURCE"
        | "LICENSE_GRANT_MISMATCH"
        | "GRANT_NOT_ACTIVE"
        | "ACTION_NOT_ALLOWED_FOR_GRANT_STATE"
        | "RUNTIME_STATE_CHANGED"
        | "INVALID_LICENSE_RECORD"
        | "INVALID_REQUEST"
        | "LICENSE_NOT_YET_VALID"
        | "INSTALLATION_MISMATCH"
        | "MT5_LOGIN_NOT_ALLOWED"
        | "BROKER_SERVER_NOT_ALLOWED"
        | "LICENSE_NOT_ACTIVE"
        | "ACTION_NOT_ALLOWED_FOR_LICENSE_STATE"
        | "EXISTING_POSITION_REQUIRED"
        | "POSITION_MISMATCH"
        | "STOP_LOSS_CONTEXT_REQUIRED"
        | "STOP_LOSS_NOT_RISK_REDUCING";
      readonly grantStatus?: EffectiveCustomerGrantStatus;
      readonly effectiveLicenseStatus?: LicenseStatus;
    };

const ACTION_REQUEST_KEYS = new Set([
  "grantId",
  "licenseId",
  "installationId",
  "mt5Login",
  "brokerServer",
  "action",
  "masterPositionRef",
  "existingPosition",
]);

function isCanonicalNonBlankString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.trim() === value
  );
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isRuntimeActionRequest(
  value: unknown,
): value is CustomerCopyRuntimeActionRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;
  for (const key of Object.keys(request)) {
    if (!ACTION_REQUEST_KEYS.has(key)) return false;
  }

  for (const key of [
    "grantId",
    "licenseId",
    "installationId",
    "mt5Login",
    "brokerServer",
    "action",
    "masterPositionRef",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(request, key)) return false;
  }

  return (
    isCanonicalNonBlankString(request.grantId) &&
    isCanonicalNonBlankString(request.licenseId)
  );
}

function resolveSecurity(
  value: unknown,
): CustomerCopyActionSecurityServices | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<CustomerCopyActionSecurityServices>;
  return typeof candidate.now === "function"
    ? (candidate as CustomerCopyActionSecurityServices)
    : null;
}

function readServerNow(
  security: CustomerCopyActionSecurityServices,
): number | null {
  try {
    const now = security.now();
    return isSafeInteger(now) ? now : null;
  } catch {
    return null;
  }
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameNumberArray(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameLifecycleSnapshot(
  left: CustomerProductGrantLifecycleRecord,
  right: CustomerProductGrantLifecycleRecord,
): boolean {
  return (
    left.version === right.version &&
    left.status === right.status &&
    left.revokedAt === right.revokedAt &&
    left.revision === right.revision &&
    left.grant.version === right.grant.version &&
    left.grant.grantId === right.grant.grantId &&
    left.grant.licenseId === right.grant.licenseId &&
    left.grant.customerId === right.grant.customerId &&
    left.grant.productMode === right.grant.productMode &&
    left.grant.installationId === right.grant.installationId &&
    sameStringArray(left.grant.allowedBotModes, right.grant.allowedBotModes) &&
    sameStringArray(
      left.grant.allowedCopySizingModes,
      right.grant.allowedCopySizingModes,
    ) &&
    left.grant.issuedAt === right.grant.issuedAt &&
    left.grant.expiresAt === right.grant.expiresAt
  );
}

function sameLicenseSnapshot(
  left: LicenseRecord,
  right: LicenseRecord,
): boolean {
  return (
    left.licenseId === right.licenseId &&
    left.status === right.status &&
    left.customerId === right.customerId &&
    sameNumberArray(left.allowedMt5Logins, right.allowedMt5Logins) &&
    sameStringArray(left.allowedBrokerServers, right.allowedBrokerServers) &&
    left.installationId === right.installationId &&
    left.installationPublicKey === right.installationPublicKey &&
    left.plan === right.plan &&
    left.maxAccounts === right.maxAccounts &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt &&
    left.revokedAt === right.revokedAt
  );
}

async function loadContext(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  grantId: string,
): Promise<
  | {
      readonly ok: true;
      readonly lifecycle: CustomerProductGrantLifecycleRecord;
      readonly license: LicenseRecord;
    }
  | CustomerCopyRuntimeActionDecision
> {
  let lifecycle: CustomerProductGrantLifecycleRecord | null;
  try {
    lifecycle = await registry.get(grantId);
  } catch {
    return { ok: false, code: "INVALID_GRANT_SOURCE" };
  }

  if (!lifecycle) {
    return { ok: false, code: "GRANT_NOT_FOUND" };
  }

  try {
    assertCustomerProductGrantLifecycleRecord(lifecycle);
  } catch {
    return { ok: false, code: "INVALID_GRANT_SOURCE" };
  }

  if (lifecycle.grant.productMode !== "COPY_FOLLOWER") {
    return { ok: false, code: "PRODUCT_MODE_MISMATCH" };
  }

  let rawLicense: unknown | null;
  try {
    rawLicense = await licenses.get(lifecycle.grant.licenseId);
  } catch {
    return { ok: false, code: "INVALID_LICENSE_SOURCE" };
  }

  if (rawLicense === null) {
    return { ok: false, code: "LICENSE_NOT_FOUND" };
  }

  try {
    assertLicenseRecord(rawLicense);
  } catch {
    return { ok: false, code: "INVALID_LICENSE_SOURCE" };
  }

  return { ok: true, lifecycle, license: rawLicense };
}

function isNonLooseningStopUpdate(
  position: ExistingPositionContext,
): boolean {
  const next = position.requestedStopLoss;
  if (next === undefined || !Number.isFinite(next) || next <= 0) {
    return false;
  }
  if (position.currentStopLoss === null) {
    return true;
  }
  return position.side === "BUY"
    ? next >= position.currentStopLoss
    : next <= position.currentStopLoss;
}

function inactiveGrantRiskReductionFailure(
  request: CustomerCopyRuntimeActionRequest,
): CustomerCopyRuntimeActionDecision | null {
  if (request.action === "POSITION_OPEN") {
    return { ok: false, code: "GRANT_NOT_ACTIVE" };
  }

  if (request.action === "TAKE_PROFIT_UPDATE") {
    return { ok: false, code: "ACTION_NOT_ALLOWED_FOR_GRANT_STATE" };
  }

  const position = request.existingPosition;
  if (position === undefined) {
    return { ok: false, code: "EXISTING_POSITION_REQUIRED" };
  }

  if (position.masterPositionRef !== request.masterPositionRef) {
    return { ok: false, code: "POSITION_MISMATCH" };
  }

  if (request.action === "STOP_LOSS_UPDATE") {
    if (position.requestedStopLoss === undefined) {
      return { ok: false, code: "STOP_LOSS_CONTEXT_REQUIRED" };
    }
    if (!isNonLooseningStopUpdate(position)) {
      return { ok: false, code: "STOP_LOSS_NOT_RISK_REDUCING" };
    }
  }

  return null;
}

async function newExposureStateRemainsCurrent(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  lifecycle: CustomerProductGrantLifecycleRecord,
  license: LicenseRecord,
  now: number,
): Promise<boolean> {
  let currentLifecycle: CustomerProductGrantLifecycleRecord | null;
  try {
    currentLifecycle = await registry.get(lifecycle.grant.grantId);
  } catch {
    return false;
  }
  if (!currentLifecycle) return false;

  try {
    assertCustomerProductGrantLifecycleRecord(currentLifecycle);
  } catch {
    return false;
  }

  if (!sameLifecycleSnapshot(lifecycle, currentLifecycle)) {
    return false;
  }

  let currentLicense: unknown | null;
  try {
    currentLicense = await licenses.get(license.licenseId);
  } catch {
    return false;
  }
  if (currentLicense === null) return false;

  try {
    assertLicenseRecord(currentLicense);
  } catch {
    return false;
  }

  return (
    sameLicenseSnapshot(license, currentLicense) &&
    effectiveCustomerGrantStatus(currentLifecycle, now) === "ACTIVE" &&
    effectiveLicenseStatus(currentLicense, now) === "ACTIVE"
  );
}

export async function authorizeCopyFollowerRuntimeAction(
  registry: CustomerGrantRegistryRepository,
  licenses: CustomerLicenseResolver,
  securityInput: unknown,
  requestInput: unknown,
): Promise<CustomerCopyRuntimeActionDecision> {
  if (!isRuntimeActionRequest(requestInput)) {
    return { ok: false, code: "INVALID_RUNTIME_ACTION_REQUEST" };
  }

  const security = resolveSecurity(securityInput);
  const now = security ? readServerNow(security) : null;
  if (!security || now === null) {
    return { ok: false, code: "INVALID_RUNTIME_SECURITY_CONTEXT" };
  }

  const context = await loadContext(
    registry,
    licenses,
    requestInput.grantId,
  );
  if (!context.ok) {
    return context;
  }

  const { lifecycle, license } = context;
  const grant = lifecycle.grant;

  if (
    requestInput.licenseId !== grant.licenseId ||
    grant.licenseId !== license.licenseId ||
    grant.customerId !== license.customerId ||
    grant.installationId !== license.installationId ||
    grant.issuedAt < license.issuedAt ||
    grant.expiresAt > license.expiresAt
  ) {
    return { ok: false, code: "LICENSE_GRANT_MISMATCH" };
  }

  const licenseDecision = authorizeLicenseAction(license, {
    installationId: requestInput.installationId,
    mt5Login: requestInput.mt5Login,
    brokerServer: requestInput.brokerServer,
    action: requestInput.action,
    masterPositionRef: requestInput.masterPositionRef,
    now,
    ...(requestInput.existingPosition === undefined
      ? {}
      : { existingPosition: requestInput.existingPosition }),
  });

  if (!licenseDecision.ok) {
    return {
      ...licenseDecision,
      grantStatus: effectiveCustomerGrantStatus(lifecycle, now),
    };
  }

  const grantStatus = effectiveCustomerGrantStatus(lifecycle, now);
  if (grantStatus !== "ACTIVE") {
    const riskFailure = inactiveGrantRiskReductionFailure(requestInput);
    if (riskFailure) {
      return {
        ...riskFailure,
        grantStatus,
        effectiveLicenseStatus: licenseDecision.effectiveStatus,
      };
    }
  }

  if (requestInput.action === "POSITION_OPEN") {
    const finalNow = readServerNow(security);
    if (
      finalNow === null ||
      finalNow < now ||
      !(await newExposureStateRemainsCurrent(
        registry,
        licenses,
        lifecycle,
        license,
        finalNow,
      ))
    ) {
      return {
        ok: false,
        code: "RUNTIME_STATE_CHANGED",
        grantStatus,
        effectiveLicenseStatus: licenseDecision.effectiveStatus,
      };
    }
  }

  return {
    ok: true,
    code: "AUTHORIZED",
    grantStatus,
    effectiveLicenseStatus: licenseDecision.effectiveStatus,
    exposureAllowed: requestInput.action === "POSITION_OPEN",
  };
}
