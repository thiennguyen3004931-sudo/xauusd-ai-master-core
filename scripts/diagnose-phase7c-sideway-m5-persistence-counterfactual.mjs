import fs from "node:fs";
import readline from "node:readline";

const file = process.argv[2];
if (!file) throw new Error("Usage: node diagnose-phase7c-sideway-m5-persistence-counterfactual.mjs <live-sideway-decisions.jsonl>");
if (!fs.existsSync(file)) throw new Error(`Audit file not found: ${file}`);

const now = Date.now();
const maxWindowMs = 90 * 24 * 60 * 60_000;
const all = [];
const input = fs.createReadStream(file, { encoding: "utf8" });
const lines = readline.createInterface({ input, crlfDelay: Infinity });

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function condMap(raw) {
  const rows = Array.isArray(raw?.entryConditions?.conditions) ? raw.entryConditions.conditions : [];
  return new Map(
    rows
      .map((r) => [
        String(r?.id ?? ""),
        {
          enabled: r?.enabled === true,
          mandatory: r?.mandatory === true,
          status: String(r?.status ?? ""),
          observed: r?.observed ?? null,
        },
      ])
      .filter(([id]) => id),
  );
}
function initialEval(row) {
  if (row.event === "ENTRY_STRATEGY_CONDITIONS_PASS") return true;
  return row.event === "ENTRY_STRATEGY_CONDITION_BLOCK" && String(row.raw?.phase ?? "").toUpperCase() !== "FINAL_GATE";
}
function rowClose(row) {
  return finite(row.raw?.closeTime);
}
function rowSide(row) {
  return String(row.raw?.side ?? "").toUpperCase();
}
function m5Condition(row) {
  return condMap(row.raw).get("m5Confirmation") ?? null;
}

for await (const line of lines) {
  if (!line.trim()) continue;
  let p;
  try {
    p = JSON.parse(line);
  } catch {
    continue;
  }
  const timestamp = finite(p?.timestamp);
  if (timestamp === null || timestamp > now || timestamp < now - maxWindowMs) continue;
  all.push({
    timestamp,
    event: String(p?.event ?? "UNKNOWN"),
    raw: p?.raw && typeof p.raw === "object" ? p.raw : {},
  });
}

const conditionIds = [
  "rangingRegime",
  "recommendedModeSideway",
  "minimumRegimeConfidence",
  "supplyDemandRange",
  "rangeEdge",
  "m5Confirmation",
];

function dedupeInitial(windowRows) {
  const byClose = new Map();
  let fallback = 0;
  for (const row of windowRows.filter(initialEval)) {
    const close = rowClose(row);
    const key = close !== null ? `C:${close}` : `F:${row.timestamp}:${fallback++}`;
    const prev = byClose.get(key);
    if (!prev || row.timestamp >= prev.timestamp) byClose.set(key, row);
  }
  return [...byClose.values()].sort((a, b) => {
    const ca = rowClose(a) ?? a.timestamp;
    const cb = rowClose(b) ?? b.timestamp;
    return ca - cb || a.timestamp - b.timestamp;
  });
}
function isEffectivelyEnabled(c) {
  return Boolean(c?.mandatory || c?.enabled);
}
function baselinePass(row) {
  const map = condMap(row.raw);
  if (!map.size) return false;
  for (const id of conditionIds) {
    const c = map.get(id);
    if (!c) return false;
    if (isEffectivelyEnabled(c) && c.status !== "PASS") return false;
  }
  return true;
}
function allNonM5Pass(row) {
  const map = condMap(row.raw);
  if (!map.size) return false;
  for (const id of conditionIds) {
    const c = map.get(id);
    if (!c) return false;
    if (id === "m5Confirmation") continue;
    if (isEffectivelyEnabled(c) && c.status !== "PASS") return false;
  }
  return true;
}
function findPersistedM5Source(row, evals, carryBars) {
  const map = condMap(row.raw);
  const current = map.get("m5Confirmation");
  if (!current) return null;
  if (!isEffectivelyEnabled(current)) {
    return { source: "DISABLED", closeTime: rowClose(row), pattern: current.observed ?? null, ageBars: 0 };
  }
  if (current.status === "PASS") {
    return { source: "CURRENT", closeTime: rowClose(row), pattern: current.observed ?? null, ageBars: 0 };
  }

  const close = rowClose(row);
  const side = rowSide(row);
  if (close === null || !side) return null;

  const maxAgeMs = carryBars * 5 * 60_000;
  let best = null;
  for (const candidate of evals) {
    const candidateClose = rowClose(candidate);
    if (candidateClose === null || candidateClose >= close) continue;
    const ageMs = close - candidateClose;
    if (ageMs > maxAgeMs) continue;
    if (rowSide(candidate) !== side) continue;

    const candidateM5 = m5Condition(candidate);
    if (!candidateM5 || candidateM5.status !== "PASS") continue;

    if (!best || candidateClose > best.closeTime) {
      best = {
        source: "PERSISTED",
        closeTime: candidateClose,
        pattern: candidateM5.observed ?? null,
        ageBars: Math.round(ageMs / (5 * 60_000)),
      };
    }
  }
  return best;
}
function persistencePass(row, evals, carryBars) {
  if (!allNonM5Pass(row)) return { passed: false, source: null };
  const m5 = findPersistedM5Source(row, evals, carryBars);
  return { passed: Boolean(m5), source: m5 };
}
function fmtPct(n, d) {
  return d ? (100 * n / d).toFixed(2) : "0.00";
}

