import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

// Docs tables stay legible at any width: a table that would overflow its box stacks into cards, nothing scrolls
// sideways, and addresses always show in full.
test("docs tables never overflow and keep full addresses from phone to desktop widths", { timeout: 180_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered docs layout");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-docs-tables-"));
  const server = await createServer({ cacheDir: `node_modules/.vite-browser/docsTables`, logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: { ...process.env, HOME: process.env.HOME },
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    const send = (method, params = {}, page = true) => new Promise((resolve, reject) => {
      const commandId = ++id;
      const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 30_000);
      pending.set(commandId, { resolve, reject, timer });
      chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
    });
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
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, false));
    await send("Page.enable");
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };

    for (const width of [375, 800, 1280, 1890]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      for (const path of ["/docs", "/docs/concepts", "/docs/catalogs", "/docs/formulas", "/docs/contracts"]) {
        await send("Page.navigate", { url: origin + path });
        const layout = await evaluate(`new Promise(resolve => {
          const started = Date.now();
          const check = () => {
            const boxes = [...document.querySelectorAll(".docs-prose .docs-table")];
            if (!boxes.length && Date.now() - started < 10000) return setTimeout(check, 100);
            // Two frames: the ResizeObserver has measured and any switch to cards has rendered.
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              tables: boxes.length,
              overflowing: boxes.filter(box => box.scrollWidth > box.clientWidth + 1).map(box => box.textContent.slice(0, 60)),
              pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
              shortened: [...document.querySelectorAll(".docs-prose a[href*='/address/'], .docs-prose a[href*='/token/']")]
                .map(link => link.textContent.trim()).filter(text => !/^0x[0-9a-fA-F]{40}$/.test(text)),
            })));
          };
          check();
        })`);
        const where = `${path} at ${width}px`;
        assert.ok(layout.tables > 0, `${where}: no docs tables rendered`);
        assert.deepEqual(layout.overflowing, [], `${where}: a table overflows its box`);
        assert.equal(layout.pageOverflow, false, `${where}: the page scrolls sideways`);
        assert.deepEqual(layout.shortened, [], `${where}: an address link is not shown in full`);
      }
    }
  } finally {
    for (const { timer } of pending.values()) clearTimeout(timer);
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
