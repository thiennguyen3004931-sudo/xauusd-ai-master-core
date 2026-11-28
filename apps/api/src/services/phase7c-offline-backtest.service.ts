// Phase 7C backtest page — runs the offline replay in a worker thread (no MT5, no orders, no runtime state).
//
// Safety:
//   - reads only the MT5 CSV exports in PHASE7C_BACKTEST_DATA_DIR (default <repo>/backtest-data, gitignored) and
//     the regime cache written by `pnpm backtest` (default <repo>/.runtime/backtest/phase7c-replay-cache.json)
//   - never imports the broker, never touches BOT_MODE / LIVE ARM / lot settings / .runtime of the bot
//   - one replay at a time, in a worker thread with a timeout, so the API that serves the bot UI stays responsive
//   - the worker is stopped after a few idle minutes to give its memory back
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const WORKER_FILE = join(REPO_ROOT, "scripts", "backtest", "phase7c-backtest-worker.mjs");
const RUN_TIMEOUT_MS = 90_000;
const IDLE_STOP_MS = 5 * 60_000;

export type OfflineBacktestErrorCode = "BUSY" | "DATA_MISSING" | "DATA_TOO_SHORT" | "CACHE_MISSING" | "BAD_REQUEST" | "TIMEOUT" | "FAILED";

export class OfflineBacktestError extends Error {
  constructor(public readonly code: OfflineBacktestErrorCode, message: string) {
    super(message);
  }
}

export type BacktestFiles = { dataDir: string; m5File: string | null; m15File: string | null; cacheFile: string };

const timeframeOf = (name: string): "M5" | "M15" | null => {
  if (!/\.csv$/i.test(name)) return null;
  if (/(^|[^A-Z0-9])M15([^A-Z0-9]|$)/i.test(name)) return "M15";
  if (/(^|[^A-Z0-9])M5([^A-Z0-9]|$)/i.test(name)) return "M5";
  return null;
};

/** Find the M5 / M15 CSV exports: prefer XAUUSD_M5.csv / XAUUSD_M15.csv, else the newest matching file. */
export function resolveBacktestFiles(env: NodeJS.ProcessEnv = process.env, root = REPO_ROOT): BacktestFiles {
  const dataDir = env.PHASE7C_BACKTEST_DATA_DIR?.trim() || join(root, "backtest-data");
  const cacheFile = env.PHASE7C_BACKTEST_CACHE_FILE?.trim() || join(root, ".runtime", "backtest", "phase7c-replay-cache.json");
  const pick = (tf: "M5" | "M15") => {
    if (!existsSync(dataDir)) return null;
    const names = readdirSync(dataDir).filter((n) => timeframeOf(n) === tf);
    const preferred = names.find((n) => n.toUpperCase() === `XAUUSD_${tf}.CSV`);
    if (preferred) return join(dataDir, preferred);
    const newest = names
      .map((n) => ({ n, t: statSync(join(dataDir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    return newest ? join(dataDir, newest.n) : null;
  };
  return { dataDir, m5File: pick("M5"), m15File: pick("M15"), cacheFile };
}

type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; code: OfflineBacktestErrorCode; error: string };

let worker: Worker | null = null;
let busy = false;
let seq = 0;
let idleTimer: NodeJS.Timeout | null = null;

function stopWorker() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  if (w) void w.terminate();
}

function call(message: Record<string, unknown>, timeoutMs = RUN_TIMEOUT_MS): Promise<unknown> {
  if (busy) return Promise.reject(new OfflineBacktestError("BUSY", "Đang chạy một backtest khác, đợi vài giây rồi thử lại."));
  busy = true;
  if (idleTimer) clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(WORKER_FILE);
    worker.unref();
  }
  const w = worker;
  const id = ++seq;
  return new Promise<unknown>((resolvePromise, reject) => {
    const done = () => {
      clearTimeout(timer);
      w.off("message", onMessage);
      w.off("error", onError);
      busy = false;
      idleTimer = setTimeout(stopWorker, IDLE_STOP_MS);
      idleTimer.unref();
    };
    const onMessage = (reply: WorkerReply) => {
      if (reply.id !== id) return;
      done();
      if (reply.ok) resolvePromise(reply.result);
      else reject(new OfflineBacktestError(reply.code, reply.error));
    };
    const onError = (error: Error) => {
      done();
      stopWorker();
      reject(new OfflineBacktestError("FAILED", error.message));
    };
    const timer = setTimeout(() => {
      done();
      stopWorker();
      reject(new OfflineBacktestError("TIMEOUT", "Backtest chạy quá lâu và đã bị dừng. Thử khoảng ngày ngắn hơn."));
    }, timeoutMs);
    w.on("message", onMessage);
    w.on("error", onError);
    w.postMessage({ id, ...message });
  });
}

const prepareCommand = (files: BacktestFiles) =>
  `pnpm backtest --m5 "${files.m5File ?? join(files.dataDir, "XAUUSD_M5.csv")}" --m15 "${files.m15File ?? join(files.dataDir, "XAUUSD_M15.csv")}"`;

/** Dataset + defaults for the page. Never throws for missing data: the page shows how to prepare it. */
export async function getOfflineBacktestStatus(env: NodeJS.ProcessEnv = process.env) {
  const files = resolveBacktestFiles(env);
  const meta = (await call({ type: "status", m5File: files.m5File, m15File: files.m15File, cacheFile: files.cacheFile }, 30_000)) as Record<string, unknown>;
  return {
    safety: "OFFLINE_REPLAY_ONLY — chỉ đọc file CSV lịch sử; không kết nối MT5, không gửi/sửa/đóng lệnh, không đổi BOT_MODE/LIVE ARM",
    files: {
      dataDir: files.dataDir,
      m5: files.m5File ? basename(files.m5File) : null,
      m15: files.m15File ? basename(files.m15File) : null,
    },
    prepareCommand: prepareCommand(files),
    ...meta,
  };
}

export async function runOfflineBacktest(body: unknown, env: NodeJS.ProcessEnv = process.env) {
  const files = resolveBacktestFiles(env);
  return call({ type: "run", m5File: files.m5File, m15File: files.m15File, cacheFile: files.cacheFile, body });
}

export const offlineBacktestHttpStatus = (code: OfflineBacktestErrorCode): number =>
  code === "BAD_REQUEST" ? 400 : code === "BUSY" ? 429 : code === "TIMEOUT" ? 504 : code === "FAILED" ? 500 : 409;

/** For tests: stop the worker now. */
export function stopOfflineBacktestWorker() {
  stopWorker();
}
