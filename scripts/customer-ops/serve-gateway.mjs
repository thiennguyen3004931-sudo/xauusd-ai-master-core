#!/usr/bin/env node
// Customer-only HTTPS listener: strictly no Master Control API and no MT5 mutation.
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  SqliteCustomerSecurityStore,
  OperatorSqliteCustomerTokenLedger,
  createCustomerApiGatewayHttpsServer,
} from "../../packages/customer-runtime-session/dist/index.js";
import {
  assertSafeGatewayBind, createCustomerOperatorGateway,
} from "./customer-ops.mjs";

async function start() {
  const { XAUUSD_CUSTOMER_GATEWAY_DB: database,
    XAUUSD_CUSTOMER_GATEWAY_OPERATOR_TOKEN_LEDGER: operatorLedgerPath,
    XAUUSD_CUSTOMER_GATEWAY_TLS_KEY: tlsKey,
    XAUUSD_CUSTOMER_GATEWAY_TLS_CERT: tlsCert,
    XAUUSD_CUSTOMER_GATEWAY_BIND: configuredHost,
    XAUUSD_CUSTOMER_GATEWAY_PORT: configuredPort,
    XAUUSD_CUSTOMER_GATEWAY_ALLOW_REMOTE: remoteApproval,
  } = process.env;

  for (const [label, path] of Object.entries({ database, operatorLedgerPath, tlsKey, tlsCert })) {
    if (!path || !isAbsolute(path)) throw new Error(label + " must be an absolute, operator-controlled path");
  }
  const host = assertSafeGatewayBind(configuredHost || "127.0.0.1", remoteApproval);
  const port = configuredPort === undefined ? 8443 : Number(configuredPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("port must be in 1024..65535");
  }

  // Require physically separate operator-owned directory; never load a token
  // list from a customer-restorable file. External authority is still required
  // to defend against rollback of the operator ledger itself (P0 #176).
  const [customerDir, operatorDir] = await Promise.all([
    realpath(dirname(database)), realpath(dirname(operatorLedgerPath)),
  ]);
  if (customerDir === operatorDir || resolve(database) === resolve(operatorLedgerPath)) {
    throw new Error("OPERATOR_LEDGER_MUST_BE_SEPARATE_FROM_CUSTOMER_DB");
  }
  // TLS key and certificate must be supplied out of band. Never use a development
  // certificate for real customers; never print tokens or PEM material.
  const tlsOptions = {
    key: await readFile(tlsKey),
    cert: await readFile(tlsCert),
    minVersion: "TLSv1.2",
  };
  const operatorLedger = new OperatorSqliteCustomerTokenLedger(operatorLedgerPath);
  let store;
  try {
    store = new SqliteCustomerSecurityStore(database);
  } catch (error) {
    operatorLedger.close();
    throw error;
  }
  const gateway = createCustomerOperatorGateway(store, operatorLedger);
  const server = createCustomerApiGatewayHttpsServer(gateway, tlsOptions);
  server.requestTimeout = 15_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  const close = () => {
    server.close(() => {
      store.close();
      operatorLedger.close();
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  server.on("error", (error) => {
    console.error("CUSTOMER_GATEWAY_LISTENER_FAILED:", error.code || "LISTENER_ERROR");
    process.exitCode = 1;
    server.close();
    store.close();
    operatorLedger.close();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log("CUSTOMER_GATEWAY_HTTPS_READY host=" + host + " port=" + port +
    " trading_mutation=NONE master_api_exposure=NONE");
}

start().catch((error) => {
  console.error("CUSTOMER_GATEWAY_STARTUP_DENIED:", error instanceof Error ? error.message : "UNKNOWN");
  process.exitCode = 1;
});
