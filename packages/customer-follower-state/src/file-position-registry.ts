import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CustomerFollowerPositionRegistry } from "@xauusd/customer-agent";

interface RegistryFile {
  readonly version: 1;
  readonly bindings: Readonly<Record<string, string>>;
}

function canonical(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parseRegistry(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as Partial<RegistryFile>;
  if (
    parsed.version !== 1 ||
    parsed.bindings === null ||
    typeof parsed.bindings !== "object" ||
    Array.isArray(parsed.bindings)
  ) {
    throw new Error("FOLLOWER_POSITION_REGISTRY_INVALID");
  }

  const map = new Map<string, string>();
  for (const [masterPositionRef, followerTicket] of Object.entries(
    parsed.bindings,
  )) {
    if (!canonical(masterPositionRef) || !canonical(followerTicket)) {
      throw new Error("FOLLOWER_POSITION_REGISTRY_INVALID");
    }
    map.set(masterPositionRef, followerTicket);
  }
  return map;
}

function serializeRegistry(bindings: ReadonlyMap<string, string>): string {
  return (
    JSON.stringify(
      {
        version: 1,
        bindings: Object.fromEntries(
          [...bindings.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      } satisfies RegistryFile,
      null,
      2,
    ) + "\n"
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await delay(25 * attempt);
    }
  }
  throw lastError;
}

const STALE_LOCK_MS = 30_000;

export class FileCustomerFollowerPositionRegistry
  implements CustomerFollowerPositionRegistry
{
  private readonly lockPath: string;

  constructor(private readonly filePath: string) {
    if (!canonical(filePath)) {
      throw new TypeError("filePath must be a canonical non-blank string");
    }
    this.lockPath = filePath + ".lock";
  }

  async get(masterPositionRef: string): Promise<string | undefined> {
    if (!canonical(masterPositionRef)) {
      throw new TypeError(
        "masterPositionRef must be a canonical non-blank string",
      );
    }
    const bindings = await this.readLatest();
    return bindings.get(masterPositionRef);
  }

  async set(masterPositionRef: string, followerTicket: string): Promise<void> {
    if (!canonical(masterPositionRef) || !canonical(followerTicket)) {
      throw new TypeError(
        "position binding values must be canonical non-blank strings",
      );
    }

    await this.mutate((bindings) => {
      bindings.set(masterPositionRef, followerTicket);
    });
  }

  async delete(masterPositionRef: string): Promise<void> {
    if (!canonical(masterPositionRef)) {
      throw new TypeError(
        "masterPositionRef must be a canonical non-blank string",
      );
    }

    await this.mutate((bindings) => {
      bindings.delete(masterPositionRef);
    });
  }

  private async readLatest(): Promise<Map<string, string>> {
    try {
      return parseRegistry(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return new Map();
      }
      throw error;
    }
  }

  private async mutate(
    change: (bindings: Map<string, string>) => void,
  ): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    const release = await this.acquireLock();
    try {
      const current = await this.readLatest();
      const next = new Map(current);
      change(next);
      await this.persist(next);
    } finally {
      await release();
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 80; attempt += 1) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        return async () => {
          await handle.close();
          try {
            await unlink(this.lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
              throw error;
            }
          }
        };
      } catch (error) {
        lastError = error;
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
          throw error;
        }

        try {
          const lock = await stat(this.lockPath);
          if (Date.now() - lock.mtimeMs > STALE_LOCK_MS) {
            await unlink(this.lockPath);
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException)?.code === "ENOENT") {
            continue;
          }
          throw lockError;
        }

        if (attempt < 80) await delay(25);
      }
    }

    throw new Error(
      "FOLLOWER_POSITION_REGISTRY_LOCK_TIMEOUT",
      { cause: lastError },
    );
  }

  private async persist(bindings: ReadonlyMap<string, string>): Promise<void> {
    const tempPath =
      this.filePath + "." + process.pid + "." + randomUUID() + ".tmp";

    try {
      await writeFile(tempPath, serializeRegistry(bindings), {
        encoding: "utf8",
        mode: 0o600,
      });
      await renameWithRetry(tempPath, this.filePath);
    } finally {
      try {
        await unlink(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}
