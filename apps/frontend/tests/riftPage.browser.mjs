// Run from apps/frontend: node --test tests/riftPage.browser.mjs
// Optional RIFT_PAGE_ARTIFACTS=<dir> writes full-page screenshots. Local disposable Chrome only;
// the fixture stubs the Base RPC and records actions instead of sending transactions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Rift page injects, extracts, finalizes and shows history at desktop and phone width", { timeout: 180_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for the rendered Rift page regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-rift-page-"));
  const server = await createServer({
    // The Rift fixture renders no animated planets.
    plugins: [{ name: "rift-page-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.RIFT_PAGE_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/riftPage.html`;
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
    async function waitFor(expression, label) {
      const deadline = Date.now() + 20_000;
      while (!(await evaluate(`Boolean(${expression})`))) {
        assert.ok(Date.now() < deadline, `${label}\n` + await evaluate("document.body.innerText.slice(0, 1200)"));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    // Elements are found by their visible text, the way a player finds them.
    const button = text => `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
    const buttonStarting = text => `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    const text = () => evaluate("document.body.innerText");
    const calls = () => evaluate("JSON.parse(JSON.stringify(window.riftFixture.calls))");
    // Real pointer input: a mouse click on desktop, a touch tap on mobile.
    async function tap(element, mobile) {
      await evaluate(`${element}.scrollIntoView({ block: "center" })`);
      await settle();
      const box = await evaluate(`(() => { const r = ${element}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (mobile) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [box] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
      }
      await settle();
    }
    async function type(resource, value) {
      await evaluate(`(() => { const input = document.querySelector("#rift-amount-${resource}"); input.focus(); input.select(); })()`);
      await send("Input.insertText", { text: value });
      await settle();
    }
    // Full-page captures; they are review aids, not assertions.
    async function screenshot(name) {
      if (!artifacts) return;
      const height = await evaluate("document.documentElement.scrollHeight");
      const width = await evaluate("innerWidth");
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      writeFileSync(join(artifacts, name), Buffer.from(shot.data, "base64"));
    }

    for (const width of [1280, 390]) {
      const mobile = width < 640;
      const where = `${width}px`;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
      await send("Page.navigate", { url });
      await waitFor(`window.riftFixture && document.querySelector("#rift-amount-metal")`, `${where}: Rift page did not render`);
      assert.equal(await evaluate("document.querySelector('#rift-title').textContent"), "Move resources between Aurora Prime and your wallet", where);
      assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, `${where}: horizontal overflow`);
      // Each resource row labels its own amount box with the resource and what the planet holds.
      assert.match(await evaluate("document.querySelector('label[for=\"rift-amount-deuterium\"]').textContent"), /Deuterium\s*41,870/, `${where}: amount boxes are labelled`);
      await screenshot(`rift-page-${width}.png`);

      // Running extractions on every planet of the wallet, each with its countdown and raid exposure.
      const claims = await evaluate(`Array.from(document.querySelectorAll('[aria-labelledby="rift-claims-title"] li')).map(li => li.innerText)`);
      assert.equal(claims.length, 2, `${where}: ${JSON.stringify(claims)}`);
      assert.match(claims[0], /Metal[\s\S]*Aurora Prime[\s\S]*600,000[\s\S]*20d 0h[\s\S]*Open to raiders until [\s\S]*Raids took 400,000 \(40%\)/, where);
      assert.match(claims[1], /Crystal[\s\S]*Kestrel Reach[\s\S]*Ready[\s\S]*Finalize and receive 250,000 vCRYSTAL/, where);
      assert.equal(await evaluate(`${button("Finalize and receive 600,000 vMETAL")} === undefined`), true, `${where}: a locked extraction has nothing to finalize`);

      // History lists every planet, including the player's own raid.
      assert.equal(await evaluate(`document.querySelectorAll('[aria-labelledby="rift-history-title"] ol > li').length`), 5, where);
      assert.match(await text(), /You raided a Rift lock[\s\S]*From planet #77/, where);

      // Extract several resources at once: one extraction per resource per planet, and the raid risk must be acknowledged.
      assert.equal(await evaluate(`document.querySelector("#rift-amount-metal").disabled`), true, `${where}: Metal is already extracting`);
      assert.match(await evaluate(`document.querySelector("#rift-amount-metal-note").textContent`), /^Already extracting until /, where);
      assert.equal(await evaluate(`${buttonStarting("Start")}.disabled`), true, where);
      await type("deuterium", "999,999");
      assert.equal(await evaluate(`document.querySelector("#rift-amount-deuterium-note").textContent`), "Aurora Prime holds 41,870 Deuterium.", where);
      assert.equal(await evaluate(`document.querySelector("#rift-amount-deuterium-note").getAttribute("role")`), "alert", where);
      assert.equal(await evaluate(`${buttonStarting("Start")}.disabled`), true, where);
      await type("deuterium", "25,000");
      await type("crystal", "10,000");
      assert.match(await text(), /You receive up to 10,000 vCRYSTAL and 25,000 vDEUT in your wallet on /, where);
      assert.match(await text(), /even through newbie, score and bashing protection/, where);
      assert.match(await text(), /can't be cancelled/, where);
      assert.equal(await evaluate(`${button("Start 2 extractions")}.disabled`), true, `${where}: start needs the acknowledgement`);
      await tap(`document.querySelector('[aria-labelledby="rift-title"] input[type="checkbox"]')`, mobile);
      assert.equal(await evaluate(`${button("Start 2 extractions")}.disabled`), false, where);
      await screenshot(`rift-page-extract-${width}.png`);
      await tap(button("Start 2 extractions"), mobile);
      assert.deepEqual((await calls()).extract, ["crystal:10000", "deuterium:25000"], `${where}: one extraction per resource, in order`);
      assert.deepEqual(await evaluate(`["crystal", "deuterium"].map(key => document.querySelector("#rift-amount-" + key).value)`), ["", ""], `${where}: the started amounts clear`);
      assert.equal(await evaluate(`document.querySelector('[aria-labelledby="rift-title"] input[type="checkbox"]').checked`), false, `${where}: the acknowledgement resets`);

      // Inject: wallet balances come from the (stubbed) Base RPC; approve exactly the amounts, then inject once the allowances read back.
      await tap(buttonStarting("Inject into planet"), mobile);
      await waitFor(`document.querySelector('label[for="rift-amount-metal"]').textContent.includes("12,500,000")`, `${where}: wallet balance was not read`);
      await type("metal", "2500000");
      await type("deuterium", "1000000");
      assert.match(await text(), /Aurora Prime gets \+2,500,000 Metal and \+1,000,000 Deuterium right away\./, where);
      assert.equal(await evaluate(`${button("Inject")} === undefined`), true, `${where}: inject waits for approval`);
      await tap(button("Approve vMETAL and vDEUT"), mobile);
      assert.deepEqual((await calls()).approve, ["metal:2500000", "deuterium:1000000"], `${where}: approvals are exact, never unlimited`);
      await waitFor(`${button("Inject")} && !${button("Inject")}.disabled`, `${where}: allowances were not re-read after approval`);
      await tap(button("Inject"), mobile);
      assert.deepEqual((await calls()).deposit, ["metal:2500000", "deuterium:1000000"], where);
      await type("metal", "12500001");
      assert.equal(await evaluate(`document.querySelector("#rift-amount-metal-note").textContent`), "Your wallet holds 12,500,000 vMETAL.", `${where}: insufficient balance`);
      assert.equal(await evaluate(`document.querySelector('button[aria-label="Max Crystal"]').disabled`), true, `${where}: no vCRYSTAL to inject`);
      await screenshot(`rift-page-inject-${width}.png`);

      // A ready extraction on another planet finalizes from here.
      await tap(button("Finalize and receive 250,000 vCRYSTAL"), mobile);
      assert.deepEqual((await calls()).finalize, ["extraction:2:1"], where);
      if (mobile) {
        for (const label of ["Extract to wallet", "Inject into planet", "Max", "Inject", "Finalize and receive 250,000 vCRYSTAL"]) {
          const height = await evaluate(`${button(label)}.getBoundingClientRect().height`);
          assert.ok(height >= 40, `${where}: ${label} tap target ${height}px`);
        }
      }
      console.log("PASS rift page", where);

      // Without a Stabilizer the page explains how to unlock it and points to planets that have one.
      await send("Page.navigate", { url: `${url}?state=locked` });
      await waitFor(`document.querySelector("#rift-locked-title")`, `${where}: locked Rift did not render`);
      assert.equal(await evaluate(`document.querySelector("#rift-locked-title").textContent`), "Build a Rift Stabilizer on Aurora Prime", where);
      assert.match(await text(), /Energy Technology 5/, where);
      assert.equal(await evaluate(`document.querySelector("#rift-amount-metal")`), null, `${where}: no actions without a Stabilizer`);
      assert.equal(await evaluate(`document.querySelectorAll('[aria-labelledby="rift-claims-title"] li').length`), 2, `${where}: claims stay finalizable`);
      await tap(button("Use the Rift on Kestrel Reach"), mobile);
      assert.deepEqual((await calls()).select, ["2"], where);
      assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, `${where}: horizontal overflow`);
      await screenshot(`rift-page-locked-${width}.png`);
      console.log("PASS rift page locked", where);
    }
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
