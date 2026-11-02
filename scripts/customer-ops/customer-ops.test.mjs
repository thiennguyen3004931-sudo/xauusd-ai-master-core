import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { SqliteCustomerSecurityStore, OperatorSqliteCustomerTokenLedger, initializeEmptyOperatorTokenLedger, sha256CustomerApiToken } from "../../packages/customer-runtime-session/dist/index.js";
import {
  generateInstallationDeviceKeyPair, exportInstallationPublicKey,
} from "../../packages/installation-proof/dist/index.js";
import {
  assertSafeGatewayBind, createCustomerOperatorGateway, enrollCustomerLicense,
  issueCustomerGrant, revokeCustomerGrant,
} from "./customer-ops.mjs";

const tempDirs = [];
function dbPath() {
  const folder = mkdtempSync(join(tmpdir(), "xauusd-ops-"));
  tempDirs.push(folder);
  return join(folder, "security.sqlite");
}
function operatorLedger() {
  const folder = mkdtempSync(join(tmpdir(), "xauusd-operator-ledger-"));
  tempDirs.push(folder);
  const filename = join(folder, "tokens.sqlite");
  initializeEmptyOperatorTokenLedger(filename);
  return { filename, ledger: new OperatorSqliteCustomerTokenLedger(filename) };
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});
const NOW = 5_000_000_000_000;
function license(id = "license-1", customerId = "customer-1") {
  const pair = generateInstallationDeviceKeyPair();
  return {
    licenseId: id,
    status: "ACTIVE",
    customerId,
    allowedMt5Logins: [701001],
    allowedBrokerServers: ["Broker-Demo"],
    installationId: "install-" + id,
    installationPublicKey: exportInstallationPublicKey(pair.publicKey),
    plan: "CUSTOMER_V1",
    maxAccounts: 1,
    issuedAt: NOW - 100000,
    expiresAt: NOW + 900000,
    revokedAt: null,
  };
}
function req(productMode, licenseId, grantId) {
  return productMode === "SELF_MANAGED"
    ? {
        productMode, licenseId, grantId,
        issuedAt: NOW - 1000, expiresAt: NOW + 500000,
        allowedBotModes: [],
      }
    : {
        productMode, licenseId, grantId,
        issuedAt: NOW - 1000, expiresAt: NOW + 500000,
        allowedCopySizingModes: ["EQUITY_RATIO"],
      };
}

test("admin import refuses overwrite and grant inherits only the stored parent binding", async () => {
  const store = new SqliteCustomerSecurityStore(dbPath());
  try {
    const parent = license();
    await enrollCustomerLicense(store, parent);
    await assert.rejects(() => enrollCustomerLicense(store, parent), /LICENSE_ALREADY_REGISTERED/);
    const created = await issueCustomerGrant(store, req("SELF_MANAGED", parent.licenseId, "grant-self"));
    assert.equal(created.code, "REGISTERED");
    assert.equal(created.installationId, parent.installationId);
    const saved = await store.grants.get("grant-self");
    assert.deepEqual(saved.grant.allowedBotModes, ["PAUSE"]);
    assert.equal(saved.grant.customerId, parent.customerId);
    await assert.rejects(
      () => issueCustomerGrant(store, { ...req("SELF_MANAGED", parent.licenseId, "grant-invalid"), customerId: "another-customer" }),
      /missing or unexpected fields/,
    );
    await assert.rejects(
      () => issueCustomerGrant(store, req("COPY_FOLLOWER", parent.licenseId, "grant-self")),
      /GRANT_NOT_REGISTERED/,
    );
  } finally { store.close(); }
});

