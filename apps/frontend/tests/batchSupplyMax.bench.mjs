// Run from apps/frontend: node --test tests/batchSupplyMax.bench.mjs
// SUPPLY_MAX_BASELINE=1 measures ticket63 base. Local disposable Chrome, no wallet/API.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

test("Supply production worker cold and warm latency", { timeout: 240_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for worker benchmark");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const baseline = process.env.SUPPLY_MAX_BASELINE === "1";
  const bundled = await build({ configFile: false, logLevel: "error", build: { write: false, minify: true, rollupOptions: { input: "src/batchSupplyMax.worker.ts", output: { format: "es", inlineDynamicImports: true } } }, plugins: baseline ? [{ name: "baseline-planner", enforce: "pre", load(id) { if (id.endsWith('/batchSupplyPlanner.ts')) return execFileSync("git", ["show", "420aaa8a:apps/frontend/src/batchSupplyPlanner.ts"], { encoding: "utf8" }); } }] : [] });
  const workerCode = bundled.output.find(item => item.type === "chunk").code;
  console.log(JSON.stringify({ baseline, workerBytes: Buffer.byteLength(workerCode) }));
  let workerRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/max-benchmark-worker.js") { workerRequests++; res.setHeader("Content-Type", "text/javascript"); res.end(workerCode); }
    else { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Worker benchmark</title>"); }
  });
  let chrome;
  const pending = new Map();
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/max-benchmark.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    function send(method, params = {}, page = true) {
      const commandId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 120_000);
        pending.set(commandId, { resolve, reject, timer });
        chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
      });
    }
    chrome.stdio[4].on("data", chunk => {
      buffered += chunk.toString();
      let end;
      while ((end = buffered.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        if (message.method === "Runtime.exceptionThrown") console.error("Browser exception", JSON.stringify(message.params));
        const command = pending.get(message.id);
        if (!command) continue;
        pending.delete(message.id); clearTimeout(command.timer);
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      }
    });
    console.log(JSON.stringify(await send("Browser.getVersion", {}, false)));
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, false));
    await send("Page.enable");
    await send("Runtime.enable");
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await send("Page.navigate", { url });
    for (const count of [9, 15]) for (const fuelStarved of [false, true]) {
      const result = await evaluate(
        `(async () => {
          const sources = Array.from({ length: COUNT }, (_, i) => ({
            planetId: String(i), label: String(i), coordinates: { galaxy: 6, system: 10 + i, position: 14 },
            resources: { metal: 250000000, crystal: 1000000, deuterium: STARVED ? 10 : 1000000 },
            ships: { largeCargo: STARVED ? 10000 : 40, smallCargo: STARVED ? 0 : 20 }, driveLevels: {},
          }));
          const options = { targetCoordinates: { galaxy: 6, system: 9, position: 12 }, sources, selectedPlanetIds: new Set(sources.map(s => s.planetId)), requested: { metal: 0, crystal: 0, deuterium: 0 }, maxOrders: 15 };
          const timings = []; let maximum;
          for (let i = 0; i < 3; i++) {
            const start = performance.now();
            const worker = new Worker('/max-benchmark-worker.js', { type: 'module' });
            maximum = await new Promise((resolve, reject) => { worker.onmessage = e => resolve(e.data.maximum); worker.onerror = reject; worker.postMessage({ options, resource: 'metal' }); });
            timings.push(performance.now() - start); worker.terminate();
          }
          return { maximum, timings };
        })()`.replaceAll('COUNT', String(count)).replaceAll('STARVED', String(fuelStarved)));
      console.log(JSON.stringify({ count, fuelStarved, ...result }));
    }
  } finally {
    console.log(JSON.stringify({ workerRequests, apiRequests: 0 }));
    if (chrome && chrome.exitCode === null) await new Promise(resolve => { chrome.once("exit", resolve); chrome.kill(); });
    await new Promise(resolve => server.close(resolve));
    for (const command of pending.values()) { clearTimeout(command.timer); command.reject(new Error('closed')); }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
