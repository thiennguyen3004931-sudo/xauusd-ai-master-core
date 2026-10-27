// Positive Windows end-to-end coverage for the production offline readiness CLI.
// Everything happens under a disposable temp directory with synthetic Ed25519
// material; only a guarded TEST FIXTURE modifies that directory's DACL.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { protectInstallationPrivateKey } from "../customer-release/bin/installation-identity-dpapi.mjs";

const runFile = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const readinessCli = path.join(repoRoot, "customer-release/bin/check-customer-installation-readiness.mjs");
const syntheticAcl = path.join(repoRoot, "scripts/customer-offline-readiness-synthetic-acl-fixture.ps1");
const windowsOnly = { skip: process.platform !== "win32" && "requires a real disposable Windows DPAPI and NTFS fixture" };

async function run(args, cwd, command = process.execPath) {
  try {
    const result = await runFile(command, args, {
      cwd, timeout: 45000, windowsHide: true,
      env: { ...process.env, XAUUSD_CUSTOMER_API_TOKEN: "" },
      maxBuffer: 4096,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

function assertBlock(result) {
  assert.equal(result.code, 2, "expected sanitized blocked status; stdout omitted");
  assert.match(result.stderr, /CUSTOMER_INSTALLATION_OFFLINE_READINESS=BLOCKED/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE KEY|S-1-5-|C:\\Users\\/);
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "xauusd-offline-positive-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }));
  const keys = path.join(dir, "keys");
  await mkdir(keys);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicString = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const blob = await protectInstallationPrivateKey(privateKey, publicString);
  try {
    await writeFile(path.join(keys, "installation-private.dpapi"), blob, { flag: "wx", mode: 0o600 });
  } finally {
    blob.fill(0);
  }
  await writeFile(path.join(keys, "installation-public.txt"), publicString + "\n", { flag: "wx" });
  await writeFile(path.join(keys, "installation-id.txt"), "installation-synthetic-offline-positive\n", { flag: "wx" });

  return { dir, keys, dpapi: path.join(keys, "installation-private.dpapi") };
}

async function applySyntheticAcl(dir, injectEveryone = false) {
  const args = [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", syntheticAcl, "-Root", dir,
  ];
  if (injectEveryone) args.push("-InjectEveryone");
  const result = await run(args, repoRoot, "powershell.exe");
  const diagnostic = [...result.stderr.matchAll(/SYNTHETIC_ACL_FIXTURE_BLOCKED_(?:STAGE|CATEGORY|EXCEPTION_TYPE)=[A-Z_a-z]+/g)].map(m => m[0]).join(" ");
  assert.equal(result.code, 0, "temp ACL fixture setup failed (" + (diagnostic || "NO_SANITIZED_STAGE") + ")");
  assert.match(result.stdout, /SYNTHETIC_TEMP_ONLY_ACL_FIXTURE=PASS/);
}

test("synthetic ACL fixture is guarded against non-temp customer paths", async () => {
  const source = await readFile(syntheticAcl, "utf8");
  assert.match(source, /xauusd-offline-positive-/);
  assert.match(source, /\$parent -ine \$tempFull/);
  assert.match(source, /SYNTHETIC_ACL_FIXTURE_ROOT_REQUIRED/);
  assert.doesNotMatch(source, /(?<![A-Za-z])Remove-Item\b|(?<![A-Za-z])Get-Content\b/);
});

test("Windows synthetic DPAPI + explicit restricted ACL passes OFFLINE readiness, then broad ACL fails", windowsOnly, async (t) => {
  const f = await fixture(t);
  const before = createHash("sha256").update(await readFile(f.dpapi)).digest("hex");
  await applySyntheticAcl(f.dir);

  const good = await run([readinessCli], f.dir);
  assert.equal(good.code, 0, "conservative Windows temp fixture unexpectedly rejected");
  assert.match(good.stdout, /^CUSTOMER_INSTALLATION_OFFLINE_READINESS=PASS$/m);
  assert.match(good.stdout, /^CUSTOMER_DPAPI_IDENTITY_CURRENT_USER=VERIFIED$/m);
  assert.match(good.stdout, /^CUSTOMER_NTFS_ACL_CONSERVATIVE_PREFLIGHT=PASS$/m);
  assert.match(good.stdout, /^CUSTOMER_EFFECTIVE_HOST_SECURITY_ACCEPTANCE=NOT_VERIFIED$/m);
  assert.match(good.stdout, /^CUSTOMER_LICENSE_AND_GRANT=NOT_VERIFIED$/m);
  assert.match(good.stdout, /^CUSTOMER_MT5_EXECUTION=NOT_VERIFIED$/m);
  assert.match(good.stdout, /^CUSTOMER_COMMERCIAL_RELEASE=NOT_APPROVED$/m);
  assert.doesNotMatch(good.stdout + good.stderr, /PRIVATE KEY|S-1-5-|C:\\Users\\/);

  await applySyntheticAcl(f.dir, true);
  const broad = await run([readinessCli], f.dir);
  assertBlock(broad);
  assert.equal(createHash("sha256").update(await readFile(f.dpapi)).digest("hex"), before);
});

test("Windows offline readiness blocks a substituted public key without touching protected bytes", windowsOnly, async (t) => {
  const f = await fixture(t);
  await applySyntheticAcl(f.dir);
  const before = createHash("sha256").update(await readFile(f.dpapi)).digest("hex");
  const otherPair = generateKeyPairSync("ed25519");
  const otherPublic = otherPair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  await writeFile(path.join(f.keys, "installation-public.txt"), otherPublic + "\n");
  assertBlock(await run([readinessCli], f.dir));
  assert.equal(createHash("sha256").update(await readFile(f.dpapi)).digest("hex"), before);
});