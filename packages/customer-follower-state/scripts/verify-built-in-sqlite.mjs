import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of ["sqlite-command-journal.js", "sqlite-command-journal.cjs"]) {
  const path = resolve(root, "dist", name);
  const before = readFileSync(path, "utf8");
  // Some tsup/esbuild combinations remove the node: scheme from built-in SQLite.
  // Rewrite only the exact generated import, never an arbitrary dependency.
  const after = before
    .replace(/(from\s*["'])sqlite(["'])/g, "$1node:sqlite$2")
    .replace(/(require\(\s*["'])sqlite(["']\s*\))/g, "$1node:sqlite$2")
    .replace(/(import\(\s*["'])sqlite(["']\s*\))/g, "$1node:sqlite$2");
  if (!after.includes("node:sqlite")) {
    throw new Error(name + ": missing expected built-in node:sqlite import");
  }
  if (/(?:from\s*["']|require\(\s*["']|import\(\s*["'])sqlite["']/.test(after)) {
    throw new Error(name + ": unresolved bare sqlite import");
  }
  if (after !== before) writeFileSync(path, after);
}
