#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { computeScope } from "./ci-scope.mjs";

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

function envBool(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === "true";
}

function scopeFromEnvOrGit(args) {
  const fromEnv = {
    frontend: envBool("CI_SCOPE_FRONTEND"),
    backend: envBool("CI_SCOPE_BACKEND"),
    universe: envBool("CI_SCOPE_UNIVERSE"),
    contracts: envBool("CI_SCOPE_CONTRACTS"),
    storage_layout: envBool("CI_SCOPE_STORAGE_LAYOUT"),
    full_build: envBool("CI_SCOPE_FULL_BUILD"),
  };

  if (Object.values(fromEnv).some((value) => value !== undefined)) {
    return Object.fromEntries(
      Object.entries(fromEnv).map(([key, value]) => [key, value === true]),
    );
  }

  return computeScope({ base: args.base, head: args.head, eventName: args.event || "local" });
}

const flaggedOutput = /(^|[^a-z])(warning|warn:|error:)/i;
const allowedFlaggedOutputLines = [
  /^\((?:pass|skip)\) /,
  /^Missing dependencies found\. Installing now\.\.\.$/,
  /^[╭╮╰╯├┤┬┴┼─│╞╪╡═+|]/,
  /^- Adjust chunk size limit for this warning via build\.chunkSizeWarningLimit\.$/,
  // Frontend browser tests run the Vite dev server without a backend; its dev proxy logs
  // each unanswered API request. Only these exact local-proxy lines are tolerated.
  /^\d{1,2}:\d{2}:\d{2}(?: [AP]M)? \[vite\] http proxy error: \/\S*$/,
  /^Error: connect ECONNREFUSED 127\.0\.0\.1:4000$/,
];

export function outputContainsFlaggedOutput(output) {
  return output
    .split(/\r?\n/)
    .some((line) => {
      const normalizedLine = line
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
        .trim();
      if (allowedFlaggedOutputLines.some((pattern) => pattern.test(normalizedLine))) return false;
      return flaggedOutput.test(normalizedLine);
    });
}

export async function writeCheckOutput(output) {
  await new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => error ? reject(error) : resolve());
  });
}

async function runLogged(label, command, args) {
  console.log(`\n== ${label} ==`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status !== 0) {
    // Flush the complete failure before exiting; an async pipe write followed
    // by process.exit truncated large test logs before their failing assertions.
    await writeCheckOutput(output);
    if (result.signal) console.error(`${label} terminated by ${result.signal}.`);
    if (result.error) console.error(result.error);
    process.exit(result.status || 1);
  }

  if (outputContainsFlaggedOutput(output)) {
    await writeCheckOutput(output);
    console.error(`::error::${label} output contains flagged output.`);
    process.exit(1);
  }

  // Bun's backend suite deliberately exercises many negative read paths and emits
  // structured diagnostics for them. Keeping that entire successful stream in the
  // GitHub Actions log can throttle the runner before later contract checks begin;
  // retain it on any failure, but record a concise success marker otherwise.
  console.log(`${label} passed.`);
}

// Heavy checks get their own parallel CI job; everything else runs in the "rest" group.
// Without a group (local preflight) every applicable check runs in one process, as before.
export const CHECK_GROUPS = ["all", "rest", "build", "browser", "contracts-test"];
const HEAVY = { build: "build", "frontend-touch-browser": "browser", "contracts-test": "contracts-test" };

export function planChecks(scope, group = "all") {
  if (!CHECK_GROUPS.includes(group)) throw new Error(`unknown check group "${group}" (use ${CHECK_GROUPS.join(", ")})`);
  const plan = [];
  const add = (label, command, args) => plan.push({ label, command, args });
  const note = (label, message) => plan.push({ label, note: message });

  // Documentation-only changes must run these too; neither needs Bun or installed packages.
  add("docs-link-tests", "node", ["--test", "scripts/veydrift-docs-links-check.test.mjs"]);
  add("docs-check", "node", ["scripts/veydrift-docs-content-check.mjs"]);

  if (scope.universe) {
    add("universe-check", "bun", ["run", "check:universe"]);
    add("universe-test", "bun", ["run", "test:universe"]);
  }

  if (scope.backend) {
    add("backend-check", "bun", ["run", "check:backend"]);
    add("backend-test", "bun", ["run", "test:backend"]);
    add("backend-performance-tool-test", "bun", ["run", "test:api-latency-report"]);
    add("release-diagnostics-test", "node", ["--test", "scripts/veydrift-safe-diagnostics.test.mjs", "scripts/veydrift-delivery-timing.test.mjs"]);
  }

  if (scope.frontend) {
    add("frontend-precheck", "bash", ["-lc", "cd apps/frontend && bun scripts/generate-image-variants.mjs"]);
    add("frontend-typecheck", "bash", ["-lc", "cd apps/frontend && ../../node_modules/.bin/tsc --project tsconfig.json"]);
    add("frontend-test", "bun", ["run", "test:frontend"]);
    add("frontend-touch-browser", "bash", ["-lc", "cd apps/frontend && bun run test:touch-browser"]);
    add("stats-check", "bun", ["run", "check:stats"]);
  }

  if (scope.contracts) {
    add("deployment-manifest-test", "node", [
      "--test",
      "scripts/veydrift-deployment-manifest.test.mjs",
      "scripts/veydrift-upgrade-receipt.test.mjs",
    ]);
    add("referral-migration-manifest-test", "node", ["--test",
      "scripts/veydrift-referral-migration-manifest.test.mjs",
      "scripts/veydrift-referral-migration-live-shape.test.mjs",
      "scripts/veydrift-referral-migration-repeat.test.mjs",
    ]);
    add("contracts-fast-check", "bun", ["run", "check:contracts:fast"]);
    add("contracts-test", "bun", ["run", "test:contracts"]);
    if (scope.storage_layout) {
      add("contracts-storage-check", "bun", ["run", "check:contracts:storage"]);
    } else {
      note("contracts-storage-check", "Skipped: no storage-relevant contract files changed.");
    }
  }

  if (scope.full_build) {
    add("build", "bun", ["run", "build"]);
  }

  if (group === "all") return plan;
  const selected = plan.filter(({ label }) => (HEAVY[label] || "rest") === group);
  // Heavy groups run in their own job, so they repeat the cheap frontend asset preparation they rely on.
  const precheck = plan.find(({ label }) => label === "frontend-precheck");
  if (precheck && ["browser", "build"].includes(group) && selected.length) selected.unshift(precheck);
  return selected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = scopeFromEnvOrGit(args);
  const group = args.group || process.env.CI_CHECK_GROUP || "all";
  const plan = planChecks(scope, group);

  if (args.list) {
    for (const step of plan) console.log(step.note ? `${step.label} (${step.note})` : step.label);
    return;
  }
  for (const step of plan) {
    if (step.note) console.log(`\n== ${step.label} ==\n${step.note}`);
    else await runLogged(step.label, step.command, step.args);
  }
  if (!plan.some((step) => !step.note && !step.label.startsWith("docs-"))) {
    console.log(group === "all" ? "No package checks needed for this change." : `No ${group} checks needed for this change.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
