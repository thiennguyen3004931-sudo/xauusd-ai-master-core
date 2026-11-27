import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const installer = fs.readFileSync("scripts/install-phase7c-desktop-control-local.ps1", "utf8");
const launcher = fs.readFileSync("scripts/open-phase7c-control-center-local.ps1", "utf8");
const doc = fs.readFileSync("docs/phase7c-desktop-control.md", "utf8");

test("desktop installer keeps legacy defaults for the running machine", () => {
  assert.match(installer, /\[string\]\$BridgeTask = "XAUUSD-Phase7B-Bridge"/);
  assert.match(installer, /\[string\]\$WebTask = "XAUUSD-Phase7B-Web"/);
  assert.match(launcher, /\[string\]\$BridgeTask = "XAUUSD-Phase7B-Bridge"/);
  assert.match(launcher, /\[string\]\$WebTask = "XAUUSD-Phase7B-Web"/);
});

test("desktop shortcut forwards the installed Bridge/Web task names to the launcher", () => {
  // A new machine installed by install-phase7c-new-machine-local.ps1 only has
  // XAUUSD-Phase7C-Bridge. The shortcut must open the same tasks the installer validated.
  const argsLine = installer.split(/\r?\n/).find((line) => line.includes("$shortcut.Arguments ="));
  assert.ok(argsLine, "shortcut Arguments assignment missing");
  assert.ok(argsLine.includes('-BridgeTask `"$BridgeTask`"'), "shortcut must pass -BridgeTask");
  assert.ok(argsLine.includes('-WebTask `"$WebTask`"'), "shortcut must pass -WebTask");
});

test("desktop installer still refuses to disable a running executor and never arms LIVE", () => {
  assert.ok(installer.includes("[switch]$KeepExecutorStartup"));
  assert.ok(installer.includes("is currently Running. Keep PAUSE"));
  assert.ok(!/arm-phase7c-live-local/i.test(installer));
});

test("desktop control doc tells operators to keep the executor startup trigger", () => {
  assert.ok(doc.includes("-KeepExecutorStartup"), "doc must show -KeepExecutorStartup");
  assert.ok(doc.includes("XAUUSD-Phase7C-Bridge"), "doc must cover new-machine Bridge task name");
  assert.ok(doc.includes("-SkipMt5Panel"), "doc must cover skipping the panel already installed on a new machine");
});
