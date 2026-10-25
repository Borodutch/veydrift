#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { AREAS, computeScope } from "./ci-scope.mjs";

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
  // Tests and dry runs can pin the scope with CI_SCOPE_<AREA>=true|false.
  const keys = [...AREAS, "storage_layout"];
  const fromEnv = Object.fromEntries(keys.map((key) => [key, envBool("CI_SCOPE_" + key.toUpperCase())]));
  if (Object.values(fromEnv).some((value) => value !== undefined)) {
    const scope = Object.fromEntries(keys.map((key) => [key, fromEnv[key] === true]));
    scope.script_tests = (process.env.CI_SCOPE_SCRIPT_TESTS || "").split(/\s+/).filter(Boolean);
    return scope;
  }
  return computeScope({ base: args.base, head: args.head, eventName: args.event || process.env.GITHUB_EVENT_NAME || "local" });
}

const flaggedOutput = /(^|[^a-z])(warning|warn:|error:)/i;
const allowedFlaggedOutputLines = [
  /^\((?:pass|skip)\) /,
  /^[✔﹣] /, // node --test passing/skipped test names
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

function runCaptured(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => resolve({ status: null, signal: null, error, output }));
    child.on("close", (status, signal) => resolve({ status, signal, error: undefined, output }));
  });
}

// Runs one check and logs it as one block. Returns false (after logging the full output) on failure.
async function runLogged(label, command, args) {
  const started = Date.now();
  const result = await runCaptured(command, args);
  const header = `\n== ${label} ==\n$ ${[command, ...args].join(" ")}\n`;
  const seconds = `${((Date.now() - started) / 1000).toFixed(1)}s`;

  if (result.status !== 0) {
    // Flush the complete failure; an async pipe write followed by process.exit truncated
    // large test logs before their failing assertions.
    await writeCheckOutput(header + result.output);
    if (result.signal) console.error(`${label} terminated by ${result.signal}.`);
    if (result.error) console.error(result.error);
    console.error(`::error::${label} failed after ${seconds}.`);
    return false;
  }

  if (outputContainsFlaggedOutput(result.output)) {
    await writeCheckOutput(header + result.output);
    console.error(`::error::${label} output contains flagged output.`);
    return false;
  }

  // Bun's backend suite deliberately exercises many negative read paths and emits
  // structured diagnostics for them. Keeping that entire successful stream in the
  // Actions log can throttle the runner; retain it on any failure, but record a
  // concise success marker otherwise.
  console.log(`${header}${label} passed in ${seconds}.`);
  return true;
}

// One CI job per area: contracts, backend (also the shared packages' and repo-wide tooling checks) and frontend.
// A job whose area a change doesn't touch plans nothing and finishes in seconds. The group names are fixed
// (they are required statuses). Within a group the checks run as a few side-by-side chains, each chain in
// order; `pre` steps run first, before the chains. Without a group (local preflight) everything runs in order.
export const CHECK_GROUPS = ["all", "contracts", "backend", "frontend"];
const PLACE = {
  "frontend-precheck": ["frontend", "pre"],
  "frontend-test": ["frontend", 0],
  "frontend-typecheck": ["frontend", 1],
  "frontend-build": ["frontend", 1],
  "frontend-browser": ["frontend", 2],
  // contracts-build and contracts-test share plain's compile cache, so they run in order; the manifest
  // tests and the fast/storage checks build into their own out dirs (src only), so they run next to them.
  "contracts-build": ["contracts", 0],
  "contracts-test": ["contracts", 0],
  "deployment-manifest-test": ["contracts", 1],
  "referral-migration-manifest-test": ["contracts", 1],
  "contracts-fast-check": ["contracts", 1],
  "contracts-storage-check": ["contracts", 1],
  "backend-test": ["backend", 0],
};
// Everything else (backend typecheck, universe, stats, keeper, chicken, docs and script tests) is backend chain 1.
const place = (label) => PLACE[label] ?? ["backend", 1];

