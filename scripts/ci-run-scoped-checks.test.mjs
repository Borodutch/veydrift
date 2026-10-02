import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputContainsFlaggedOutput } from "./ci-run-scoped-checks.mjs";

test("PR and push CI select the same scoped checks for the same change", () => {
  const dir = mkdtempSync(join(tmpdir(), "veydrift-ci-parity-"));
  const scopeScript = new URL("./ci-scope.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  for (const key of ["BASE_REF", "HEAD_REF", "BEFORE_SHA", "GITHUB_SHA", "GITHUB_EVENT_PATH", "EVENT_NAME", "GITHUB_EVENT_NAME"]) {
    delete env[key];
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env });
  const scope = (event, base) => JSON.parse(execFileSync(process.execPath, [
    scopeScript, "--event", event, "--base", base, "--head", "HEAD", "--json",
  ], { cwd: dir, encoding: "utf8", env }));
  const areas = (result) => ["universe", "backend", "frontend", "stats", "keeper", "chicken", "contracts", "storage_layout"]
    .filter((key) => result[key]);
  const expected = {
    "README.md": [],
    "docs/guide.md": [],
    "apps/backend/src/example.ts": ["backend"],
    "apps/frontend/src/example.ts": ["frontend"],
    "apps/stats/src/example.ts": ["stats"],
    "apps/battle-keeper/src/example.ts": ["keeper"],
    "packages/universe/src/example.ts": ["universe", "backend", "frontend"],
    "packages/api-types/src/index.ts": ["backend", "frontend"],
    "packages/contracts/test/Example.t.sol": ["contracts"],
    "packages/contracts/src/Example.sol": ["backend", "contracts", "storage_layout"],
    "package.json": ["universe", "backend", "frontend", "stats", "keeper", "chicken", "contracts", "storage_layout"],
    "Dockerfile": ["universe", "backend", "frontend", "stats", "keeper", "chicken", "contracts", "storage_layout"],
  };
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.invalid");
    git("commit", "--allow-empty", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    git("checkout", "-b", "change");
    for (const [file, want] of Object.entries(expected)) {
      git("reset", "--hard", base);
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "fixture\n");
      git("add", file);
      git("commit", "-m", "fixture change");
      const pr = scope("pull_request", "main");
      const push = scope("push", base);
      assert.deepEqual(pr, push, file);
      assert.deepEqual(areas(pr).sort(), [...want].sort(), file);
    }
    // A push whose previous tip is unknown checks everything.
    assert.equal(scope("push", "0000000000000000000000000000000000000000").full, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a changed script runs its own tests", async () => {
  const { changedScriptTests } = await import("./ci-scope.mjs");
  const exists = (path) => path === "scripts/a.test.mjs";
  assert.deepEqual(changedScriptTests(["scripts/a.mjs", "scripts/a.test.mjs", "scripts/b.mjs", "docs/a.mjs"], exists), ["scripts/a.test.mjs"]);
});

