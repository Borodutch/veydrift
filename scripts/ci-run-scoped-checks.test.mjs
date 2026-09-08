import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { outputContainsFlaggedOutput } from "./ci-run-scoped-checks.mjs";

test("passing test names may describe warnings without being diagnostics", () => {
  assert.equal(outputContainsFlaggedOutput("(pass) warning UI > renders a warning badge"), false);
  assert.equal(outputContainsFlaggedOutput("(pass) warning UI > renders a warning badge\nwarning: unexpected diagnostic"), true);
});
import { filesRequireContractChecks } from "./ci-scope.mjs";

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

test("still flags warnings and errors", () => {
  assert.equal(outputContainsFlaggedOutput("warning: unused variable"), true);
  assert.equal(outputContainsFlaggedOutput("::error::contracts-fast-check failed"), true);
});
