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

// Resolves to the file's exit code and full log.
function run(unit) {
  const [file, shard] = unit.split("@");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", `tests/${file}.browser.mjs`], {
      env: shard ? { ...process.env, BROWSER_TEST_SHARD: shard } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("close", (code) => resolve({ code, log }));
  });
}

// In a CI lane a failed file runs once more: the runners are shared with simulators and other jobs,
// and a first run that times out while Vite is still optimizing a cold dep cache never saves it.
// A real failure fails both times. A passing retry logs one line instead of the first attempt's
// log, because the CI check runner treats any logged error line as a failure.
async function chain(units, retry) {
  let ok = true;
  for (const unit of units) {
    let result = await run(unit);
    if (result.code !== 0 && retry) {
      const first = result;
      result = await run(unit);
      process.stdout.write(`\n# ${unit}: first attempt exited ${first.code}, retried${result.code === 0 ? "" : `\n${first.log}`}\n`);
    }
    // One block per file, so side-by-side chains never interleave their output.
    process.stdout.write(`\n# ${unit} (exit ${result.code})\n${result.log}`);
    ok = result.code === 0 && ok;
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
