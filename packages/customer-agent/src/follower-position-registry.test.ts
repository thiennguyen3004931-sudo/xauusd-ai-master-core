import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCustomerFollowerPositionRegistry } from "./follower-position-registry.js";

const roots: string[] = [];

async function tempFile() {
  const root = await mkdtemp(path.join(os.tmpdir(), "xauusd-follower-registry-"));
  roots.push(root);
  return path.join(root, "state", "positions.json");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileCustomerFollowerPositionRegistry", () => {
  it("survives restart and preserves master-to-follower ticket ownership", async () => {
    const file = await tempFile();
    const first = new FileCustomerFollowerPositionRegistry(file);

    await first.set("master-001", "ticket-9001");
    await first.set("master-002", "ticket-9002");

    const second = new FileCustomerFollowerPositionRegistry(file);
    await expect(second.get("master-001")).resolves.toBe("ticket-9001");
    await expect(second.get("master-002")).resolves.toBe("ticket-9002");

    await second.delete("master-001");

    const third = new FileCustomerFollowerPositionRegistry(file);
    await expect(third.get("master-001")).resolves.toBeUndefined();
    await expect(third.get("master-002")).resolves.toBe("ticket-9002");
  });

  it("writes versioned deterministic JSON without leaking unrelated data", async () => {
    const file = await tempFile();
    const registry = new FileCustomerFollowerPositionRegistry(file);

    await registry.set("master-b", "ticket-b");
    await registry.set("master-a", "ticket-a");

    const text = await readFile(file, "utf8");
    expect(text).toContain('"version": 1');
    expect(text.indexOf("master-a")).toBeLessThan(text.indexOf("master-b"));
    expect(text).not.toContain("apiToken");
    expect(text).not.toContain("privateKey");
  });

  it("fails closed on corrupt or non-canonical persisted state", async () => {
    const file = await tempFile();
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        bindings: { " master-001": "ticket-9001" },
      }),
      "utf8",
    );

    const registry = new FileCustomerFollowerPositionRegistry(file);
    await expect(registry.get("master-001")).rejects.toThrow(
      "FOLLOWER_POSITION_REGISTRY_INVALID",
    );
  });

  it("validates binding inputs before persistence", async () => {
    const file = await tempFile();
    const registry = new FileCustomerFollowerPositionRegistry(file);

    await expect(registry.set(" master", "ticket")).rejects.toThrow(
      "position binding values must be canonical",
    );
    await expect(registry.set("master", "")).rejects.toThrow(
      "position binding values must be canonical",
    );
  });
});
