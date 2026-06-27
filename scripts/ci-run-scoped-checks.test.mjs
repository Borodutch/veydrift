import test from "node:test";
import assert from "node:assert/strict";
import { outputContainsFlaggedOutput } from "./ci-run-scoped-checks.mjs";

test("allows Foundry dependency bootstrap notice", () => {
  const output = [
    "Missing dependencies found. Installing now...",
    "Compiling 14 files with Solc 0.8.28",
    "Compiler run successful!",
  ].join("\n");

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("still flags warnings and errors", () => {
  assert.equal(outputContainsFlaggedOutput("warning: unused variable"), true);
  assert.equal(outputContainsFlaggedOutput("::error::contracts-fast-check failed"), true);
});
