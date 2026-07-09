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
    circuits: envBool("CI_SCOPE_CIRCUITS"),
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
  /^Missing dependencies found\. Installing now\.\.\.$/,
  /^[╭╮╰╯├┤┬┴┼─│╞╪╡═+|\-]/,
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

function runLogged(label, command, args) {
  console.log(`\n== ${label} ==`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  if (outputContainsFlaggedOutput(output)) {
    console.error(`::error::${label} output contains flagged output.`);
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = scopeFromEnvOrGit(args);

  if (scope.universe) {
    runLogged("universe-check", "bun", ["run", "check:universe"]);
    runLogged("universe-test", "bun", ["run", "test:universe"]);
  }

  if (scope.backend) {
    runLogged("backend-check", "bun", ["run", "check:backend"]);
    runLogged("backend-test", "bun", ["run", "test:backend"]);
  }

  if (scope.frontend) {
    runLogged("frontend-precheck", "bash", ["-lc", "cd apps/frontend && bun scripts/generate-image-variants.mjs"]);
    runLogged("frontend-typecheck", "bash", ["-lc", "cd apps/frontend && ../../node_modules/.bin/tsc --project tsconfig.json"]);
  }

  if (scope.circuits) {
    runLogged("circuits-check", "bun", ["run", "check:circuits"]);
  }

  if (scope.contracts) {
    runLogged("contracts-fast-check", "bun", ["run", "check:contracts:fast"]);
    runLogged("contracts-test", "bun", ["run", "test:contracts"]);
    if (scope.storage_layout) {
      runLogged("contracts-storage-check", "bun", ["run", "check:contracts:storage"]);
    } else {
      console.log("\n== contracts-storage-check ==\nSkipped: no storage-relevant contract files changed.");
    }
  }

  if (scope.full_build) {
    runLogged("build", "bun", ["run", "build"]);
  }

  if (!scope.frontend && !scope.backend && !scope.universe && !scope.contracts && !scope.circuits && !scope.full_build) {
    console.log("No package checks needed for this change.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
