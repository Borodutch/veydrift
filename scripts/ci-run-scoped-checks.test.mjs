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

test("allows Foundry contract size table rows", () => {
  const output = "| Errors                              | 3                | 31                | 24,573             | 49,121              |";

  assert.equal(outputContainsFlaggedOutput(output), false);
});

test("allows Foundry unicode contract size table rows", () => {
  const output = [
    "╭-------------------------------------+------------------+-------------------+--------------------+---------------------╮",
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
