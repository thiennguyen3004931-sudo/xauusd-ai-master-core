import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CustomerFollowerPositionRegistry } from "./mt5-follower-executor.js";

interface RegistryFile {
  readonly version: 1;
  readonly bindings: Readonly<Record<string, string>>;
}

function canonical(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parseRegistry(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as Partial<RegistryFile>;
  if (parsed.version !== 1 || parsed.bindings === null || typeof parsed.bindings !== "object") {
    throw new Error("FOLLOWER_POSITION_REGISTRY_INVALID");
  }
  const map = new Map<string, string>();
  for (const [masterPositionRef, followerTicket] of Object.entries(parsed.bindings)) {
    if (!canonical(masterPositionRef) || !canonical(followerTicket)) {
      throw new Error("FOLLOWER_POSITION_REGISTRY_INVALID");
    }
    if (map.has(masterPositionRef)) {
      throw new Error("FOLLOWER_POSITION_REGISTRY_INVALID");
    }
    map.set(masterPositionRef, followerTicket);
  }
  return map;
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) {
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }
  throw lastError;
}

export class FileCustomerFollowerPositionRegistry
  implements CustomerFollowerPositionRegistry
{
  private loaded = false;
  private bindings = new Map<string, string>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (!canonical(filePath)) {
      throw new TypeError("filePath must be a canonical non-blank string");
    }
  }

  async get(masterPositionRef: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.bindings.get(masterPositionRef);
  }

  async set(masterPositionRef: string, followerTicket: string): Promise<void> {
    if (!canonical(masterPositionRef) || !canonical(followerTicket)) {
      throw new TypeError("position binding values must be canonical non-blank strings");
    }
    await this.ensureLoaded();
    this.bindings.set(masterPositionRef, followerTicket);
    await this.persist();
  }

  async delete(masterPositionRef: string): Promise<void> {
    if (!canonical(masterPositionRef)) {
      throw new TypeError("masterPositionRef must be a canonical non-blank string");
    }
    await this.ensureLoaded();
    this.bindings.delete(masterPositionRef);
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      this.bindings = parseRegistry(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        this.bindings = new Map();
      } else {
        throw error;
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(
      {
        version: 1,
        bindings: Object.fromEntries(
          [...this.bindings.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      } satisfies RegistryFile,
      null,
      2,
    ) + "\n";

    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = this.filePath + ".tmp";
      await writeFile(tempPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await renameWithRetry(tempPath, this.filePath);
    });

    await this.writeChain;
  }
}
