#!/usr/bin/env node
// bun test runs files one after another in one process. This runs each given test file (or the test
// files under each directory) in its own bun test process, N at a time, slowest first, and prints each
// file's output as one block. Usage: node bun-test-pool.mjs <N> <paths...>
// For suites with a few slow files (the backend); bun-test-parallel.mjs suits many small files, where a
// process per file costs more than it saves.
// Each file's last run time is kept in node_modules/.cache (the CI runners keep their workspace), so the
// slowest files start first; a file without a recorded time is estimated from its size.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

const cacheDir = "node_modules/.cache";
const timesFile = join(cacheDir, "bun-test-times.json");
let times = {};
try {
  times = JSON.parse(readFileSync(timesFile, "utf8"));
} catch {}
// About 50 KB of test source per second, for files that have not run here yet.
const estimate = (file) => times[file] ?? statSync(file).size / 50_000;
const queue = [...files].sort((a, b) => estimate(b) - estimate(a));

const results = new Map();
const worker = async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const started = performance.now();
    results.set(file, await new Promise((resolve) => {
      const child = spawn("bun", ["test", file], { stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      child.stdout.on("data", (chunk) => { log += chunk; });
      child.stderr.on("data", (chunk) => { log += chunk; });
      child.on("close", (code) => resolve({ code, log }));
    }));
    times[file] = (performance.now() - started) / 1000;
  }
};
await Promise.all(Array.from({ length: Math.min(Number(count) || 1, files.length) }, worker));

try {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(timesFile, JSON.stringify(times));
} catch {}
// Wait for each write: exiting right after an async pipe write truncated the log (CI run 603).
for (const file of files) await new Promise((resolve) => process.stdout.write(results.get(file).log, resolve));
process.exit(files.every((file) => results.get(file).code === 0) ? 0 : 1);
