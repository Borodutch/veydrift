#!/usr/bin/env node
// Runs the browser test suite. `node scripts/touch-browser.mjs` runs every file one after another;
// `node scripts/touch-browser.mjs <lane>` runs one CI lane: its two chains run side by side, each
// chain's files one after another. Every file has its own Vite cache dir, so chains never share one.
// "file@k/n" runs shard k of n of a file (tests/shard.mjs), so the two slowest files spread over lanes.
// Lanes are balanced by measured durations (~1 min each on an idle M1 Max).
import { spawn } from "node:child_process";

export const LANES = [
  [["batchSupply@1/3"], ["planetPickerTouchBrowser@1/3", "galaxySlots"]],
  [["batchSupply@2/3", "levelPopupLayout"], ["planetPickerTouchBrowser@2/3", "productionQueueSizing"]],
  [["batchSupply@3/3", "sidebar"], ["planetPickerTouchBrowser@3/3", "docsTables", "riftPage"]],
  [["supplyActions", "currentState"], ["levelSupply", "resolvedGroupMissions", "planetFleetActivity", "combatModelRefresh",
    "trailerPlayer", "publicMoonActions", "demolishIcon", "loopAnimations"]],
];

function run(unit) {
  const [file, shard] = unit.split("@");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", `tests/${file}.browser.mjs`], {
      env: shard ? { ...process.env, BROWSER_TEST_SHARD: shard } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => {
      // One block per file, so side-by-side chains never interleave their output.
      process.stdout.write(`\n# ${unit} (exit ${code})\n${output}`);
      resolve(code === 0);
    });
  });
}

// In a CI lane a failed file runs once more: the runners are shared with simulators and other jobs,
// and a first run that times out while Vite is still optimizing a cold dep cache never saves it.
// A real failure fails both times.
async function chain(units, retry) {
  let ok = true;
  for (const unit of units) {
    let passed = await run(unit);
    if (!passed && retry) {
      process.stdout.write(`\n# RETRY ${unit}: failed once, running it again\n`);
      passed = await run(unit);
    }
    ok = passed && ok;
  }
  return ok;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lane = process.argv[2];
  if (lane && !LANES[Number(lane) - 1]) throw new Error(`no browser lane ${lane} (1-${LANES.length})`);
  const results = lane
    ? await Promise.all(LANES[Number(lane) - 1].map((units) => chain(units, true)))
    : [await chain(LANES.flat(2))];
  process.exit(results.every(Boolean) ? 0 : 1);
}
