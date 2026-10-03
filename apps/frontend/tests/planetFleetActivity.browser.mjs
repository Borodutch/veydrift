import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Mission activity local clock, ticking, cleanup and responsive layout", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-mission-activity-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.MISSION_ACTIVITY_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/planetFleetActivity.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: { ...process.env, HOME: process.env.HOME },
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
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }

    const clocks = [];
    for (const timezoneId of ["America/Vancouver", "Asia/Tokyo"]) {
      await send("Emulation.setTimezoneOverride", { timezoneId });
      for (const width of [1200, 790, 390, 320]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
        await send("Page.navigate", { url });
        const deadline = Date.now() + 20000;
        while (!await evaluate('Boolean(window.fixture && document.querySelectorAll("main a").length === 5 && fixture.timers() === 1)')) {
          assert.ok(Date.now() < deadline, "fixture did not mount: " + await evaluate("document.body.innerText"));
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await evaluate("document.fonts.ready");
        const row = id => '[...document.querySelectorAll("main a")].find(a => a.textContent.includes("#' + id + '"))';
        const text = id => evaluate(row(id) + '.innerText');
        assert.match(await text(95088), /in 1d 2h 3m 4s/);
        assert.match(await text(95163), /in 1m 0s/);
        assert.match(await text(94825), /Lands.*local[\s\S]*in 2s/);
        assert.match(await text(94826), /landing\/settling/);
        assert.match(await text(94827), /ETA unavailable/);
        assert.match(await evaluate(row(95163) + '.getAttribute("href")'), /95163/);
        const clock = await evaluate(row(95163) + '.lastElementChild.firstElementChild.textContent');
        const expectedClock = await evaluate('new Intl.DateTimeFormat(undefined, {dateStyle:"medium", timeStyle:"short"}).format(new Date("2026-09-30T00:01:00Z"))');
        assert.equal(clock, 'Arrives ' + expectedClock + ' local');
        if (width === 1200) clocks.push(clock);
        const measured = await evaluate('[...document.querySelectorAll("main a")].map(a => ({text:a.innerText, clipped:[a, ...a.querySelectorAll("span")].some(s => s.clientWidth > 0 && (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1)), timingOverflow: [...a.lastElementChild.children].some(s => { const r = s.getBoundingClientRect(), p = a.getBoundingClientRect(); return r.left < p.left || r.right > p.right || r.bottom > p.bottom; })}))');
        for (const item of measured) {
          assert.equal(item.clipped, false, width + ': clipping ' + item.text);
          assert.equal(item.timingOverflow, false, width + ': timing overflow');
        }
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), width + ': page overflow');
        // Tick the shared interval without rerendering props or fetching anything.
        await evaluate('fixture.advance(1000); new Promise(requestAnimationFrame)');
        assert.match(await text(95088), /in 1d 2h 3m 3s/);
        assert.match(await text(95163), /in 59s/);
        assert.match(await text(94825), /in 1s/);
        await evaluate('fixture.advance(1000); new Promise(requestAnimationFrame)');
        assert.match(await text(94825), /landing\/settling/);
        await evaluate('fixture.advance(58000); new Promise(requestAnimationFrame)');
        assert.match(await text(95163), /arriving\/settling/);
        await evaluate('fixture.returning(); new Promise(requestAnimationFrame)');
        assert.match(await text(95163), /Lands.*local[\s\S]*in 1m 0s/);
        assert.equal(await evaluate('fixture.fetches()'), 0);
        assert.equal(await evaluate('fixture.timers()'), 1);
        measurements.push({ timezoneId, width, rows: measured });
        if (artifacts) {
          const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          writeFileSync(join(artifacts, timezoneId.replace('/', '-') + '-' + width + '.png'), Buffer.from(data, 'base64'));
        }
        await evaluate('fixture.unmount(); new Promise(requestAnimationFrame)');
        assert.equal(await evaluate('fixture.timers()'), 0, 'unmount releases clock subscription');
      }
    }
    assert.notEqual(clocks[0], clocks[1], 'browser timezone changes the displayed clock');
    if (artifacts) writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
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
