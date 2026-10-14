import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const packageDir = path.join(root, "packages", "customer-runtime-session");
const sourceDir = path.join(packageDir, "src");
const workflowPath = path.join(root, ".github", "workflows", "customer-runtime-session-ci.yml");

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

test("runtime session package uses only customer security/control dependencies", async () => {
  const pkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@xauusd/customer-runtime-session");
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), [
    "@xauusd/customer-grant-registry",
    "@xauusd/customer-product-access",
    "@xauusd/customer-runtime-gate",
    "@xauusd/installation-proof",
    "@xauusd/license-service",
  ]);
});

test("runtime session production source has no trading, MT5, API, or network dependency", async () => {
  const files = (await listFilesRecursively(sourceDir)).filter(
    (file) => !file.endsWith(".test.ts"),
  );
  const forbidden = [
    "@xauusd/strategy-engine",
    "@xauusd/risk-engine",
    "@xauusd/execution-engine",
    "@xauusd/mt5-broker",
    "express",
    "axios",
    "fetch(",
    "WebSocket",
    "node:http",
    "node:https",
    "node:net",
    "node:fs",
    "writeFile(",
    "appendFile(",
    "order_send",
    "position_modify",
    "position_close",
  ];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const marker of forbidden) {
      assert.equal(
        content.includes(marker),
        false,
        `${path.relative(root, file)} contains forbidden marker: ${marker}`,
      );
    }
  }
});

test("durable persistence is isolated to the SQLite security adapter", async () => {
  const files = (await listFilesRecursively(sourceDir)).filter(
    (file) => !file.endsWith(".test.ts"),
  );
  const sqliteUsers = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.includes("node:sqlite")) sqliteUsers.push(path.relative(root, file));
  }
  assert.deepEqual(sqliteUsers, [
    path.join("packages", "customer-runtime-session", "src", "sqlite-store.ts"),
  ]);

  const source = await readFile(path.join(sourceDir, "sqlite-store.ts"), "utf8");
  for (const required of [
    "DatabaseSync",
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = FULL",
    "customer_license_records",
    "customer_grant_records",
    "customer_runtime_challenges",
    "consumed_at IS NULL",
  ]) {
    assert.ok(source.includes(required), `SQLite store missing: ${required}`);
  }
});

test("runtime session challenge store is in-memory and one-time by construction", async () => {
  const source = await readFile(path.join(sourceDir, "session.ts"), "utf8");
  assert.match(source, /class InMemoryCustomerRuntimeChallengeStore/);
  assert.match(source, /consumed = new Set<string>/);
  assert.match(source, /this\.consumed\.has\(challengeId\)/);
  assert.match(source, /this\.challenges\.delete\(challengeId\)/);
  assert.match(source, /this\.consumed\.add\(challengeId\)/);
  assert.match(source, /purpose: "RECONNECT"/);
  assert.match(source, /CUSTOMER_RUNTIME_CHALLENGE_TTL_MS = 60_000/);
});

test("dedicated runtime session CI locks tests, typecheck, build, boundary, and diff hygiene", async () => {
  assert.equal((await stat(workflowPath)).isFile(), true);
  const workflow = await readFile(workflowPath, "utf8");
  for (const required of [
    "pnpm install --frozen-lockfile",
    "pnpm --filter @xauusd/customer-runtime-session test",
    "pnpm --filter @xauusd/customer-runtime-session typecheck",
    "pnpm --filter @xauusd/customer-runtime-session build",
    "node --test scripts/test-customer-runtime-session-boundary.mjs",
    "git diff --check",
    "PRODUCTION_MUTATION=NONE",
    "API_ROUTE_MUTATION=NONE",
  ]) {
    assert.ok(workflow.includes(required), `Runtime session CI missing: ${required}`);
  }
});
