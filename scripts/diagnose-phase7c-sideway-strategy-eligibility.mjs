import fs from "node:fs";
import readline from "node:readline";

const file = process.argv[2];
if (!file) throw new Error("Usage: node diagnose-phase7c-sideway-strategy-eligibility.mjs <live-sideway-decisions.jsonl>");
if (!fs.existsSync(file)) throw new Error(`Audit file not found: ${file}`);

const now = Date.now();
const windows = [7, 30, 90];
const rows = [];
const input = fs.createReadStream(file, { encoding: "utf8" });
const lines = readline.createInterface({ input, crlfDelay: Infinity });

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function failedConditions(raw) {
  const explicit = raw?.entryConditions?.failedConditions;
  if (Array.isArray(explicit)) return explicit.map(String).filter(Boolean);
  const reason = typeof raw?.reason === "string" ? raw.reason : "";
  return reason.split(",").map((x) => x.trim()).filter(Boolean);
}

function conditionSnapshot(raw) {
  const conditions = Array.isArray(raw?.entryConditions?.conditions)
    ? raw.entryConditions.conditions
    : [];
  return conditions.map((row) => ({
    id: String(row?.id ?? ""),
    enabled: row?.enabled === true,
    mandatory: row?.mandatory === true,
    status: String(row?.status ?? ""),
    observed: row?.observed ?? null,
  })).filter((row) => row.id);
}

for await (const line of lines) {
  if (!line.trim()) continue;
  let parsed;
  try { parsed = JSON.parse(line); } catch { continue; }
  const timestamp = finite(parsed?.timestamp);
  if (timestamp === null || timestamp > now || timestamp < now - 90 * 24 * 60 * 60_000) continue;
  rows.push({
    timestamp,
    event: String(parsed?.event ?? "UNKNOWN"),
    raw: parsed?.raw && typeof parsed.raw === "object" ? parsed.raw : {},
  });
}

function uniqueInitialEvaluations(windowRows) {
  const initial = windowRows.filter((row) =>
    row.event === "ENTRY_STRATEGY_CONDITIONS_PASS" ||
    (row.event === "ENTRY_STRATEGY_CONDITION_BLOCK" && String(row.raw?.phase ?? "").toUpperCase() !== "FINAL_GATE")
  );

  const byClose = new Map();
  let fallbackSeq = 0;
  for (const row of initial) {
    const closeTime = finite(row.raw?.closeTime);
    const key = closeTime !== null ? `C:${closeTime}` : `T:${row.timestamp}:${fallbackSeq++}`;
    const current = byClose.get(key);
    if (!current || row.timestamp >= current.timestamp) byClose.set(key, row);
  }
  return { rows: initial, unique: [...byClose.values()] };
}

