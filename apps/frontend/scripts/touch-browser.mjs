#!/usr/bin/env node
// Runs the browser smoke tests: real headless Chrome against the Vite dev server, for what unit tests
// can't see (layout at real widths, touch scrolling, navigation). Kept deliberately small so CI stays
// fast; app logic belongs in unit tests. Every file runs at once (the tests mostly wait on the browser),
// each in its own process with its own Chrome, Vite server and Vite cache dir; the long planet picker
// file as SHARDS processes, each with every SHARDS-th of its tests.
import { spawn } from "node:child_process";

export const FILES = ["planetPickerTouchBrowser", "levelPopupLayout", "galaxySlots", "productionQueueSizing", "sidebar", "currentState"];
const SHARDS = { planetPickerTouchBrowser: 2 };

// Resolves to the process's exit code and full log.
function run(file, shard) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", `tests/${file}.browser.mjs`], {
      env: shard ? { ...process.env, BROWSER_TEST_SHARD: shard } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("close", (code) => {
      // One block per process, so side-by-side runs never interleave their output.
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(`\n# ${file}${shard ? ` ${shard}` : ""} (exit ${code} after ${seconds}s)\n${log}`);
      resolve(code === 0);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = FILES.flatMap((file) => SHARDS[file]
    ? Array.from({ length: SHARDS[file] }, (_, i) => run(file, `${i + 1}/${SHARDS[file]}`))
    : [run(file)]);
  process.exit((await Promise.all(runs)).every(Boolean) ? 0 : 1);
}
