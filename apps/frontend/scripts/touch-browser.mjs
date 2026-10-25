#!/usr/bin/env node
// Runs the browser smoke tests: real headless Chrome against the Vite dev server, for what unit tests
// can't see (layout at real widths, touch scrolling, navigation). Kept deliberately small so CI stays
// fast; app logic belongs in unit tests. The files run as side-by-side chains (the tests mostly wait on
// the browser, ~0.3 core each), each chain's files one after another; every file has its own Vite cache dir.
import { spawn } from "node:child_process";

export const CHAINS = [
  ["planetPickerTouchBrowser"],
  ["levelPopupLayout", "galaxySlots"],
  ["productionQueueSizing", "sidebar", "currentState"],
];

// Resolves to the file's exit code and full log.
function run(unit) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", `tests/${unit}.browser.mjs`], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("close", (code) => resolve({ code, log }));
  });
}

async function chain(units) {
  let ok = true;
  for (const unit of units) {
    const result = await run(unit);
    // One block per file, so side-by-side chains never interleave their output.
    process.stdout.write(`\n# ${unit} (exit ${result.code})\n${result.log}`);
    ok = result.code === 0 && ok;
  }
  return ok;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await Promise.all(CHAINS.map(chain));
  process.exit(results.every(Boolean) ? 0 : 1);
}
