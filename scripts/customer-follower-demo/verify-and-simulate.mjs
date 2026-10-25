#!/usr/bin/env node
// Signed COPY_FOLLOWER dry-run only. No MT5 broker import, transport or order mutation.
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  CustomerCopyCommandVerifier,
  CustomerFollowerExecutionAdapter,
} from "../../packages/customer-agent/dist/index.js";
import {
  SqliteCustomerFollowerCommandJournal,
  DurableCustomerFollowerDispatcher,
} from "../../packages/customer-follower-state/dist/index.js";

async function readBoundedJson(filename) {
  const bytes = await readFile(filename);
  if (bytes.byteLength > 32 * 1024) throw new Error("COPY_DEMO_FILE_TOO_LARGE");
  return JSON.parse(bytes.toString("utf8"));
}

async function main([configPath, commandPath]) {
  if (!configPath || !commandPath || !isAbsolute(configPath) || !isAbsolute(commandPath)) {
    throw new Error("USAGE: node scripts/customer-follower-demo/verify-and-simulate.mjs <absolute-config.json> <absolute-signed-command.json>");
  }
  const config = await readBoundedJson(configPath);
  if (config.productMode !== "COPY_FOLLOWER" || config.executionMode !== "SIMULATED_ONLY" ||
      !isAbsolute(config.journalPath) ||
      !Array.isArray(config.allowedSymbols) || config.allowedSymbols.length === 0 ||
      !config.trustedPublicKeys || typeof config.trustedPublicKeys !== "object" ||
      Array.isArray(config.trustedPublicKeys) ||
      Object.keys(config.trustedPublicKeys).length === 0) {
    throw new Error("COPY_DEMO_INVALID_CONFIGURATION");
  }
  const binding = {
    licenseId: config.licenseId,
    installationId: config.installationId,
    mt5Login: config.mt5Login,
    brokerServer: config.brokerServer,
    allowedSymbols: config.allowedSymbols,
  };
  const verifier = new CustomerCopyCommandVerifier(
    binding,
    new Map(Object.entries(config.trustedPublicKeys)),
    { now: () => Date.now() },
  );
  const journal = new SqliteCustomerFollowerCommandJournal(config.journalPath, binding);
  try {
    const input = await readBoundedJson(commandPath);
    let seenAction = "";
    const adapter = new CustomerFollowerExecutionAdapter({
      async execute(request) {
        // A verified, strict command reaches this fake executor. No broker IO.
        seenAction = request.action;
      },
    });
    const dispatcher = new DurableCustomerFollowerDispatcher(verifier, adapter, journal);
    const outcome = await dispatcher.dispatch(input);
    console.log(JSON.stringify({
      ...outcome,
      simulatedOnly: true,
      mt5Mutation: false,
      ...(outcome.ok ? { action: seenAction } : {}),
      pendingReconciliation: journal.listReserved().length,
    }));
    if (!outcome.ok) process.exitCode = 2;
  } finally {
    journal.close();
  }
}
main(process.argv.slice(2)).catch((error) => {
  console.error("COPY_FOLLOWER_SIMULATION_DENIED:", error instanceof Error ? error.message : "UNKNOWN");
  process.exitCode = 1;
});