test("COPY_FOLLOWER grant and revocation are durable and block further challenges", async () => {
  const filename = dbPath();
  let store = new SqliteCustomerSecurityStore(filename);
  const parent = license("license-copy");
  await enrollCustomerLicense(store, parent);
  await issueCustomerGrant(store, req("COPY_FOLLOWER", parent.licenseId, "grant-copy"));
  const { ledger } = operatorLedger();
  assert.equal(await ledger.registerToken({
    customerId: parent.customerId, tokenSha256Hex: sha256CustomerApiToken("test-token"),
    status: "ACTIVE", notBeforeMs: NOW - 1000, expiresAtMs: NOW + 100000,
    revokedAtMs: null, generation: 1,
  }), true);
  const gateway = createCustomerOperatorGateway(store, ledger, () => NOW);
  const body = JSON.stringify({
    productMode: "COPY_FOLLOWER",
    grantId: "grant-copy",
    installationId: parent.installationId,
  });
  const call = (authorization) => gateway.handle({
    path: "/v1/customer/runtime/challenge",
    method: "POST",
    contentType: "application/json",
    remoteAddress: "192.0.2.8",
    authorization,
    body,
  });
  assert.equal((await call(undefined)).status, 401);
  assert.equal((await call("Bearer wrong")).status, 401);
  assert.equal((await call("Bearer test-token")).status, 200);

  await revokeCustomerGrant(store, "grant-copy", NOW);
  store.close();
  store = new SqliteCustomerSecurityStore(filename);
  try {
    const restarted = createCustomerOperatorGateway(store, ledger, () => NOW + 1);
    const denied = await restarted.handle({
      path: "/v1/customer/runtime/challenge",
      method: "POST",
      contentType: "application/json",
      authorization: "Bearer test-token",
      body,
    });
    assert.equal(denied.status, 403);
    assert.equal((await store.grants.get("grant-copy")).status, "REVOKED");
  } finally { store.close(); ledger.close(); }
});

test("all wrong product, malformed request and invalid license conditions fail closed", async () => {
  const store = new SqliteCustomerSecurityStore(dbPath());
  try {
    const parent = license();
    await enrollCustomerLicense(store, parent);
    await assert.rejects(
      () => issueCustomerGrant(store, { ...req("COPY_FOLLOWER", parent.licenseId, "bad"), allowedBotModes: ["AUTO"] }),
      /missing or unexpected fields/,
    );
    await assert.rejects(
      () => issueCustomerGrant(store, req("SELF_MANAGED", "unknown-license", "bad")),
      /PARENT_LICENSE_NOT_FOUND/,
    );
    await assert.rejects(
      () => issueCustomerGrant(store, { ...req("SELF_MANAGED", parent.licenseId, "expired"), expiresAt: parent.expiresAt + 1 }),
      /parent license/,
    );
  } finally { store.close(); }
});

test("listener restrictions and token hash configuration must be explicit", () => {
  assert.equal(assertSafeGatewayBind("127.0.0.1"), "127.0.0.1");
  assert.throws(() => assertSafeGatewayBind("192.0.2.10"), /EXPLICIT_APPROVAL/);
  assert.equal(assertSafeGatewayBind("192.0.2.10", "YES"), "192.0.2.10");
  assert.throws(() => assertSafeGatewayBind("0.0.0.0", "YES"), /WILDCARD/);
  assert.throws(() => createCustomerOperatorGateway({}, null), /OPERATOR_TOKEN_LEDGER_REQUIRED/);
});


test("Gateway token revocation survives restart and operator ledger outage denies both product modes", async () => {
  const store = new SqliteCustomerSecurityStore(dbPath());
  const { filename, ledger } = operatorLedger();
  const token = "synthetic-gateway-token-not-a-real-secret";
  const digest = sha256CustomerApiToken(token);
  try {
    assert.equal(await ledger.registerToken({
      customerId: "customer-1", tokenSha256Hex: digest,
      status: "ACTIVE", notBeforeMs: NOW - 1000, expiresAtMs: NOW + 60000,
      revokedAtMs: null, generation: 1,
    }), true);
    const request = (productMode) => ({
      path: "/v1/customer/runtime/challenge", method: "POST",
      contentType: "application/json", remoteAddress: "127.0.0.1",
      authorization: "Bearer " + token,
      body: JSON.stringify({ productMode, grantId: "missing-grant", installationId: "synthetic-install" }),
    });
    const gateway = createCustomerOperatorGateway(store, ledger, () => NOW);
    for (const mode of ["SELF_MANAGED", "COPY_FOLLOWER"]) {
      assert.equal((await gateway.handle(request(mode))).status, 403);
    }
    assert.equal(await ledger.revokeToken(digest, 1, NOW), true);
    ledger.close();
    const reopened = new OperatorSqliteCustomerTokenLedger(filename);
    try {
      const restarted = createCustomerOperatorGateway(store, reopened, () => NOW + 1);
      for (const mode of ["SELF_MANAGED", "COPY_FOLLOWER"]) {
        assert.equal((await restarted.handle(request(mode))).status, 401);
      }
      reopened.close();
      assert.equal((await restarted.handle(request("SELF_MANAGED"))).status, 503);
    } finally { try { reopened.close(); } catch {} }
  } finally { store.close(); try { ledger.close(); } catch {} }
});
