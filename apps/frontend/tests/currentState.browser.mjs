// Run from apps/frontend: node --test tests/currentState.browser.mjs
// Optional CURRENT_STATE_ARTIFACTS writes screenshots + measured styles for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Current state surfaces render safe lifecycle and inventory at desktop/mobile sizes", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-queue-sizing-"));
  // Local component proof does not need production animation baking or API proxies.
  const server = await createServer({ configFile: false, esbuild: { jsx: "automatic", jsxImportSource: "preact" }, logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.CURRENT_STATE_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/currentState.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    function send(method, params = {}, page = true) {
      const commandId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 15_000);
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
        const command = pending.get(message.id);
        if (!command) continue;
        pending.delete(message.id); clearTimeout(command.timer);
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      }
    });
    await send("Browser.getVersion", {}, false);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, false));
    await send("Page.enable");
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await send("Page.navigate", { url });
    const deadline = Date.now() + 20000;
    while (!(await evaluate("Boolean(window.fixture)"))) { assert.ok(Date.now() < deadline, "fixture load"); await new Promise(r => setTimeout(r, 100)); }
    for (const width of [390, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      for (const [surface, modes] of Object.entries({ defense: ["current", "unknown", "partial", "missile-empty", "missile-partial", "loading", "empty", "error"], shipyard: ["unknown"], control: ["current", "randomness", "queued", "staged", "loading", "empty"], detail: ["current", "randomness", "queued", "staged", "report-pending", "report-failed", "loading", "empty", "error"], forecast: ["current", "missing", "stale", "arrived"], activity: ["current", "indexed"], readiness: ["current"], composer: ["current"], resources: ["unknown"] })) {
        for (const mode of modes) {
          await evaluate("window.fixture.show(" + JSON.stringify(surface) + "," + JSON.stringify(mode) + "); new Promise(requestAnimationFrame)");
          const text = await evaluate('document.querySelector("main").innerText');
          const attrs = await evaluate('[...document.querySelectorAll("[title],[aria-label]")].map(e => [e.title,e.getAttribute("aria-label")].join(" ")).join(" ")');
          assert.doesNotMatch(text + attrs, /Awaiting settlement|Finish defenses|\bResolve\b|randomness|Resolving \d|Recorded |INTERNAL|storage.order|indexing|snapshot|backend/i, surface + ":" + mode);
          if (surface === "defense" && mode === "current") assert.match(text, /Deployed: 101/);
          if (surface === "defense" && mode === "partial") { assert.match(text, /Deployed: 81/); assert.match(text, /Queued: 20/); }
          if (["defense", "shipyard"].includes(surface) && mode === "unknown") {
            assert.match(text + attrs, /Current resources are unavailable/);
            assert.equal(await evaluate('[...document.querySelectorAll("button")].filter(e => e.textContent.trim() === "Build").every(e => e.disabled)'), true);
          }
          if (surface === "defense" && mode.startsWith("missile")) {
            assert.match(text, /Deployed: 17/);
            const max = mode === "missile-partial" ? 2 : 3;
            await evaluate(`document.querySelector('[aria-label="Interplanetary Missile maximum affordable quantity"]').click(); new Promise(requestAnimationFrame)`);
            assert.equal(await evaluate(`document.querySelector('[aria-label="Interplanetary Missile quantity"]').value`), String(max));
          }
          if (surface === "resources") { assert.match(text, /Resources unavailable/); assert.doesNotMatch(text, /999999/); }
          if (["control", "detail"].includes(surface) && mode === "randomness") assert.match(text, /Battle pending/);
          if (["control", "detail"].includes(surface) && mode === "staged") assert.match(text, /Battle in progress/);
          if (["forecast", "composer"].includes(surface)) assert.match(text, /Uncertain/);
          if (surface === "readiness") assert.match(text, /Attacks are temporarily unavailable/);
          if (surface === "activity") {
            const tone = await evaluate('document.querySelector("article > span").className');
            if (mode === "current") measurements.push({ width, tone }); else assert.equal(tone, measurements.at(-1).tone);
            assert.equal(await evaluate('document.querySelectorAll("article a").length'), mode === "indexed" ? 1 : 0);
          }
          if (artifacts && mode === "current") { const image = await send("Page.captureScreenshot", {format: "png"}); writeFileSync(join(artifacts, surface + "-" + width + ".png"), Buffer.from(image.data, "base64")); }
        }
      }
    }
    // The query stays mounted with the SAME descriptor/key across a real chain
    // change; recovery must be store-owned, not a rerun of its mount effect.
    await evaluate('import("/tests/fixtures/supplyPreload.tsx")');
    const readiness = () => evaluate('document.querySelector("#supply-readiness").textContent');
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await settle();
    assert.equal(await evaluate('supplyPreload.calls()'), 1);
    assert.equal(await readiness(), 'loading');
    await evaluate('supplyPreload.chain("84532")'); await settle();
    assert.equal(await evaluate('supplyPreload.calls()'), 2, 'mounted chain switch restarts without remount');
    await evaluate('supplyPreload.finish(0, 1)'); await settle();
    assert.equal(await readiness(), 'loading', 'late previous chain cannot end loading');
    await evaluate('supplyPreload.finish(1, 9)'); await settle();
    assert.equal(await readiness(), '9');
    await evaluate('supplyPreload.chain("0x14a34")'); await settle();
    assert.equal(await evaluate('supplyPreload.calls()'), 2, 'equivalent hex chain preserves ready inventory');
    await evaluate('supplyPreload.chain("8453")'); await settle();
    assert.equal(await readiness(), 'loading', 'ready old inventory removed while replacement loads');
    assert.equal(await evaluate('supplyPreload.calls()'), 3);
    await evaluate('supplyPreload.finish(2, 7)'); await settle();
    assert.equal(await readiness(), '7');
    await evaluate('supplyPreload.dispose()');
    console.log('PASS mounted Supply readiness across pending/ready chain changes');
    await send('Browser.close', {}, false);
  } finally {
    for (const command of pending.values()) clearTimeout(command.timer);
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
