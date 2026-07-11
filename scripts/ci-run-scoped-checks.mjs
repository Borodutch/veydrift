#!/usr/bin/env node
import { spawn } from "node:child_process";
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let pendingLine = "";
    let flagged = false;
    let tail = "";
    const tailLimit = 128 * 1024;

    const consume = (chunk) => {
      const output = chunk.toString();
      tail = `${tail}${output}`.slice(-tailLimit);
      const lines = `${pendingLine}${output}`.split(/\r?\n/);
      pendingLine = lines.pop();
      if (outputContainsFlaggedOutput(lines.join("\n"))) flagged = true;
    };

    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => reject(new Error(`${label} failed to run: ${error.message}`)));
    child.on("close", (code) => {
      if (pendingLine && outputContainsFlaggedOutput(pendingLine)) flagged = true;
      if (code !== 0 || flagged) {
        process.stdout.write(tail);
        reject(new Error(code !== 0 ? `${label} exited with ${code}` : `${label} output contains flagged output.`));
        return;
      }
      console.log(`${label}: passed`);
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = scopeFromEnvOrGit(args);

  if (scope.universe) {
    await runLogged("universe-check", "bun", ["run", "check:universe"]);
    await runLogged("universe-test", "bun", ["run", "test:universe"]);
  }

  if (scope.backend) {
    await runLogged("backend-check", "bun", ["run", "check:backend"]);
    await runLogged("backend-test", "bun", ["run", "test:backend"]);
  }

  if (scope.frontend) {
    await runLogged("frontend-precheck", "bash", ["-lc", "cd apps/frontend && bun scripts/generate-image-variants.mjs"]);
    await runLogged("frontend-typecheck", "bash", ["-lc", "cd apps/frontend && ../../node_modules/.bin/tsc --project tsconfig.json"]);
  }

  if (scope.circuits) {
    await runLogged("circuits-check", "bun", ["run", "check:circuits"]);
  }

  if (scope.contracts) {
    await runLogged("contracts-fast-check", "bun", ["run", "check:contracts:fast"]);
    await runLogged("contracts-test", "bun", ["run", "test:contracts"]);
    if (scope.storage_layout) {
      await runLogged("contracts-storage-check", "bun", ["run", "check:contracts:storage"]);
    } else {
      console.log("\n== contracts-storage-check ==\nSkipped: no storage-relevant contract files changed.");
    }
  }

  if (scope.full_build) {
    await runLogged("build", "bun", ["run", "build"]);
  }

  if (!scope.frontend && !scope.backend && !scope.universe && !scope.contracts && !scope.circuits && !scope.full_build) {
    console.log("No package checks needed for this change.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
