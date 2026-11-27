// The web page shows the regime-library sample charts next to the live chart. They are served as static
// files from apps/web/public/market-intel-samples and must stay identical to docs/market-intel/charts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const docs = new URL("../../docs/market-intel/charts/", import.meta.url);
const web = new URL("../../apps/web/public/market-intel-samples/", import.meta.url);

test("web sample charts: one per state x sample x timeframe, identical to docs", () => {
  const names = readdirSync(web).filter((n) => n.endsWith(".svg")).sort();
  const expected = [];
  for (const state of ["downtrend", "sideway", "uptrend"]) for (const k of [1, 2]) for (const tf of ["h1", "h4"]) expected.push(`${state}-${k}-${tf}.svg`);
  assert.deepEqual(names, expected.sort());
  for (const n of names) {
    const svg = readFileSync(new URL(n, web), "utf8");
    assert.equal(svg, readFileSync(new URL(n, docs), "utf8"), n);
    assert.ok(svg.startsWith("<svg") && !/<script/i.test(svg), n);
  }
});
