import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import preact from "@preact/preset-vite";
import { freePort } from "./freePort.mjs";

test("Combat verification preserves mounted reports and fails closed", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for mounted combat regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-combat-refresh-"));
  const server = await createServer({ configFile: false, plugins: [preact()], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/combatModelRefresh.html`;
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

    async function until(expression, label) {
      const deadline = Date.now() + 20_000;
      while (!await evaluate(expression)) {
        assert.ok(Date.now() < deadline, label + ': ' + await evaluate('document.body.innerText'));
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    const disclosure = 'document.querySelector("details")';
    const invalid = '[...document.querySelectorAll("button")].some(b => b.getAttribute("aria-label") === "Open simulated battle report" && b.disabled)';
    async function fresh() {
      await send('Page.navigate', { url });
      await until('Boolean(window.fixture && document.querySelector("summary"))', 'verified composer');
      await evaluate('document.querySelector("summary").click()');
      await until(disclosure + '?.open && document.body.innerText.includes("Round 1")', 'real worker report');
      await evaluate('window.savedReport = document.querySelector("details")');
    }
    async function staysOpen() {
      assert.equal(await evaluate('savedReport.isConnected && savedReport.open && savedReport === document.querySelector("details")'), true, 'same report stays mounted and open');
      assert.match(await evaluate('savedReport.innerText'), /Round 1/);
    }
    async function invalidated() {
      await until(invalid, 'capability invalidated');
      assert.equal(await evaluate('savedReport.isConnected'), false, 'stale report removed');
      assert.equal(await evaluate('document.querySelector("details")'), null);
    }

    await fresh();
    for (let refresh = 0; refresh < 3; refresh++) {
      await evaluate('fixture.mode("pending"); fixture.advance(15000)');
      await until('fixture.pending().length === 1', 'refresh pending');
      await staysOpen();
      await evaluate('fixture.advance(1000); fixture.resolve()');
      await until('fixture.timers().includes(15000)', 'refresh finished');
      await staysOpen();
    }
    await evaluate('fixture.mode("mismatch"); fixture.advance(15000)');
    await invalidated();
    await evaluate('fixture.mode("success"); fixture.advance(15000)');
    await until('Boolean(document.querySelector("summary"))', 'fresh verification recovers');
    assert.equal(await evaluate(disclosure + '.open'), false, 'recovery must not resurrect an open stale report');

    await fresh();
    await evaluate('fixture.mode("failure"); fixture.advance(15000)');
    await invalidated();

    for (const path of ['/runtime-config', '/combat-model']) {
      await fresh();
      await evaluate('fixture.mode("pending", ' + JSON.stringify(path) + '); fixture.advance(15000)');
      await until('fixture.pending().length === 1', 'hanging request');
      await evaluate('fixture.advance(4999)');
      await staysOpen();
      await evaluate('fixture.advance(1)');
      await invalidated();
      assert.equal(await evaluate('fixture.pending()[0].aborted'), true, 'deadline aborts transport');
      const before = await evaluate('fixture.requests()');
      await evaluate('fixture.resolve()');
      await until('fixture.timers().includes(15000)', 'late response finished');
      await invalidated();
      assert.equal(await evaluate('fixture.requests()'), before, 'late config cannot start a model request');
    }

    // Recheck dispatch can be delayed by tab throttling: the success lease still
    // expires at 20s, before a newly started request reaches its 5s deadline.
    await fresh();
    await evaluate('fixture.mode("pending"); fixture.advance(18000)');
    await until('fixture.pending().length === 1', 'delayed refresh');
    await staysOpen();
    await evaluate('fixture.advance(2000)');
    await invalidated();
    assert.equal(await evaluate('fixture.pending()[0].aborted'), true, 'lease expiry retires the pending request');
    await evaluate('fixture.resolve()');
    await until('fixture.timers().includes(15000)', 'expired request finished');
    await invalidated();

    // A fulfilled response may run before overdue timeout/lease callbacks after sleep.
    for (const refreshAt of [15000, 18000]) {
      await fresh();
      await evaluate('fixture.mode("pending"); fixture.advance(' + refreshAt + ')');
      await until('fixture.pending().length === 1', 'suspended refresh');
      await evaluate('fixture.advance(' + (20001 - refreshAt) + ', false); fixture.resolve()');
      await invalidated();
    }

    await fresh();
    await evaluate('fixture.mode("pending"); fixture.advance(15000)');
    await until('fixture.pending().length === 1', 'unmount pending refresh');
    await evaluate('fixture.unmount()');
    assert.deepEqual(await evaluate('fixture.timers()'), [], 'unmount releases capability timers');
    assert.equal(await evaluate('fixture.pending()[0].aborted'), true);
    // Remount must verify independently despite the retained outcome cache.
    await evaluate('fixture.mode("mismatch"); fixture.mount()');
    await until(invalid, 'remount fail closed');
    await until('fixture.timers().includes(15000)', 'remount check finished');
    const before = await evaluate('fixture.requests()');
    await evaluate('fixture.resolve()');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await evaluate(invalid), true, 'unmounted response cannot resurrect verification');
    assert.equal(await evaluate('fixture.requests()'), before);
    await evaluate('fixture.unmount(); fixture.advance(60000)');
    assert.deepEqual(await evaluate('fixture.timers()'), []);
    assert.equal(await evaluate('fixture.requests()'), before, 'no polls after unmount');
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
