// Run from apps/frontend: node --test tests/levelPopupLayout.browser.mjs
// Every structure's level popup at phone, landscape and desktop widths: no sideways scrolling, no
// clipped numbers, and equal-height rows. Long effect text may ellipsize only on <=360px phones.
// Optional LEVEL_POPUP_ARTIFACTS writes the measurements.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

const WIDTHS = [320, 360, 390, 640, 700, 768, 1024, 1280];

test("level popups fit every structure at every width", { timeout: 180_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered layout regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-level-popup-"));
  const server = await createServer({
    plugins: [{ name: "level-popup-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.LEVEL_POPUP_ARTIFACTS;
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/levelPopupLayout.html`;
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
    const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const failures = [];
    for (const width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      await send("Page.navigate", { url });
      const deadline = Date.now() + 20_000;
      while (!(await evaluate("Boolean(window.levelPopup)"))) {
        assert.ok(Date.now() < deadline, "level popup fixture did not render");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const cases = await evaluate("window.levelPopup.cases");
      for (let index = 0; index < cases.length; index++) {
        await evaluate(`window.levelPopup.show(${index})`);
        await settle();
        const measured = await evaluate(`(() => {
          const table = document.querySelector('[data-level-info-layer] [role=table]');
          const scroller = table.parentElement;
          const rows = Array.from(table.querySelectorAll('[role=row][data-level-status]'));
          const heights = rows.map(row => row.offsetHeight);
          const clipped = Array.from(table.querySelectorAll('[data-level-fit]')).filter(el => el.scrollWidth > el.clientWidth + 1 && !(el.dataset.levelFit === 'text' && innerWidth <= 360));
          return { tableWidth: table.clientWidth, rows: rows.length, overflow: scroller.scrollWidth - scroller.clientWidth, minHeight: Math.min(...heights), maxHeight: Math.max(...heights),
            clipped: clipped.length, clippedSample: clipped.slice(0, 2).map(el => el.closest('[role=row]').querySelector('[role=rowheader]').textContent + ': ' + el.textContent) };
        })()`);
        const { body, key } = cases[index];
        measurements.push({ width, body, key, ...measured });
        const label = `${body} ${key} @${width}`;
        if (measured.overflow > 1) failures.push(`${label} scrolls sideways by ${measured.overflow}px`);
        if (measured.clipped > 0) failures.push(`${label} clips ${measured.clipped} values, e.g. ${measured.clippedSample.join(" | ")}`);
        // Research requirement/effect text wraps by design; every structure row is one fixed height.
        if (body !== "research" && measured.maxHeight - measured.minHeight > 1) failures.push(`${label} rows range ${measured.minHeight}-${measured.maxHeight}px`);
      }
      console.log("PASS measured level popups", width);
    }
    if (artifacts) {
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, "level-popup-all-layout.json"), JSON.stringify(measurements, null, 2));
    }
    assert.deepEqual(failures, []);
    await send("Browser.close", {}, false);
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
