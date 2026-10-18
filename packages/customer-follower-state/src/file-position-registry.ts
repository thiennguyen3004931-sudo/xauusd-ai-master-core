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
  private readonly guardPath: string;

  constructor(private readonly filePath: string) {
    if (!canonical(filePath)) {
      throw new TypeError("filePath must be a canonical non-blank string");
    }
    this.lockPath = filePath + ".lock";
    this.guardPath = this.lockPath + ".guard";
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
      const ownerToken = randomUUID();
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        try {
          await handle.writeFile(ownerToken, "utf8");
          await handle.sync();
        } catch (error) {
          await handle.close();
          throw error;
        }

        return async () => {
          await handle.close();
          await this.withLockPathGuard(async () => {
            let currentToken: string;
            try {
              currentToken = await readFile(this.lockPath, "utf8");
            } catch (error) {
              if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                return;
              }
              throw error;
            }

            // A stale-lock recovery may have replaced this lock. Only its
            // owner may remove it; never unlink a replacement owner's lock.
            if (currentToken !== ownerToken) return;
            try {
              await unlink(this.lockPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
                throw error;
              }
            }
          });
        };
      } catch (error) {
        lastError = error;
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
          throw error;
        }

        const reclaimed = await this.reclaimStaleLock();
        if (reclaimed) continue;
        if (attempt < 80) await delay(25);
      }
    }

    throw new Error("FOLLOWER_POSITION_REGISTRY_LOCK_TIMEOUT", {
      cause: lastError,
    });
  }

  private async reclaimStaleLock(): Promise<boolean> {
    let reclaimed = false;

    // Release and stale recovery share this short guard so a stale check
    // cannot race an owner's release and unlink a newly acquired lock.
    await this.withLockPathGuard(async () => {
      let lock;
      try {
        lock = await stat(this.lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
        throw error;
      }

      if (Date.now() - lock.mtimeMs <= STALE_LOCK_MS) return;

      try {
        await unlink(this.lockPath);
        reclaimed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw error;
        }
      }
    });

    return reclaimed;
  }

  private async withLockPathGuard<T>(
    action: () => Promise<T>,
  ): Promise<T> {
    const releaseGuard = await this.acquireGuard();
    try {
      return await action();
    } finally {
      await releaseGuard();
    }
  }

  private async acquireGuard(): Promise<() => Promise<void>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 80; attempt += 1) {
      const guardToken = randomUUID();
      try {
        const handle = await open(this.guardPath, "wx", 0o600);
        try {
          await handle.writeFile(guardToken, "utf8");
          await handle.sync();
        } catch (error) {
          await handle.close();
          throw error;
        }

        return async () => {
          await handle.close();
          try {
            const currentToken = await readFile(this.guardPath, "utf8");
            if (currentToken !== guardToken) return;
            await unlink(this.guardPath);
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
          const guard = await stat(this.guardPath);
          if (Date.now() - guard.mtimeMs > STALE_LOCK_MS) {
            const tokenBefore = await readFile(this.guardPath, "utf8");
            const verifiedStat = await stat(this.guardPath);
            const tokenAfter = await readFile(this.guardPath, "utf8");
            if (
              Date.now() - verifiedStat.mtimeMs > STALE_LOCK_MS &&
              tokenBefore === tokenAfter
            ) {
              await unlink(this.guardPath);
              continue;
            }
          }
        } catch (guardError) {
          if ((guardError as NodeJS.ErrnoException)?.code === "ENOENT") {
            continue;
          }
          throw guardError;
        }

        if (attempt < 80) await delay(25);
      }
    }

    throw new Error("FOLLOWER_POSITION_REGISTRY_GUARD_TIMEOUT", {
      cause: lastError,
    });
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