test("documentation checks run when no package checks are selected", () => {
  const env = { ...process.env };
  // This child runs its own node:test process, rather than joining the parent's test context.
  delete env.NODE_TEST_CONTEXT;
  for (const area of ["UNIVERSE", "BACKEND", "FRONTEND", "STATS", "KEEPER", "CHICKEN", "CONTRACTS", "STORAGE_LAYOUT"]) {
    env["CI_SCOPE_" + area] = "false";
  }
  const result = spawnSync(process.execPath, ["scripts/ci-run-scoped-checks.mjs"], {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /docs-link-tests passed/);
  assert.match(result.stdout, /docs-check passed/);
  assert.match(result.stdout, /No package checks needed/);
});

test("passing test names may describe warnings without being diagnostics", () => {
  assert.equal(outputContainsFlaggedOutput("(pass) warning UI > renders a warning badge"), false);
  assert.equal(outputContainsFlaggedOutput("(pass) warning UI > renders a warning badge\nwarning: unexpected diagnostic"), true);
  assert.equal(outputContainsFlaggedOutput("✔ passing test names may describe warnings (0.6ms)"), false);
});
import { filesRequireContractChecks, filesRequireFrontendChecks, filesRequireBackendChecks } from "./ci-scope.mjs";

test("shared JSON contracts require both frontend and backend validation", () => {
  const files = ["packages/api-types/src/index.ts"];
  assert.equal(filesRequireFrontendChecks(files), true);
  assert.equal(filesRequireBackendChecks(files), true);
  assert.equal(filesRequireContractChecks(files), false);
});

test("flushes a large failure log to a pipe before exiting", () => {
  const moduleUrl = new URL("./ci-run-scoped-checks.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { writeCheckOutput } from ${JSON.stringify(moduleUrl)};
    await writeCheckOutput("x".repeat(200000) + "FAILURE DETAIL\\n");
    process.exit(1);
  `], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.length, 200015);
  assert.ok(result.stdout.endsWith("FAILURE DETAIL\n"));
});

test("routes deployment proof changes through blocking contract CI", () => {
  assert.equal(filesRequireContractChecks(["scripts/veydrift-postdeploy-smoke.mjs"]), true);
  assert.equal(filesRequireContractChecks(["scripts/veydrift-upgrade-receipt.test.mjs"]), true);
  assert.equal(filesRequireContractChecks(["docs/deployment.md"]), false);
});

test("allows Foundry dependency bootstrap notice", () => {
  const output = [
    "Missing dependencies found. Installing now...",
    "Compiling 14 files with Solc 0.8.28",
    "Compiler run successful!",
  ].join("\n");

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("allows Foundry contract size table rows", () => {
  const output = "| Errors                              | 3                | 31                | 24,573             | 49,121              |";

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("allows Foundry unicode contract size table rows", () => {
  const output = [
    "╭-------------------------------------+------------------+-------------------+--------------------+---------------------╮",
    "╞═════════════════════════════════════╪══════════════════╪═══════════════════╪════════════════════╪═════════════════════╡",
    "│ Errors                              │ 3                │ 31                │ 24,573             │ 49,121              │",
  ].join("\n");

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("allows ANSI-colored Foundry contract size table rows", () => {
  const output = "\u001b[32m| Errors                              | 3                | 31                | 24,573             | 49,121              |\u001b[0m";

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("allows only the exact Vite chunk-size explanation, not other diagnostics", () => {
  const viteLine = "- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.";
  assert.equal(outputContainsFlaggedOutput(viteLine), false);
  assert.equal(outputContainsFlaggedOutput(`${viteLine}\u001b[39m`), false); // Captured CI build output.
  assert.equal(outputContainsFlaggedOutput(`${viteLine} warning: unexpected`), true);
  assert.equal(outputContainsFlaggedOutput("- warning: unexpected diagnostic"), true);
  assert.equal(outputContainsFlaggedOutput(`${viteLine}\nwarning: unexpected diagnostic`), true);
  assert.equal(outputContainsFlaggedOutput("warning: unused variable"), true);
  assert.equal(outputContainsFlaggedOutput("warning[unsafe-typecast]: typecasts that can truncate values should be checked"), true);
  assert.equal(outputContainsFlaggedOutput("::error::contracts-fast-check failed"), true);
});

test("tolerates only the Vite dev-proxy noise from backend-less browser tests", () => {
  const noise = [
    "\u001b[2m10:42:55 AM\u001b[22m \u001b[31m\u001b[1m[vite]\u001b[22m\u001b[39m \u001b[31mhttp proxy error: /missions?status=active&live=1\u001b[39m",
    "Error: connect ECONNREFUSED 127.0.0.1:4000",
    "✔ desktop sidebar commits the reported Overview (422.66ms)",
  ].join("\n");
  assert.equal(outputContainsFlaggedOutput(noise), false);
  assert.equal(outputContainsFlaggedOutput(noise + "\nError: connect ECONNREFUSED 127.0.0.1:5432"), true);
  assert.equal(outputContainsFlaggedOutput(noise + "\nError: request failed with status 500"), true);
});

import { planChecks, CHECK_GROUPS } from "./ci-run-scoped-checks.mjs";
import { shardTestFiles, parseShard } from "../packages/contracts/scripts/run-tests-separately.mjs";

const FULL_SCOPE = { universe: true, backend: true, frontend: true, stats: true, keeper: true, chicken: true, contracts: true, storage_layout: true };
const labels = (plan) => plan.map((step) => step.label);

test("parallel check groups partition the full sequential plan", () => {
  const all = labels(planChecks(FULL_SCOPE));
  const grouped = CHECK_GROUPS.filter((group) => group !== "all")
    .flatMap((group) => labels(planChecks(FULL_SCOPE, group)))
    .filter((label, index, list) => label !== "frontend-precheck" || list.indexOf(label) === index);
  assert.deepEqual([...grouped].sort(), [...all].sort());
  assert.deepEqual(labels(planChecks(FULL_SCOPE, "contracts")), ["contracts-build", "contracts-fast-check", "contracts-test"]);
  assert.deepEqual(labels(planChecks(FULL_SCOPE, "contracts-storage")), ["contracts-storage-check"]);
  assert.deepEqual(labels(planChecks(FULL_SCOPE, "browser")), ["frontend-precheck", "frontend-touch-browser"]);
  assert.ok(!labels(planChecks(FULL_SCOPE, "rest")).some((label) => label.startsWith("contracts-") || label === "frontend-touch-browser"));
  assert.throws(() => planChecks(FULL_SCOPE, "nope"), /unknown check group/);
});

test("groups with nothing in scope plan no checks", () => {
  const docsOnly = Object.fromEntries(Object.keys(FULL_SCOPE).map((key) => [key, false]));
  assert.deepEqual(labels(planChecks(docsOnly, "rest")), ["docs-link-tests", "docs-check"]);
  for (const group of ["browser", "contracts", "contracts-storage"]) assert.deepEqual(planChecks(docsOnly, group), []);
});

test("a backend-only change plans only cheap backend checks", () => {
  const backend = { ...Object.fromEntries(Object.keys(FULL_SCOPE).map((key) => [key, false])), backend: true };
  assert.deepEqual(labels(planChecks(backend, "rest")), ["docs-link-tests", "docs-check", "backend-check", "backend-test",
    "backend-performance-tool-test", "release-diagnostics-test"]);
  for (const group of ["browser", "contracts", "contracts-storage"]) assert.deepEqual(planChecks(backend, group), []);
});

test("contract test shards cover every file exactly once and isolate the largest file", () => {
  const counts = { "Game.t.sol": 306, "Moon.t.sol": 82, "Alliance.t.sol": 51, "A.t.sol": 17, "B.t.sol": 16, "C.t.sol": 14, "D.t.sol": 1 };
  const files = Object.keys(counts);
  const shards = [1, 2, 3].map((index) => shardTestFiles(files, counts, index, 3));
  assert.deepEqual(shards.flat().sort(), [...files].sort());
  assert.deepEqual(shards[0], ["Game.t.sol"]);
  assert.deepEqual(parseShard("2/3"), { index: 2, count: 3 });
  assert.equal(parseShard(""), null);
  assert.throws(() => shardTestFiles(files, counts, 4, 3), /invalid contract test shard/);
  assert.throws(() => parseShard("two"), /must look like/);
});

test("contract test files that mutate process state get their own forge process", async () => {
  const { splitTestFiles } = await import("../packages/contracts/scripts/run-tests-separately.mjs");
  const sources = { "A.t.sol": "vm.setEnv(\"X\", \"1\");", "B.t.sol": "vm.writeJson(json, path);", "C.t.sol": "assertEq(1, 1);", "VeydriftStagedCombat.t.sol": "" };
  assert.deepEqual(splitTestFiles(Object.keys(sources), sources), { own: ["A.t.sol", "B.t.sol", "VeydriftStagedCombat.t.sol"], shared: ["C.t.sol"] });
});