export function planChecks(scope, group = "all") {
  if (!CHECK_GROUPS.includes(group)) throw new Error(`unknown check group "${group}" (use ${CHECK_GROUPS.join(", ")})`);
  const plan = [];
  const add = (label, command, args) => plan.push({ label, command, args });
  const note = (label, message) => plan.push({ label, note: message });

  // Documentation-only changes must run these too; neither needs Bun or installed packages.
  add("docs-link-tests", "node", ["--test", "scripts/veydrift-docs-links-check.test.mjs"]);
  add("docs-check", "node", ["scripts/veydrift-docs-content-check.mjs"]);
  for (const testFile of scope.script_tests ?? []) {
    // The CI workflow already runs this one first, in the rest job, on every PR.
    if (group !== "all" && testFile === "scripts/ci-run-scoped-checks.test.mjs") continue;
    add(`script-test ${testFile}`, "node", ["--test", testFile]);
  }

  if (scope.universe) {
    add("universe-check", "bun", ["run", "check:universe"]);
    add("universe-test", "bun", ["run", "test:universe"]);
  }

  if (scope.backend) {
    add("backend-check", "bun", ["run", "check:backend"]);
    add("backend-test", "bun", ["run", "test:backend"]);
    add("backend-performance-tool-test", "bun", ["run", "test:api-latency-report"]);
    add("release-diagnostics-test", "node", ["--test", "scripts/veydrift-safe-diagnostics.test.mjs"]);
  }

  if (scope.frontend) {
    // Image derivatives and pinned media that Vite, the unit tests and the browser tests all read.
    add("frontend-precheck", "bash", ["-lc", "cd apps/frontend && bun scripts/generate-image-variants.mjs && bun scripts/media.mjs sync"]);
    add("frontend-typecheck", "bash", ["-lc", "cd apps/frontend && ../../node_modules/.bin/tsc --project tsconfig.json"]);
    add("frontend-test", "bun", ["run", "test:frontend"]);
    add("frontend-build", "bun", ["run", "build:frontend"]);
    add("frontend-browser", "bash", ["-lc", "cd apps/frontend && node scripts/touch-browser.mjs"]);
  }

  if (scope.stats) add("stats-check", "bun", ["run", "check:stats"]);

  if (scope.keeper) {
    add("keeper-check", "bun", ["run", "check:keeper"]);
    add("keeper-test", "bun", ["run", "test:keeper"]);
  }

  if (scope.chicken) {
    add("chicken-burn-listener-check", "bun", ["run", "check:chicken-burn-listener"]);
    add("chicken-burn-listener-test", "bun", ["run", "test:chicken-burn-listener"]);
  }

  if (scope.contracts) {
    add("deployment-manifest-test", "node", [
      "--test",
      "scripts/veydrift-deployment-manifest.test.mjs",
      "scripts/veydrift-upgrade-receipt.test.mjs",
    ]);
    add("referral-migration-manifest-test", "node", ["--test",
      "scripts/veydrift-referral-migration-input.test.mjs",
      "scripts/veydrift-referral-migration-manifest.test.mjs",
      "scripts/veydrift-referral-migration-live-shape.test.mjs",
      "scripts/veydrift-referral-migration-repeat.test.mjs",
    ]);
    // Compile check of src, test and script on plain (getplain.org), plus the two out/ artifacts the
    // mixed-proxy proof reads (in contracts-test). plain's compile cache is shared by every runner, so
    // this is near-free after the first build; forge build was a cold via-IR compile (~7 min) on each
    // runner. (plain 0.4.0's whole-project --out stops at lib/ files, hence the two named sources.)
    add("contracts-build", "bash", ["-lc",
      "cd packages/contracts && plain build && plain build src/VeydriftGame.sol src/VeydriftBatchTransportModule.sol --out out"]);
    add("contracts-fast-check", "bun", ["run", "check:contracts:fast"]);
    add("contracts-test", "bun", ["run", "test:contracts"]);
    if (scope.storage_layout) {
      add("contracts-storage-check", "bun", ["run", "check:contracts:storage"]);
    } else {
      note("contracts-storage-check", "Skipped: no storage-relevant contract files changed.");
    }
  }

  if (group === "all") return plan;
  return plan.filter(({ label }) => place(label)[0] === group);
}

// In a CI group the `pre` steps run first, then each chain in order with the chains side by side;
// the local preflight ("all") runs every step in order.
async function runPlan(plan, concurrent) {
  const steps = plan.filter((step) => !step.note);
  const serial = async (chain) => {
    for (const step of chain) if (!(await runLogged(step.label, step.command, step.args))) return false;
    return true;
  };
  if (!concurrent) return serial(steps);
  if (!(await serial(steps.filter((step) => place(step.label)[1] === "pre")))) return false;
  const chains = [0, 1, 2].map((chain) => steps.filter((step) => place(step.label)[1] === chain));
  return (await Promise.all(chains.map(serial))).every(Boolean);
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
  for (const step of plan) if (step.note) console.log(`\n== ${step.label} ==\n${step.note}`);
  if (!(await runPlan(plan, group !== "all"))) process.exit(1);
  if (!plan.some((step) => !step.note && !step.label.startsWith("docs-"))) {
    console.log(group === "all" ? "No package checks needed for this change." : `No ${group} checks needed for this change.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
