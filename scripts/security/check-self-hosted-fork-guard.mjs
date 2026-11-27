// Fail-closed static check: on a public repository, code from a fork pull request
// must never run on the self-hosted runner that lives on the bot machine.
//
// Every job that runs on a self-hosted runner in a workflow triggered by
// `pull_request` must carry a job-level `if:` that is false for fork PRs.
// `pull_request_target` and `workflow_run` are rejected outright because they
// run with repository privileges on behalf of untrusted pull requests.
//
// Note: a fork PR can edit workflow files in its own branch, so this check is
// defence in depth for our own changes. The hard boundary is the GitHub setting
// "Require approval for all external contributors" (or a private repository).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FORK_GUARD =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const SAME_REPO_CLAUSE = "github.event.pull_request.head.repo.full_name == github.repository";
const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"];
const NON_PR_CONJUNCTS = [
  /^github\.event_name == '(push|workflow_dispatch|schedule)'$/,
  /^github\.ref == 'refs\/heads\/main'$/,
];

function stripQuotes(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeCondition(raw) {
  let cond = stripQuotes(raw).trim();
  const expr = /^\$\{\{([\s\S]*)\}\}$/.exec(cond);
  if (expr) cond = expr[1].trim();
  return cond.replace(/\s+/g, " ");
}

export function isForkSafeCondition(raw) {
  if (raw == null) return false;
  const cond = normalizeCondition(raw);
  if (!cond || /always\(\)|failure\(\)|cancelled\(\)/.test(cond)) return false;
  if (cond === FORK_GUARD || cond === SAME_REPO_CLAUSE) return true;
  for (const prefix of [`(${FORK_GUARD}) && `, `${SAME_REPO_CLAUSE} && `]) {
    if (cond.startsWith(prefix) && !cond.slice(prefix.length).includes("||")) return true;
  }
  if (cond.includes("||")) return false;
  const conjuncts = cond.split("&&").map((part) => part.trim().replace(/^\((.*)\)$/, "$1").trim());
  return conjuncts.some(
    (part) => part === SAME_REPO_CLAUSE || NON_PR_CONJUNCTS.some((re) => re.test(part)),
  );
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isContent(line) {
  const t = line.trim();
  return t !== "" && !t.startsWith("#");
}

function topLevelBlock(lines, key) {
  const keyRe = new RegExp(`^(?:${key}|"${key}"|'${key}'):(.*)$`);
  const start = lines.findIndex((line) => keyRe.test(line));
  if (start < 0) return null;
  const inline = keyRe.exec(lines[start])[1].trim();
  let end = start + 1;
  while (end < lines.length && (!isContent(lines[end]) || indentOf(lines[end]) > 0)) end += 1;
  return { inline, body: lines.slice(start + 1, end) };
}

export function workflowTriggers(text) {
  const lines = text.split(/\r?\n/);
  const block = topLevelBlock(lines, "on") ?? topLevelBlock(lines, "true");
  if (!block) return [];
  if (block.inline && !block.inline.startsWith("#")) {
    return block.inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((t) => stripQuotes(t))
      .filter(Boolean);
  }
  const contentLines = block.body.filter(isContent);
  if (contentLines.length === 0) return [];
  const minIndent = Math.min(...contentLines.map(indentOf));
  return contentLines
    .filter((line) => indentOf(line) === minIndent)
    .map((line) => line.trim().replace(/^-\s*/, "").replace(/:.*$/, ""))
    .map(stripQuotes);
}

export function workflowJobs(text) {
  const lines = text.split(/\r?\n/);
  const block = topLevelBlock(lines, "jobs");
  if (!block) return [];
  const body = block.body;
  const contentLines = body.filter(isContent);
  if (contentLines.length === 0) return [];
  const jobIndent = Math.min(...contentLines.map(indentOf));
  const jobs = [];
  let current = null;
  for (const line of body) {
    if (isContent(line) && indentOf(line) === jobIndent) {
      current = { name: stripQuotes(line.trim().replace(/:\s*$/, "")), lines: [] };
      jobs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return jobs.map((job) => {
    const props = job.lines.filter(isContent);
    const propIndent = props.length ? Math.min(...props.map(indentOf)) : 0;
    let runsOn = "";
    let condition = null;
    for (let i = 0; i < job.lines.length; i += 1) {
      const line = job.lines[i];
      if (!isContent(line) || indentOf(line) !== propIndent) continue;
      const trimmed = line.trim();
      if (trimmed.startsWith("runs-on:")) {
        runsOn = trimmed.slice("runs-on:".length);
        for (let j = i + 1; j < job.lines.length; j += 1) {
          if (isContent(job.lines[j]) && indentOf(job.lines[j]) <= propIndent) break;
          runsOn += ` ${job.lines[j].trim()}`;
        }
      } else if (trimmed.startsWith("if:")) {
        condition = trimmed.slice("if:".length).trim();
        if (/^[|>]/.test(condition)) {
          const parts = [];
          for (let j = i + 1; j < job.lines.length; j += 1) {
            if (isContent(job.lines[j]) && indentOf(job.lines[j]) <= propIndent) break;
            parts.push(job.lines[j].trim());
          }
          condition = parts.join(" ");
        }
      }
    }
    return { name: job.name, runsOn, condition };
  });
}

export function inspectWorkflowText(text) {
  const triggers = workflowTriggers(text);
  const violations = FORBIDDEN_TRIGGERS.filter((t) => triggers.includes(t)).map(
    (t) => `<trigger:${t}>`,
  );
  if (!triggers.includes("pull_request")) return violations;
  for (const job of workflowJobs(text)) {
    if (!/self-hosted/i.test(job.runsOn)) continue;
    if (!isForkSafeCondition(job.condition)) violations.push(job.name);
  }
  return violations;
}

export function inspectWorkflowDirectory(directory) {
  const violations = [];
  for (const file of readdirSync(directory).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const job of inspectWorkflowText(readFileSync(join(directory, file), "utf8"))) {
      violations.push(`${file}:${job}`);
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? ".github/workflows");
  const violations = inspectWorkflowDirectory(directory);
  if (violations.length > 0) {
    for (const v of violations) console.error(`SELF_HOSTED_FORK_GUARD_MISSING=${v}`);
    process.exit(1);
  }
  console.log("SELF_HOSTED_FORK_GUARD=PASS");
}
