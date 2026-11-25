import { execFileSync } from "node:child_process";
import fs from "node:fs";

const allowedWriter = "apps/api/src/services/phase7c-bot-mode.service.ts";
const provenanceWorkflow = ".github/workflows/phase7c-bot-mode-provenance-ci.yml";
const testFixtures = new Set([
  "scripts/test-phase7c-bot-mode-provenance.ts",
  "scripts/test-phase7c-bot-mode-provenance-writers.mjs",
  // Unit test: writes only lock fixtures in a mkdtemp directory; mode changes go through the service.
  "apps/api/src/services/phase7c-bot-mode.semi.test.ts",
]);
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((file) => /\.(?:ts|tsx|js|mjs|cjs|ps1)$/i.test(file));

const pathNeedles = ["phase7c-bot-mode.json", "PHASE7C_BOT_MODE_FILE"];
const writerPatterns = [
  /\b(?:writeFileSync|appendFileSync|renameSync|writeFile|appendFile|rename)\s*\(/,
  /\b(?:Set-Content|Add-Content|Out-File|Move-Item|Rename-Item)\b/i,
  /\[System\.IO\.File\]::(?:WriteAllText|AppendAllText|Move)/i,
  /\[IO\.File\]::(?:WriteAllText|AppendAllText|Move)/i,
];

const lineHasWriter = (line) => writerPatterns.some((pattern) => pattern.test(line));
const lineHasNeedle = (line) => pathNeedles.some((needle) => line.includes(needle));

// Reviewed non-service writers. Each one is accepted only while its narrow invariant holds,
// so a future edit that turns it into a real bypass fails this audit again.
const reviewedExceptions = new Map([
  [
    // New-machine bootstrap may only seed the fail-closed PAUSE state, never TREND/SIDEWAY/AUTO/SEMI.
    "scripts/install-phase7c-new-machine-local.ps1",
    (source) => {
      const lines = source.split(/\r?\n/).filter(lineHasNeedle);
      if (lines.length !== 1) return "must reference the bot-mode file exactly once";
      if (!/^\s*Write-JsonAtomic -Path \(Join-Path \$workDir "phase7c-bot-mode\.json"\) -Value \$botMode\s*$/.test(lines[0])) {
        return "bot-mode write must be the single Write-JsonAtomic of $botMode";
      }
      const block = source.match(/\$botMode = \[pscustomobject\]@\{([\s\S]*?)\n\}/);
      if (!block) return "$botMode seed block not found";
      const modes = [...block[1].matchAll(/\bmode\s*=\s*"([^"]*)"/g)].map((match) => match[1]);
      if (modes.length !== 1 || modes[0] !== "PAUSE") return `seed mode must be PAUSE, got ${modes.join(",") || "none"}`;
      if (!/updatedBy\s*=\s*"new-machine-bootstrap"/.test(block[1])) return "seed must record updatedBy new-machine-bootstrap";
      if ((source.match(/\$botMode\b/g) ?? []).length !== 2) return "$botMode must only be built and written once";
      return null;
    },
  ],
  [
    // Read-only precheck: reads the bot-mode file, and its only write is the operator receipt.
    "scripts/ops/check-phase7c-web-recovery-eligibility-readonly.ps1",
    (source) => {
      const lines = source.split(/\r?\n/);
      if (lines.some((line) => lineHasNeedle(line) && lineHasWriter(line))) return "bot-mode file must be read-only here";
      const writers = lines.filter(lineHasWriter);
      if (writers.length !== 1 || !/\[IO\.File\]::WriteAllText\(\$ReceiptPath,/.test(writers[0])) {
        return "only the $ReceiptPath receipt write is allowed";
      }
      return null;
    },
  ],
]);

// Self-check: the exception guards must reject a non-PAUSE seed and a bot-mode write in the precheck.
{
  const installer = reviewedExceptions.get("scripts/install-phase7c-new-machine-local.ps1");
  const good = '$botMode = [pscustomobject]@{\n  mode = "PAUSE"\n  updatedBy = "new-machine-bootstrap"\n}\nWrite-JsonAtomic -Path (Join-Path $workDir "phase7c-bot-mode.json") -Value $botMode\n';
  if (installer(good) !== null) throw new Error("Installer guard self-check rejected a PAUSE seed");
  if (installer(good.replace('"PAUSE"', '"AUTO"')) === null) throw new Error("Installer guard self-check accepted an AUTO seed");
  const precheck = reviewedExceptions.get("scripts/ops/check-phase7c-web-recovery-eligibility-readonly.ps1");
  const readOnly = "$mode = Read-Json 'phase7c-bot-mode.json'\n[IO.File]::WriteAllText($ReceiptPath, $out)\n";
  if (precheck(readOnly) !== null) throw new Error("Precheck guard self-check rejected a read-only source");
  if (precheck(readOnly + "Set-Content 'phase7c-bot-mode.json' x\n") === null) {
    throw new Error("Precheck guard self-check accepted a bot-mode write");
  }
}

const suspicious = [];
const references = [];

for (const file of tracked) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (!pathNeedles.some((needle) => source.includes(needle))) continue;
  references.push(file);
  if (file === allowedWriter || testFixtures.has(file)) continue;

  const exception = reviewedExceptions.get(file);
  if (exception) {
    const violation = exception(source);
    if (violation) suspicious.push(`${file} (${violation})`);
    continue;
  }

  if (writerPatterns.some((pattern) => pattern.test(source))) {
    suspicious.push(file);
  }
}

if (!references.includes(allowedWriter)) {
  throw new Error(`Canonical bot-mode writer is not discoverable at ${allowedWriter}`);
}

if (suspicious.length > 0) {
  throw new Error(
    `Potential direct bot-mode state writer(s) bypass provenance service: ${suspicious.join(", ")}`,
  );
}

const workflowSource = fs.readFileSync(provenanceWorkflow, "utf8");
const protectsMainPullRequests = /pull_request:\s*\r?\n\s+branches:\s*\r?\n\s+- main(?:\r?\n|$)/.test(
  workflowSource,
);
if (!protectsMainPullRequests) {
  throw new Error("Bot Mode Provenance CI must protect pull requests targeting main");
}
if (workflowSource.includes("- fix/phase7c-legacy-background-cleanup")) {
  throw new Error("Bot Mode Provenance CI must not target the retired legacy integration branch");
}

console.log(`PHASE7C_BOT_MODE_PROVENANCE_WRITER_AUDIT=PASS|REFERENCES=${references.length}`);
