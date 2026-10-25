#!/usr/bin/env node
// bun test runs files one after another in one process. This splits the given test files (or
// directories) into N bun test processes that run side by side, balanced by file size, and
// prints each process's output as one block. Usage: node bun-test-parallel.mjs <N> <paths...>
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [count, ...paths] = process.argv.slice(2);
const isTest = (name) => /\.test\.tsx?$/.test(name);
const files = [];
const walk = (path) => {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) if (entry !== "node_modules") walk(join(path, entry));
  } else if (isTest(path)) files.push(path);
};
for (const path of paths) walk(path);

// Largest first, each onto the lightest process.
const shards = Array.from({ length: Math.min(Number(count) || 1, files.length) }, () => ({ size: 0, files: [] }));
for (const file of files.map((file) => [file, statSync(file).size]).sort((a, b) => b[1] - a[1])) {
  const lightest = shards.reduce((best, shard) => (shard.size < best.size ? shard : best));
  lightest.files.push(file[0]);
  lightest.size += file[1];
}

const results = await Promise.all(shards.map(({ files }) => new Promise((resolve) => {
  const child = spawn("bun", ["test", ...files], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  child.on("close", (code) => resolve({ code, log }));
})));
// Wait for each write: exiting right after an async pipe write truncated the log (CI run 603).
for (const { log } of results) await new Promise((resolve) => process.stdout.write(log, resolve));
process.exit(results.every(({ code }) => code === 0) ? 0 : 1);
