#!/usr/bin/env node
// Customer-only HTTPS listener: strictly no Master Control API and no MT5 mutation.
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  SqliteCustomerSecurityStore,
  createCustomerApiGatewayHttpsServer,
} from "../../packages/customer-runtime-session/dist/index.js";
import {
  assertSafeGatewayBind, createCustomerOperatorGateway, parseCustomerTokenHashRecords,
} from "./customer-ops.mjs";

async function start() {
  const { XAUUSD_CUSTOMER_GATEWAY_DB: database,
    XAUUSD_CUSTOMER_GATEWAY_TOKEN_HASHES: tokenFile,
    XAUUSD_CUSTOMER_GATEWAY_TLS_KEY: tlsKey,
    XAUUSD_CUSTOMER_GATEWAY_TLS_CERT: tlsCert,
    XAUUSD_CUSTOMER_GATEWAY_BIND: configuredHost,
    XAUUSD_CUSTOMER_GATEWAY_PORT: configuredPort,
    XAUUSD_CUSTOMER_GATEWAY_ALLOW_REMOTE: remoteApproval,
  } = process.env;

  for (const [label, path] of Object.entries({ database, tokenFile, tlsKey, tlsCert })) {
    if (!path || !isAbsolute(path)) throw new Error(label + " must be an absolute, operator-controlled path");
  }
  const host = assertSafeGatewayBind(configuredHost || "127.0.0.1", remoteApproval);
  const port = configuredPort === undefined ? 8443 : Number(configuredPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("port must be in 1024..65535");
  }

  const tokenHashes = parseCustomerTokenHashRecords(
    JSON.parse(await readFile(tokenFile, "utf8")),
  );
  // TLS key and certificate must be supplied out of band. Never use a development
  // certificate for real customers; never print tokens or PEM material.
  const tlsOptions = {
    key: await readFile(tlsKey),
    cert: await readFile(tlsCert),
    minVersion: "TLSv1.2",
  };
  const store = new SqliteCustomerSecurityStore(database);
  const gateway = createCustomerOperatorGateway(store, tokenHashes);
  const server = createCustomerApiGatewayHttpsServer(gateway, tlsOptions);
  server.requestTimeout = 15_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  const close = () => {
    server.close(() => {
      store.close();
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
