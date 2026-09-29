import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

test("Resolved group mission labels, scope and actions survive desktop/mobile sizing", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-group-missions-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.GROUP_MISSIONS_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/resolvedGroupMissions.html`;
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

    const rowsExpression = '[...document.querySelectorAll("[data-mission-row]")].filter(row => row.getBoundingClientRect().height > 0)';
    for (const width of [1440, 1100, 791, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
      await send('Page.navigate', { url });
      const deadline = Date.now() + 20000;
      while (await evaluate('(' + rowsExpression + ').length') !== 4) {
        assert.ok(Date.now() < deadline, 'four fixture rows did not render: ' + await evaluate('document.body.innerText'));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await evaluate('document.fonts.ready');
      const measured = await evaluate('(' + rowsExpression + ').map(row => { const s = row.querySelector("summary"); const badge = s.querySelector("[title]"); const b = badge.getBoundingClientRect(); const route = s.children[1].getBoundingClientRect(); return { text: s.innerText, label: badge.textContent, whiteSpace: getComputedStyle(badge).whiteSpace, clipped: badge.scrollWidth > badge.clientWidth + 1 || badge.scrollHeight > badge.clientHeight + 1, collision: b.top < route.bottom && route.top < b.bottom && b.right > route.left, columns: [...s.children].map(el => Math.round(el.getBoundingClientRect().x)) }; })');
      for (const [i, row] of measured.entries()) {
        assert.equal(row.label, 'Incoming group attack');
        assert.equal(row.clipped, false, width + ': label clipping');
        assert.equal(row.collision, false, width + ': route collision');
        assert.match(row.text, /Shared battle/);
        assert.match(row.text, /#94880/);
        assert.match(row.text, /Group losses/);
        assert.match(row.text, /Draw/);
        assert.ok(row.text.includes('#' + [94889,94888,94887,94886][i]));
        if (width >= 1024) assert.deepEqual(row.columns, measured[0].columns, 'aligned columns');
      }
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), width + ': page horizontal overflow');
      // Native keyboard disclosure and both actions: participant identity is never replaced by leader.
      await evaluate('(' + rowsExpression + ')[0].open = false; (' + rowsExpression + ')[0].querySelector("summary").focus()');
      assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await evaluate('new Promise(requestAnimationFrame)');
      assert.equal(await evaluate('(' + rowsExpression + ')[0].open'), true, width + ': keyboard disclosure');
      assert.match(await evaluate('(' + rowsExpression + ')[0].innerText'), /Individual fleet losses are unavailable/);
      await evaluate('(' + rowsExpression + ')[0].querySelector("button[aria-label=Open]").click()');
      assert.equal(await evaluate('document.querySelector("output").textContent'), '94889');
      await evaluate('[...(' + rowsExpression + ')[0].querySelectorAll("button")].find(b => b.textContent.includes("participants")).click()');
      assert.equal(await evaluate('document.querySelector("output").textContent'), '94880');
      measurements.push({ width, rows: measured });
      if (artifacts) {
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        writeFileSync(join(artifacts, width + '.png'), Buffer.from(data, 'base64'));
      }
    }
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
