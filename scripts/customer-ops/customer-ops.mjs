import { readFile } from "node:fs/promises";
import { createCustomerProductGrantLifecycle, issueCopyFollowerGrant, issueSelfManagedGrant } from "../../packages/customer-product-access/dist/index.js";
import { registerCustomerGrant, revokeRegisteredCustomerGrant } from "../../packages/customer-grant-registry/dist/index.js";
import { assertLicenseRecord } from "../../packages/license-service/dist/index.js";
import {
  CustomerApiGateway,
  InMemoryFixedWindowCustomerApiRateLimiter,
  Sha256CustomerApiKeyAuthenticator,
} from "../../packages/customer-runtime-session/dist/index.js";

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(name + " must be a JSON object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((x, i) => x !== expected[i])) {
    throw new TypeError(name + " has missing or unexpected fields");
  }
}

export async function readJsonFile(filename) {
  if (typeof filename !== "string" || filename.trim() !== filename || !filename) {
    throw new TypeError("an explicit local file path is required");
  }
  return JSON.parse(await readFile(filename, "utf8"));
}

export async function enrollCustomerLicense(store, record) {
  assertLicenseRecord(record);
  if (record.status !== "ACTIVE" || record.revokedAt !== null) {
    throw new Error("LICENSE_NOT_ACTIVE");
  }
  if (await store.licenses.get(record.licenseId)) {
    throw new Error("LICENSE_ALREADY_REGISTERED: refusing to overwrite existing identity");
  }
  await store.licenses.put(record);
  return Object.freeze({ code: "LICENSE_ENROLLED", licenseId: record.licenseId });
}

export async function issueCustomerGrant(store, request) {
  if (!request || (request.productMode !== "SELF_MANAGED" && request.productMode !== "COPY_FOLLOWER")) {
    throw new TypeError("productMode must be SELF_MANAGED or COPY_FOLLOWER");
  }
  const isSelfManaged = request.productMode === "SELF_MANAGED";
  exact(
    request,
    isSelfManaged
      ? ["productMode", "licenseId", "grantId", "issuedAt", "expiresAt", "allowedBotModes"]
      : ["productMode", "licenseId", "grantId", "issuedAt", "expiresAt", "allowedCopySizingModes"],
    "grant request",
  );
  if (typeof request.licenseId !== "string" || !request.licenseId || request.licenseId.trim() !== request.licenseId) {
    throw new TypeError("licenseId is invalid");
  }
  const license = await store.licenses.get(request.licenseId);
  if (!license) throw new Error("PARENT_LICENSE_NOT_FOUND");
  // Identity, broker and account binding are inherited from this server-side license.
  const grant = isSelfManaged
    ? issueSelfManagedGrant(license, {
        grantId: request.grantId,
        issuedAt: request.issuedAt,
        expiresAt: request.expiresAt,
        allowedBotModes: request.allowedBotModes,
      })
    : issueCopyFollowerGrant(license, {
        grantId: request.grantId,
        issuedAt: request.issuedAt,
        expiresAt: request.expiresAt,
        allowedCopySizingModes: request.allowedCopySizingModes,
      });
  const result = await registerCustomerGrant(store.grants, createCustomerProductGrantLifecycle(grant));
  if (!result.ok || result.code !== "REGISTERED") {
    throw new Error("GRANT_NOT_REGISTERED: " + result.code);
  }
  return Object.freeze({
    code: result.code,
    grantId: grant.grantId,
    licenseId: grant.licenseId,
    installationId: grant.installationId,
    productMode: grant.productMode,
  });
}

export async function revokeCustomerGrant(store, grantId, now) {
  if (typeof grantId !== "string" || !grantId || grantId.trim() !== grantId || !Number.isSafeInteger(now)) {
    throw new TypeError("grantId or timestamp invalid");
  }
  const result = await revokeRegisteredCustomerGrant(store.grants, grantId, now);
  if (!result.ok) throw new Error("GRANT_REVOCATION_DENIED: " + result.code);
  return Object.freeze({ code: result.code, grantId });
}

export function parseCustomerTokenHashRecords(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("token hash records must be a nonempty array");
  for (const record of value) exact(record, ["customerId", "tokenSha256Hex"], "token hash record");
  // Authenticator checks lowercase SHA-256, canonical customer IDs, duplicate hashes.
  new Sha256CustomerApiKeyAuthenticator(value);
  return value;
}

export function createCustomerOperatorGateway(store, tokenHashes, now = () => Date.now()) {
  parseCustomerTokenHashRecords(tokenHashes);
  return new CustomerApiGateway({
    grants: store.grants,
    licenses: store.licenses,
    challenges: store.challenges,
    clock: { now },
    authenticator: new Sha256CustomerApiKeyAuthenticator(tokenHashes),
    rateLimiter: new InMemoryFixedWindowCustomerApiRateLimiter(),
  });
}

export function assertSafeGatewayBind(host, allowRemote) {
  if (typeof host !== "string" || !host || host.trim() !== host) throw new TypeError("bind host required");
  if (host !== "127.0.0.1" && host !== "::1" && allowRemote !== "YES") {
    throw new Error("REMOTE_LISTENER_REQUIRES_EXPLICIT_APPROVAL");
  }
  if (host === "0.0.0.0" || host === "::") {
    throw new Error("WILDCARD_LISTEN_ADDRESS_FORBIDDEN");
  }
  return host;
}
