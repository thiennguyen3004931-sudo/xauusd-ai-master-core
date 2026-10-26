// Offline, detached Ed25519 attestation for a customer ZIP. No network or trading access.
// A release is trusted only when its signer is pinned in the independently trusted keyring.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "xauusd-customer-release-attestation/v1";
const DOMAIN = "XAUUSD_RELEASE_ATTESTATION_V1\n";
const shaPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const keyIdPattern = /^[a-zA-Z0-9._-]{1,64}$/;
const releasePattern = /^customer-agent-v[0-9]+\.[0-9]+\.[0-9]+(?:-rc[0-9]+)?$/;
const bodyKeys = ["schema", "releaseId", "sourceCommit", "publicContractCommit", "zipSha256", "zipSizeBytes", "signedAt", "signerKeyId"];
const signatureKey = "signatureBase64";

function assertExactKeys(object, expected, label) {
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error(label + "_SHAPE_INVALID");
  const actual = Object.keys(object).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(label + "_FIELDS_INVALID");
}
function assertBody(body) {
  assertExactKeys(body, bodyKeys, "RELEASE_BODY");
  if (body.schema !== SCHEMA || !releasePattern.test(body.releaseId) ||
      !shaPattern.test(body.sourceCommit) || !shaPattern.test(body.publicContractCommit) ||
      !hashPattern.test(body.zipSha256) || !Number.isSafeInteger(body.zipSizeBytes) ||
      body.zipSizeBytes <= 0 || !keyIdPattern.test(body.signerKeyId) ||
      typeof body.signedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.signedAt) ||
      !Number.isFinite(Date.parse(body.signedAt)) ||
      new Date(body.signedAt).toISOString() !== body.signedAt) {
    throw new Error("RELEASE_BODY_INVALID");
  }
}
function transcript(body) {
  assertBody(body);
  return Buffer.from(DOMAIN + JSON.stringify(bodyKeys.map((field) => body[field])), "utf8");
}
async function fingerprint(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size <= 0 || !Number.isSafeInteger(info.size)) throw new Error("RELEASE_ZIP_NOT_REGULAR");
  const h = createHash("sha256");
  let length = 0;
  for await (const chunk of createReadStream(file)) { h.update(chunk); length += chunk.length; }
  if (length !== info.size) throw new Error("RELEASE_ZIP_CHANGED_DURING_READ");
  return { zipSha256: h.digest("hex"), zipSizeBytes: length };
}
export async function createAttestation({ zipPath, releaseId, sourceCommit, publicContractCommit, signerKeyId, signedAt, privateKeyPem }) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("RELEASE_SIGNER_MUST_BE_ED25519");
  const body = {
    schema: SCHEMA, releaseId, sourceCommit, publicContractCommit,
    ...await fingerprint(zipPath),
    signedAt, signerKeyId
  };
  const message = transcript(body);
  return { ...body, signatureBase64: sign(null, message, key).toString("base64") };
}
export async function verifyAttestation({ zipPath, attestation, trust }) {
  assertExactKeys(attestation, [...bodyKeys, signatureKey], "RELEASE_ATTESTATION");
  const body = Object.fromEntries(bodyKeys.map((field) => [field, attestation[field]]));
  const message = transcript(body);
  assertExactKeys(trust, ["schema", "signers"], "RELEASE_TRUST");
  if (trust.schema !== SCHEMA || !Array.isArray(trust.signers)) throw new Error("RELEASE_TRUST_INVALID");
  const ids = new Set();
  let matchedKey = null;
  for (const entry of trust.signers) {
    assertExactKeys(entry, ["keyId", "publicKeyPem"], "RELEASE_TRUST_SIGNER");
    if (!keyIdPattern.test(entry.keyId) || typeof entry.publicKeyPem !== "string" || ids.has(entry.keyId)) {
      throw new Error("RELEASE_TRUST_SIGNER_INVALID");
    }
    ids.add(entry.keyId);
    if (entry.keyId === body.signerKeyId) matchedKey = entry.publicKeyPem;
  }
  if (!matchedKey) throw new Error("RELEASE_SIGNER_NOT_TRUSTED");
  const pub = createPublicKey(matchedKey);
  if (pub.asymmetricKeyType !== "ed25519") throw new Error("RELEASE_TRUST_KEY_NOT_ED25519");
  const b64 = attestation.signatureBase64;
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) ||
      Buffer.from(b64, "base64").toString("base64") !== b64 ||
      Buffer.from(b64, "base64").length !== 64) {
    throw new Error("RELEASE_SIGNATURE_FORMAT_INVALID");
  }
  if (!verify(null, message, pub, Buffer.from(b64, "base64"))) throw new Error("RELEASE_SIGNATURE_INVALID");
  const actual = await fingerprint(zipPath);
  if (actual.zipSha256 !== body.zipSha256 || actual.zipSizeBytes !== body.zipSizeBytes) {
    throw new Error("RELEASE_ZIP_CHECKSUM_MISMATCH");
  }
  return { releaseId: body.releaseId, sourceCommit: body.sourceCommit, zipSha256: body.zipSha256, signerKeyId: body.signerKeyId };
}
// Resolve symlinks and anchor custody to the actual repository, never process.cwd().
export async function assertExternalReleaseSigningKeyPath(keyPath) {
  if (typeof keyPath !== "string" || keyPath.trim() === "") {
    throw new Error("RELEASE_SIGNING_KEY_FILE_NOT_SET");
  }
  const repositoryRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
  const resolvedKey = await realpath(path.resolve(keyPath));
  const relative = path.relative(repositoryRoot, resolvedKey);
  if (relative === "" ||
      (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("RELEASE_SIGNING_KEY_MUST_BE_OUTSIDE_REPOSITORY");
  }
  return resolvedKey;
}

function parseArgs(args) {
  const flags = {};
  if (args.length % 2 !== 0) throw new Error("RELEASE_ARGUMENTS_INVALID");
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!/^--[a-z-]+$/.test(name) || name in flags || args[i + 1].startsWith("--")) throw new Error("RELEASE_ARGUMENTS_INVALID");
    flags[name] = args[i + 1];
  }
  return flags;
}
async function cli() {
  const [action, ...args] = process.argv.slice(2);
  const flags = parseArgs(args);
  const keyringDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../security/customer-release-trusted-signers.json");
  if (action === "sign") {
    const required = ["--zip", "--out", "--release-id", "--source", "--public", "--key-id"];
    if (JSON.stringify(Object.keys(flags).sort()) !== JSON.stringify([...required].sort())) throw new Error("RELEASE_ARGUMENTS_INVALID");
    const keyPath = process.env.XAUUSD_RELEASE_SIGNING_KEY_FILE;
    if (!keyPath) throw new Error("RELEASE_SIGNING_KEY_FILE_NOT_SET");
    const resolvedKeyPath = await assertExternalReleaseSigningKeyPath(keyPath);
    const privateKeyPem = await readFile(resolvedKeyPath, "utf8");
    const attestation = await createAttestation({
      zipPath: flags["--zip"], releaseId: flags["--release-id"],
      sourceCommit: flags["--source"], publicContractCommit: flags["--public"],
      signerKeyId: flags["--key-id"], signedAt: new Date().toISOString(), privateKeyPem
    });
    await writeFile(flags["--out"], JSON.stringify(attestation, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log("CUSTOMER_RELEASE_ATTESTATION_WRITTEN=TRUE");
    console.log("CUSTOMER_RELEASE_SIGNED_ZIP_SHA256=" + attestation.zipSha256);
  } else if (action === "verify") {
    const allowed = ["--zip", "--attestation", "--trust"];
    if (Object.keys(flags).some((x) => !allowed.includes(x)) || !flags["--zip"] || !flags["--attestation"]) {
      throw new Error("RELEASE_ARGUMENTS_INVALID");
    }
    const result = await verifyAttestation({
      zipPath: flags["--zip"],
      attestation: JSON.parse(await readFile(flags["--attestation"], "utf8")),
      trust: JSON.parse(await readFile(flags["--trust"] || keyringDefault, "utf8"))
    });
    console.log("CUSTOMER_RELEASE_SIGNATURE=PASS");
    console.log("CUSTOMER_RELEASE_VERIFIED_ZIP_SHA256=" + result.zipSha256);
    console.log("CUSTOMER_RELEASE_VERIFIED_SIGNER_ID=" + result.signerKeyId);
  } else {
    throw new Error("USAGE: sign|verify with explicit --zip and release arguments");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => { console.error("CUSTOMER_RELEASE_ATTESTATION_FAILED=" + error.message); process.exitCode = 1; });
}
