import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  FORK_GUARD,
  inspectWorkflowText,
  inspectWorkflowDirectory,
} from "./check-self-hosted-fork-guard.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const header = (trigger) => `name: Sample\n\non:\n${trigger}\n\npermissions:\n  contents: read\n\njobs:\n`;

test("self-hosted job on pull_request without guard is rejected", () => {
  const text = `${header("  pull_request:\n    branches:\n      - main")}  build:\n    runs-on: [self-hosted, Windows, X64, xauusd-core-ci]\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(text), ["build"]);
});

test("self-hosted job with fork guard is accepted", () => {
  const text = `${header("  pull_request:\n  push:\n    branches: [main]")}  build:\n    if: ${FORK_GUARD}\n    runs-on: [self-hosted, Windows, X64, xauusd-core-ci]\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(text), []);
});

test("self-hosted job whose condition requires push or workflow_dispatch is accepted", () => {
  for (const cond of [
    "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    "github.event_name == 'workflow_dispatch'",
    "github.event.pull_request.head.repo.full_name == github.repository",
  ]) {
    const text = `${header("  pull_request:")}  prod:\n    if: ${cond}\n    runs-on: [self-hosted, Windows]\n    steps:\n      - run: echo hi\n`;
    assert.deepEqual(inspectWorkflowText(text), [], cond);
  }
});

test("a guard that can still be true for fork pull requests is rejected", () => {
  for (const cond of [
    "always()",
    "github.event_name != 'push'",
    "github.event_name == 'push' || github.event_name == 'pull_request'",
  ]) {
    const text = `${header("  pull_request:")}  prod:\n    if: ${cond}\n    runs-on: [self-hosted, Windows]\n    steps:\n      - run: echo hi\n`;
    assert.deepEqual(inspectWorkflowText(text), ["prod"], cond);
  }
});

test("hosted runners and workflows without pull_request are not flagged", () => {
  const hosted = `${header("  pull_request:")}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(hosted), []);
  const dispatchOnly = `${header("  workflow_dispatch:")}  ops:\n    runs-on: [self-hosted, Windows]\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(dispatchOnly), []);
});

test("pull_request_target and workflow_run are rejected on any workflow", () => {
  const prt = `${header("  pull_request_target:")}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(prt), ["<trigger:pull_request_target>"]);
  const wr = `${header("  workflow_run:\n    workflows: [x]")}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(wr), ["<trigger:workflow_run>"]);
});

test("inline trigger lists are understood", () => {
  const text = `name: x\non: [push, pull_request]\njobs:\n  build:\n    runs-on: [self-hosted]\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(inspectWorkflowText(text), ["build"]);
});

test("every repository workflow keeps fork PRs off the self-hosted runner", () => {
  const violations = inspectWorkflowDirectory(resolve(repoRoot, ".github", "workflows"));
  assert.deepEqual(violations, []);
});
