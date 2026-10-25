import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const identityFiles = [
  "installation-private.pem",
  "installation-public.txt",
  "installation-id.txt",
];

async function releaseFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "xauusd-installation-cli-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(path.join(root, "bin"));
  await cp(
    path.join(repoRoot, "customer-release/bin/generate-installation-identity.mjs"),
    path.join(root, "bin/generate-installation-identity.mjs"),
  );
  for (const name of ["copy-protocol", "installation-proof"]) {
    const target = path.join(root, "node_modules/@xauusd", name);
    await mkdir(target, { recursive: true });
    await cp(path.join(repoRoot, "packages", name, "package.json"), path.join(target, "package.json"));
    await cp(path.join(repoRoot, "packages", name, "dist"), path.join(target, "dist"), { recursive: true });
  }
  return root;
}

async function run(root, installationId) {
  const args = [path.join(root, "bin/generate-installation-identity.mjs")];
  if (installationId !== undefined) args.push(installationId);
  try {
    const result = await execFileAsync(process.execPath, args, { cwd: root, timeout: 15_000 });
    return { code: 0, ...result };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function snapshot(root) {
  const entries = await Promise.all(identityFiles.map(async name => [name, createHash("sha256").update(await readFile(path.join(root, "keys", name))).digest("hex")]));
  return Object.fromEntries(entries);
}

async function assertMatchingKeyPair(root) {
  const privatePem = await readFile(path.join(root, "keys/installation-private.pem"), "utf8");
  const publicKey = (await readFile(path.join(root, "keys/installation-public.txt"), "utf8")).trim();
  const derived = createPublicKey(privatePem).export({ type: "spki", format: "der" }).toString("base64url");
  assert.equal(publicKey, derived);
  if (process.platform !== "win32") {
    assert.equal((await stat(path.join(root, "keys/installation-private.pem"))).mode & 0o777, 0o600);
  }
}

test("packaged identity CLI creates one consistent local identity", async t => {
  const root = await releaseFixture(t);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  await assertMatchingKeyPair(root);
  const id = (await readFile(path.join(root, "keys/installation-id.txt"), "utf8")).trim();
  assert.match(id, /^installation-[0-9a-f-]{36}$/);
  assert.ok(result.stdout.includes("INSTALLATION_ID=" + id));
  assert.equal(result.stdout.includes("-----BEGIN PRIVATE KEY-----"), false);
});

test("rerunning identity generation preserves the enrolled key and installation ID", async t => {
  const root = await releaseFixture(t);
  assert.equal((await run(root, "installation-original")).code, 0);
  const before = await snapshot(root);
  const result = await run(root, "installation-replacement");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /INSTALLATION_IDENTITY_ALREADY_EXISTS/);
  assert.deepEqual(await snapshot(root), before);
  await assertMatchingKeyPair(root);
});

for (const name of identityFiles) {
  test("partial identity containing " + name + " is preserved without creating replacement files", async t => {
    const root = await releaseFixture(t);
    await mkdir(path.join(root, "keys"));
    const retained = "retained-existing-identity-" + name;
    await writeFile(path.join(root, "keys", name), retained);
    const result = await run(root);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /INSTALLATION_IDENTITY_ALREADY_EXISTS/);
    assert.deepEqual(await readdir(path.join(root, "keys")), [name]);
    assert.equal(await readFile(path.join(root, "keys", name), "utf8"), retained);
  });
}

test("concurrent initializers produce one complete identity and reject the other", async t => {
  const root = await releaseFixture(t);
  const results = await Promise.all([run(root, "installation-first"), run(root, "installation-second")]);
  assert.equal(results.filter(result => result.code === 0).length, 1);
  const rejected = results.find(result => result.code !== 0);
  assert.match(rejected.stderr, /INSTALLATION_IDENTITY_ALREADY_EXISTS/);
  await assertMatchingKeyPair(root);
  const winner = results.find(result => result.code === 0);
  const id = (await readFile(path.join(root, "keys/installation-id.txt"), "utf8")).trim();
  assert.ok(winner.stdout.includes("INSTALLATION_ID=" + id));
});