function summarize(days) {
  const cutoff = now - days * 24 * 60 * 60_000;
  const windowRows = rows.filter((row) => row.timestamp >= cutoff);
  const { rows: evalRows, unique: evals } = uniqueInitialEvaluations(windowRows);
  const passes = evals.filter((row) => row.event === "ENTRY_STRATEGY_CONDITIONS_PASS");
  const blocks = evals.filter((row) => row.event === "ENTRY_STRATEGY_CONDITION_BLOCK");

  const failCounts = new Map();
  const comboCounts = new Map();
  const enabledCounts = new Map();
  const statusCounts = new Map();

  for (const row of evals) {
    const conditions = conditionSnapshot(row.raw);
    const enabled = conditions.filter((c) => c.enabled);
    enabledCounts.set(enabled.length, (enabledCounts.get(enabled.length) ?? 0) + 1);
    for (const condition of enabled) {
      const key = `${condition.id}:${condition.status}`;
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
    if (row.event !== "ENTRY_STRATEGY_CONDITION_BLOCK") continue;
    const failed = failedConditions(row.raw);
    for (const id of failed) failCounts.set(id, (failCounts.get(id) ?? 0) + 1);
    const combo = failed.length ? [...failed].sort().join("+") : "UNKNOWN";
    comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1);
  }

  const followEvents = [
    "ENTRY_PLAN_BLOCK",
    "ENTRY_STRATEGY_CONDITION_BLOCK",
    "ENTRY_FINAL_GATE_BLOCK",
    "ENTRY_FINAL_PLAN_BLOCK",
    "ENTRY_AUTO_LOT_BLOCK",
    "ENTRY_SUBMIT",
    "ENTRY_FILLED",
  ];
  const byCloseEvents = new Map();
  for (const row of windowRows) {
    const closeTime = finite(row.raw?.closeTime);
    if (closeTime === null) continue;
    const list = byCloseEvents.get(closeTime) ?? [];
    list.push(row);
    byCloseEvents.set(closeTime, list);
  }

  const postPassCounts = new Map();
  for (const pass of passes) {
    const closeTime = finite(pass.raw?.closeTime);
    if (closeTime === null) continue;
    const related = byCloseEvents.get(closeTime) ?? [];
    for (const event of followEvents) {
      let matched = related.filter((row) => row.event === event);
      if (event === "ENTRY_STRATEGY_CONDITION_BLOCK") {
        matched = matched.filter((row) => String(row.raw?.phase ?? "").toUpperCase() === "FINAL_GATE");
      }
      if (matched.length) postPassCounts.set(event, (postPassCounts.get(event) ?? 0) + 1);
    }
  }

  const pct = evals.length ? (passes.length / evals.length) * 100 : 0;
  console.log(`SIDEWAY_ELIGIBLE_${days}D_EVAL_ROWS=${evalRows.length}`);
  console.log(`SIDEWAY_ELIGIBLE_${days}D_UNIQUE_M5=${evals.length}`);
  console.log(`SIDEWAY_ELIGIBLE_${days}D_PASS=${passes.length}`);
  console.log(`SIDEWAY_ELIGIBLE_${days}D_BLOCK=${blocks.length}`);
  console.log(`SIDEWAY_ELIGIBLE_${days}D_PASS_RATE_PERCENT=${pct.toFixed(2)}`);

  let rank = 0;
  for (const [id, count] of [...failCounts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))) {
    rank += 1;
    console.log(`SIDEWAY_ELIGIBLE_${days}D_FAIL_${rank}=${id}|${count}`);
  }

  rank = 0;
  for (const [combo, count] of [...comboCounts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,20)) {
    rank += 1;
    console.log(`SIDEWAY_ELIGIBLE_${days}D_COMBO_${rank}=${combo}|${count}`);
  }

  for (const [key, count] of [...statusCounts.entries()].sort()) {
    console.log(`SIDEWAY_ELIGIBLE_${days}D_STATUS_${key.replace(/[^A-Za-z0-9]+/g,"_").toUpperCase()}=${count}`);
  }

  for (const [countEnabled, count] of [...enabledCounts.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log(`SIDEWAY_ELIGIBLE_${days}D_ENABLED_COUNT_${countEnabled}=${count}`);
  }

  for (const event of followEvents) {
    console.log(`SIDEWAY_ELIGIBLE_${days}D_POSTPASS_${event}=${postPassCounts.get(event) ?? 0}`);
  }

  const recent = [...evals].sort((a,b)=>b.timestamp-a.timestamp).slice(0,20);
  for (let i=0;i<recent.length;i+=1) {
    const row=recent[i];
    const failed=failedConditions(row.raw).join(",");
    const conditions=conditionSnapshot(row.raw)
      .filter((c)=>c.enabled)
      .map((c)=>`${c.id}:${c.status}`)
      .join(",");
    console.log(
      `SIDEWAY_ELIGIBLE_${days}D_RECENT_${i+1}=${new Date(row.timestamp).toISOString()}|CLOSE=${row.raw?.closeTime ?? "NA"}|EVENT=${row.event}|SIDE=${row.raw?.side ?? "NA"}|FAILED=${failed}|STATUS=${conditions}`
    );
  }
}

console.log(`SIDEWAY_ELIGIBLE_DIAG_NOW=${new Date(now).toISOString()}`);
for (const days of windows) summarize(days);
console.log("SIDEWAY_ELIGIBLE_DIAG_FILE_READ_ONLY=TRUE");
console.log("SIDEWAY_ELIGIBLE_DIAG_STATUS=PASS");
