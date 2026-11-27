// Phase 7C backtest page — worker thread that replays history for the API (offline, no MT5, no orders).
//
// Runs inside node:worker_threads so a replay never blocks the API event loop that serves the bot UI.
// It only READS the MT5 CSV exports and the regime cache prepared by `pnpm backtest` (CLI). It never computes
// the regime itself (minutes of CPU on the bot machine) and never writes anything.
//
// Messages in:  { id, type: "status" | "run", m5File, m15File, cacheFile, body? }
// Messages out: { id, ok: true, result } | { id, ok: false, code, error }
import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { M15_MS, M5_MS, loadCache, loadMt5Bars } from "./phase7c-replay-data.mjs";
import { RESEARCH_NOTICE, WEB_DEFAULT_REQUEST, WEB_LIMITS, runWebBacktest } from "./phase7c-backtest-web.mjs";

let memo = null; // { key, m5, m15, pre }

const stamp = (file) => {
  const s = fs.statSync(file);
  return `${file}:${s.size}:${s.mtimeMs}`;
};

const datasetInfo = (ds) => ({
  m5Bars: ds.m5.length,
  m15Bars: ds.m15.length,
  from: new Date(ds.m5[0].openTime).toISOString().slice(0, 10),
  to: new Date(ds.m5.at(-1).closeTime).toISOString().slice(0, 10),
  cacheReady: ds.pre !== null,
});

class CodedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Load bars + cache once per file version. */
export function loadDataset({ m5File, m15File, cacheFile }) {
  for (const f of [m5File, m15File]) if (!f || !fs.existsSync(f)) throw new CodedError("DATA_MISSING", "Chưa có file CSV M5/M15 trong thư mục dữ liệu backtest");
  const cacheKey = fs.existsSync(cacheFile) ? stamp(cacheFile) : "none";
  const key = `${stamp(m5File)}|${stamp(m15File)}|${cacheKey}`;
  if (memo?.key === key) return memo;
  const m5 = loadMt5Bars(m5File, M5_MS);
  const m15 = loadMt5Bars(m15File, M15_MS);
  if (m5.length < 100 || m15.length < 400) throw new CodedError("DATA_TOO_SHORT", `Dữ liệu quá ít (${m5.length} nến M5, ${m15.length} nến M15, cần ≥ 400 nến M15)`);
  const pre = loadCache(cacheFile, m15, m5);
  memo = { key, m5, m15, pre };
  return memo;
}

export function handle(msg) {
  if (msg.type === "status") {
    const meta = { defaults: WEB_DEFAULT_REQUEST, limits: WEB_LIMITS, research: RESEARCH_NOTICE };
    try {
      return { ...meta, dataset: datasetInfo(loadDataset(msg)), problem: null };
    } catch (error) {
      return { ...meta, dataset: null, problem: { code: error.code ?? "FAILED", error: error instanceof Error ? error.message : String(error) } };
    }
  }
  const ds = loadDataset(msg);
  if (!ds.pre) throw new CodedError("CACHE_MISSING", "Chưa có cache regime khớp với file CSV. Chạy lệnh chuẩn bị một lần trên máy (xem hướng dẫn trên trang).");
  try {
    return runWebBacktest({ m5: ds.m5, m15: ds.m15, pre: ds.pre, body: msg.body ?? {} });
  } catch (error) {
    throw new CodedError("BAD_REQUEST", error instanceof Error ? error.message : String(error));
  }
}

parentPort?.on("message", (msg) => {
  try {
    parentPort.postMessage({ id: msg.id, ok: true, result: handle(msg) });
  } catch (error) {
    parentPort.postMessage({ id: msg.id, ok: false, code: error.code ?? "FAILED", error: error instanceof Error ? error.message : String(error) });
  }
});
