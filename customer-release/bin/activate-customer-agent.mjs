import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CustomerAgent,
  HttpsCustomerAgentTransport,
} from "@xauusd/customer-agent";

const configPath = path.resolve(
  process.argv[2] || "config/customer-agent.json",
);
const config = JSON.parse(await readFile(configPath, "utf8"));

const token = process.env.XAUUSD_CUSTOMER_API_TOKEN;
if (!token || token.trim() !== token || token.length === 0) {
  throw new Error("XAUUSD_CUSTOMER_API_TOKEN is required");
}

const requiredString = (value, field) => {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(field + " must be a canonical non-blank string");
  }
  return value;
};

const installationId = (
  await readFile(path.resolve(config.installationIdFile), "utf8")
).trim();
const installationPublicKey = (
  await readFile(path.resolve(config.installationPublicKeyFile), "utf8")
).trim();
const privatePem = await readFile(
  path.resolve(config.installationPrivateKeyFile),
  "utf8",
);
const installationPrivateKey = createPrivateKey(privatePem);

const mt5Login = Number(config.mt5Login);
if (!Number.isSafeInteger(mt5Login) || mt5Login <= 0) {
  throw new Error("mt5Login must be a positive safe integer");
}

const transport = new HttpsCustomerAgentTransport(
  requiredString(config.apiBaseUrl, "apiBaseUrl"),
);
const agent = new CustomerAgent(transport, {
  apiToken: token,
  grantId: requiredString(config.grantId, "grantId"),
  installationId,
  installationPublicKey,
  installationPrivateKey,
  mt5Login,
  brokerServer: requiredString(config.brokerServer, "brokerServer"),
});

let result;
if (config.productMode === "SELF_MANAGED") {
  result = await agent.activateSelfManaged(
    requiredString(config.requestedBotMode, "requestedBotMode"),
  );
} else if (config.productMode === "COPY_FOLLOWER") {
  result = await agent.activateCopyFollower(
    requiredString(config.requestedSizingMode, "requestedSizingMode"),
  );
} else {
  throw new Error("productMode must be SELF_MANAGED or COPY_FOLLOWER");
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;
