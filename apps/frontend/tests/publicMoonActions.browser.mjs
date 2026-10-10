import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Public moon Attack loading, eligibility, navigation and responsive layout", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-public-moon-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.PUBLIC_MOON_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });

  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/publicMoonActions.html`;
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

    const attack = `document.querySelector('[aria-label="Moon actions"] button[aria-label^="Attack"]')`;
    async function until(expression) {
      const deadline = Date.now() + 15000;
      while (!await evaluate(expression)) {
        assert.ok(Date.now() < deadline, "fixture condition failed: " + expression + " — " + await evaluate("document.body.innerText"));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    for (const width of [1280, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      // Direct entry with an unresolved protection response must explain the guard.
      await send("Page.navigate", { url: url + "?mode=loading" });
      await until('Boolean(window.fixture && ' + attack + ')');
      assert.equal(await evaluate(attack + '.disabled'), true);
      assert.match(await evaluate('document.body.innerText'), /Checking attack protection/);
      await evaluate(attack + '.click()');
      assert.equal(await evaluate('fixture.launches.length'), 0);
      await evaluate('fixture.release()');
      await until(attack + ' && !' + attack + '.disabled');
      assert.ok(await evaluate('fixture.requests.some(url => url.includes("targetIsMoon=true"))'));
      // Keyboard activation traverses the real mounted button and callback.
      await evaluate(attack + '.focus()');
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await until('fixture.launches.length === 1');
      const launch = await evaluate('fixture.launches[0]');
      assert.equal(launch.action.kind, 'attack');
      assert.equal(launch.action.defaultTargetIsMoon, true);
      assert.equal(launch.targetId, '9');
      assert.deepEqual(launch.coords, { galaxy: 2, system: 44, position: 9 });
      const cases = [
        ['failed', /Refresh before attacking/],
        ['mismatch', /Refresh before attacking/],
        ['same_alliance', /target belongs to your alliance/],
        ['score_protection', /score-ratio protection/],
        ['bashing_limit', /bashing limit/],
        ['disconnected', /Connect a wallet/],
        ['no-ships', /Requires at least one movable ship/],
        ['no-callback', /Mission actions unavailable/],
        ['own', /You cannot attack your own moon/],
        ['busy', /Preparing mission/],
      ];
      for (const [mode, reason] of cases) {
        // Same-page target transitions use a fresh keyed component, like the app route.
        await evaluate('fixture.show(' + JSON.stringify(mode) + ')');
        await until(attack + ' && ' + attack + '.disabled && ' + reason + '.test(document.body.innerText)');
        assert.match(await evaluate(attack + '.getAttribute("aria-label")'), reason);
        assert.match(await evaluate(attack + '.parentElement.querySelector("p").innerText'), reason);
        await evaluate(attack + '.click()');
        assert.equal(await evaluate('fixture.launches.length'), 1);
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), width + ': page overflow');
        assert.ok(await evaluate(attack + '.checkVisibility()'), width + ': Attack not visible');
        if (artifacts && mode === 'failed') {
          const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          writeFileSync(join(artifacts, 'unavailable-' + width + '.png'), Buffer.from(data, 'base64'));
        }
      }
      await evaluate('fixture.show("eligible")');
      await until(attack + ' && !' + attack + '.disabled');
      const point = await evaluate('(() => {const b = ' + attack + ';const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:b.contains(document.elementFromPoint(x,y))};})()');
      assert.equal(point.hit, true);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await until('fixture.launches.length === 2');
      if (artifacts) {
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        writeFileSync(join(artifacts, 'eligible-' + width + '.png'), Buffer.from(data, 'base64'));
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
