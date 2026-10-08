#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const TRUE = "true";
const FALSE = "false";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function diffNames(range) {
  return git(["diff", "--name-only", range])
    .split("\n")
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function githubEventBefore() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) return "";
  try {
    const event = JSON.parse(readFileSync(path, "utf8"));
    return typeof event.before === "string" ? event.before : "";
  } catch {
    return "";
  }
}

function zeroSha(value) {
  return /^0+$/.test(value);
}

function changedFiles({ base, head = "HEAD", eventName = "local" } = {}) {
  const diffBase = base || process.env.BASE_REF || "";
  const diffHead = head || "HEAD";

  // A pull_request checkout is GitHub's merge commit: its first parent is the base branch tip,
  // so HEAD^1..HEAD is exactly the change the PR introduces. A squash-merge push to main diffs
  // against the previous main tip. Both therefore select the same checks for the same change.
  if (eventName === "pull_request") {
    try {
      return diffNames(`${diffHead}^1..${diffHead}`);
    } catch {
      return ["package.json"];
    }
  }

  if (diffBase.startsWith("origin/")) {
    git(["fetch", "--no-tags", "--depth=1", "origin", diffBase.replace(/^origin\//, "")]);
    try {
      return diffNames(`${diffBase}...${diffHead}`);
    } catch {
      return diffNames(`${diffBase}..${diffHead}`);
    }
  }

  if (diffBase && !zeroSha(diffBase)) {
    try {
      return diffNames(`${diffBase}..${diffHead}`);
    } catch {
      return ["package.json"];
    }
  }

  // No usable base (new branch, force push, unfetched history): check everything.
  return eventName === "local" ? [] : ["package.json"];
}

function anyMatch(files, pattern) {
  return files.some((file) => pattern.test(file));
}

// Each area's checks run when the area itself or anything it reads changes.
export function filesRequireUniverseChecks(files) {
  return anyMatch(files, /^packages\/universe\//);
}

export function filesRequireBackendChecks(files) {
  return anyMatch(files, /^(apps\/backend|packages\/(universe|api-types))\//)
    // Backend tests read contract sources and storage layouts.
    || anyMatch(files, /^packages\/contracts\/(src|storage-layout)\//)
    || anyMatch(
      files,
      /^scripts\/(veydrift-api-(latency-report|route-benchmark)|veydrift-(redeploy-preflight|redeploy-readiness-probe|safe-diagnostics))(\.test)?\.mjs$/,
    );
}

export function filesRequireFrontendChecks(files) {
  return anyMatch(files, /^(apps\/frontend|packages\/(universe|api-types))\//)
    || anyMatch(files, /^packages\/contracts\/combat-preview-catalog\.json$/)
    || anyMatch(files, /^scripts\/veydrift-test-frontend-config-check\.mjs$/);
}

export function filesRequireStatsChecks(files) {
  return anyMatch(files, /^apps\/stats\//);
}

export function filesRequireKeeperChecks(files) {
  return anyMatch(files, /^apps\/battle-keeper\//);
}

export function filesRequireChickenChecks(files) {
  return anyMatch(files, /^apps\/chicken-burn-listener\//);
}

export function filesRequireContractChecks(files) {
  return anyMatch(files, /^packages\/contracts\//)
    || anyMatch(files, /^\.gitmodules$/)
    || anyMatch(
      files,
      /^scripts\/(veydrift-(apply-deployment-manifest|deployment-manifest|postdeploy-smoke|upgrade-receipt|referral-migration-[a-z-]+)|mission-batch-[a-z-]+)(\.test)?\.(mjs|ts)$/,
    );
}

// Changes that affect every package (toolchain, lockfile, CI itself) run the full suite.
const REPO_WIDE = /^(\.github\/workflows\/ci\.yml|package\.json|bun\.lockb|tsconfig\.base\.json|nixpacks(\.[a-z]+)?\.toml)$/;
// Paths no check reads (beyond the docs checks, which always run).
const NO_CHECKS = /^(docs\/|[^/]+\.md$|\.dockerignore$|\.gitignore$|LICENSE$|\.github\/(?!workflows\/ci\.yml))/;
const AREA_PATHS = /^(apps\/(backend|frontend|stats|battle-keeper|chicken-burn-listener)|packages\/(universe|api-types|contracts))\//;

// scripts/<name>.mjs and scripts/<name>.test.mjs: a change runs that script's own tests.
export function changedScriptTests(files, exists = existsSync) {
  const names = files
    .map((file) => /^scripts\/([^/]+?)(\.test)?\.mjs$/.exec(file)?.[1])
    .filter(Boolean);
  const tests = names.map((name) => `scripts/${name}.test.mjs`);
  if (files.some((file) => file.startsWith("scripts/base-node/"))) tests.push("scripts/base-node-reliability.test.mjs");
  return unique(tests).filter((test) => exists(test));
}

export function computeScope(options = {}) {
  const eventName = options.eventName || process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME || "local";
  const base =
    options.base ||
    process.env.BASE_REF ||
    (eventName === "push" ? process.env.BEFORE_SHA || githubEventBefore() : "origin/main");
  const head = options.head || process.env.HEAD_REF || process.env.GITHUB_SHA || "HEAD";
  const files = unique([
    ...changedFiles({ base, head, eventName }),
    ...(eventName === "local" ? diffNames("HEAD") : []),
    ...(eventName === "local" ? git(["diff", "--cached", "--name-only"]).split("\n") : []),
    ...(eventName === "local" ? git(["ls-files", "--others", "--exclude-standard"]).split("\n") : []),
  ]);

  const scriptTests = changedScriptTests(files);
  const known = (file) => AREA_PATHS.test(file) || NO_CHECKS.test(file) || /^scripts\//.test(file);
  // Anything unclassified is treated as repo-wide rather than silently skipped.
  const full = anyMatch(files, REPO_WIDE) || files.some((file) => !known(file));

  const scope = {
    universe: full || filesRequireUniverseChecks(files),
    backend: full || filesRequireBackendChecks(files),
    frontend: full || filesRequireFrontendChecks(files),
    stats: full || filesRequireStatsChecks(files),
    keeper: full || filesRequireKeeperChecks(files),
    chicken: full || filesRequireChickenChecks(files),
    contracts: full || filesRequireContractChecks(files),
    storage_layout:
      full ||
      anyMatch(
        files,
        /^packages\/contracts\/(src\/.*\.sol|foundry\.toml|package\.json|storage-layout\/|scripts\/(check|regen)-storage-layout\.mjs)/,
      ),
    full,
    changed_count: files.length,
  };
  scope.any_package_check = AREAS.some((area) => scope[area]);
  scope.script_tests = scriptTests;
  scope.files = files;
  return scope;
}

export const AREAS = ["universe", "backend", "frontend", "stats", "keeper", "chicken", "contracts"];

function writeGithubOutput(path, scope) {
  const lines = [];
  for (const [key, value] of Object.entries(scope)) {
    if (key === "files" || key === "script_tests") continue;
    lines.push(`${key}=${value ? TRUE : FALSE}`);
  }
  appendFileSync(path, `${lines.join("\n")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const scope = computeScope({
    base: args.base,
    head: args.head,
    eventName: args.event || process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME,
  });

  if (args["github-output"]) {
    writeGithubOutput(args["github-output"], scope);
  }

  if (args.json || !args["github-output"]) {
    console.log(JSON.stringify(scope, null, 2));
  } else {
    console.log(
      `changed=${scope.changed_count} full=${scope.full} ` + AREAS.map((area) => `${area}=${scope[area]}`).join(" "),
    );
  }
}
