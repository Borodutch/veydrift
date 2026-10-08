// Run from apps/frontend: node --test tests/supplyConfirmation.browser.mjs
// Local disposable Chrome only; all backend and wallet boundaries are mocked.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Production Supply confirmation lifecycle prevents stale and duplicate launches", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const server = await createServer({ cacheDir: join(profile, "vite-cache"),
    // These fixtures render level tables/cargo controls, not animated planets.
    plugins: [{ name: "level-supply-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) { animations.buildStart = undefined; animations.configureServer = undefined; }
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplyConfirmation.html`;
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
    const f = 'confirmationFixture';
    const launch = 'document.querySelector("footer button")';
    const input = `document.querySelector('input[aria-label="metal to send"]')`;
    async function until(expression) {
      const deadline = Date.now() + 20000;
      while (!(await evaluate(expression))) {
        assert.ok(Date.now() < deadline, expression + ': ' + await evaluate('document.body.textContent.slice(-1200)'));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await settle();
    }
    async function load(width = 1280) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 568, deviceScaleFactor: 1, mobile: width < 640 });
      await send('Page.navigate', { url });
      await until('window.confirmationFixture && document.querySelector("footer button") && !document.querySelector("footer button").disabled');
    }
    const state = () => evaluate(f + '.state()');
    async function submit() { await evaluate(launch + '.click()'); await settle(); }
    const refresh = '[...document.querySelectorAll("button")].find(b => b.textContent === "Refresh destination and shortfall")';
    for (const width of [1280, 390]) {
      await load(width);
      await evaluate(f + '.spend()'); await submit();
      await until(f + '.state().completed === 1');
      assert.equal((await state()).sent.length, 0);
      assert.equal(await evaluate(input + '.value'), '12300', 'preflight preserves reviewed cargo');
      assert.equal(await evaluate(launch + '.disabled'), true, 'second confirmation disabled until explicit goal review');
      assert.ok(await evaluate('document.body.textContent.includes("Destination goal changed")'));
      assert.ok(await evaluate(`document.querySelector('section[aria-label="Supply totals"]').textContent.includes("RemainingM 500")`));
      await submit();
      assert.equal((await state()).runs, 1, 'disabled second click never launches');
      await evaluate(refresh + '.click()'); await settle();
      await until(input + '.value === "12800"');
      assert.equal(await evaluate(launch + '.disabled'), false);
      await submit(); await until(f + '.state().sent.length === 1');
      const data = (await state()).sent[0][0].data;
      assert.equal(data.slice(0, 10), '0x9c26e0be');
      const words = data.slice(10).match(/.{64}/g).map(value => BigInt('0x' + value));
      assert.equal(words[0], 831n);
      assert.deepEqual(words.slice(-4), [12800n, 3340n, 6400n, 100n]);
      assert.ok((await state()).calls.every(call => call.id === '831' && call.options.fresh));
      console.log('PASS production goal review and exact calldata', width);
    }
    await load();
    await evaluate(f + '.defer(); ' + refresh + '.click()'); await settle();
    await evaluate(f + '.spend(); void ' + f + '.refresh()'); await settle();
    assert.equal((await state()).reads.length, 2);
    await evaluate(f + '.resolve(1)'); await until(input + '.value === "12800"');
    await evaluate(f + '.resolve(0)'); await settle();
    assert.equal(await evaluate(input + '.value'), '12800', 'older refresh cannot restore obsolete shortfall');
    console.log('PASS production out-of-order destination refresh');

    for (const kind of ['account', 'destination']) {
      for (const stage of ['read', 'send']) {
        await load();
        if (stage === 'read') await evaluate(f + '.defer()');
        else await evaluate(f + '.holdSend()');
        // Two real DOM activations in one tick exercise the synchronous submit lock.
        await evaluate(launch + '.click(); ' + launch + '.click()'); await settle();
        assert.equal((await state()).runs, 1, 'duplicate handler dispatch is locked');
        if (stage === 'read') {
          await evaluate(f + '.resolve()');
          await until(f + '.state().reads[0]?.kind === "infrastructure"');
        } else await until(f + '.state().sendWaiting');
        await evaluate(f + '.switch(' + JSON.stringify(kind) + ')'); await settle();
        if (stage === 'read') await evaluate(f + '.resolve()');
        else await evaluate(f + '.releaseSend()');
        await until(f + '.state().completed === 1');
        assert.equal((await state()).sent.length, 0, 'obsolete context must never reach wallet');
        assert.equal((await state()).initialRequested.metal, 12300);
        assert.equal((await state()).target, kind === 'account' ? '831' : '832');
        console.log('PASS production duplicate and ' + kind + ' switch during ' + stage);
      }
      await load();
      await evaluate(f + '.defer(); void ' + f + '.refresh()');
      await evaluate(f + '.switch(' + JSON.stringify(kind) + ')'); await settle();
      await evaluate(f + '.resolve()'); await settle();
      assert.equal((await state()).preview, undefined, 'obsolete refresh cannot publish preview');
      assert.equal((await state()).loading, false);
    }
    await load(); await evaluate(f + '.defer()'); await submit();
    await evaluate(f + '.resolve()'); await until(f + '.state().reads[0]?.kind === "infrastructure"');
    await evaluate(f + '.unmount(); ' + f + '.resolve()');
    await until(f + '.state().completed === 1');
    assert.equal((await state()).sent.length, 0, 'unmounted handler cannot send');
    console.log('PASS production unmount while reading');
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
