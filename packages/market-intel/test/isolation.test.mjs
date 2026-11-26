// Static guard: market-intel is advisory only. It must never reach order execution,
// broker mutation or the network, and must not import the runtime controllers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const roots = [join(here, "..", "src"), join(here, "..", "..", "..", "scripts", "market-intel")];

function files(dir) {
  let out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(files(p));
    else if (/\.(mjs|js|ts)$/.test(e.name) && !e.name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const forbidden = [
  /order_send/i, /orderSend/, /placeOrder/, /sendOrder/, /closePosition/, /modifyPosition/,
  /order_check/i, /\/v1\/orders?/, /\/v1\/positions?/,
  /@xauusd\/(execution-engine|mt5-broker|risk-engine)/, /packages\/(execution-engine|mt5-broker)/,
  /run-phase7[bc]-[a-z-]*controller/, /BOT_MODE\s*=/, /LIVE_ARM/,
  /\bfetch\s*\(/, /node:(http|https|net|child_process)/,
];

test("market-intel sources contain no order, broker-mutation, runtime or network path", () => {
  const list = roots.flatMap(files);
  assert.ok(list.length > 0);
  for (const file of list) {
    const text = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${file} matches forbidden ${pattern}`);
    }
  }
});
