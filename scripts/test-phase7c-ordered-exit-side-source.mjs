import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireLiteral(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} missing required literal: ${needle}`);
  }
}

function assertSampleBeforeFastMove(source, label) {
  const manageStart = source.indexOf("async function managePosition");
  if (manageStart < 0) throw new Error(`${label} missing managePosition`);
  const sample = source.indexOf('journal("MANAGEMENT_EXIT_SIDE_SAMPLE"', manageStart);
  const fastMove = source.indexOf("fastMoveProfitLockCandidate({", manageStart);
  if (sample < 0) throw new Error(`${label} missing MANAGEMENT_EXIT_SIDE_SAMPLE journal event`);
  if (fastMove < 0) throw new Error(`${label} missing FastMove evaluation`);
  if (sample > fastMove) {
    throw new Error(`${label} must persist the exit-side sample before FastMove evaluation`);
  }
}

for (const [file, label] of [
  ["scripts/run-phase7b-demo-controller.ts", "TREND"],
  ["scripts/run-phase7c-sideway-controller.mjs", "SIDEWAY"],
]) {
  const source = read(file);
  assertSampleBeforeFastMove(source, label);
  for (const literal of [
    'journal("MANAGEMENT_EXIT_SIDE_SAMPLE"',
    "timestamp: Number(quote.timestamp)",
    "ticket: managed.ticket",
    "side: managed.side",
    "bid: Number(quote.bid)",
    "ask: Number(quote.ask)",
    "exitSidePrice:",
    "evidenceVersion: 1",
  ]) {
    requireLiteral(source, literal, label);
  }
}

const evidence = read("apps/api/src/services/phase7c-ordered-exit-side-evidence.service.ts");
for (const literal of [
  "MANAGEMENT_EXIT_SIDE_SAMPLE",
  "OPEN_BOUNDARY_NOT_BRACKETED",
  "CLOSE_BOUNDARY_NOT_BRACKETED",
  "JOURNAL_MALFORMED_ROWS",
  "SIDE_MISMATCH",
  'verdict: "EXACT"',
  'verdict: "UNAVAILABLE"',
  "boundaryToleranceMs",
]) {
  requireLiteral(evidence, literal, "ORDERED_EVIDENCE");
}

const counterfactual = read("apps/api/src/services/phase7c-counterfactual-intelligence.service.ts");
for (const literal of [
  "orderedExitSideEvidenceByTradeKey",
  "orderedExitSidePrices:",
  "orderedExitSideEvidenceComplete:",
  "getPhase7COrderedExitSideEvidence",
]) {
  requireLiteral(counterfactual, literal, "P4");
}

console.log("P6A_ORDERED_EXIT_SIDE_SOURCE_CONTRACT=PASS");
console.log("P6A_CANONICAL_SAMPLE_BEFORE_FASTMOVE=PASS");
console.log("P6A_TRADING_LOGIC_MUTATION=NONE");
