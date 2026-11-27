import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OfflineBacktestError,
  getOfflineBacktestStatus,
  offlineBacktestHttpStatus,
  resolveBacktestFiles,
  runOfflineBacktest,
  stopOfflineBacktestWorker,
} from "./phase7c-offline-backtest.service";

after(() => stopOfflineBacktestWorker());

const T0 = Date.UTC(2026, 0, 5, 1, 0);
const M5 = 5 * 60_000;

function csv(count: number, periodMs: number) {
  const rows = ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>"];
  for (let i = 0; i < count; i += 1) {
    const iso = new Date(T0 + i * periodMs).toISOString();
    rows.push(`${iso.slice(0, 10).replaceAll("-", ".")}\t${iso.slice(11, 19)}\t2000\t2000\t2000\t2000\t1\t0\t20`);
  }
  return rows.join("\n");
}

function fixture({ cache }: { cache: boolean }) {
  const dir = mkdtempSync(path.join(tmpdir(), "p7c-bt-"));
  writeFileSync(path.join(dir, "XAUUSD.G_M5_202601050100.csv"), csv(1300, M5));
  writeFileSync(path.join(dir, "XAUUSD.G_M15_202601050100.csv"), csv(433, 3 * M5));
  writeFileSync(path.join(dir, "notes.txt"), "ignored");
  const cacheFile = path.join(dir, "cache.json");
  if (cache) {
    const nul = (n: number) => Array.from({ length: n }, () => null);
    writeFileSync(cacheFile, JSON.stringify({
      version: 1, m15Count: 433, m5Count: 1300, firstM15: T0, lastM15: T0 + 432 * 3 * M5,
      regimes: nul(433), m15St: nul(433), m5St: nul(1300), ma20: nul(433), ma50: nul(433), trendSignals: nul(433),
    }));
  }
  return { dir, env: { PHASE7C_BACKTEST_DATA_DIR: dir, PHASE7C_BACKTEST_CACHE_FILE: cacheFile } as NodeJS.ProcessEnv };
}

test("finds MT5 export names for M5 and M15 without mixing them up", () => {
  const { dir, env } = fixture({ cache: false });
  const files = resolveBacktestFiles(env);
  assert.equal(path.basename(files.m5File ?? ""), "XAUUSD.G_M5_202601050100.csv");
  assert.equal(path.basename(files.m15File ?? ""), "XAUUSD.G_M15_202601050100.csv");
  writeFileSync(path.join(dir, "XAUUSD_M5.csv"), csv(10, M5));
  assert.equal(path.basename(resolveBacktestFiles(env).m5File ?? ""), "XAUUSD_M5.csv", "plain name preferred");
  const empty = resolveBacktestFiles({ PHASE7C_BACKTEST_DATA_DIR: path.join(dir, "missing") } as NodeJS.ProcessEnv);
  assert.equal(empty.m5File, null);
});

test("status without cache explains how to prepare it; run reports CACHE_MISSING (409) and writes nothing", async () => {
  const { dir, env } = fixture({ cache: false });
  const before = readdirSync(dir).sort();
  const status = (await getOfflineBacktestStatus(env)) as Record<string, any>;
  assert.match(status.safety, /không gửi\/sửa\/đóng lệnh/);
  assert.equal(status.dataset.cacheReady, false);
  assert.match(status.prepareCommand, /^pnpm backtest --m5 /);
  assert.equal(status.defaults.breakEven.triggerPrice, 6);
  assert.equal(status.defaults.fixedTp.enabled, false);
  await assert.rejects(runOfflineBacktest({}, env), (e: unknown) => e instanceof OfflineBacktestError && e.code === "CACHE_MISSING");
  assert.equal(offlineBacktestHttpStatus("CACHE_MISSING"), 409);
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test("run returns metrics; bad input is 400; a second concurrent run is refused (429)", async () => {
  const { env } = fixture({ cache: true });
  const result = (await runOfflineBacktest({ lot: 0.03, breakEven: { triggerPrice: 8 } }, env)) as Record<string, any>;
  assert.equal(result.kind, "phase7c-web-backtest");
  assert.equal(result.summary.trades, 0);
  assert.equal(result.isBaseline, false);
  assert.equal(result.request.breakEven.triggerPrice, 8);
  await assert.rejects(runOfflineBacktest({ botMode: "AUTO" }, env), (e: unknown) => e instanceof OfflineBacktestError && e.code === "BAD_REQUEST");
  assert.equal(offlineBacktestHttpStatus("BAD_REQUEST"), 400);
  const first = runOfflineBacktest({}, env);
  await assert.rejects(runOfflineBacktest({}, env), (e: unknown) => e instanceof OfflineBacktestError && e.code === "BUSY");
  assert.equal(offlineBacktestHttpStatus("BUSY"), 429);
  await first;
});

test("route and service are replay-only: no broker, no order path, no runtime mutation", () => {
  const service = readFileSync(new URL("./phase7c-offline-backtest.service.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../routes/phase7c-offline-backtest.route.ts", import.meta.url), "utf8");
  const forbidden = /mt5-broker|execution-engine|order_send|OrderSend|writeFile|BOT_MODE\s*=|liveArm|child_process|node:(net|http|https)/;
  assert.doesNotMatch(service, forbidden);
  assert.doesNotMatch(route, forbidden);
  const routes = [...route.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes, ["get /status", "post /run"]);
  const app = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
  assert.match(app, /app\.use\("\/api\/v1\/phase7c\/offline-backtest", phase7cOfflineBacktestRouter\)/);
});