for (const days of [7, 30, 90]) {
  const cutoff = now - days * 24 * 60 * 60_000;
  const windowRows = all.filter((r) => r.timestamp >= cutoff);
  const evals = dedupeInitial(windowRows);
  const baseline = evals.filter(baselinePass);
  const baselineKeys = new Set(baseline.map((r) => `${rowClose(r)}|${rowSide(r)}`));

  console.log(`SIDEWAY_M5CF_${days}D_EVALS=${evals.length}`);
  console.log(`SIDEWAY_M5CF_${days}D_BASELINE_PASS=${baseline.length}`);
  console.log(`SIDEWAY_M5CF_${days}D_BASELINE_RATE_PERCENT=${fmtPct(baseline.length, evals.length)}`);

  for (const carryBars of [1, 2]) {
    const accepted = [];
    for (const row of evals) {
      const result = persistencePass(row, evals, carryBars);
      if (result.passed) accepted.push({ row, source: result.source });
    }
    const newlyAccepted = accepted.filter(({ row }) => !baselineKeys.has(`${rowClose(row)}|${rowSide(row)}`));
    const persistedOnly = accepted.filter(({ source }) => source?.source === "PERSISTED");

    console.log(`SIDEWAY_M5CF_${days}D_CURRENT_PLUS_${carryBars}_PASS=${accepted.length}`);
    console.log(`SIDEWAY_M5CF_${days}D_CURRENT_PLUS_${carryBars}_RATE_PERCENT=${fmtPct(accepted.length, evals.length)}`);
    console.log(`SIDEWAY_M5CF_${days}D_CURRENT_PLUS_${carryBars}_NEW_VS_BASELINE=${newlyAccepted.length}`);
    console.log(`SIDEWAY_M5CF_${days}D_CURRENT_PLUS_${carryBars}_PERSISTED_SOURCE_COUNT=${persistedOnly.length}`);

    for (let i = 0; i < Math.min(newlyAccepted.length, 12); i += 1) {
      const { row, source } = newlyAccepted[i];
      console.log(
        `SIDEWAY_M5CF_${days}D_CURRENT_PLUS_${carryBars}_NEW_${i + 1}=` +
        `${new Date(row.timestamp).toISOString()}|CLOSE=${rowClose(row)}|SIDE=${rowSide(row)}|M5_SOURCE=${source?.source ?? "NA"}|SOURCE_CLOSE=${source?.closeTime ?? "NA"}|AGE_BARS=${source?.ageBars ?? "NA"}|PATTERN=${JSON.stringify(source?.pattern ?? null)}`,
      );
    }
  }

  const nonM5Ready = evals.filter(allNonM5Pass);
  console.log(`SIDEWAY_M5CF_${days}D_ALL_OTHER_CONDITIONS_PASS=${nonM5Ready.length}`);
}

console.log("SIDEWAY_M5CF_READ_ONLY=TRUE");
console.log("SIDEWAY_M5CF_STRATEGY_MUTATION=NONE");
console.log("SIDEWAY_M5CF_PRODUCTION_MUTATION=NONE");
console.log("SIDEWAY_M5CF_STATUS=PASS");
