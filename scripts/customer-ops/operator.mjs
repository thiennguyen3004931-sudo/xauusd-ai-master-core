#!/usr/bin/env node
// Offline administrator-only CLI. No HTTP admin surface and no trading capability.
import { isAbsolute } from "node:path";
import { SqliteCustomerSecurityStore } from "../../packages/customer-runtime-session/dist/index.js";
import {
  readJsonFile, enrollCustomerLicense, issueCustomerGrant, revokeCustomerGrant,
} from "./customer-ops.mjs";

async function main(argv) {
  const [action, dbPath, input] = argv;
  if (!["enroll-license", "issue-grant", "revoke-grant"].includes(action) ||
      !dbPath || !input || !isAbsolute(dbPath) ||
      process.env.XAUUSD_CUSTOMER_ADMIN_APPROVED !== "YES") {
    throw new Error(
      "USAGE: XAUUSD_CUSTOMER_ADMIN_APPROVED=YES node scripts/customer-ops/operator.mjs " +
      "<enroll-license|issue-grant|revoke-grant> <absolute-db-path> <local-json-file-or-grant-id> " +
      "(local OS ACL/admin approval required)",
    );
  }
  const store = new SqliteCustomerSecurityStore(dbPath);
  try {
    let result;
    if (action === "enroll-license") {
      result = await enrollCustomerLicense(store, await readJsonFile(input));
    } else if (action === "issue-grant") {
      result = await issueCustomerGrant(store, await readJsonFile(input));
    } else {
      result = await revokeCustomerGrant(store, input, Date.now());
    }
    console.log(JSON.stringify(result)); // Sanitized result; never output keys, tokens or raw license.
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error("CUSTOMER_OPERATOR_DENIED:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
