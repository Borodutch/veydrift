#!/usr/bin/env node
import { readFileSync } from "node:fs";

const requiredFiles = [
  "docs/open-alpha-state-preservation.md",
  "docs/veydrift-contract-redeploy-runbook.md",
  "README.md",
  "packages/contracts/README.md",
  "packages/contracts/script/Deploy.s.sol"
];

const read = (path) => readFileSync(path, "utf8");

function requireIncludes(path, needles) {
  const contents = read(path);
  const missing = needles.filter((needle) => !contents.includes(needle));
  if (missing.length > 0) {
    throw new Error(`${path} is missing required alpha policy text: ${missing.join(", ")}`);
  }
}

for (const file of requiredFiles) {
  read(file);
}

requireIncludes("docs/open-alpha-state-preservation.md", [
  "Veydrift is in open alpha as of 2026-05-29",
  "Do not wipe current alpha state",
  "Prefer an implementation upgrade on an existing proxy",
  "If a full redeploy is unavoidable, migrate state",
  "Backend indexed state is part of the user-visible state surface",
  "Do not mark a redeploy or upgrade task done unless"
]);

requireIncludes("docs/veydrift-contract-redeploy-runbook.md", [
  "Migration Verification Gate",
  "No alpha player state exists",
  "Migration plan approved",
  "VEYDRIFT_ALPHA_REDEPLOY_ACK",
  "proxy upgrade, no-state redeploy, or migrated redeploy"
]);

requireIncludes("packages/contracts/script/Deploy.s.sol", [
  "VEYDRIFT_ALPHA_REDEPLOY_ACK",
  "OPEN_ALPHA_STATE_PRESERVATION_ACK_REQUIRED"
]);

requireIncludes("README.md", [
  "open alpha as of 2026-05-29",
  "docs/open-alpha-state-preservation.md"
]);

requireIncludes("packages/contracts/README.md", [
  "open alpha as of 2026-05-29",
  "No alpha player state exists",
  "Migration plan approved",
  "VEYDRIFT_ALPHA_REDEPLOY_ACK"
]);

console.log("Alpha state preservation check passed.");
