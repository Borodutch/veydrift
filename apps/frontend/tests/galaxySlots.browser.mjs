import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Galaxy preserves all 15 slots for sparse captured systems, navigation and reload", { timeout: 300_000 }, async (t) => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-galaxy-slots-"));
  const server = await createServer({ cacheDir: `node_modules/.vite-browser/galaxySlots`, logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.GALAXY_SLOTS_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/galaxySlots.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: { ...process.env, HOME: process.env.HOME },
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    // The page's current URL (from main-frame navigations), so a stalled command says where it stalled.
    let id = 0, buffered = "", sessionId, pageUrl = "about:blank";
    // Under a loaded CI Mac one command can take tens of seconds (a cold Vite transform, a starved
    // renderer), so the cap is generous; waits that poll use a short cap and retry instead (until()).
    // Commands slower than 5 s, and ones that time out (including retried tries), are reported as
    // test diagnostics with their expression and page.
    function send(method, params = {}, { page = true, timeout = 60_000 } = {}) {
      const commandId = ++id;
      const what = method + (params.expression ? "(" + JSON.stringify(params.expression.length > 200 ? params.expression.slice(0, 80) + "…" + params.expression.slice(-120) : params.expression) + ")" : "");
      const started = Date.now();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(commandId);
          const error = Object.assign(new Error(what + " timed out after " + timeout / 1000 + "s on " + pageUrl), { timedOut: true });
          t.diagnostic(error.message);
          reject(error);
        }, timeout);
        pending.set(commandId, { resolve, reject, timer, settled: () => { const ms = Date.now() - started; if (ms > 5_000) t.diagnostic("slow CDP command (" + ms + " ms) on " + pageUrl + ": " + what); } });
        chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
      });
    }
    chrome.stdio[4].on("data", chunk => {
      buffered += chunk.toString();
      let end;
      while ((end = buffered.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) pageUrl = message.params.frame.url.replace(/^https?:\/\/[^/]+/, "");
        const command = pending.get(message.id);
        if (!command) continue;
        pending.delete(message.id); clearTimeout(command.timer); command.settled();
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      }
    });
    await send("Browser.getVersion", {}, { page: false });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, { page: false });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, { page: false }));
    await send("Page.enable");
    async function evaluate(expression, timeout) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, { timeout });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    // Polls a short expression until it's true. A try that stalls or fails (a navigation or reload in
    // flight, a starved renderer) is abandoned and retried, so only the wait's own deadline (well
    // inside the test's) can fail it, with the expression, page and last error. Tries get 5 s, doubled
    // after each timeout up to 20 s, so a renderer that stays slow still gets to answer.
    async function until(expression, deadline = 90_000) {
      const end = Date.now() + deadline;
      let last, cap = 5_000;
      for (;;) {
        try {
          if (await evaluate(expression, Math.max(1_000, Math.min(cap, end - Date.now())))) return;
          last = undefined;
        } catch (error) {
          last = error;
          if (error.timedOut) cap = Math.min(cap * 2, 20_000);
        }
        t.signal.throwIfAborted();
        if (Date.now() > end) throw new Error("Not true after " + deadline / 1000 + "s on " + pageUrl + ": " + expression + (last ? "\nLast try: " + last.message : ""));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    const captures = JSON.parse(readFileSync(new URL('./fixtures/galaxySlots.json', import.meta.url), 'utf8'));
    // Select row containers by their leading slot badge, for both empty and planet rows.
    const rowExpression = '[...document.querySelectorAll("main .grid > div")].filter(row => row.children.length > 1 && row.firstElementChild && /^(?:[1-9]|1[0-5])$/.test(row.firstElementChild.textContent.trim()))';
    async function ready(galaxy = 5, system = 199, empty = false) {
      await until('(' + rowExpression + ').length === 15 && ' + (empty ? 'true' : 'document.querySelector(' + JSON.stringify('button[aria-label="Open Planet ' + galaxy + '.' + system + '.1"]') + ') !== null'));
    }
    // Page.navigate and Page.reload can return before the old document goes away: mark it and wait
    // for a document without the mark, or ready() can pass on the page being replaced.
    async function replacePage(method, params) {
      await evaluate('window.replacedPage = true');
      await send(method, params);
      await until('window.replacedPage !== true');
    }
    async function load(query, width) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      await replacePage('Page.navigate', { url: url + '?' + query });
      await ready(5, 199, query.includes('empty'));
    }
    async function commit(label, value) {
      await evaluate('(() => { const input = document.querySelector(' + JSON.stringify('input[aria-label="' + label + '"]') + '); input.focus(); input.value = ' + JSON.stringify(String(value)) + '; input.dispatchEvent(new Event("input", { bubbles: true })); })()');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await evaluate('new Promise(requestAnimationFrame)');
    }
    async function check(capture, label, { trailing = false, empty = false } = {}) {
      const rows = await evaluate('(' + rowExpression + ').map(row => ({ position: Number(row.firstElementChild.textContent), text: row.innerText, name: row.querySelector("button[aria-label^=Open]")?.getAttribute("aria-label") ?? null }))');
      assert.deepEqual(rows.map(row => row.position), Array.from({ length: 15 }, (_, i) => i + 1), label + ': all slot numbers');
      for (const row of rows) {
        const planet = capture.planets.find(planet => planet.position === row.position && !empty && (!trailing || planet.position < 13));
        if (!planet) {
          assert.equal(row.name, null, label + ': empty ' + row.position);
          assert.match(row.text, /Empty space/, label + ': empty label ' + row.position);
        } else {
          const name = planet.name?.trim() || 'Planet ' + capture.galaxy + '.' + capture.system + '.' + planet.position;
          assert.equal(row.name, 'Open ' + name, label + ': identity ' + row.position);
          assert.ok(row.text.includes(planet.fields + ' fields'), label + ': fields ' + row.position);
          assert.equal(row.text.includes('Unclaimed'), !planet.occupiedBy, label + ': occupancy ' + row.position);
          assert.ok(!row.text.includes('Empty space'), label + ': not empty ' + row.position);
          await evaluate('document.querySelector(' + JSON.stringify('button[aria-label=' + JSON.stringify('Open ' + name) + ']') + ').click()');
          await evaluate('new Promise(requestAnimationFrame)');
          assert.deepEqual(JSON.parse(await evaluate('document.querySelector("output").textContent')), { galaxy: capture.galaxy, system: capture.system, position: row.position }, label + ': selection coordinates');
        }
      }
      // Clipped at the fold is not omitted: scroll slot 15 into the viewport and hit-test it.
      assert.ok(await evaluate('(() => { const row = (' + rowExpression + ')[14]; row.scrollIntoView({ block: "center" }); const box = row.getBoundingClientRect(); return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && row.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })()'), label + ': slot 15 visible after scroll');
      measurements.push({ label, rows });
      if (artifacts && label.endsWith('initial')) {
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        writeFileSync(join(artifacts, label + '.png'), Buffer.from(data, 'base64'));
      }
    }
    for (const width of [1440, 390]) {
      for (const query of ['', 'reverse=1']) {
        const label = width + '-' + (query ? 'reversed' : 'ordered');
        await load(query, width);
        await check(captures[0], label + '-initial');
        await replacePage('Page.reload', { ignoreCache: true });
        await ready();
        await check(captures[0], label + '-reload');
        for (const capture of [...captures.slice(1), captures[0]]) {
          // System first so the galaxy change commits the final target coordinates.
          await commit('System', capture.system);
          await commit('Galaxy', capture.galaxy);
          await ready(capture.galaxy, capture.system);
          await check(capture, label + '-switch-' + capture.galaxy + '-' + capture.system);
        }
      }
      for (const variant of ['trailing', 'empty']) {
        await load(variant + '=1&reverse=1', width);
        await check(captures[0], width + '-' + variant, { [variant]: true });
      }
    }
    if (artifacts) writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log('Verified ' + measurements.length + ' rendered states / ' + measurements.length * 15 + ' rows');
  } finally {
    for (const command of pending.values()) clearTimeout(command.timer);
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      // Its profile is a temp dir: nothing to save, so no graceful shutdown.
      chrome.kill("SIGKILL");
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
