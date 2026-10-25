import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  exportInstallationPublicKey,
  generateInstallationDeviceKeyPair,
} from "@xauusd/installation-proof";

const root = process.cwd();
const keysDir = path.join(root, "keys");
await mkdir(keysDir, { recursive: true });

const identityFiles = [
  "installation-private.pem",
  "installation-public.txt",
  "installation-id.txt",
];
const existingIdentityError = () => new Error(
  "INSTALLATION_IDENTITY_ALREADY_EXISTS: preserve the existing identity files; do not regenerate an enrolled identity.",
);

// Refuse partial identities too: their surviving files may already be enrolled.
for (const name of identityFiles) {
  try {
    await lstat(path.join(keysDir, name));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw existingIdentityError();
}

const installationId =
  process.argv[2]?.trim() || `installation-${randomUUID()}`;

const pair = generateInstallationDeviceKeyPair();
const privatePem = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = exportInstallationPublicKey(pair.publicKey);

try {
  // Exclusive creation prevents another initializer from replacing any file
  // between the check above and these writes. Preserve partial files on error.
  await writeFile(
    path.join(keysDir, "installation-private.pem"),
    privatePem,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(keysDir, "installation-public.txt"),
    publicKey + "\n",
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(keysDir, "installation-id.txt"),
    installationId + "\n",
    { encoding: "utf8", flag: "wx" },
  );
} catch (error) {
  if (error.code === "EEXIST") throw existingIdentityError();
  throw error;
}

console.log("INSTALLATION_ID=" + installationId);
console.log("INSTALLATION_PUBLIC_KEY=" + publicKey);
console.log("PRIVATE_KEY_STORED_LOCAL=keys/installation-private.pem");
console.log("SEND_PRIVATE_KEY_TO_ADMIN=NO");
