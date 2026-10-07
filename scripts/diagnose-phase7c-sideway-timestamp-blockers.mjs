import fs from "node:fs";
import readline from "node:readline";

const file = process.argv[2];
if (!file) throw new Error("Usage: node diagnose-sideway-timestamp-blockers.mjs <sideway-decisions.jsonl>");
if (!fs.existsSync(file)) throw new Error(`Audit file not found: ${file}`);

const now = Date.now();
const sevenDaysAgo = now - 7 * 24 * 60 * 60_000;
const oneDayAgo = now - 24 * 60 * 60_000;

const rows = [];
const schemaSamples = [];

const input = fs.createReadStream(file, { encoding: "utf8" });
const lines = readline.createInterface({ input, crlfDelay: Infinity });

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function collectTimestampReasons(value, path = "raw", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTimestampReasons(item, `${path}[${index}]`, out));
    return out;
  }
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (reason === "TIMESTAMP_STALE" || reason === "TIMESTAMP_TOO_FAR_IN_FUTURE") {
    out.push({
      path,
      reason,
      ageMs: finite(value.ageMs),
      rawAgeMs: finite(value.rawAgeMs),
      clockOffsetMs: finite(value.clockOffsetMs),
      quoteTimestamp: finite(value.quoteTimestamp),
      closeTime: finite(value.closeTime),
      normalizedTimestamp: finite(value.normalizedTimestamp),
    });
  }
  for (const [key, nested] of Object.entries(value)) {
    if (nested && typeof nested === "object") {
      collectTimestampReasons(nested, `${path}.${key}`, out);
    }
  }
  return out;
}

for await (const line of lines) {
  if (!line.trim()) continue;
  let parsed;
  try { parsed = JSON.parse(line); } catch { continue; }
  const timestamp = finite(parsed?.timestamp);
  if (timestamp === null || timestamp < sevenDaysAgo || timestamp > now) continue;

  const event = String(parsed?.event ?? "UNKNOWN");
  const topReason = String(parsed?.reason ?? "");
  const topReasonCode = String(parsed?.reasonCode ?? "");
  const raw = parsed?.raw ?? {};

  const matches = collectTimestampReasons(raw);
  const textHaystack = `${topReason} ${topReasonCode} ${JSON.stringify(raw)}`;
  const textualReasons = [];
  if (textHaystack.includes("TIMESTAMP_STALE")) textualReasons.push("TIMESTAMP_STALE");
  if (textHaystack.includes("TIMESTAMP_TOO_FAR_IN_FUTURE")) textualReasons.push("TIMESTAMP_TOO_FAR_IN_FUTURE");

  if (textualReasons.length && schemaSamples.length < 30) {
    schemaSamples.push({
      timestamp,
      timestampIso: new Date(timestamp).toISOString(),
      event,
      reason: topReason,
      reasonCode: topReasonCode,
      raw,
    });
  }

  for (const match of matches) {
    rows.push({
      timestamp,
      timestampIso: new Date(timestamp).toISOString(),
      event,
      source: "STRUCTURED_RAW",
      ...match,
    });
  }

  if (matches.length === 0) {
    for (const reason of textualReasons) {
      rows.push({
        timestamp,
        timestampIso: new Date(timestamp).toISOString(),
        event,
        source: "TEXT_FALLBACK",
        path: "normalized-row",
        reason,
        ageMs: finite(raw?.ageMs),
        rawAgeMs: finite(raw?.rawAgeMs),
        clockOffsetMs: finite(raw?.clockOffsetMs),
        quoteTimestamp: finite(raw?.quoteTimestamp),
        closeTime: finite(raw?.closeTime),
        normalizedTimestamp: finite(raw?.normalizedTimestamp),
      });
    }
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

const groups = new Map();
for (const row of rows) {
  const key = `${row.event}\u0000${row.path}\u0000${row.reason}`;
  const list = groups.get(key) ?? [];
  list.push(row);
  groups.set(key, list);
}

const summary = [...groups.entries()].map(([key, list]) => {
  const [event, path, reason] = key.split("\u0000");
  const ages = list.map((row) => row.ageMs).filter((value) => value !== null);
  const offsets = list.map((row) => row.clockOffsetMs).filter((value) => value !== null);
  return {
    event,
    path,
    reason,
    count7d: list.length,
    count24h: list.filter((row) => row.timestamp >= oneDayAgo).length,
    ageMsMin: ages.length ? Math.min(...ages) : null,
    ageMsP50: percentile(ages, 0.50),
    ageMsP95: percentile(ages, 0.95),
    ageMsMax: ages.length ? Math.max(...ages) : null,
    clockOffsetsMs: [...new Set(offsets)].sort((a,b)=>a-b),
  };
}).sort((a,b) => b.count7d - a.count7d || a.event.localeCompare(b.event));

console.log(`SIDEWAY_TIMESTAMP_DIAG_NOW=${new Date(now).toISOString()}`);
console.log(`SIDEWAY_TIMESTAMP_DIAG_ROWS_7D=${rows.length}`);
console.log(`SIDEWAY_TIMESTAMP_DIAG_ROWS_24H=${rows.filter((row)=>row.timestamp >= oneDayAgo).length}`);
console.log(`SIDEWAY_TIMESTAMP_DIAG_SCHEMA_SAMPLES=${schemaSamples.length}`);

for (let i = 0; i < summary.length; i += 1) {
  const item = summary[i];
  console.log(
    `SIDEWAY_TIMESTAMP_GROUP_${i+1}=${item.event}|PATH=${item.path}|REASON=${item.reason}|COUNT_7D=${item.count7d}|COUNT_24H=${item.count24h}|AGE_MIN=${item.ageMsMin}|AGE_P50=${item.ageMsP50}|AGE_P95=${item.ageMsP95}|AGE_MAX=${item.ageMsMax}|OFFSETS=${item.clockOffsetsMs.join(",")}`
  );
}

const recent = [...rows].sort((a,b) => b.timestamp - a.timestamp).slice(0, 20);
for (let i = 0; i < recent.length; i += 1) {
  const row = recent[i];
  console.log(
    `SIDEWAY_TIMESTAMP_RECENT_${i+1}=${row.timestampIso}|EVENT=${row.event}|PATH=${row.path}|REASON=${row.reason}|AGE_MS=${row.ageMs}|RAW_AGE_MS=${row.rawAgeMs}|OFFSET_MS=${row.clockOffsetMs}|QUOTE_TS=${row.quoteTimestamp}|CLOSE_TIME=${row.closeTime}|NORMALIZED_TS=${row.normalizedTimestamp}`
  );
}

for (let i = 0; i < schemaSamples.length; i += 1) {
  const sample = schemaSamples[i];
  console.log(
    `SIDEWAY_TIMESTAMP_SCHEMA_${i+1}=${sample.timestampIso}|EVENT=${sample.event}|REASON=${sample.reason}|REASON_CODE=${sample.reasonCode}|RAW=${JSON.stringify(sample.raw)}`
  );
}

console.log("SIDEWAY_TIMESTAMP_DIAG_READ_ONLY=TRUE");
console.log("SIDEWAY_TIMESTAMP_DIAG_STATUS=PASS");
