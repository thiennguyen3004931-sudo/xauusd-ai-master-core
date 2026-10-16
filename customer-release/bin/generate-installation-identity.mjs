import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  exportInstallationPublicKey,
  generateInstallationDeviceKeyPair,
} from "@xauusd/installation-proof";

const root = process.cwd();
const keysDir = path.join(root, "keys");
await mkdir(keysDir, { recursive: true });

const installationId =
  process.argv[2]?.trim() || `installation-${randomUUID()}`;

const pair = generateInstallationDeviceKeyPair();
const privatePem = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = exportInstallationPublicKey(pair.publicKey);

await writeFile(
  path.join(keysDir, "installation-private.pem"),
  privatePem,
  { encoding: "utf8", mode: 0o600 },
);
await writeFile(
  path.join(keysDir, "installation-public.txt"),
  publicKey + "\n",
  "utf8",
);
await writeFile(
  path.join(keysDir, "installation-id.txt"),
  installationId + "\n",
  "utf8",
);

console.log("INSTALLATION_ID=" + installationId);
console.log("INSTALLATION_PUBLIC_KEY=" + publicKey);
console.log("PRIVATE_KEY_STORED_LOCAL=keys/installation-private.pem");
console.log("SEND_PRIVATE_KEY_TO_ADMIN=NO");
