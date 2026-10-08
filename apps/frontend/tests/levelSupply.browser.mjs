// Run from apps/frontend: node --test tests/levelSupply.browser.mjs
// Optional LEVEL_SUPPLY_ARTIFACTS writes screenshots and layout evidence. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Upgrade rows open the existing Supply planner without launch on desktop/mobile", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const server = await createServer({
    // These fixtures render level tables/cargo controls, not animated planets.
    plugins: [{ name: "level-supply-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) { animations.buildStart = undefined; animations.configureServer = undefined; }
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.LEVEL_SUPPLY_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/levelSupply.html`;
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
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    for (const width of [1280, 390]) {
      for (const kind of ['building', 'moon', 'research', 'binary']) {
        const label = kind === 'research' ? 'Energy Technology' : kind === 'binary' ? 'Rift Stabilizer' : 'Robotics Factory';
        const level = kind === 'binary' ? 1 : 9;
        const selector = 'button[aria-label="Supply ' + label + ' Level ' + level + '"]';
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
        await send('Page.navigate', { url: url + '?kind=' + kind });
        const deadline = Date.now() + 20000;
        while (!(await evaluate('Boolean(window.levelFixture && document.querySelector(' + JSON.stringify(selector) + '))'))) {
          assert.ok(Date.now() < deadline, 'level fixture did not render: ' + kind);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (level === 9) assert.equal(await evaluate('Boolean(document.querySelector(' + JSON.stringify(selector.replace('Level 9', 'Level 8')) + '))'), false);
        await evaluate('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"center"}); document.querySelector(' + JSON.stringify(selector) + ').focus()');
        if (kind === 'building' && artifacts) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, 'level-table-' + width + '.png'), Buffer.from(shot.data, 'base64')); }
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await settle();
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(await evaluate('document.querySelector("input") !== null'), await evaluate('document.body.textContent.slice(0, 1500)'));
        const expected = kind === 'research' ? ['','204080','101200'] : kind === 'binary' ? ['5600','7280','2800'] : ['100000','30000','50000'];
        assert.deepEqual(await evaluate('["metal","crystal","deuterium"].map(r=>Array.from(document.querySelectorAll("input")).find(el=>el.getAttribute("aria-label")===r+" to send").value)'), expected);
        assert.equal(await evaluate('window.levelFixture.launches()'), 0);
        const text = await evaluate(`document.querySelector('section[aria-label="Upgrade requirement"]').textContent`);
        assert.ok(text.includes(label) && text.includes('Level ' + level) && text.includes('1:1:2'));
        assert.ok(text.includes(kind === 'moon' ? 'Moon' : 'Planet'));
        assert.ok(text.includes('this level only'));
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Close supply resources');
        assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
        assert.equal(await evaluate('Array.from(document.querySelectorAll("input")).some(el => el.getBoundingClientRect().right > innerWidth)'), false);
        if (kind === 'building') {
          if (artifacts) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, 'level-supply-' + width + '.png'), Buffer.from(shot.data, 'base64')); }
          await evaluate('window.levelFixture.spend(); Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Refresh destination and shortfall").click()');
          await settle();
          assert.equal(await evaluate('Array.from(document.querySelectorAll("input")).find(el=>el.getAttribute("aria-label")==="metal to send").value'), '102400');
        }
        await evaluate('window.levelFixture.full(); Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Refresh destination and shortfall").click()');
        await settle();
        assert.equal(await evaluate('document.querySelector("footer button").disabled'), true);
        assert.ok(await evaluate('document.body.textContent.includes("Fully funded")'));
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await settle();
        assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'), 1);
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Supply ' + label + ' Level ' + level);
        assert.equal(await evaluate('window.levelFixture.launches()'), 0);
        if (kind === 'building') {
          const later = selector.replace('Level 9', 'Level 10');
          await evaluate('document.querySelector(' + JSON.stringify(later) + ').click()');
          await settle();
          assert.equal(await evaluate('Array.from(document.querySelectorAll("input")).find(el=>el.getAttribute("aria-label")==="metal to send").value'), '102400');
          assert.ok(await evaluate(`document.querySelector('section[aria-label="Upgrade requirement"]').textContent.includes("204,800")`));
        }
        console.log('PASS level-to-Supply handoff', kind, width);
      }
    }
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
