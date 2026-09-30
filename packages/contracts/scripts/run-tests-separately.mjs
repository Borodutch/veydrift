#!/usr/bin/env node

import {readdirSync, readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const TEST_FUNCTION = /function\s+(?:test|testFuzz|invariant)\w*\s*\(/g;

// Deterministically split test files into `count` shards with balanced test counts
// (largest file first, each onto the lightest shard). Returns the files for shard `index` (1-based).
export function shardTestFiles(files, testCounts, index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) {
    throw new Error(`invalid contract test shard ${index}/${count}`);
  }
  const shards = Array.from({length: count}, () => ({load: 0, files: []}));
  const ordered = [...files].sort((a, b) => (testCounts[b] ?? 0) - (testCounts[a] ?? 0) || a.localeCompare(b));
  for (const file of ordered) {
    const lightest = shards.reduce((best, shard) => (shard.load < best.load ? shard : best));
    lightest.files.push(file);
    lightest.load += Math.max(1, testCounts[file] ?? 0);
  }
  return shards[index - 1].files.sort();
}

export function parseShard(value) {
  if (!value) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`CONTRACT_TEST_SHARD must look like 1/3, got "${value}"`);
  return {index: Number(match[1]), count: Number(match[2])};
}

// Only this multi-transaction driver exceeds Forge's aggregate default. Every
// actual resolver call remains explicitly capped at 15M in the Solidity fixture.
export function forgeTestArgs(file) {
  const args = ["test", "--match-path", `test/${file}`];
  if (file === "VeydriftStagedCombat.t.sol") {
    args.push("--isolate", "--gas-limit", "100000000000");
  }
  return args;
}

function main() {
  let testFiles = readdirSync("test")
    .filter((file) => file.endsWith(".t.sol"))
    .sort();

  const shard = parseShard(process.env.CONTRACT_TEST_SHARD);
  if (shard) {
    const counts = Object.fromEntries(testFiles.map((file) => [
      file,
      (readFileSync(`test/${file}`, "utf8").match(TEST_FUNCTION) || []).length,
    ]));
    testFiles = shardTestFiles(testFiles, counts, shard.index, shard.count);
    console.log(`Contract test shard ${shard.index}/${shard.count}: ${testFiles.join(", ")}`);
  }

  for (const file of testFiles) {
    const testPath = `test/${file}`;
    console.log(`\n== ${testPath} ==`);
    const result = spawnSync("forge", forgeTestArgs(file), {
      stdio: "inherit",
    });

    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
