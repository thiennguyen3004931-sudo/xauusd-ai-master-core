import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function inspectTrackedPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();

  if (/\.env\.example$/.test(lower) || /\.env\.sample$/.test(lower)) {
    return "ALLOW";
  }

  if (
    /(^|\/)\.env(?:\.|$)/.test(lower) ||
    /(^|\/)prod\.env$/.test(lower) ||
    /\.(?:pem|key|p12|pfx)$/.test(lower) ||
    /(^|\/)id_(?:rsa|ed25519)(?:\.|$)/.test(lower) ||
    /(^|\/)[^/]*(?:private-key|signing-key|credential)[^/]*$/.test(lower)
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--tracked") {
    console.error("USAGE: node scripts/security/check-private-secrets.mjs --tracked");
    process.exitCode = 2;
  } else {
    const rejected = trackedPaths().filter(
      (filePath) => inspectTrackedPath(filePath) === "REJECT",
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
