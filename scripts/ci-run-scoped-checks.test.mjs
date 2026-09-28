import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputContainsFlaggedOutput } from "./ci-run-scoped-checks.mjs";

test("PR and push CI select every check, while local preflight stays scoped", () => {
  const dir = mkdtempSync(join(tmpdir(), "veydrift-ci-parity-"));
  const scopeScript = new URL("./ci-scope.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  for (const key of ["BASE_REF", "HEAD_REF", "BEFORE_SHA", "GITHUB_SHA", "GITHUB_EVENT_PATH"]) {
    delete env[key];
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env });
  const scope = (event, base) => JSON.parse(execFileSync(process.execPath, [
    scopeScript, "--event", event, "--base", base, "--head", "HEAD", "--json",
  ], { cwd: dir, encoding: "utf8", env }));
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.invalid");
    git("commit", "--allow-empty", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    git("remote", "add", "origin", dir);
    git("checkout", "-b", "change");
    for (const file of ["README.md", "apps/frontend/src/example.ts", "packages/contracts/test/Example.t.sol", "packages/contracts/src/Example.sol", "package.json"]) {
      git("reset", "--hard", base);
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "fixture\n");
      git("add", file);
      git("commit", "-m", "fixture change");
      const pr = scope("pull_request", "main");
      const push = scope("push", base);
      assert.deepEqual(pr, push, file);
      for (const key of ["frontend", "backend", "universe", "contracts", "storage_layout", "full_build", "any_package_check"]) {
        assert.equal(pr[key], true, file + ": " + key);
      }
      if (file === "README.md") {
        assert.equal(scope("local", base).any_package_check, false);
      }
      if (file === "packages/contracts/test/Example.t.sol") {
        const local = scope("local", base);
        assert.equal(local.contracts, true);
        assert.equal(local.frontend, false);
        assert.equal(local.full_build, false);
        assert.equal(local.storage_layout, false);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("documentation checks run when no package checks are selected", () => {
  const env = { ...process.env };
  // This child runs its own node:test process, rather than joining the parent's test context.
  delete env.NODE_TEST_CONTEXT;
  for (const area of ["FRONTEND", "BACKEND", "UNIVERSE", "CONTRACTS", "STORAGE_LAYOUT", "FULL_BUILD"]) {
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
