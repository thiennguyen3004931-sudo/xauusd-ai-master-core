import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkerPaths = new Set([
  "scripts/security/check-private-secrets.mjs",
  "scripts/security/check-private-secrets.test.mjs",
]);

export function inspectTrackedPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();

  if (checkerPaths.has(lower)) {
    return "ALLOW";
  }

  if (/\.env\.example$/.test(lower) || /\.env\.sample$/.test(lower)) {
    return "ALLOW";
  }

  if (
    /(^|\/)\.env(?:\.|$)/.test(lower) ||
    /(^|\/)prod\.env$/.test(lower) ||
    /\.(?:pem|key|p12|pfx)$/.test(lower) ||
    /(^|\/)id_(?:rsa|ed25519)(?:\.|$)/.test(lower) ||
    /(^|\/)[^/]*(?:private-key|signing-key|credential|secrets?)[^/]*$/.test(lower)
  ) {
    return "REJECT";
  }

  return "ALLOW";
}

export function inspectTrackedContent(filePath, content) {
  const text = String(content);

  const privateKeyBlock =
    /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[\s\S]{16,}?-----END \1-----/;
  const classicGitHubToken = /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/;
  const fineGrainedGitHubToken = /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/;

  if (
    privateKeyBlock.test(text) ||
    classicGitHubToken.test(text) ||
    fineGrainedGitHubToken.test(text)
  ) {
    return "REJECT";
  }

  return "ALLOW";
}

function trackedPaths() {
  const stdout = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.split("\0").filter(Boolean);
}

function inspectTrackedFile(filePath) {
  if (inspectTrackedPath(filePath) === "REJECT") {
    return "REJECT";
  }

  const content = fs.readFileSync(path.join(repoRoot, filePath), "utf8");
  return inspectTrackedContent(filePath, content);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--tracked") {
    console.error("USAGE: node scripts/security/check-private-secrets.mjs --tracked");
    process.exitCode = 2;
  } else {
    const rejected = trackedPaths().filter(
      (filePath) => inspectTrackedFile(filePath) === "REJECT",
    );

    for (const filePath of rejected) {
      console.error(`TRACKED_SECRET_PATH_REJECTED:${filePath}`);
    }

    if (rejected.length > 0) {
      process.exitCode = 1;
    } else {
      console.log("TRACKED_SECRET_PATHS=PASS");
    }
  }
}
