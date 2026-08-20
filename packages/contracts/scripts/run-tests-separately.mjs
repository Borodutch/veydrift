#!/usr/bin/env node

import {readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";

const testFiles = readdirSync("test")
  .filter((file) => file.endsWith(".t.sol"))
  .sort();

for (const file of testFiles) {
  const testPath = `test/${file}`;
  console.log(`\n== ${testPath} ==`);
  const result = spawnSync("forge", ["test", "--match-path", testPath], {
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
