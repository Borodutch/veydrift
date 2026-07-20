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

  if (eventName === "pull_request" || diffBase.startsWith("origin/")) {
    const baseRef = diffBase.startsWith("origin/") ? diffBase : `origin/${diffBase}`;
    git(["fetch", "--no-tags", "--depth=1", "origin", baseRef.replace(/^origin\//, "")]);
    try {
      return diffNames(`${baseRef}...${diffHead}`);
    } catch {
      return diffNames(`${baseRef}..${diffHead}`);
    }
  }

  if (diffBase && !zeroSha(diffBase)) {
    try {
      return diffNames(`${diffBase}..${diffHead}`);
    } catch {
      return ["package.json"];
    }
  }

  return [];
}

function anyMatch(files, pattern) {
  return files.some((file) => pattern.test(file));
}

export function filesRequireBackendChecks(files) {
  return anyMatch(files, /^(apps\/backend|packages\/universe)\//)
    || anyMatch(
      files,
      /^scripts\/(ci-(run-scoped-checks|scope)|veydrift-api-(latency-report|route-benchmark))(\.test)?\.mjs$/,
    );
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

  const repoWide = anyMatch(files, /^(\.github\/workflows\/ci\.yml|package\.json|bun\.lockb)$/);
  const scope = {
    frontend: false,
    backend: false,
    universe: false,
    contracts: false,
    circuits: false,
    storage_layout: false,
    full_build: false,
    changed_count: files.length,
  };

  if (eventName !== "pull_request" && eventName !== "local") {
    scope.frontend = true;
    scope.backend = true;
    scope.universe = true;
    scope.contracts = true;
    scope.circuits = true;
    scope.full_build = true;
  } else if (repoWide) {
    scope.frontend = true;
    scope.backend = true;
    scope.universe = true;
    scope.contracts = true;
    scope.circuits = true;
  } else {
    scope.frontend = anyMatch(files, /^(apps\/frontend|packages\/universe)\//);
    scope.backend = filesRequireBackendChecks(files);
    scope.universe = anyMatch(files, /^packages\/universe\//);
    scope.contracts = anyMatch(files, /^packages\/contracts\//);
    scope.circuits = anyMatch(files, /^packages\/circuits\//);
  }

  scope.storage_layout =
    repoWide ||
    anyMatch(
      files,
      /^packages\/contracts\/(src\/.*\.sol|foundry\.toml|package\.json|storage-layout\/|scripts\/(check|regen)-storage-layout\.mjs)/,
    );

  scope.any_package_check =
    scope.frontend || scope.backend || scope.universe || scope.contracts || scope.circuits || scope.full_build;
  scope.files = files;
  return scope;
}

function writeGithubOutput(path, scope) {
  const lines = [];
  for (const [key, value] of Object.entries(scope)) {
    if (key === "files") continue;
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
      `changed=${scope.changed_count} frontend=${scope.frontend} backend=${scope.backend} universe=${scope.universe} contracts=${scope.contracts} circuits=${scope.circuits} storage_layout=${scope.storage_layout} full_build=${scope.full_build}`,
    );
  }
}
